-- 0015_security_hardening.sql — Pre-release security review fixes.
-- ============================================================================
-- Closes privilege-escalation, IDOR, and data-exposure holes found while
-- auditing the schema before the Play Store release. Idempotent and additive;
-- db-apply wraps it in a single transaction (all-or-nothing).
--
-- Each fix was verified against the CLIENT's real access patterns so nothing
-- legitimate breaks:
--   • Normal profile edits (display_name/about/avatar/links/last_seen) never
--     touch the privileged columns, so FIX 1 is invisible to them.
--   • Client payment activation is disabled pre-launch (PAYMENTS_READY=false),
--     and premium is granted via admin_grant_premium()/developer override, so
--     removing client writes on subscriptions (FIX 2) changes no live flow.
--   • getSubscription() reads the caller's own row via "read own subscription"
--     (kept), and premium badges read the premium_users view (FIX 5).
--   • Group creation adds participants to a conversation the caller CREATED, so
--     the created_by branch in FIX 3 keeps it working; 1:1 chats use the
--     SECURITY DEFINER start_direct_conversation() and are unaffected.
--   • Media is uploaded to `<conversation_id>/<file>`, so scoping the bucket to
--     conversation membership (FIX 4) matches every real object.
-- ============================================================================

-- ── FIX 1 (CRITICAL) — no self-service admin / self-unban via profiles UPDATE ──
-- "update own profile" (0001) has no column scope and 0004 grants UPDATE on all
-- columns, so any user could `update profiles set role='admin'` (→ is_admin) or
-- clear their own ban/suspension/verified flags. Freeze the privileged columns
-- with a BEFORE UPDATE trigger: unless the caller is an admin, these columns are
-- reset to their prior values. Admin changes still flow through the 0013 RPCs
-- (SECURITY DEFINER; auth.uid() is still the admin, so is_admin() passes here).
create or replace function public.guard_profile_privileged()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then
    new.role            := old.role;
    new.account_status  := old.account_status;
    new.status_reason   := old.status_reason;
    new.suspended_until := old.suspended_until;
    new.verified        := old.verified;
    new.verified_at     := old.verified_at;
    new.banned_at       := old.banned_at;
    new.deleted_at      := old.deleted_at;
    new.force_logout_at := old.force_logout_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_profile_privileged on public.profiles;
create trigger trg_guard_profile_privileged
  before update on public.profiles
  for each row execute function public.guard_profile_privileged();

-- ── FIX 2 (CRITICAL) — no self-service Premium via direct subscriptions write ──
-- "insert/update own subscription" (0003) let any user write their own active
-- row (→ is_premium) with zero payment verification. Remove client writes; the
-- only writers become admin_grant_premium()/admin_revoke_premium() (owner/admin,
-- SECURITY DEFINER) and the future server-side payment webhook.
drop policy if exists "insert own subscription" on public.subscriptions;
drop policy if exists "update own subscription" on public.subscriptions;
revoke insert, update, delete on public.subscriptions from authenticated;

-- ── FIX 5 (HIGH) — stop exposing every subscriber's billing row to all users ──
-- "read premium flags" (0003) returned WHOLE subscription rows (provider ids,
-- amount, period) of every active subscriber to any authenticated user (and over
-- Realtime). Drop it; keep read-own; expose only user_id for badges via the
-- premium_users view, switched to run with the view owner's rights (so it no
-- longer needs a broad table SELECT policy). Also stop broadcasting the table.
drop policy if exists "read premium flags" on public.subscriptions;
alter view public.premium_users set (security_invoker = off);
grant select on public.premium_users to authenticated;
do $$ begin
  alter publication supabase_realtime drop table public.subscriptions;
exception when others then null; -- not in the publication ⇒ nothing to do
end $$;

-- ── FIX 3 (HIGH) — close conversation-participant IDOR (self-add to any chat) ──
-- "add participants" (0001) allowed `user_id = auth.uid()` UNCONDITIONALLY, so
-- knowing any conversation_id let an attacker insert themselves and then read /
-- post to that private chat. Allow self/other adds only if you're already a
-- member OR you created the conversation (group bootstrap). 1:1 chats go through
-- the SECURITY DEFINER start_direct_conversation() and bypass this policy.
drop policy if exists "add participants" on public.conversation_participants;
create policy "add participants" on public.conversation_participants
  for insert to authenticated
  with check (
    public.is_member(conversation_id)
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.created_by = auth.uid()
    )
  );

-- ── FIX 4 (HIGH) — scope the private `media` bucket to conversation membership ─
-- "media auth read/write" (0002) let ANY authenticated user read (and list) or
-- write EVERY object in the media bucket. Objects live at `<conversation_id>/…`,
-- so gate on membership of that conversation. The regex guard avoids a uuid-cast
-- error on any legacy/odd path (is_member(null) ⇒ false ⇒ denied).
drop policy if exists "media auth read" on storage.objects;
create policy "media auth read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and public.is_member(
      case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
           then ((storage.foldername(name))[1])::uuid end)
  );

drop policy if exists "media auth write" on storage.objects;
create policy "media auth write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and public.is_member(
      case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
           then ((storage.foldername(name))[1])::uuid end)
  );

-- ── FIX 6 (MEDIUM) — event RSVPs were world-readable (leaks who attends what) ──
-- "read rsvps" (0007) used USING (true). Scope to the event's audience.
drop policy if exists "read rsvps" on public.event_rsvps;
create policy "read rsvps" on public.event_rsvps
  for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id
        and (
          (e.conversation_id is not null and public.is_member(e.conversation_id))
          or (e.community_id is not null and public.is_community_member(e.community_id))
        )
    )
  );

-- ── FIX 7 (LOW) — reactions could be attached to messages you can't see ────────
-- The reactions SELECT policy already checks conversation membership; the INSERT
-- policy only checked ownership. Mirror the membership check so you can only
-- react within conversations you belong to.
drop policy if exists "Users can add their own reactions" on public.message_reactions;
create policy "Users can add their own reactions"
  on public.message_reactions for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.is_member((select conversation_id from public.messages where id = message_id))
  );

-- ============================================================================
-- KNOWN, INTENTIONALLY-DEFERRED (documented, needs app changes — not applied):
--   • profiles SELECT (0001) exposes phone + moderation columns to all users.
--     Proper fix = a public_profiles view (no phone/status) + repointing every
--     getProfile('*') read; too broad to land blindly on prod here. Track as a
--     follow-up before enabling phone-based discovery.
-- ============================================================================
