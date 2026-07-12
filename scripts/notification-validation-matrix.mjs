#!/usr/bin/env node
/**
 * Lumixo notification validation matrix (checklist generator).
 * Run: node scripts/notification-validation-matrix.mjs
 *
 * Full 100-message / force-stop tests require two physical devices + FCM live.
 * This script documents the matrix and runs pure offline checks that do not
 * need hardware.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

function ok(label, cond) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

console.log('\n═══ Lumixo notification validation ═══\n');

// ── Static contract checks ──────────────────────────────────────────────────
console.log('1) Code contracts');
const pushFn = readFileSync(join(root, 'supabase/functions/push/index.ts'), 'utf8');
ok('release_push_dedupe on zero delivery', /release_push_dedupe|releaseDedupe/.test(pushFn));
ok('high priority FCM', /priority:\s*['"]high['"]/.test(pushFn));
ok('call cancel uses same tag path', /isCallCancel/.test(pushFn) && /tag/.test(pushFn));
ok('server rebuilds generic titles', /genericTitle|New message/.test(pushFn));

const mig = join(root, 'supabase/migrations/0048_push_killed_reliability.sql');
ok('migration 0048 present', existsSync(mig));
ok('release_push_dedupe SQL', existsSync(mig) && /release_push_dedupe/.test(readFileSync(mig, 'utf8')));

const notif = readFileSync(join(root, 'mobile/src/lib/notifications.ts'), 'utf8');
ok('registerForPush exists', /export async function registerForPush/.test(notif));
ok('call Accept/Decline categories', /identifier:\s*'accept'/.test(notif) && /decline/.test(notif));
ok('message reply category', /identifier:\s*'reply'/.test(notif));

const bridge = readFileSync(join(root, 'mobile/src/components/NotificationsBridge.tsx'), 'utf8');
ok('cold-start last response', /getLastNotificationResponseAsync/.test(bridge));
ok('drain on active', /drainOutbox/.test(bridge));

const gate = join(root, 'mobile/src/components/NotificationSetupGate.tsx');
ok('NotificationSetupGate present', existsSync(gate));
const setup = join(root, 'mobile/src/lib/notificationSetup.ts');
const oemGuides = join(root, 'mobile/src/lib/oemNotifGuides.ts');
ok('Notification setup module present', existsSync(setup));
ok('OEM guide module present', existsSync(oemGuides));
if (existsSync(oemGuides)) {
  const s = readFileSync(oemGuides, 'utf8');
  for (const brand of ['xiaomi', 'oppo', 'vivo', 'realme', 'oneplus', 'samsung', 'motorola']) {
    ok(`OEM family: ${brand}`, s.includes(`'${brand}'`) || s.includes(`"${brand}"`));
  }
}
ok('Setup gate mounted in App', /NotificationSetupGate/.test(readFileSync(join(root, 'mobile/App.tsx'), 'utf8')));
ok('Incoming call plugin present', existsSync(join(root, 'mobile/plugins/withIncomingCallNotifications.js')));
ok('Call FCM data-only path', /callDataOnly|DATA-ONLY/.test(pushFn));
ok('Latency probe sentAt', /sentAt/.test(pushFn));
ok('Native call bridge', existsSync(join(root, 'mobile/src/lib/incomingCallNative.ts')));
ok('Latency module', existsSync(join(root, 'mobile/src/lib/notifLatency.ts')));

// ── Manual device matrix (print for QA) ─────────────────────────────────────
console.log('\n2) Device QA matrix (run on hardware)');
const cases = [
  '100 consecutive messages while recipient force-stopped',
  'Background app + screen locked message',
  'Killed app (remove from Recents) message < 5s',
  'Incoming call ring while killed',
  'Caller hangup clears ring on killed receiver',
  'Decline stops ring; Answer opens call UI',
  'Answered on device B → ring stops on A',
  'Missed call notification after timeout',
  'Device reboot → re-register token → message arrives',
  'Airplane on → send → airplane off → outbox drain delivers',
  'Wi-Fi → mobile data switch mid-session',
  'Two devices same account: read on A clears tray on B',
  'Long idle 30+ min then message (Doze)',
  'Open chat: no self-notification spam',
  'Group stacking: N new messages body',
  'Reply from shade',
  'Mark as read from shade',
  'Mute / Archive from shade',
  'First-launch permission gate explains then requests',
  'Permanent deny opens Settings',
  'OEM battery guide (Xiaomi/Samsung if available)',
];
cases.forEach((c, i) => console.log(`  [ ] ${String(i + 1).padStart(2, '0')}. ${c}`));

console.log('\n3) Latency targets (measure on device)');
console.log('  • Message (online both): < 2s typical (FCM + outbox)');
console.log('  • Call ring after server insert: < 2s');
console.log('  • Tap → open chat: < 1s once process starts');
console.log('  (Automated latency capture requires instrumentation + 2 devices.)');

console.log(`\n═══ Result: ${failed === 0 ? 'PASS contracts' : `FAIL ${failed} contract(s)`} ═══\n`);
process.exit(failed ? 1 : 0);
