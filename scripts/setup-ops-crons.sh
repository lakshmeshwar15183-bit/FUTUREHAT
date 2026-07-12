#!/usr/bin/env bash
# Lumixo P0 ops: print / optionally register cron hooks for push drain + account purge.
#
# Supabase hosted crons are configured in Dashboard → Edge Functions → Schedules
# (or Database → Cron). This script:
#   1) Verifies the project ref
#   2) Prints exact schedule configs to paste
#   3) Optionally fires a one-shot drain now (needs SUPABASE_SERVICE_ROLE_KEY)
#
# Usage:
#   bash scripts/setup-ops-crons.sh
#   SUPABASE_SERVICE_ROLE_KEY=eyJ... bash scripts/setup-ops-crons.sh --fire-now
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-toscljrivrawvlfebdzz}"
BASE="https://${PROJECT_REF}.supabase.co/functions/v1"

echo "═══════════════════════════════════════════════════════════════"
echo " Lumixo P0 ops crons — project ${PROJECT_REF}"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "1) PUSH OUTBOX DRAIN — every 1 minute"
echo "   URL:    ${BASE}/push"
echo "   Method: POST"
echo "   Headers:"
echo "     Authorization: Bearer <SERVICE_ROLE_KEY>"
echo "     Content-Type: application/json"
echo "   Body:   {\"drainOutbox\":true,\"limit\":100}"
echo ""
echo "2) ACCOUNT PURGE — every day at 03:00 UTC"
echo "   URL:    ${BASE}/account-purge"
echo "   Method: POST"
echo "   Headers:"
echo "     Authorization: Bearer <SERVICE_ROLE_KEY>"
echo "     Content-Type: application/json"
echo "   Body:   {\"limit\":50}"
echo ""
echo "3) CRASH PURGE (optional) — weekly"
echo "   SQL:    select public.purge_old_crash_reports();"
echo ""
echo "Dashboard: https://supabase.com/dashboard/project/${PROJECT_REF}/functions"
echo "Or use an external cron (cron-job.org / GitHub Actions) with the same POSTs."
echo "═══════════════════════════════════════════════════════════════"

if [[ "${1:-}" == "--fire-now" ]]; then
  : "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY to fire now}"
  echo ""
  echo "→ Firing push drain now…"
  curl -sS -X POST "${BASE}/push" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"drainOutbox":true,"limit":100}'
  echo ""
  echo "→ Firing account-purge now…"
  curl -sS -X POST "${BASE}/account-purge" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"limit":20}'
  echo ""
  echo "Done."
fi
