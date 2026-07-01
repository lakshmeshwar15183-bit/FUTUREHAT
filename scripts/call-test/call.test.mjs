// Runtime verification of the REAL CallSession (bundled) driven through a two-peer
// signaling handshake with mocked WebRTC + an in-memory bus. Proves the signaling
// state machine, the dual-signal connect, and that "Connecting…" can no longer
// hang (watchdog). Real media/ICE/audio still require a device — see report.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { CallSession } = require('./bundle.cjs');
const RN = require('./mocks/react-native-webrtc.js');
const ICM = require('./mocks/react-native-incall-manager.js');
const SH = require('./mocks/shared.js');

const CALL = 'call-1';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); for (let i = 0; i < 12; i++) await Promise.resolve(); };

function reset() { RN.__resetPeers(); ICM.__reset(); SH.__reset(); }
function peer(selfId, isCaller, type) {
  const events = [];
  const s = new CallSession(CALL, selfId, isCaller, type, {
    onLocalStream: () => events.push('localStream'),
    onRemoteStream: () => events.push('remoteStream'),
    onConnected: () => events.push('connected'),
    onEnded: () => events.push('ended'),
  });
  return { s, events };
}
// Bring two peers through the full SDP/ICE handshake. Returns their fake PCs.
async function handshake(type = 'audio') {
  const caller = peer('A', true, type);
  const callee = peer('B', false, type);
  caller.s.start(); callee.s.start();
  await flush();
  const [pcA, pcB] = RN.__peers;
  return { caller, callee, pcA, pcB };
}

test.beforeEach(() => { reset(); mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); });
test.afterEach(() => { mock.timers.reset(); });

test('SIGNALING: ready→offer→answer→candidate exchange completes; both reach stable', async () => {
  const { caller, callee, pcA, pcB } = await handshake('audio');
  const kinds = SH.__busLog.filter((r) => r[0] === 'send').map((r) => r[1]);
  console.log('  bus messages:', kinds.join(' → '));
  console.log('  caller signalingState:', pcA.signalingState, '| callee signalingState:', pcB.signalingState);
  console.log('  ICE candidates added — caller:', pcA.addedCandidates.length, 'callee:', pcB.addedCandidates.length);
  assert.ok(kinds.includes('ready'), 'callee announced ready');
  assert.ok(kinds.includes('offer'), 'caller sent offer');
  assert.ok(kinds.includes('answer'), 'callee sent answer');
  assert.equal(pcA.signalingState, 'stable');
  assert.equal(pcB.signalingState, 'stable');
  assert.ok(pcA.addedCandidates.length >= 1 && pcB.addedCandidates.length >= 1, 'ICE candidates crossed both ways');
  assert.ok(caller.events.includes('localStream') && callee.events.includes('localStream'), 'local media acquired');
});

test('CONNECT: firing iceConnectionState=connected clears "Connecting…" on both peers', async () => {
  const { caller, callee, pcA, pcB } = await handshake('audio');
  pcA.__fireIce('connected'); pcB.__fireIce('connected');
  console.log('  caller events:', caller.events.join(','), '| callee events:', callee.events.join(','));
  assert.ok(caller.events.includes('connected'), 'caller onConnected fired');
  assert.ok(callee.events.includes('connected'), 'callee onConnected fired');
});

test('DUAL-SIGNAL: connectionState stuck at "connecting" but iceConnectionState=completed still connects', async () => {
  const { caller, pcA } = await handshake('video');
  pcA.__fireConn('connecting'); // aggregated state never advances (Android quirk)
  assert.ok(!caller.events.includes('connected'), 'not connected on connecting alone');
  pcA.__fireIce('completed');   // the dependable signal
  console.log('  after ice=completed, connected:', caller.events.includes('connected'));
  assert.ok(caller.events.includes('connected'), 'ICE completed alone clears Connecting…');
});

