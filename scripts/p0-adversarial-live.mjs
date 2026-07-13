#!/usr/bin/env node
/**
 * Optional live REST attacks against a real project.
 * Requires: SUPABASE_URL, SUPABASE_ANON_KEY, TEST_JWT (authenticated user JWT)
 *
 * Expected: every attack is denied (401/403/empty/error).
 *
 * Run: node scripts/p0-adversarial-live.mjs
 */
const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const jwt = process.env.TEST_JWT;

if (!url || !anon || !jwt) {
  console.log('⊘ skip live adversarial (set SUPABASE_URL, SUPABASE_ANON_KEY, TEST_JWT)');
  process.exit(0);
}

let failed = 0;
function ok(label, cond, detail = '') {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${url.replace(/\/$/, '')}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { /* */ }
  return { status: res.status, text, json };
}

console.log('\n═══ P0 LIVE ADVERSARIAL (REST) ═══\n');

// 1) Try insert system message
console.log('1) INSERT type=system');
{
  const r = await rest('/rest/v1/messages', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      conversation_id: '00000000-0000-0000-0000-000000000001',
      sender_id: '00000000-0000-0000-0000-000000000002',
      type: 'system',
      content: 'FORGED',
    },
  });
  ok(
    'system INSERT rejected',
    r.status >= 400 || /system|policy|permission|check|violation|not a member/i.test(r.text),
    `status=${r.status}`,
  );
}

// 2) claim_push_outbox RPC
console.log('\n2) claim_push_outbox as user');
{
  const r = await rest('/rest/v1/rpc/claim_push_outbox', {
    method: 'POST',
    body: { p_limit: 5 },
  });
  ok(
    'claim_push_outbox denied',
    r.status === 401 || r.status === 403 || r.status === 404 || /permission|denied|not exist/i.test(r.text),
    `status=${r.status}`,
  );
}

// 3) recipient_push_tokens
console.log('\n3) recipient_push_tokens harvest');
{
  const r = await rest('/rest/v1/rpc/recipient_push_tokens', {
    method: 'POST',
    body: { p_conversation: '00000000-0000-0000-0000-000000000001' },
  });
  ok(
    'recipient_push_tokens denied',
    r.status === 401 || r.status === 403 || r.status === 404 || /permission|denied|not exist/i.test(r.text),
    `status=${r.status}`,
  );
}

// 4) Enumerate peers' phone via profiles
console.log('\n4) profiles phone dump');
{
  const r = await rest('/rest/v1/profiles?select=id,phone&limit=50');
  const rows = Array.isArray(r.json) ? r.json : [];
  const phones = rows.filter((x) => x && x.phone != null && String(x.phone).length > 0);
  // Under RLS own-or-admin: at most own row with phone.
  ok(
    'no mass peer phone leak',
    phones.length <= 1,
    `rows=${rows.length} phones=${phones.length}`,
  );
}

// 5) public_profiles has no phone field
console.log('\n5) public_profiles schema');
{
  const r = await rest('/rest/v1/public_profiles?select=*&limit=1');
  if (r.status === 200 && Array.isArray(r.json) && r.json[0]) {
    ok('public_profiles row has no phone key', !('phone' in r.json[0]));
  } else {
    ok('public_profiles reachable or empty', r.status === 200 || r.status === 206, `status=${r.status}`);
  }
}

// 6) post_system_message RPC
console.log('\n6) post_system_message as user');
{
  const r = await rest('/rest/v1/rpc/post_system_message', {
    method: 'POST',
    body: { p_conv: '00000000-0000-0000-0000-000000000001', p_text: 'FORGED' },
  });
  ok(
    'post_system_message denied',
    r.status === 401 || r.status === 403 || r.status === 404 || /permission|denied|not exist|forbidden/i.test(r.text),
    `status=${r.status}`,
  );
}

console.log(`\n═══ live adversarial: ${failed === 0 ? 'PASS' : `${failed} FAIL`} ═══\n`);
process.exit(failed === 0 ? 0 : 1);
