#!/usr/bin/env bash
# FUTUREHAT — deploy the `push` Edge Function + set its FCM secret.
# The ONLY input this needs is a Supabase personal access token (browser-issued),
# because deploying functions / setting secrets goes through the Supabase Management
# API — the DB password can't authenticate it. Everything else is already in place.
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx bash scripts/deploy-push.sh
#
# Get a token at: https://supabase.com/dashboard/account/tokens
set -euo pipefail

PROJECT_REF="toscljrivrawvlfebdzz"
SA_KEY="$HOME/.futurehat-secrets/fcm-service-account.json"   # secured, outside the repo

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)}"
[ -f "$SA_KEY" ] || { echo "Service-account key not found at $SA_KEY"; exit 1; }

echo "→ Setting FCM_SERVICE_ACCOUNT secret (from $SA_KEY) …"
supabase secrets set "FCM_SERVICE_ACCOUNT=$(cat "$SA_KEY")" --project-ref "$PROJECT_REF"

echo "→ Deploying the push Edge Function …"
supabase functions deploy push --project-ref "$PROJECT_REF"

echo "✅ push function deployed and FCM secret set for project $PROJECT_REF"
