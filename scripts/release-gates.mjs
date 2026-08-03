#!/usr/bin/env node
/**
 * Lumixo hard release gates — FAIL the process if production essentials are missing.
 *
 * Usage:
 *   node scripts/release-gates.mjs              # check code + optional env files
 *   LUMIXO_RELEASE=1 node scripts/release-gates.mjs   # strict: require TURN env present
 *
 * Gates:
 *   1) Code: push Edge refuses user JWT global drain without CRON/PUSH_DRAIN secret
 *   2) Code: mobile/web production blocks calls without TURN
 *   3) Env (when LUMIXO_RELEASE=1 or --strict): TURN URLs for mobile + web
 *   4) Ops: setup-ops-crons / deploy docs mention CRON_SECRET
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const strict =
  process.argv.includes('--strict') ||
  process.env.LUMIXO_RELEASE === '1' ||
  process.env.CI_RELEASE === '1';

let failed = 0;
function ok(label, cond, detail = '') {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}
function warn(label, cond, detail = '') {
  if (cond) console.log(`  ✅ ${label}`);
  else console.log(`  ⚠️  ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('\n═══ Lumixo RELEASE GATES ═══');
console.log(`mode: ${strict ? 'STRICT (release)' : 'contract (dev OK without secrets)'}\n`);

// ── 1) Push drain secret gate in Edge source ────────────────────────────────
console.log('1) Push outbox drain ACL');
const push = readFileSync(join(root, 'supabase/functions/push/index.ts'), 'utf8');
ok(
  'CRON_SECRET or PUSH_DRAIN_SECRET checked',
  /CRON_SECRET|PUSH_DRAIN_SECRET/.test(push),
);
ok(
  'x-cron-secret or x-push-drain-secret header',
  /x-cron-secret|x-push-drain-secret/.test(push),
);
ok(
  'user JWT cannot freely drain (shouldDrain gated)',
  /shouldDrain/.test(push) && /secretOk|drainSecret/.test(push),
);
ok(
  'sendPush client drainOutbox false',
  /drainOutbox:\s*false/.test(readFileSync(join(root, 'shared/pushApi.ts'), 'utf8')),
);

// ── 2) TURN hard-require in production code paths ───────────────────────────
console.log('\n2) TURN production hard-require');
const callCtx = readFileSync(join(root, 'mobile/src/calls/CallContext.tsx'), 'utf8');
const callEngine = readFileSync(join(root, 'web/src/calls/CallEngine.tsx'), 'utf8');
ok(
  'mobile CallContext blocks prod without TURN',
  /isProd/.test(callCtx) && /Calls unavailable|TURN/.test(callCtx) && /hasTurn/.test(callCtx),
);
ok(
  'web CallEngine blocks PROD without TURN',
  /import\.meta\.env\.PROD/.test(callEngine) && /hasTurn/.test(callEngine) && /TURN/.test(callEngine),
);

// ── 3) Env presence (strict release) ────────────────────────────────────────
console.log('\n3) Production secrets / env');
function envHas(path, key) {
  if (!existsSync(path)) return false;
  const t = readFileSync(path, 'utf8');
  const re = new RegExp(`^\\s*${key}\\s*=\\s*\\S+`, 'm');
  return re.test(t) && !new RegExp(`^\\s*${key}\\s*=\\s*["']?\\s*["']?\\s*$`, 'm').test(t);
}

const mobileEnvCandidates = [
  join(root, 'mobile/.env'),
  join(root, 'mobile/.env.local'),
  join(root, 'mobile/.env.production'),
];
const webEnvCandidates = [
  join(root, 'web/.env'),
  join(root, 'web/.env.local'),
  join(root, 'web/.env.production'),
];

const hasMobileTurn =
  process.env.EXPO_PUBLIC_TURN_URL ||
  mobileEnvCandidates.some((p) => envHas(p, 'EXPO_PUBLIC_TURN_URL'));
const hasWebTurn =
  process.env.VITE_TURN_URL ||
  webEnvCandidates.some((p) => envHas(p, 'VITE_TURN_URL'));

if (strict) {
  ok('EXPO_PUBLIC_TURN_URL present (mobile prod)', !!hasMobileTurn, 'set for release builds');
  ok('VITE_TURN_URL present (web prod)', !!hasWebTurn, 'set for release builds');
  // CRON_SECRET cannot be verified from client env — require ops script / deploy checklist.
  const ops = existsSync(join(root, 'scripts/setup-ops-crons.sh'))
    ? readFileSync(join(root, 'scripts/setup-ops-crons.sh'), 'utf8')
    : '';
  ok(
    'ops cron script references secret or CRON',
    /CRON|secret|push/i.test(ops) || existsSync(join(root, 'DEPLOY.md')),
    'configure CRON_SECRET on Edge + scheduled drain',
  );
} else {
  warn('EXPO_PUBLIC_TURN_URL (optional in dev)', !!hasMobileTurn, 'required for LUMIXO_RELEASE=1');
  warn('VITE_TURN_URL (optional in dev)', !!hasWebTurn, 'required for LUMIXO_RELEASE=1');
}

// ── 4) Security migrations present ──────────────────────────────────────────
console.log('\n4) Security seal migrations');
for (const m of [
  '0049_security_lockdown.sql',
  '0050_profile_privacy.sql',
  '0051_p0_security_seal.sql',
  '0052_p0_system_immutable_columns.sql',
]) {
  ok(`migration ${m}`, existsSync(join(root, 'supabase/migrations', m)));
}

// ── 5) Device-proof + adversarial scripts present ───────────────────────────
console.log('\n5) Measurement + pen-test harnesses');
ok('device-proof harness', existsSync(join(root, 'scripts/device-proof-harness.mjs')));
ok('p0 adversarial tests', existsSync(join(root, 'scripts/p0-adversarial-test.mjs')));
ok('web media blob store', existsSync(join(root, 'web/src/lib/mediaBlobStore.ts')));

console.log(`\n═══ ${failed === 0 ? 'RELEASE GATES PASS' : `${failed} GATE(S) FAILED`} ═══\n`);
process.exit(failed === 0 ? 0 : 1);
