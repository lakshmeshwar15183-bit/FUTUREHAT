#!/bin/bash
# Lumixo — verify 0069 + 0063 + Edge secrets on live project
set -e
REF="toscljrivrawvlfebdzz"
echo "== Check migrations on $REF =="
supabase db push --project-ref $REF --dry-run 2>&1 | head -n 50 || echo "db push dry-run not available — run supabase migration list"
echo ""
echo "== Check Edge secrets =="
supabase secrets list --project-ref $REF 2>&1 | grep -E "TURN_|RAZORPAY|FCM_SERVICE|CRON_SECRET" || echo "No TURN secrets yet — set via:"
echo '  supabase secrets set TURN_URL="turn:turn.example.com:443?transport=tcp,turn:turn.example.com:80" TURN_USERNAME="u" TURN_CREDENTIAL="p" --project-ref $REF'
echo '  supabase secrets set RAZORPAY_KEY_ID=rzp_... RAZORPAY_KEY_SECRET=... RAZORPAY_WEBHOOK_SECRET=... --project-ref $REF'
echo '  supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)" --project-ref $REF'
echo '  supabase secrets set CRON_SECRET="$(openssl rand -hex 32)" --project-ref $REF'
echo ""
echo "== Deploy Edge Functions =="
echo "supabase functions deploy turn-config push payments-razorpay ai crash-report --project-ref $REF"
echo ""
echo "== Auth hardening — also enable in Dashboard =="
echo "Supabase Dashboard → Authentication → Password Security → Enable 'Leaked password protection' + 'Require 8 chars + symbols' (config.toml now enforces for local)"
