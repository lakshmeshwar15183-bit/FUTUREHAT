// Mock of ../lib/shared for the call harness: an in-memory signaling bus that
// stands in for the Supabase realtime broadcast channel. It faithfully models the
// two real-world hazards:
//   • onReady fires asynchronously (like a real SUBSCRIBED ack), and
//   • messages can be DROPPED (broadcast has no replay), which is exactly the
//     condition that used to wedge the handshake on "Connecting…".
const peersByCall = new Map(); // callId -> Set<peer>
let dropPredicate = null;      // (msg) => boolean : return true to drop
const busLog = [];

function buildIceServers() { return [{ urls: 'stun:mock' }]; }
function hasTurn() { return false; }

function createSignalingChannel(client, callId, selfId, onSignal, onReady) {
  const peer = { selfId, onSignal };
  if (!peersByCall.has(callId)) peersByCall.set(callId, new Set());
  peersByCall.get(callId).add(peer);
  // Simulate the async SUBSCRIBED ack.
  queueMicrotask(() => onReady && onReady());

  return {
    channel: { __mock: true },
    send: (msg) => {
      const full = { ...msg, from: selfId };
      if (dropPredicate && dropPredicate(full)) { busLog.push(['DROP', full.kind, selfId]); return; }
      busLog.push(['send', full.kind, selfId]);
      for (const p of peersByCall.get(callId) ?? []) {
        if (p.selfId !== selfId) queueMicrotask(() => p.onSignal(full));
      }
    },
    close: () => { peersByCall.get(callId)?.delete(peer); },
  };
}

module.exports = {
  buildIceServers,
  hasTurn,
  createSignalingChannel,
  __setDrop: (fn) => { dropPredicate = fn; },
  __busLog: busLog,
  __reset: () => { peersByCall.clear(); dropPredicate = null; busLog.length = 0; },
};
