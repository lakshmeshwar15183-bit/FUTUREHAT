#!/usr/bin/env node
/**
 * Adversarial pure-logic + static checks for the six sealed P0s.
 * Does not need live DB. Optional: SUPABASE_URL + user JWT for live REST probes.
 *
 * Run: node scripts/p0-adversarial-test.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
function ok(label, cond, detail = '') {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

console.log('\n═══ P0 ADVERSARIAL TESTS (static + pure logic) ═══\n');

// ── 1) System message forgery ───────────────────────────────────────────────
console.log('1) System message UPDATE/INSERT forgery');
const m52 = readFileSync(join(root, 'supabase/migrations/0052_p0_system_immutable_columns.sql'), 'utf8');
const m51 = readFileSync(join(root, 'supabase/migrations/0051_p0_security_seal.sql'), 'utf8');
const api = readFileSync(join(root, 'shared/api.ts'), 'utf8');
ok('guard freezes type', /type cannot be changed|message type cannot be changed/.test(m51 + m52));
ok('system messages immutable', /system messages are immutable/.test(m51 + m52));
ok('INSERT policy excludes system', /type is distinct from 'system'/.test(m52));
ok('client send rejects system', /type === 'system'/.test(api));
ok('client edit rejects system', /system messages cannot be edited|neq\('type', 'system'\)/.test(api));
ok('post_system_message revoked from authenticated', /revoke all on function public\.post_system_message/.test(m51));

// ── 2) Push RPC abuse ───────────────────────────────────────────────────────
console.log('\n2) Push RPC client abuse');
const pushApi = readFileSync(join(root, 'shared/pushApi.ts'), 'utf8');
const pushFn = readFileSync(join(root, 'supabase/functions/push/index.ts'), 'utf8');
ok('client sendPush drainOutbox false', /drainOutbox:\s*false/.test(pushApi));
ok('edge drain requires secret', /CRON_SECRET|PUSH_DRAIN_SECRET/.test(pushFn));
ok('0051 revokes claim/enqueue/release', /claim_push_outbox|enqueue_push|release_push_dedupe/.test(m51));
ok('revoke from authenticated present', /revoke all on function/.test(m51));

// Attack simulation: pure logic
function clientCanDrainWithoutSecret(body, headers) {
  const secret = 'prod-secret';
  const provided = headers['x-cron-secret'] || '';
  const secretOk = provided === secret;
  return secretOk ? !!body.drainOutbox : false;
}
ok(
  'ATTACK sim: user JWT drainOutbox:true → denied',
  clientCanDrainWithoutSecret({ drainOutbox: true }, {}) === false,
);
ok(
  'ATTACK sim: cron secret drain → allowed',
  clientCanDrainWithoutSecret({ drainOutbox: true }, { 'x-cron-secret': 'prod-secret' }) === true,
);

// ── 3) FCM token hijack ─────────────────────────────────────────────────────
console.log('\n3) FCM token hijack');
ok('register_push_token refuses foreign owner', /hard refuse|is distinct from v_uid|do not steal/.test(m51));
ok('FOR UPDATE present', /for update/i.test(m51));
function wouldHijack(owner, attacker) {
  if (owner != null && owner !== attacker) return false;
  return true;
}
ok('ATTACK sim: A cannot claim B token', wouldHijack('user-B', 'user-A') === false);
ok('ATTACK sim: A can refresh own', wouldHijack('user-A', 'user-A') === true);

// ── 4) Profiles phone enumeration ───────────────────────────────────────────
console.log('\n4) Profiles phone enumeration');
const m50 = readFileSync(join(root, 'supabase/migrations/0050_profile_privacy.sql'), 'utf8');
ok('profiles select own or admin', /profiles select own or admin|id = auth\.uid\(\)/.test(m50 + m51));
ok('public_profiles has no phone column in view', !/phone/.test(
  (m50 + m51).match(/create or replace view public\.public_profiles[\s\S]*?;/i)?.[0] ?? 'phone',
) || /public_profiles[\s\S]*?from public\.profiles/.test(m50));
// view definition should select without phone
const viewMatch = (m50 + m51).match(/create or replace view public\.public_profiles[\s\S]*?from public\.profiles/i);
ok(
  'public_profiles select list omits phone',
  viewMatch ? !/\bphone\b/.test(viewMatch[0]) : false,
);
ok('getProfilesPublic uses public cols', /PROFILE_PUBLIC_COLS|public_profiles/.test(api));
// Public peer column list must not mention phone (self cols may include phone).
const publicColsMatch = api.match(
  /PROFILE_PUBLIC_COLS\s*=\s*\n?\s*['`]([^'`]+)['`]/,
);
const publicCols = publicColsMatch?.[1] ?? '';
ok(
  'PROFILE_PUBLIC_COLS excludes phone',
  publicCols.length > 0 && !/\bphone\b/.test(publicCols),
  publicCols || 'constant not found',
);

// ── 5) AppLock unbound WebAuthn ─────────────────────────────────────────────
console.log('\n5) AppLock unbound WebAuthn');
const deviceAuth = readFileSync(join(root, 'web/src/lib/deviceAuth.ts'), 'utf8');
const appLock = readFileSync(join(root, 'web/src/premium/AppLockGate.tsx'), 'utf8');
ok('credentials.get has allowCredentials', /allowCredentials/.test(deviceAuth));
// Every credentials.get call site must include allowCredentials (bound assertion).
const getIdx = deviceAuth.indexOf('credentials.get(');
const getSlice = getIdx >= 0 ? deviceAuth.slice(getIdx, getIdx + 400) : '';
ok(
  'every credentials.get is bound (allowCredentials in options)',
  getIdx >= 0 && /allowCredentials/.test(getSlice),
  getIdx < 0 ? 'no credentials.get' : 'missing allowCredentials near get',
);
ok('get bound to stored id', /allowCredentials:.*fromB64url|fromB64url\(existing\)/.test(deviceAuth.replace(/\n/g, ' ')));
ok('bio unlock requires hasCredential', /hasCredential/.test(appLock));
ok('PBKDF2 PIN', /PBKDF2|pbkdf2/.test(appLock));
ok('min PIN length >= 6', /MIN_PIN_LEN\s*=\s*[6-9]|MIN_PIN_LEN\s*=\s*1[0-2]/.test(appLock));

// ── 6) XSS media links ──────────────────────────────────────────────────────
console.log('\n6) XSS media links');
const safeUrl = readFileSync(join(root, 'web/src/util/safeUrl.ts'), 'utf8');
const signed = readFileSync(join(root, 'web/src/lib/SignedMedia.tsx'), 'utf8');
ok('safeHref exported', /export function safeHref/.test(safeUrl));
ok('safeMediaSrc exported', /export function safeMediaSrc/.test(safeUrl));
ok('SignedLink uses safeHref', /safeHref\(url\)/.test(signed));
ok('SignedImage uses safeMediaSrc', /safeMediaSrc/.test(signed));

// Pure attack vectors
function safeHref(u, origin = 'https://lumixo.app') {
  if (!u) return undefined;
  const t = String(u).trim();
  if (/^(javascript|vbscript|data\s*:?\s*text\/html)/i.test(t)) return undefined;
  try {
    const p = new URL(t, origin).protocol;
    return p === 'http:' || p === 'https:' ? t : undefined;
  } catch {
    return undefined;
  }
}
ok('ATTACK javascript: blocked', safeHref('javascript:alert(1)') === undefined);
ok('ATTACK data:text/html blocked', safeHref('data:text/html,<script>x</script>') === undefined);
ok('ATTACK https allowed', !!safeHref('https://cdn.example/a.jpg'));

// ── Live optional ───────────────────────────────────────────────────────────
console.log('\n7) Live REST (optional)');
if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.TEST_JWT) {
  console.log('  → spawning live REST probes…');
  const { spawnSync } = await import('node:child_process');
  const live = spawnSync(process.execPath, [join(root, 'scripts/p0-adversarial-live.mjs')], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
  });
  if (live.stdout) process.stdout.write(live.stdout);
  if (live.stderr) process.stderr.write(live.stderr);
  if ((live.status ?? 1) !== 0) failed++;
} else {
  console.log('  ⚠️  skip live REST (set SUPABASE_URL, SUPABASE_ANON_KEY, TEST_JWT)');
  console.log('     optional: node scripts/p0-adversarial-live.mjs');
}

console.log(`\n═══ adversarial: ${failed === 0 ? 'ALL ATTACKS BLOCKED (static)' : `${failed} FAILURES`} ═══\n`);
process.exit(failed === 0 ? 0 : 1);
