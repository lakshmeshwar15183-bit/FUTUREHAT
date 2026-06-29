// FUTUREHAT — verify the permanent developer override.
// Signs in (or signs up, if the account doesn't exist yet) as the developer
// email, then asserts lifetime Premium + Admin straight from the live backend.
//
// Env: FH_URL, FH_ANON (required). Optional: FH_DEV_EMAIL, FH_DEV_PASSWORD.
// Requires migrations 0004_grants.sql and 0005_developer_override.sql applied,
// and (for first-time signup) Supabase email-confirmation OFF.

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const URL = process.env.FH_URL;
const ANON = process.env.FH_ANON;
const EMAIL = (process.env.FH_DEV_EMAIL || 'lakshmeshwar15183@gmail.com').toLowerCase();
// A strong password is generated if none supplied; it's printed so you can keep it.
const PASSWORD = process.env.FH_DEV_PASSWORD || `Dev!${randomBytes(9).toString('base64url')}`;

if (!URL || !ANON) { console.error('Set FH_URL and FH_ANON'); process.exit(1); }

const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
let pass = 0, fail = 0;
const ok = (n, cond, d = '') => { console.log(`${cond ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); cond ? pass++ : fail++; return cond; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1) Authenticate — sign in, or sign up on first run.
  let signedUp = false;
  let si = await c.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (si.error) {
    const up = await c.auth.signUp({ email: EMAIL, password: PASSWORD, options: { data: { display_name: 'FUTUREHAT Developer' } } });
    if (up.error) { ok('Authenticate developer', false, up.error.message); return finish(); }
    signedUp = true;
    if (!up.data.session) {
      si = await c.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
      if (si.error) { ok('Authenticate developer', false, `signup ok but sign-in failed: ${si.error.message} (email confirmation may be ON)`); return finish(); }
    }
  }
  const { data: { user } } = await c.auth.getUser();
  ok(`Authenticate developer (${signedUp ? 'created on first login' : 'existing account'})`, !!user, user ? user.id : 'no user');
  if (!user) return finish();
  await sleep(700); // let the signup trigger provision

  // 2) Premium override active (server-authoritative).
  const prem = await c.rpc('is_premium', { uid: user.id });
  ok('is_premium() = true (lifetime Premium, no payment)', !prem.error && prem.data === true, prem.error?.message || `got ${JSON.stringify(prem.data)}`);

  // 3) Admin/developer privilege.
  const adm = await c.rpc('is_admin', { uid: user.id });
  ok('is_admin() = true (Admin/developer)', !adm.error && adm.data === true, adm.error?.message || `got ${JSON.stringify(adm.data)}`);

  // 4) Lifetime subscription row provisioned (so the client shows Premium).
  const sub = await c.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle();
  const s = sub.data;
  ok('Lifetime subscription row provisioned',
    !sub.error && s && s.status === 'active' && s.provider === 'developer' && new Date(s.current_period_end).getTime() > Date.now(),
    sub.error?.message || (s ? `status=${s.status} provider=${s.provider} ends=${s.current_period_end}` : 'no row'));

  // 5) Override is exact: a brand-new non-dev account must NOT be premium/admin.
  const otherEmail = `fh.nondev.${Date.now()}@gmail.com`;
  const oc = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const ou = await oc.auth.signUp({ email: otherEmail, password: 'Password123!', options: { data: { display_name: 'Non Dev' } } });
  if (!ou.error && (ou.data.session || !(await oc.auth.signInWithPassword({ email: otherEmail, password: 'Password123!' })).error)) {
    const oid = (await oc.auth.getUser()).data.user?.id;
    const op = await oc.rpc('is_premium', { uid: oid });
    const oa = await oc.rpc('is_admin', { uid: oid });
    ok('Non-developer is NOT premium (scope is exact)', op.data === false, `is_premium=${JSON.stringify(op.data)}`);
    ok('Non-developer is NOT admin (scope is exact)', oa.data === false, `is_admin=${JSON.stringify(oa.data)}`);
  } else {
    console.log('⏭️  Scope check skipped (could not create a control account)');
  }

  finish();
}

function finish() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (!process.env.FH_DEV_PASSWORD) console.log(`\nDeveloper login password (generated — save or reset it):\n  email:    ${EMAIL}\n  password: ${PASSWORD}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('VERIFY CRASH:', e); process.exit(1); });
