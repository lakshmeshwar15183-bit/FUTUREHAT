#!/usr/bin/env bash
# FUTUREHAT — apply pending SQL migrations to the live Supabase database.
#
# Why a script: this Mac has no `psql` and the repo intentionally keeps the DB
# password / service-role key OUT of version control and out of web/.env.local
# (only the public anon key ships). So migrations are applied on demand by the
# owner, who supplies the password via the environment.
#
# Usage (from repo root):
#   SUPABASE_DB_PASSWORD='your-db-password' bash scripts/apply-migrations.sh
#
# Alternatively, paste supabase/migrations/0007_communities.sql and
# 0008_support_safety.sql into the Supabase Dashboard → SQL Editor and run.
# Both migrations are idempotent (create ... if not exists / drop policy if exists),
# so re-running is safe.
set -euo pipefail

PROJECT_REF="toscljrivrawvlfebdzz"   # FUTUREHAT, ap-northeast-2
NPM_CACHE="/tmp/fh-npm-cache"        # ~/.npm is EACCES-broken on this Mac

if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo "ERROR: set SUPABASE_DB_PASSWORD before running (see header)." >&2
  exit 1
fi

# Pooler connection string (session mode, port 5432).
# NOTE: this project is on the aws-1 pooler generation, NOT aws-0. Using aws-0
# returns "tenant/user not found". The direct host db.<ref>.supabase.co has no
# IPv4 A record from this network, so the pooler is the only working path.
DB_URL="postgresql://postgres.${PROJECT_REF}:${SUPABASE_DB_PASSWORD}@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"

echo "Applying migrations 0007 + 0008 to project ${PROJECT_REF}…"
npx --yes --cache "${NPM_CACHE}" supabase db push --db-url "${DB_URL}"
echo "Done. Verify tables: communities, channels, polls, poll_votes, events,"
echo "event_rsvps, reports, support_tickets, blocked_users, muted_conversations."
