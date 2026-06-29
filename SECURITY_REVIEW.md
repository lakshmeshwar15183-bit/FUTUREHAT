# FUTUREHAT — Security review (RLS + backend authorization)

_2026-06-30. Static review of `supabase/migrations/0001–0009` and the web/shared
data layer. Maps the requested enterprise-security checklist to what the stack
actually provides, what this codebase enforces, and concrete gaps._

## Auth & transport model
- **Auth**: Supabase Auth (email/password). Passwords hashed with bcrypt by
  Supabase (✅ secure password storage). JWT access tokens + refresh-token
  rotation are managed by Supabase (✅ JWT rotation, refresh security).
- **Transport**: All client↔Supabase and client↔Netlify traffic is HTTPS/WSS
  (✅ encryption in transit). Realtime WebSocket is authenticated by the JWT via
  `setAuth()` (✅ secure WS auth — note the e2e harness bug fixed in `8ee9186`:
  must `await setAuth` before join or RLS postgres_changes aren't delivered).
- **At rest**: Postgres + Storage encryption handled by the provider
  (✅ encryption at rest).
- **Headers** (added `netlify.toml`, this batch): CSP, HSTS (2y, preload),
  X-Frame-Options DENY + `frame-ancestors 'none'` (clickjacking), nosniff,
  Referrer-Policy, Permissions-Policy, COOP. (✅ security headers, CSP, HSTS —
  verify at runtime after deploy.)

## RLS posture per table (enabled + policy intent)
All public tables have RLS enabled. Verified policies:
- **profiles** — readable by authenticated; update self only. ✅
- **conversations / conversation_participants / messages / message_receipts** —
  gated by `is_member()` (SECURITY DEFINER, avoids recursive RLS). Send as self;
  edit own messages only. ✅
- **message_reactions** — read if in conversation; write self. ✅
- **statuses** — read if not expired; write/delete self. ✅
- **subscriptions / user_preferences / pinned / hidden / scheduled_messages** —
  self-scoped; hidden+scheduled inserts additionally gated by `is_premium()`. ✅
- **calls** — members of the conversation only. ✅
- **communities / community_members / channels** — `is_community_member` /
  `is_community_admin` (SECURITY DEFINER). ✅
- **polls / poll_votes / events / event_rsvps** — conversation/community scoped;
  votes/rsvps self-scoped. ✅
- **reports / support_tickets** — insert+read self; **admin read+update** added
  in 0009 (OR'd with self policies; admin = developer allowlist via `is_admin`). ✅
- **blocked_users / muted_conversations** — fully self-scoped. ✅
- **developer_accounts** — RLS on, **zero policies**, client grants revoked →
  deny-all to anon/authenticated; only service_role/migrations can read/write.
  `is_developer/is_admin` are SECURITY DEFINER and expose booleans only. ✅
  (No client-writable admin flag exists — privilege escalation surface is closed.)

## Already covered by the stack / this codebase
✅ SQL injection — all queries parameterized via supabase-js; no string SQL.
✅ XSS — React escapes by default; no `dangerouslySetInnerHTML` in the app.
✅ CSRF — bearer-token auth (no ambient cookies) → negligible CSRF surface.
✅ Secrets management — anon key is public-by-design; service role/DB password
   never shipped to client; AI keys live in edge-function secrets.
✅ Authorization — enforced at the DB (RLS) not just the client; admin gated by
   `is_admin`; AI edge function re-checks `is_premium` server-side.
✅ Secure file uploads (partial) — media bucket private; type/size checked client
   side (2MB free / 25MB premium); avatars upsert JPEG.

## Gaps / recommendations (prioritized)
1. **Rate limiting / brute-force / anti-spam** — Supabase Auth has basic limits;
   add per-action throttling (e.g. edge function + a `rate_limits` table or a
   gateway) for message send, report/ticket spam, signup. 🟡 needs backend.
2. **Audit logs / tamper detection** — add an append-only `audit_log` table
   written by SECURITY DEFINER triggers on sensitive actions (role changes,
   blocks, admin status updates). ❌ not yet — recommended.
3. **Server-side upload validation / malware scan** — currently client-side
   size/type only. Add an edge function to validate magic bytes + (optionally)
   call an AV/scanning service on upload. 🟡 validation feasible; ❌ malware
   scan needs an external service (e.g. VirusTotal/ClamAV) — not possible from
   the app alone.
4. **Session/device management** — Supabase doesn't expose all sessions to the
   client; a "logged-in devices + remote logout" feature needs the Admin API via
   an edge function, or a custom `sessions` table. ❌ needs backend.
5. **Razorpay signature verification** — payment success is trusted client-side;
   verify the signature in an edge function before activating premium. 🟡 known.
6. **Replay protection** — realtime/broadcast (typing, call signaling) is
   ephemeral; acceptable. For any future state-changing broadcast, add nonces. 🟡

## Not possible from a coding agent (require infra/ops or native platform)
❌ Device binding / MDM · ❌ Screenshot protection on web (no browser API) ·
❌ Proxy support (browser can't set proxies) · ❌ Network-usage metering (no API) ·
❌ Real malware scanning (external service) · ❌ True E2E "secret chat" crypto is
a large dedicated project (deferred by decision).
