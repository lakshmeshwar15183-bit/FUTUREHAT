-- 0004_grants.sql — Base table/sequence/function privileges for the API roles.
--
-- Why this exists: 0001/0002/0003 enable Row Level Security and define policies
-- (all scoped `to authenticated`), but never GRANT the underlying table
-- privileges to the `authenticated` role. Postgres checks the role's GRANT
-- BEFORE it ever consults RLS, so direct table access raised
--   "permission denied for table profiles" / "... messages"
-- for logged-in users. (RPCs like start_direct_conversation worked only because
-- they are SECURITY DEFINER and run as the owner.) Surfaced by the full
-- authenticated E2E once email-confirmation was disabled.
--
-- RLS remains the real access gate — these grants just let the role reach the
-- tables so the policies can be evaluated. Mirrors Supabase's default role grants.

grant usage on schema public to anon, authenticated;

-- Logged-in users: full DML, gated row-by-row by the existing RLS policies.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- UUID PKs don't use sequences, but premium counters/defaults might — grant for safety.
grant usage, select on all sequences in schema public to anon, authenticated;

-- Helper functions (is_member, is_premium, start_direct_conversation, …).
grant execute on all functions in schema public to anon, authenticated;

-- Keep future tables/sequences/functions working without another grant migration.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public
  grant execute on functions to anon, authenticated;
