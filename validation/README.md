# Lumixo Production Validation Suite

**Purpose:** 100% production verification before Play Store release.  
**App version target:** 4.6.0+  
**Last updated:** 2026-07-12

This suite is the single source of truth for **what must pass** before shipping.

## Structure

| Path | Contents |
|------|----------|
| [`PRODUCTION_VALIDATION_SUITE.md`](./PRODUCTION_VALIDATION_SUITE.md) | Full catalog: every test case with preconditions, steps, expected, failure, P0/P1/P2, automation flag, pass/fail |
| [`checklists/PLAY_STORE_GATE.md`](./checklists/PLAY_STORE_GATE.md) | Hard GO/NO-GO gate (P0 only) |
| [`checklists/DEVICE_MATRIX.md`](./checklists/DEVICE_MATRIX.md) | Devices / OS / network matrix |
| [`templates/SESSION_RUN.md`](./templates/SESSION_RUN.md) | Copy for a QA session run log |
| [`results/`](./results/) | Automated run outputs (gitignored artifacts OK) |
| [`../scripts/run-validation-suite.mjs`](../scripts/run-validation-suite.mjs) | Automated suite runner |

## How to run

### 1) Automated (CI / local machine)

```bash
# From repo root
node scripts/run-validation-suite.mjs
```

Runs:

- Typecheck (mobile + web + shared where available)
- Jest unit tests (`mobile`)
- Offline/outbox suite (`scripts/offline-test`)
- Call signaling suite (`scripts/call-test`)
- Media math unit tests
- Theme contrast script (if present)
- DB authz scripts **only if** `SUPABASE_DB_PASSWORD` or `DATABASE_URL` is set

Exit code `0` = all automated layers green.

### 2) Manual (required for Play Store)

1. Install release APK: `release/Lumixo-v4.6.0.apk` (or newer).
2. Open [`PRODUCTION_VALIDATION_SUITE.md`](./PRODUCTION_VALIDATION_SUITE.md).
3. Execute every **P0** case on at least 2 physical devices (see DEVICE_MATRIX).
4. Fill [`templates/SESSION_RUN.md`](./templates/SESSION_RUN.md).
5. Sign off [`checklists/PLAY_STORE_GATE.md`](./checklists/PLAY_STORE_GATE.md).

### 3) Environments

| Env | Use |
|-----|-----|
| **Staging / production Supabase** `toscljrivrawvlfebdzz` | Integration + manual |
| **Airplane mode** | Offline / outbox |
| **Cellular + Wi‑Fi pair** | Calls (TURN required) |
| **Doze / force-stop** | Push / killed-state notifications |

## Priority definitions

| Priority | Meaning |
|----------|---------|
| **P0** | Blocker. Must pass for any public release. Failure = NO-GO. |
| **P1** | High. Must pass for full GA / 100% rollout. May ship open beta if documented. |
| **P2** | Medium. Track; fix before scale or next minor. |

## Automation legend

| Flag | Meaning |
|------|---------|
| **Auto** | Covered (or coverable) by scripted tests in this repo |
| **Semi** | Partial auto (unit/integration) + manual device step |
| **Manual** | Requires human device / multi-user / Play Store |

## Accounts needed for manual QA

| Role | Setup |
|------|--------|
| User A | Fresh account |
| User B | Second phone or second profile |
| User C | Group/community member |
| Admin/Owner | Permanent owner allowlist |
| Moderator | `profiles.role` = moderator |
| Premium | Active subscription or owner override |

## Related docs

- `PRODUCTION_READINESS_FINAL_PASS.md` — last integrity fix pass + scores  
- `PRODUCTION_UI_POLISH_REPORT.md` — UI polish scores  
- `release/PLAY_STORE_CHECKLIST.md` — store listing ops  

## Sign-off rule

**Play Store public release requires:**

1. Automated suite green (`node scripts/run-validation-suite.mjs`)  
2. All **P0** manual cases Pass on Device Matrix  
3. `PLAY_STORE_GATE.md` signed by eng + QA  
4. TURN + FCM + crons confirmed live  
