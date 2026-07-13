# FUTUREHAT — Permanent Developer Override

Lifetime **Premium + Admin** for a fixed allowlist of emails, bypassing all
payment / subscription / Razorpay checks — **for those emails only**. Everyone
else follows the normal subscription flow, unchanged.

Implemented in `supabase/migrations/0005_developer_override.sql`. It lives in the
database, so it **survives every deployment and code update**.

## How it works

| Piece | Role |
|-------|------|
| `developer_accounts` (table) | The permanent allowlist — the single source of truth. RLS-locked, all client grants revoked. |
| `is_developer(uid)` | SECURITY DEFINER; true if the user's `auth.users.email` is in the allowlist (case-insensitive). |
| `is_premium(uid)` | Now returns `is_developer(uid) OR active-subscription`. |
| `is_admin(uid)` | Returns `is_developer(uid)`. |
| `provision_developer(uid)` | Inserts a lifetime `subscriptions` row (`provider='developer'`, ends 2099). Idempotent. |
| `handle_new_user()` | Signup trigger now calls `provision_developer`, so a dev is provisioned on first login. |
| Backfill block | Provisions any dev email that already had an account before this migration. |

Because **every** premium gate (RLS for hidden/scheduled chats, optional writing
tools, the premium-badge view, and any *future* premium feature) consults
`is_premium()`, the override applies everywhere with **no per-feature code**.

The web client (`PremiumContext`) also calls the `is_premium` / `is_admin` RPCs
and ORs them into `isPremium`, exposing `isAdmin`. So the developer shows as
Premium on every login even if the subscription row were ever removed, and any
current/future admin UI can gate on `isAdmin`.

## Security

- **No self-grant.** `developer_accounts` has RLS enabled with **no policies** and
  every client grant revoked (including the broad DML and default-privileges from
  `0004_grants.sql`). No `anon`/`authenticated` user can read it or insert their
  own email. Only `service_role` / migrations (the `postgres` role) can edit it.
- **No client-writable admin flag.** Admin is derived from the protected allowlist
  via a SECURITY DEFINER function — there is no `profiles.is_admin` column a user
  could flip on their own row.
- The gate functions are SECURITY DEFINER only so they can read `auth.users` for
  the email match; they return booleans, never user data, and pin `search_path`.
- Scope is exact: the override keys off the email string, so it applies to that
  account and no other.

## Managing developers

Add another developer (run in the Supabase SQL editor / a migration — **not** from
a client):

```sql
insert into public.developer_accounts (email, note)
values ('someone@example.com', 'reason')
on conflict (email) do nothing;
-- provision immediately if they already have an account:
select public.provision_developer(u.id)
from auth.users u where lower(u.email) = 'someone@example.com';
```

Revoke a developer:

```sql
delete from public.developer_accounts where lower(email) = 'someone@example.com';
update public.subscriptions set status = 'expired'
where user_id = (select id from auth.users where lower(email) = 'someone@example.com');
```

## Verify

`node web/scripts/verify-dev.mjs` (env `FH_URL`, `FH_ANON`; optional
`FH_DEV_EMAIL`, `FH_DEV_PASSWORD`) signs in (or signs up) the developer account
and asserts `is_premium`, `is_admin`, and the lifetime subscription row.
