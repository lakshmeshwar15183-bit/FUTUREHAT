#!/usr/bin/env node
/**
 * Lumixo — automated production validation runner.
 *
 * Exit 0 if all runnable layers pass.
 * Writes a summary under validation/results/.
 *
 * Usage (repo root):
 *   node scripts/run-validation-suite.mjs
 *   node scripts/run-validation-suite.mjs --skip-offline --skip-calls
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const args = new Set(process.argv.slice(2));

const resultsDir = join(ROOT, 'validation', 'results');
mkdirSync(resultsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = join(resultsDir, `validation-${stamp}.txt`);

const lines = [];
function log(msg) {
  const s = typeof msg === 'string' ? msg : String(msg);
  lines.push(s);
  console.log(s);
}

function run(name, cmd, cwd = ROOT, env = process.env) {
  log(`\n━━━ ${name} ━━━`);
  log(`$ ${cmd}  (cwd=${cwd})`);
  const r = spawnSync(cmd, {
    cwd,
    env,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.stdout) log(r.stdout.trimEnd());
  if (r.stderr) log(r.stderr.trimEnd());
  const code = r.status ?? 1;
  log(code === 0 ? `✓ ${name} PASS` : `✗ ${name} FAIL (exit ${code})`);
  return code === 0;
}

const results = [];

// 1) Typecheck
results.push([
  'typecheck-mobile',
  run('Typecheck mobile', 'npx tsc --noEmit', join(ROOT, 'mobile')),
]);
if (existsSync(join(ROOT, 'web', 'tsconfig.json'))) {
  results.push([
    'typecheck-web',
    run('Typecheck web', 'npx tsc --noEmit', join(ROOT, 'web')),
  ]);
}

// 2) Jest
results.push([
  'jest-mobile',
  run('Jest unit tests', 'npm test -- --passWithNoTests --watchAll=false', join(ROOT, 'mobile')),
]);

// 3) Offline suite — always rebuild bundle so tests hit CURRENT localCache/sync
if (!args.has('--skip-offline')) {
  const offlineDir = join(ROOT, 'scripts', 'offline-test');
  if (existsSync(join(offlineDir, 'offline.test.mjs'))) {
    if (existsSync(join(offlineDir, 'build.mjs'))) {
      const built = run('Build offline-test bundle', 'node build.mjs', offlineDir);
      if (!built) results.push(['offline-build', false]);
    }
    results.push([
      'offline-test',
      run('Offline / outbox suite', 'node offline.test.mjs', offlineDir),
    ]);
  } else {
    log('⊘ offline-test not found — skip');
  }
}

// 4) Call suite — always rebuild webrtc bundle
if (!args.has('--skip-calls')) {
  const callDir = join(ROOT, 'scripts', 'call-test');
  if (existsSync(join(callDir, 'call.test.mjs'))) {
    if (existsSync(join(callDir, 'build.mjs'))) {
      const built = run('Build call-test bundle', 'node build.mjs', callDir);
      if (!built) results.push(['call-build', false]);
    }
    results.push([
      'call-test',
      run('Call signaling suite', 'node call.test.mjs', callDir),
    ]);
  } else {
    log('⊘ call-test not found — skip');
  }
}

// 5) Theme contrast
const themeScript = join(ROOT, 'scripts', 'theme-contrast.mjs');
if (existsSync(themeScript)) {
  results.push(['theme-contrast', run('Theme contrast', 'node scripts/theme-contrast.mjs', ROOT)]);
}

// 6) Optional DB verify
if (process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_URL) {
  const authz = join(ROOT, 'scripts', 'db-verify-authz.mjs');
  if (existsSync(authz)) {
    results.push(['db-authz', run('DB authz verify', 'node scripts/db-verify-authz.mjs', ROOT)]);
  }
} else {
  log('\n⊘ DB verify skipped (set SUPABASE_DB_PASSWORD or DATABASE_URL to enable)');
}

// Summary
log('\n════════ SUMMARY ════════');
let failed = 0;
for (const [name, ok] of results) {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
log(`\n${failed === 0 ? 'ALL AUTOMATED LAYERS GREEN' : `${failed} LAYER(S) FAILED`}`);
log(`Full log: ${logPath}`);
log('\nManual P0 catalog: validation/PRODUCTION_VALIDATION_SUITE.md');
log('Gate checklist:   validation/checklists/PLAY_STORE_GATE.md');

writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');
process.exit(failed === 0 ? 0 : 1);
