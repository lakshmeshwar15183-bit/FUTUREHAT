# PRODUCTION_CHECKLIST — Lumixo Public Beta

**Date:** 2026-07-13  
Use this as the go-live gate. Check every box before promoting store build.

---

## A. Infrastructure & secrets

- [ ] Supabase project production region confirmed; backups enabled
- [ ] All migrations through **0063** applied (`supabase db push` / pipeline)
- [ ] Edge secrets set: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- [ ] Edge secrets set: FCM service account, `CRON_SECRET` / `PUSH_DRAIN_SECRET`
- [ ] Edge functions deployed: `push`, `payments-razorpay`, `crash-report`, `ai`, `account-purge`
- [ ] Cron jobs for push drain + any ops (see `scripts/setup-ops-crons.sh`)
- [ ] `LUMIXO_RELEASE=1 node scripts/release-gates.mjs` **PASS** (strict TURN)

## B. Client build

- [ ] `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (prod)
- [ ] `EXPO_PUBLIC_SITE_URL` HTTPS production
- [ ] `EXPO_PUBLIC_TURN_URL` (+ username/credential) production TURN
- [ ] Web `VITE_*` TURN + Supabase prod
- [ ] Release signing keystore **not** in git; stored in CI secrets
- [ ] `google-services.json` package name matches applicationId
- [ ] VersionCode / versionName bumped for store
- [ ] `__DEV__` false in release APK/AAB; no Metro

## C. Security smoke

- [ ] Cannot activate premium without paid order (try forge client call)
- [ ] User A cannot read User B DMs (second account)
- [ ] Poll cannot be moved to another conversation via REST (0063)
- [ ] Webhook rejects bad Razorpay signature
- [ ] Password reset deep link works on production site URL

## D. Reliability smoke

- [ ] Offline compose → airplane off → message sends once
- [ ] Kill app mid-outbox → reopen → flush continues
- [ ] Media send on poor network retries without crash
- [ ] Incoming call with battery optimization prompt path
- [ ] Group of 50+ opens chat without freeze

## E. Store / compliance

- [ ] Privacy policy + terms URLs live
- [ ] Account deletion / data export paths work
- [ ] Play Data safety form matches actual collection
- [ ] No debug menus in release (Diagnostics still 7-tap OK)

## F. Monitoring (first 48h)

- [ ] Crash report volume watched
- [ ] Payment webhook success rate
- [ ] Push drain lag
- [ ] Support ticket channel staffed

---

## Sign-off

| Role | Name | Date | OK |
|------|------|------|----|
| Security | | | ☐ |
| SRE / Backend | | | ☐ |
| Android | | | ☐ |
| QA | | | ☐ |
| Product | | | ☐ |
