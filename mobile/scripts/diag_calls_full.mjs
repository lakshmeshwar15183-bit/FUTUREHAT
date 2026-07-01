// FULL call-path diagnostic against the real project. Verifies, end to end, the
// non-WebRTC substrate the app relies on (the WebRTC media layer itself needs
// two devices; everything up to it is testable here):
//   1. Two users authenticate.
//   2. A shared direct conversation exists (needed for RLS on calls + signaling).
//   3. Caller INSERTs a `calls` row → callee receives it via postgres_changes
//      (this is the "incoming call ring" trigger).
//   4. Both join `call:<id>` broadcast and complete a ready→offer→answer→candidate
//      exchange (the exact SDP/ICE path).
// Any step that fails is the real root cause of "stuck on Connecting…".
import { createClient } from '@supabase/supabase-js';

const URL = 'https://toscljrivrawvlfebdzz.supabase.co';
const KEY = 'sb_publishable_qZsG21qWLfgNCfRqOpn2tw_PsLOKiai';
const mk = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureUser(email, password) {
  const c = mk();
  const si = await c.auth.signInWithPassword({ email, password });
  if (si.data?.user) return { user: si.data.user, client: c };
  const su = await c.auth.signUp({ email, password });
  if (su.data?.session) return { user: su.data.user, client: c };
  const retry = await c.auth.signInWithPassword({ email, password });
  if (retry.data?.user) return { user: retry.data.user, client: c };
  throw new Error(`auth failed ${email}: ${su.error?.message || retry.error?.message}`);
}

const result = { auth: false, conversation: false, incomingViaPostgres: false, broadcast: false };

try {
  const A = await ensureUser('diag_a@futurehat.test', 'Diag!2026pass');
  const B = await ensureUser('diag_b@futurehat.test', 'Diag!2026pass');
  result.auth = true;
  log('✅ auth: A', A.user.id.slice(0, 8), '| B', B.user.id.slice(0, 8));

  // Ensure a direct conversation between A and B (RPC is idempotent).
  const { data: convId, error: convErr } = await A.client.rpc('start_direct_conversation', { other_user: B.user.id });
  if (convErr || !convId) throw new Error('start_direct_conversation failed: ' + convErr?.message);
  result.conversation = true;
  log('✅ conversation:', convId);

  // B subscribes to incoming calls exactly like CallContext does.
  let incomingCall = null;
  const incomingCh = B.client
    .channel('calls:incoming')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, (p) => {
      log('   B postgres_changes INSERT calls:', p.new.id);
      incomingCall = p.new;
    })
    .subscribe((s) => log('   B calls:incoming status:', s));
  await sleep(2000);

  // A creates the call.
  const { data: call, error: callErr } = await A.client
    .from('calls')
    .insert({ conversation_id: convId, caller_id: A.user.id, type: 'audio', status: 'ringing' })
    .select().single();
  if (callErr) throw new Error('createCall failed: ' + callErr.message);
  log('   A created call:', call.id);

  // Wait for the postgres_changes to reach B.
  for (let i = 0; i < 20 && !incomingCall; i++) await sleep(300);
  result.incomingViaPostgres = !!incomingCall;
  log(result.incomingViaPostgres ? '✅ incoming call reached callee (postgres_changes)' : '❌ callee NEVER got the INSERT — incoming ring would never show');

  // Now the broadcast signaling handshake on call:<id>.
  const chanName = `call:${call.id}`;
  let bGotOffer = false, aGotAnswer = false, aGotCand = false;
  const join = (client, selfId, label, onSig) => {
    const ch = client.channel(chanName, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
      if (payload.from !== selfId) { log(`   ${label} recv`, payload.kind); onSig(payload, ch, selfId); }
    }).subscribe((s) => log(`   ${label} ${chanName} status:`, s));
    return ch;
  };
  const send = (ch, selfId, msg) => ch.send({ type: 'broadcast', event: 'signal', payload: { ...msg, from: selfId } });

  const aCh = join(A.client, A.user.id, 'A(caller)', (m, ch, self) => {
    if (m.kind === 'ready') send(ch, self, { kind: 'offer', data: { type: 'offer', sdp: 'X' } });
    if (m.kind === 'answer') { aGotAnswer = true; send(ch, self, { kind: 'candidate', data: { candidate: 'c', sdpMid: '0' } }); }
  });
  const bCh = join(B.client, B.user.id, 'B(callee)', (m, ch, self) => {
    if (m.kind === 'offer') { bGotOffer = true; send(ch, self, { kind: 'answer', data: { type: 'answer', sdp: 'Y' } }); }
    if (m.kind === 'candidate') aGotCand = true;
  });
  await sleep(2500);
  for (let i = 0; i < 5; i++) { send(bCh, B.user.id, { kind: 'ready' }); await sleep(700); }
  await sleep(1500);
  result.broadcast = bGotOffer && aGotAnswer;
  log('   offer→callee:', bGotOffer, '| answer→caller:', aGotAnswer, '| candidate→callee:', aGotCand);
  log(result.broadcast ? '✅ broadcast SDP handshake OK' : '❌ broadcast handshake BROKEN');

  // cleanup
  await A.client.from('calls').update({ status: 'ended' }).eq('id', call.id);
  A.client.removeChannel(incomingCh); A.client.removeChannel(aCh); B.client.removeChannel(bCh);
} catch (e) {
  log('ERROR:', e.message);
}

log('=== SUMMARY ===', JSON.stringify(result));
const ok = result.auth && result.conversation && result.incomingViaPostgres && result.broadcast;
log(ok ? '🎉 SIGNALING SUBSTRATE FULLY WORKS' : '⚠️  SIGNALING SUBSTRATE HAS A BROKEN STEP (see ❌ above)');
process.exit(0);
