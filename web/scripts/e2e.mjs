// FUTUREHAT — end-to-end verification against the LIVE backend.
// Pure Supabase client (HTTPS) — same operations the app performs. No admin DB.
// Creates two throwaway users and runs the full flow. (Test users remain in the
// project; a cleanup query is printed at the end.)
//
// Env: FH_URL, FH_ANON (Supabase project url + anon/publishable key)

import { createClient } from '@supabase/supabase-js';

const URL = process.env.FH_URL;
const ANON = process.env.FH_ANON;
const SERVICE = process.env.FH_SERVICE_ROLE; // optional: createUser via Admin API (no email, no rate limit)
const ts = Date.now();
const A = { email: `fh.e2e.a.${ts}@gmail.com`, password: 'Password123!', name: 'E2E Alice' };
const B = { email: `fh.e2e.b.${ts}@gmail.com`, password: 'Password123!', name: 'E2E Bob' };

const adminClient = SERVICE
  ? createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

let pass = 0, fail = 0, skip = 0;
const results = [];
const createdIds = [];
const ok = (n, cond, d = '') => { results.push(`${cond ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); cond ? pass++ : fail++; return cond; };
const skipt = (n, d) => { results.push(`⏭️  ${n} — ${d}`); skip++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

async function authed(client, who) {
  // Preferred: Admin API creates a confirmed user with no email + no rate limit.
  if (adminClient) {
    const cr = await adminClient.auth.admin.createUser({
      email: who.email, password: who.password, email_confirm: true, user_metadata: { display_name: who.name },
    });
    if (cr.error) return { error: cr.error };
    const si = await client.auth.signInWithPassword({ email: who.email, password: who.password });
    if (si.error) return { error: si.error };
    return { user: si.data.user };
  }
  // Fallback: public signUp (subject to the email rate limit).
  const up = await client.auth.signUp({ email: who.email, password: who.password, options: { data: { display_name: who.name } } });
  if (up.error) return { error: up.error };
  if (up.data.session) return { user: up.data.user }; // autoconfirm on
  const si = await client.auth.signInWithPassword({ email: who.email, password: who.password });
  if (si.error) return { error: si.error, needsConfirm: /confirm/i.test(si.error.message) };
  return { user: si.data.user };
}

async function cleanupUsers(ids) {
  if (!adminClient) return;
  for (const id of ids) { if (id) await adminClient.auth.admin.deleteUser(id).catch(() => {}); }
}

async function main() {
  const ca = mk(), cb = mk();

  const aAuth = await authed(ca, A);
  const bAuth = await authed(cb, B);
  ok('User registration + login (A)', !aAuth.error, aAuth.error?.message);
  ok('User registration + login (B)', !bAuth.error, bAuth.error?.message);

  if (aAuth.error || bAuth.error) {
    if (aAuth.needsConfirm || bAuth.needsConfirm) {
      skipt('Authenticated flow', 'project requires email confirmation — enable "autoconfirm" in Supabase Auth settings to run the full E2E, or confirm the test users');
    }
    return finish();
  }
  const aId = aAuth.user.id, bId = bAuth.user.id;
  createdIds.push(aId, bId);
  await sleep(500); // let the profile trigger run

  // Logout/login round-trip
  const lo = await ca.auth.signOut();
  const li = await ca.auth.signInWithPassword({ email: A.email, password: A.password });
  ok('Logout + re-login', !lo.error && !li.error, lo.error?.message || li.error?.message);

  await ca.from('profiles').update({ display_name: A.name, username: `alice_${ts}` }).eq('id', aId);
  await cb.from('profiles').update({ display_name: B.name, username: `bob_${ts}` }).eq('id', bId);

  const search = await ca.from('profiles').select('*').eq('username', `bob_${ts}`);
  ok('Profile search', !search.error && search.data?.length === 1, search.error?.message);

  const conv = await ca.rpc('start_direct_conversation', { other_user: bId });
  const convId = conv.data;
  ok('Start 1:1 conversation (RPC)', !conv.error && !!convId, conv.error?.message);
  if (!convId) return finish(ca, cb);

  // Realtime delivery.
  // RLS-gated postgres_changes are only delivered to a socket that carries the
  // user's access token. The browser client sets this automatically (default
  // persistSession/autoRefresh); this headless client has them off, so set it
  // explicitly — mirrors what the app does, isolating the realtime feature.
  const bSession = (await cb.auth.getSession()).data.session;
  // setAuth is ASYNC in realtime-js v2 — it pushes the JWT to the socket and any
  // channels. It MUST be awaited before subscribe(), or the channel joins with the
  // anon token and RLS-gated postgres_changes are silently never delivered.
  if (bSession) await cb.realtime.setAuth(bSession.access_token);

  let rt = false;
  const chan = cb.channel(`e2e:${convId}`).on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, () => { rt = true; });
  await new Promise((res) => { chan.subscribe((s) => s === 'SUBSCRIBED' && res()); setTimeout(res, 8000); });

  const m1 = await ca.from('messages').insert({ conversation_id: convId, sender_id: aId, type: 'text', content: 'hello from A' }).select().single();
  ok('Send message', !m1.error && !!m1.data, m1.error?.message);
  // Poll for delivery rather than a fixed sleep — realtime latency varies.
  for (let i = 0; i < 30 && !rt; i++) await sleep(300);
  ok('Realtime message delivery', rt);
  if (!m1.data) { await chan.unsubscribe(); return finish(ca, cb); } // bail cleanly so results print
  await chan.unsubscribe();

  const bRead = await cb.from('messages').select('*').eq('conversation_id', convId);
  ok('Cross-user read (RLS member access)', !bRead.error && bRead.data?.some((m) => m.id === m1.data?.id), bRead.error?.message);

  const rec = await cb.from('message_receipts').upsert({ message_id: m1.data.id, user_id: bId, status: 'read' });
  ok('Write read receipt', !rec.error, rec.error?.message);
  const aRec = await ca.from('message_receipts').select('*').eq('message_id', m1.data.id).eq('status', 'read');
  ok('Read receipt visible to sender', !aRec.error && aRec.data?.length === 1, aRec.error?.message);

  const react = await cb.from('message_reactions').insert({ message_id: m1.data.id, user_id: bId, emoji: '👍' });
  ok('Add reaction', !react.error, react.error?.message);
  const aReact = await ca.from('message_reactions').select('*').eq('message_id', m1.data.id);
  ok('Reaction visible to other user', !aReact.error && aReact.data?.length === 1, aReact.error?.message);

  const edit = await ca.from('messages').update({ content: 'edited by A', edited_at: new Date().toISOString() }).eq('id', m1.data.id).select().single();
  ok('Edit message', !edit.error && edit.data?.content === 'edited by A' && !!edit.data?.edited_at, edit.error?.message);

  const m2 = await ca.from('messages').insert({ conversation_id: convId, sender_id: aId, type: 'text', content: 'to delete' }).select().single();
  const del = await ca.from('messages').update({ is_deleted: true, content: null }).eq('id', m2.data.id).select().single();
  ok('Delete message (soft)', !del.error && del.data?.is_deleted === true, del.error?.message);

  const fwd = await ca.from('messages').insert({ conversation_id: convId, sender_id: aId, type: 'text', content: 'forwarded' }).select().single();
  ok('Forward message (re-send)', !fwd.error && !!fwd.data, fwd.error?.message);

  const media = await ca.from('messages').insert({ conversation_id: convId, sender_id: aId, type: 'image', media_url: 'https://example.com/x.png', content: '' }).select().single();
  ok('Media message insert', !media.error && media.data?.type === 'image', media.error?.message);

  // Premium gating BEFORE subscription
  const hideBlk = await cb.from('hidden_conversations').insert({ user_id: bId, conversation_id: convId });
  ok('Free user blocked from hiding chats (RLS)', !!hideBlk.error, hideBlk.error ? 'correctly denied' : 'WAS ALLOWED — gate failed');
  const schBlk = await cb.from('scheduled_messages').insert({ conversation_id: convId, sender_id: bId, content: 'later', send_at: new Date(Date.now() + 3600e3).toISOString() });
  ok('Free user blocked from scheduling (RLS)', !!schBlk.error, schBlk.error ? 'correctly denied' : 'WAS ALLOWED — gate failed');

  // Subscription activation
  const sub = await cb.from('subscriptions').upsert({
    user_id: bId, plan: 'yearly', status: 'active', provider: 'manual',
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 365 * 24 * 3600e3).toISOString(),
  }).select().single();
  ok('Premium subscription activation', !sub.error && sub.data?.status === 'active', sub.error?.message);

  const isP = await cb.rpc('is_premium', { uid: bId });
  ok('is_premium() true after activation', !isP.error && isP.data === true, isP.error?.message);
  const pv = await cb.from('premium_users').select('user_id').eq('user_id', bId);
  ok('premium_users view lists subscriber', !pv.error && pv.data?.length === 1, pv.error?.message);

  // Premium features now work
  const hideOk = await cb.from('hidden_conversations').insert({ user_id: bId, conversation_id: convId });
  ok('Premium user can hide chats', !hideOk.error, hideOk.error?.message);
  const schOk = await cb.from('scheduled_messages').insert({ conversation_id: convId, sender_id: bId, content: 'later', send_at: new Date(Date.now() + 3600e3).toISOString() });
  ok('Premium user can schedule messages', !schOk.error, schOk.error?.message);

  const pref = await cb.from('user_preferences').upsert({ user_id: bId, theme: 'midnight', font: 'inter', ghost_mode: true }).select().single();
  ok('Save premium preferences (themes/settings)', !pref.error && pref.data?.theme === 'midnight', pref.error?.message);

  const disp = await cb.rpc('dispatch_due_messages');
  ok('dispatch_due_messages() RPC', !disp.error, disp.error?.message);

  await finish(ca, cb);
}

async function finish() {
  await cleanupUsers(createdIds);
  console.log('\n──────── FUTUREHAT E2E RESULTS ────────');
  for (const r of results) console.log(r);
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  if (!adminClient) console.log(`\nCleanup (SQL editor): delete from auth.users where email like 'fh.e2e.%@gmail.com';`);
  else console.log('\nTest users auto-deleted via Admin API.');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('E2E CRASH:', e); process.exit(1); });
