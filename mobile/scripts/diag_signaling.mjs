// Diagnostic: reproduce the EXACT signaling path the app uses.
// 1. Auth two users.
// 2. Have them join the same `call:<id>` broadcast channel (self:false), exactly
//    like createSignalingChannel().
// 3. Verify a message sent by A actually reaches B and vice-versa.
// This isolates "is Supabase Realtime broadcast delivering the SDP/ICE at all?"
import { createClient } from '@supabase/supabase-js';

const URL = 'https://toscljrivrawvlfebdzz.supabase.co';
const KEY = 'sb_publishable_qZsG21qWLfgNCfRqOpn2tw_PsLOKiai';
const mk = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function ensureUser(email, password) {
  const c = mk();
  const si = await c.auth.signInWithPassword({ email, password });
  if (si.data?.user) return { user: si.data.user, client: c };
  const su = await c.auth.signUp({ email, password });
  if (su.data?.session) return { user: su.data.user, client: c };
  const retry = await c.auth.signInWithPassword({ email, password });
  if (retry.data?.user) return { user: retry.data.user, client: c };
  throw new Error(`auth failed for ${email}: ${su.error?.message || retry.error?.message}`);
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

const A = await ensureUser('diag_a@futurehat.test', 'Diag!2026pass');
const B = await ensureUser('diag_b@futurehat.test', 'Diag!2026pass');
log('authed A', A.user.id);
log('authed B', B.user.id);

const callId = 'diagcall-' + A.user.id.slice(0, 8);
const chanName = `call:${callId}`;

function joinSignaling(client, selfId, label, onSignal) {
  const channel = client.channel(chanName, { config: { broadcast: { self: false } } });
  channel
    .on('broadcast', { event: 'signal' }, ({ payload }) => {
      if (payload.from !== selfId) { log(`${label} RECEIVED`, payload.kind, 'from', payload.from.slice(0,8)); onSignal?.(payload); }
    })
    .subscribe((status) => log(`${label} channel status:`, status));
  return {
    send: (msg) => channel.send({ type: 'broadcast', event: 'signal', payload: { ...msg, from: selfId } }),
    channel,
  };
}

let aGotReady = false, bGotOffer = false, aGotAnswer = false;

const sigA = joinSignaling(A.client, A.user.id, 'CALLER-A', (m) => {
  if (m.kind === 'ready') { aGotReady = true; log('CALLER-A sends OFFER in response to ready'); sigA.send({ kind: 'offer', data: { sdp: 'FAKE_OFFER' } }); }
  if (m.kind === 'answer') { aGotAnswer = true; }
});
const sigB = joinSignaling(B.client, B.user.id, 'CALLEE-B', (m) => {
  if (m.kind === 'offer') { bGotOffer = true; log('CALLEE-B sends ANSWER in response to offer'); sigB.send({ kind: 'answer', data: { sdp: 'FAKE_ANSWER' } }); }
});

// Give both a moment to subscribe, then callee starts the ready heartbeat.
await new Promise((r) => setTimeout(r, 2500));
log('--- callee-B starts ready heartbeat ---');
for (let i = 0; i < 5; i++) { sigB.send({ kind: 'ready' }); await new Promise((r) => setTimeout(r, 700)); }

await new Promise((r) => setTimeout(r, 1500));
log('=== RESULT ===');
log('caller got ready :', aGotReady);
log('callee got offer :', bGotOffer);
log('caller got answer:', aGotAnswer);
log(aGotReady && bGotOffer && aGotAnswer ? 'SIGNALING OK ✅' : 'SIGNALING BROKEN ❌');
process.exit(0);
