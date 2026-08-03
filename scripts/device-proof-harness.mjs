#!/usr/bin/env node
/**
 * Lumixo device-proof harness — MEASURE, don't assert OEM behavior from CI.
 *
 * What this script does without hardware:
 *   • Validates instrumentation hooks exist (sentAt, notifLatency, ICE path)
 *   • Emits a machine-readable results template for device QA
 *   • Documents pass thresholds (FCM kill p95, call connect, NAT path)
 *
 * What requires 2 physical devices (operator fills results JSON):
 *   • Force-stop FCM delivery latency
 *   • Cross-network call (Wi‑Fi ↔ LTE) with TURN
 *
 * Usage:
 *   node scripts/device-proof-harness.mjs
 *   node scripts/device-proof-harness.mjs --write-template
 *
 * After a device session, merge measurements into:
 *   validation/results/device-proof-LATEST.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = join(root, 'validation/results');
let failed = 0;

function ok(label, cond) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

console.log('\n═══ DEVICE-PROOF HARNESS (instrumentation contracts) ═══\n');

// ── Code contracts that enable measurement ──────────────────────────────────
console.log('1) Instrumentation present');
const push = readFileSync(join(root, 'supabase/functions/push/index.ts'), 'utf8');
ok('FCM payload can carry sentAt', /sentAt/.test(push));
ok('high priority for data path', /priority:\s*['"]high['"]/.test(push));

const latencyPath = join(root, 'mobile/src/lib/notifLatency.ts');
ok('notifLatency module', existsSync(latencyPath));
if (existsSync(latencyPath)) {
  const lat = readFileSync(latencyPath, 'utf8');
  ok('records receive / open latency', /record|latency|sentAt|Date\.now/.test(lat));
}

const webrtc = readFileSync(join(root, 'mobile/src/calls/webrtc.ts'), 'utf8');
ok('ICE path probe (direct/relay)', /onConnectionPath|relay|srflx|ConnectionPath/.test(webrtc));
ok('ICE restart recovery', /tryIceRestart|iceRestart/.test(webrtc));

const callCtx = readFileSync(join(root, 'mobile/src/calls/CallContext.tsx'), 'utf8');
ok('prod TURN hard-gate', /isProd|Calls unavailable/.test(callCtx));

// ── Thresholds (documentation) ──────────────────────────────────────────────
console.log('\n2) Pass thresholds (fill on device)');
const thresholds = {
  fcm_force_stop_p95_ms: 5000,
  fcm_force_stop_samples_min: 20,
  fcm_miss_rate_max: 0.02,
  call_ring_killed_p95_ms: 3000,
  call_connect_same_wifi_p95_ms: 8000,
  call_connect_cross_nat_p95_ms: 15000,
  call_cross_nat_requires_relay: true,
  hangup_cancel_ring_max_ms: 2000,
};

for (const [k, v] of Object.entries(thresholds)) {
  console.log(`  • ${k}: ${v}`);
}

// ── Template ────────────────────────────────────────────────────────────────
const template = {
  schema: 'lumixo.device_proof.v1',
  generatedAt: new Date().toISOString(),
  thresholds,
  devices: [
    {
      role: 'sender',
      model: '',
      os: '',
      appVersion: '',
      network: 'wifi|lte',
    },
    {
      role: 'receiver',
      model: '',
      os: '',
      appVersion: '',
      network: 'wifi|lte',
      forceStop: true,
    },
  ],
  measurements: {
    fcm_force_stop: {
      samples_ms: [],
      p50: null,
      p95: null,
      miss_count: 0,
      notes: '',
    },
    call_ring_killed: {
      samples_ms: [],
      p50: null,
      p95: null,
      notes: '',
    },
    call_connect: {
      same_wifi_ms: [],
      cross_nat_ms: [],
      path_counts: { direct: 0, relay: 0, unknown: 0 },
      notes: '',
    },
    hangup_cancel: {
      samples_ms: [],
      p95: null,
      notes: '',
    },
  },
  verdict: {
    fcm_kill: 'PENDING',
    call_nat: 'PENDING',
    overall: 'PENDING',
  },
  operator: '',
};

console.log('\n3) Results template');
if (process.argv.includes('--write-template') || process.argv.includes('-w')) {
  mkdirSync(resultsDir, { recursive: true });
  const out = join(resultsDir, 'device-proof-TEMPLATE.json');
  writeFileSync(out, JSON.stringify(template, null, 2));
  console.log(`  ✅ wrote ${out}`);
} else {
  console.log('  ℹ️  run with --write-template to emit validation/results/device-proof-TEMPLATE.json');
}

// ── Evaluate filled results if present ──────────────────────────────────────
const latest = join(resultsDir, 'device-proof-LATEST.json');
console.log('\n4) Latest device results');
if (existsSync(latest)) {
  try {
    const data = JSON.parse(readFileSync(latest, 'utf8'));
    const fcmP95 = data?.measurements?.fcm_force_stop?.p95;
    const miss = data?.measurements?.fcm_force_stop?.miss_count ?? 0;
    const samples = data?.measurements?.fcm_force_stop?.samples_ms?.length ?? 0;
    const cross = data?.measurements?.call_connect?.cross_nat_ms ?? [];
    const path = data?.measurements?.call_connect?.path_counts ?? {};

    ok(
      `FCM force-stop p95 ≤ ${thresholds.fcm_force_stop_p95_ms}ms`,
      typeof fcmP95 === 'number' && fcmP95 <= thresholds.fcm_force_stop_p95_ms,
    );
    ok(
      `FCM samples ≥ ${thresholds.fcm_force_stop_samples_min}`,
      samples >= thresholds.fcm_force_stop_samples_min,
    );
    ok(
      `FCM miss rate low`,
      samples > 0 && miss / samples <= thresholds.fcm_miss_rate_max,
    );
    if (cross.length) {
      const sorted = [...cross].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
      ok(
        `Cross-NAT connect p95 ≤ ${thresholds.call_connect_cross_nat_p95_ms}ms`,
        p95 <= thresholds.call_connect_cross_nat_p95_ms,
      );
    } else {
      console.log('  ⚠️  no cross_nat samples yet — mark call_nat PENDING');
    }
    if (path.relay > 0 || path.direct > 0) {
      console.log(`  ℹ️  ICE paths: direct=${path.direct} relay=${path.relay} unknown=${path.unknown}`);
    }
    console.log(`  verdict file: ${data?.verdict?.overall ?? 'n/a'}`);
  } catch (e) {
    console.log(`  ❌ invalid device-proof-LATEST.json: ${e.message}`);
    failed++;
  }
} else {
  console.log('  ⚠️  no device-proof-LATEST.json — hardware session not recorded yet');
  console.log('     (instrumentation contracts can still PASS; field verdict stays PENDING)');
}

console.log(`\n═══ device-proof contracts: ${failed === 0 ? 'PASS' : 'FAIL'} ═══\n`);
console.log('Field steps (2 devices):');
console.log('  1. Receiver: force-stop Lumixo → sender sends 20 messages → log sentAt→display ms');
console.log('  2. Receiver killed → incoming call → log ring latency; hangup → cancel latency');
console.log('  3. Cross-NAT call with TURN → confirm path=relay and connect < 15s p95');
console.log('  4. Write validation/results/device-proof-LATEST.json → re-run this script\n');

process.exit(failed === 0 ? 0 : 1);
