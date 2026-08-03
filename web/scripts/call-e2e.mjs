// Lumixo — live E2E for the CALL path (createCall + realtime incoming +
// broadcast signaling + status). Validates the exact backend behind a call so
// we can tell a client bug ("tap does nothing") from a backend one.
// Env: FH_URL, FH_ANON.
import { createClient } from '@supabase/supabase-js';

const URL = process.env.FH_URL, ANON = process.env.FH_ANON;
if (!URL || !ANON) { console.error('set FH_URL + FH_ANON'); process.exit(1); }
const ts = Date.now();
const A = { email: `fh.call.a.${ts}@gmail.com`, password: 'Password123!', name: 'Call Alice' };
const B = { email: `fh.call.b.${ts}@gmail.com`, password: 'Password123!', name: 'Call Bob' };
const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); c ? pass++ : fail++; return c; };

async function signUp(c, who) {
  const up = await c.auth.signUp({ email: who.email, password: who.password, options: { data: { display_name: who.name } } });
  if (up.error) return { error: up.error };
  if (up.data.session) return { user: up.data.user, session: up.data.session };
  const si = await c.auth.signInWithPassword({ email: who.email, password: who.password });
  return si.error ? { error: si.error } : { user: si.data.user, session: si.data.session };
}

async function main() {
  const ca = mk(), cb = mk();
  const a = await signUp(ca, A), b = await signUp(cb, B);
  if (!ok('auth A', !a.error, a.error?.message) || !ok('auth B', !b.error, b.error?.message)) return done();
  const aId = a.user.id, bId = b.user.id;

  // Direct conversation A<->B
  const conv = await ca.rpc('start_direct_conversation', { other_user: bId });
  const convId = conv.data;
  if (!ok('start_direct_conversation', !conv.error && !!convId, conv.error?.message)) return done();

  // B listens for incoming calls over realtime (must carry B's JWT).
  if (b.session) await cb.realtime.setAuth(b.session.access_token);
  let incoming = null;
  const inChan = cb.channel('calls:incoming').on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'calls' }, (p) => { incoming = p.new; });
  await new Promise((res) => inChan.subscribe((s) => s === 'SUBSCRIBED' && res()));
  // postgres_changes needs the WAL replication stream to warm up after SUBSCRIBED;
  // in the real app the incoming-call channel is long-lived (opened at startup),
  // so by call time it's always warm. Give it a moment here to match that.
  await sleep(2500);

  // A creates the call (this is the exact insert behind the call button).
  const call = await ca.from('calls').insert({ conversation_id: convId, caller_id: aId, type: 'video', status: 'ringing' }).select().single();
  ok('createCall insert (RLS) returns row', !call.error && !!call.data, call.error?.message);
  if (call.error) return done();
  const callId = call.data.id;

  // B receives the incoming call via realtime postgres_changes.
  for (let i = 0; i < 40 && !incoming; i++) await sleep(150);
  ok('B receives incoming call (realtime INSERT)', !!incoming && incoming.id === callId, incoming ? `got ${incoming.id}` : 'no delivery in 6s');

  // Broadcast signaling: A and B join call:<id>; exchange offer/answer/candidate.
  const sigA = ca.channel(`call:${callId}`, { config: { broadcast: { self: false } } });
  const sigB = cb.channel(`call:${callId}`, { config: { broadcast: { self: false } } });
  let aGot = null, bGot = null;
  sigA.on('broadcast', { event: 'signal' }, ({ payload }) => { if (payload.from !== aId) aGot = payload; });
  sigB.on('broadcast', { event: 'signal' }, ({ payload }) => { if (payload.from !== bId) bGot = payload; });
  await Promise.all([
    new Promise((r) => sigA.subscribe((s) => s === 'SUBSCRIBED' && r())),
    new Promise((r) => sigB.subscribe((s) => s === 'SUBSCRIBED' && r())),
  ]);
  await sleep(300);
  await sigA.send({ type: 'broadcast', event: 'signal', payload: { kind: 'offer', from: aId, data: { sdp: 'FAKE_OFFER' } } });
  for (let i = 0; i < 30 && !bGot; i++) await sleep(150);
  ok('offer A→B over broadcast', bGot?.kind === 'offer', bGot ? '' : 'not delivered');
  await sigB.send({ type: 'broadcast', event: 'signal', payload: { kind: 'answer', from: bId, data: { sdp: 'FAKE_ANSWER' } } });
  for (let i = 0; i < 30 && !aGot; i++) await sleep(150);
  ok('answer B→A over broadcast', aGot?.kind === 'answer', aGot ? '' : 'not delivered');

  // Status update accepted (UPDATE) seen by a status subscriber.
  let statusSeen = null;
  const stChan = cb.channel(`calls:status:${callId}`).on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}` }, (p) => { statusSeen = p.new; });
  await new Promise((res) => stChan.subscribe((s) => s === 'SUBSCRIBED' && res()));
  await sleep(300);
  await ca.from('calls').update({ status: 'accepted', answered_at: new Date().toISOString() }).eq('id', callId);
  for (let i = 0; i < 30 && !statusSeen; i++) await sleep(150);
  ok('status UPDATE delivered (accept)', statusSeen?.status === 'accepted', statusSeen ? '' : 'not delivered');

  // ── Regression: the `ready` handshake under REAL timing ─────────────────────
  // Reproduces the bug we fixed: the callee subscribes to the signaling channel
  // LATE (a human takes seconds to accept the ring). A blind offer fired on a
  // timer would be lost. With the handshake, the late callee broadcasts `ready`
  // once live and the caller (re)sends the offer in response, so it still lands.
  const rOk = await (async () => {
    const cid = `${callId}:ready`;
    const caller = ca.channel(`call:${cid}`, { config: { broadcast: { self: false } } });
    let callerOffered = false, calleeGotOffer = false;
    // Caller is subscribed early and only offers when it sees `ready`.
    caller.on('broadcast', { event: 'signal' }, ({ payload }) => {
      if (payload.from === aId) return;
      if (payload.kind === 'ready' && !callerOffered) {
        callerOffered = true;
        caller.send({ type: 'broadcast', event: 'signal', payload: { kind: 'offer', from: aId, data: { sdp: 'FAKE' } } });
      }
    });
    await new Promise((r) => caller.subscribe((s) => s === 'SUBSCRIBED' && r()));
    // Simulate the human-accept delay: blind 800ms offer would already be gone.
    await sleep(1500);
    const callee = cb.channel(`call:${cid}`, { config: { broadcast: { self: false } } });
    callee.on('broadcast', { event: 'signal' }, ({ payload }) => {
      if (payload.from !== bId && payload.kind === 'offer') calleeGotOffer = true;
    });
    await new Promise((r) => callee.subscribe((s) => s === 'SUBSCRIBED' && r()));
    callee.send({ type: 'broadcast', event: 'signal', payload: { kind: 'ready', from: bId } }); // announce
    for (let i = 0; i < 30 && !calleeGotOffer; i++) await sleep(150);
    return calleeGotOffer;
  })();
  ok('late callee still gets offer via `ready` handshake', rOk, rOk ? '' : 'offer never reached late subscriber');

  done();
}
function done() {
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(`-- cleanup: delete from auth.users where email like 'fh.call.%@gmail.com';`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
