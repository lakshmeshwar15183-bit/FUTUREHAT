-- 0016_delete_for_me.sql — WhatsApp-style "Delete chat for me" for ALL users.
-- Idempotent. Apply after 0015.
-- ============================================================================
-- Background: "Hide chat" (hidden_conversations, 0003) is a PREMIUM privacy
-- feature — its INSERT policy is gated behind is_premium(). "Delete for me" is a
-- different, basic action every user expects (like WhatsApp): it clears the
-- thread for this user only and removes the chat from their list, while the peer
-- keeps their copy. Reusing hidden_conversations forced delete-for-me through the
-- premium gate, so free users got "Could not delete". This table gives delete
-- its own, ungated home; premium "hide" stays exactly as-is.

create table if not exists public.deleted_conversations (
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  deleted_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.deleted_conversations enable row level security;

-- Delete-for-me is free: a user may add/read/remove ONLY their own rows. No
-- premium check (contrast hidden_conversations). Removing a row (e.g. when a new
-- message revives the chat) stays available regardless of premium status.
drop policy if exists "manage own deleted" on public.deleted_conversations;
create policy "read own deleted" on public.deleted_conversations
  for select to authenticated using (auth.uid() = user_id);
create policy "insert own deleted" on public.deleted_conversations
  for insert to authenticated with check (auth.uid() = user_id);
create policy "delete own deleted" on public.deleted_conversations
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, delete on public.deleted_conversations to authenticated;
