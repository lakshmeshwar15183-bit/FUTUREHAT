#!/usr/bin/env bash
# Apply P0 security migrations to the linked Supabase project.
# Usage (from repo root, after `supabase link`):
#   ./scripts/apply-critical-migrations.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Checking supabase CLI…"
command -v supabase >/dev/null || { echo "Install supabase CLI first"; exit 1; }

echo "==> Pushing migrations (includes 0039–0042 security/premium/favorites)…"
supabase db push

echo "==> Done. Verify in Dashboard → Database → Migrations:"
echo "    0039_production_security"
echo "    0040_block_client_system_messages"
echo "    0041_favorite_conversations"
echo "    0042_lock_subscription_writes"
echo ""
echo "Also set Auth → URL Configuration:"
echo "  Site URL = https://futurehat-app.netlify.app  (or your prod host)"
echo "  Redirects += …/reset-password + futurehat://reset-password"
echo ""
echo "Secrets for push Edge Function:"
echo "  supabase secrets set FCM_SERVICE_ACCOUNT=\"\$(cat service-account.json)\""
echo "  supabase functions deploy push"