test('STUCK-BUG FIX: offer permanently dropped → was stuck forever → watchdog now ENDS at 45s', async () => {
  SH.__setDrop((msg) => msg.kind === 'offer'); // simulate lost offer (broadcast, no replay)
  const caller = peer('A', true, 'audio');
  const callee = peer('B', false, 'audio');
  caller.s.start(); callee.s.start();
  await flush();
  // Handshake wedged: offer never reaches callee; ICE never starts.
  assert.ok(!caller.events.includes('connected'), 'never connected (offer lost)');
  assert.ok(!caller.events.includes('ended'), 'not yet ended — THIS is the old stuck state');

  mock.timers.tick(8400); await flush();   // heartbeat window elapses, still wedged
  console.log('  at 8.4s — connected:', caller.events.includes('connected'), 'ended:', caller.events.includes('ended'), '(stuck)');
  assert.ok(!caller.events.includes('ended'), 'still stuck after heartbeat gives up');

  mock.timers.tick(44999 - 8400); await flush();
  assert.ok(!caller.events.includes('ended'), 'still stuck at t=44999ms (proves it would hang without watchdog)');

  mock.timers.tick(2); await flush();       // cross the 45s watchdog
  console.log('  at 45s — ended:', caller.events.includes('ended'), '| ever connected:', caller.events.includes('connected'));
  assert.ok(caller.events.includes('ended'), 'watchdog ENDED the wedged call — no infinite Connecting…');
  assert.ok(!caller.events.includes('connected'), 'and it never falsely reported connected');
});

test('WATCHDOG cleared on success: a call that connects does NOT get killed at 45s', async () => {
  const { caller, pcA } = await handshake('audio');
  pcA.__fireIce('connected'); await flush();
  mock.timers.tick(60000); await flush(); // long past the watchdog
  const ends = caller.events.filter((e) => e === 'ended').length;
  console.log('  connected then +60s — ended count:', ends);
  assert.equal(ends, 0, 'connected call survives past the watchdog window');
});

test('ICE FAILED surfaces as ended (not a hang)', async () => {
  const { caller, pcA } = await handshake('audio');
  pcA.__fireIce('failed'); await flush();
  console.log('  events after ice=failed:', caller.events.join(','));
  assert.ok(caller.events.includes('ended'), 'ICE failure ends the call');
});

test('RECONNECT grace: transient disconnect recovers; sustained disconnect ends after 12s', async () => {
  const { caller, pcA } = await handshake('audio');
  pcA.__fireIce('connected'); await flush();
  pcA.__fireIce('disconnected'); await flush();      // blip
  mock.timers.tick(5000);
  pcA.__fireIce('connected'); await flush();          // recovered within grace
  mock.timers.tick(12000); await flush();
  console.log('  after blip+recover: ended?', caller.events.includes('ended'));
  assert.ok(!caller.events.includes('ended'), 'recovered blip did NOT tear down');
  // now a sustained disconnect
  pcA.__fireIce('disconnected'); await flush();
  mock.timers.tick(12001); await flush();
  console.log('  after sustained disconnect: ended?', caller.events.includes('ended'));
  assert.ok(caller.events.includes('ended'), 'sustained disconnect ended after 12s grace');
});

test('BYE: hanging up one side sends bye → the other side ends + cleans up', async () => {
  const { caller, callee } = await handshake('audio');
  caller.s.end(true); await flush(); // user taps hangup
  console.log('  caller events:', caller.events.join(','), '| callee events:', callee.events.join(','));
  assert.ok(caller.events.includes('ended'), 'caller ended');
  assert.ok(callee.events.includes('ended'), 'callee received bye and ended');
  assert.ok(ICM.__log.some((l) => l[0] === 'stop'), 'InCallManager.stop() called (audio session released)');
});

test('CONTROLS: mute / speaker / video toggle / switchCamera act on tracks + audio routing', async () => {
  const { caller, pcA } = await handshake('video');
  const s = caller.s;
  const muted = s.toggleMute();
  const audioTrack = pcA.tracks.map((t) => t.track).find((t) => t.kind === 'audio');
  console.log('  muted:', muted, '| audio track enabled:', audioTrack.enabled);
  assert.equal(muted, true); assert.equal(audioTrack.enabled, false);

  const spk = s.toggleSpeaker();
  assert.ok(ICM.__log.some((l) => l[0] === 'speaker'), 'speaker routing invoked');
  console.log('  speaker now:', spk, '| InCallManager speaker calls:', ICM.__log.filter((l) => l[0] === 'speaker').length);

  const videoOn = s.toggleVideo();
  const videoTrack = pcA.tracks.map((t) => t.track).find((t) => t.kind === 'video');
  assert.equal(videoOn, false); assert.equal(videoTrack.enabled, false);

  s.switchCamera();
  console.log('  switchCamera count:', videoTrack.__switched);
  assert.equal(videoTrack.__switched, 1, 'front/back camera switch invoked on the video track');
});
