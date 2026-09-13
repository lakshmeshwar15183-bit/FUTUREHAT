# Ops crons — GDPR purge + push drain

## Account purge (GDPR)
Daily cron (Edge `account-purge` requires `SERVICE_ROLE`):

```bash
# Add to your scheduler (Supabase pg_cron or external cron):
curl -X POST https://toscljrivrawvlfebdzz.supabase.co/functions/v1/account-purge \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit":20}'
```

## Push outbox drain
Every minute, with `CRON_SECRET`:

```bash
curl -X POST https://toscljrivrawvlfebdzz.supabase.co/functions/v1/push \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"drainOutbox":true,"limit":40}'
```

Set secret: `supabase secrets set CRON_SECRET="$(openssl rand -hex 32)" --project-ref toscljrivrawvlfebdzz`

## TURN rotation
```bash
supabase secrets set TURN_URL="turn:turn.example.com:443?transport=tcp,turn:turn.example.com:80,turns:turn.example.com:443" TURN_USERNAME="u" TURN_CREDENTIAL="p" --project-ref toscljrivrawvlfebdzz
supabase functions deploy turn-config --project-ref toscljrivrawvlfebdzz
# No app rebuild needed — clients fetch at call start.
```
