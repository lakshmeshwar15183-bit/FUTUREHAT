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
echo "     x-cron-secret: <CRON_SECRET>   # REQUIRED — same value as Edge secret CRON_SECRET"
echo "     # or: x-push-drain-secret: <PUSH_DRAIN_SECRET>"
echo "   Body:   {\"drainOutbox\":true,\"limit\":100}"
echo ""
echo "   Edge secrets (Dashboard → Project Settings → Edge Functions → Secrets):"
echo "     CRON_SECRET=...          # strong random; required for global outbox drain"
echo "     PUSH_DRAIN_SECRET=...    # optional alias of CRON_SECRET"
echo "     FCM_SERVICE_ACCOUNT=...  # already required for FCM"
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
  CRON_HDR=()
  if [[ -n "${CRON_SECRET:-}" ]]; then
    CRON_HDR=(-H "x-cron-secret: ${CRON_SECRET}" -H "x-push-drain-secret: ${CRON_SECRET}")
  else
    echo "⚠️  CRON_SECRET unset — drain may be rejected by Edge (set CRON_SECRET to match function secret)"
  fi
  curl -sS -X POST "${BASE}/push" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    "${CRON_HDR[@]}" \
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
