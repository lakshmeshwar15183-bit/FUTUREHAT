// FUTUREHAT — calling data layer (framework-agnostic; web + mobile share it).
//
// The `calls` row tracks ring/accept/end state and call history. The actual
// WebRTC handshake (SDP offer/answer + ICE candidates) is exchanged over a
// per-call Supabase realtime *broadcast* channel — nothing sensitive is stored.
//
// STUN/TURN: free public STUN is fine for development and same-network testing.
// For reliable connectivity across mobile carriers/NATs in production you must
// add a TURN server (e.g. self-hosted coturn, or a managed provider). Pass its
// config via ICE_SERVERS below / the app's env.
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { Call, CallType, CallStatus, UUID } from './types.js';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Default ICE servers: public STUN only.
 *
 * IMPORTANT: STUN alone only connects peers that can reach each other directly
 * (same LAN or permissive/full-cone NAT). Calls ACROSS different networks —
 * mobile carrier ↔ home wifi, city ↔ city, most symmetric-NAT setups — REQUIRE a
 * TURN relay. There is intentionally NO default TURN here anymore: the previously
 * baked-in free relay (OpenRelay `openrelayproject`) is dead — its TLS/443 relay
 * is unreachable and the shared credentials are deprecated — so shipping it gave
 * a false sense of coverage while cross-network calls silently hung on
 * "Connecting…". Provision your OWN TURN and set it via env:
 *   web:    VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL
 *   mobile: EXPO_PUBLIC_TURN_URL / EXPO_PUBLIC_TURN_USERNAME / EXPO_PUBLIC_TURN_CREDENTIAL
 * The URL field accepts a COMMA-SEPARATED list so you can pass every transport a
 * provider gives you (udp/tcp/tls on 80/443) under one credential — e.g.
 *   "turn:turn.example.com:80,turn:turn.example.com:443?transport=tcp,turns:turn.example.com:443"
 * See buildIceServers(). Use hasTurn() to detect at runtime whether a relay is
 * configured, so the UI can warn instead of hanging.
 */
export const DEFAULT_ICE_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

/**
 * Build the ICE server list, putting an app-configured TURN (from env) ahead of
 * the STUN defaults. `custom.urls` may be a single URL, an array, or a
 * COMMA-SEPARATED string (real TURN providers hand you several transport URLs
 * under one credential) — all are normalized into one IceServer that carries the
 * shared username/credential. Falsy/empty urls are ignored.
 */
export function buildIceServers(custom?: IceServer | null): IceServer[] {
  const urls = normalizeUrls(custom?.urls);
  if (urls.length) {
    return [{ urls, username: custom!.username, credential: custom!.credential }, ...DEFAULT_ICE_SERVERS];
  }
  return DEFAULT_ICE_SERVERS;
}

/** Split a single/array/comma-separated urls value into a clean string array. */
function normalizeUrls(urls?: string | string[]): string[] {
  if (!urls) return [];
  const list = Array.isArray(urls) ? urls : String(urls).split(',');
  return list.map((u) => u.trim()).filter(Boolean);
}

/**
 * True if the resolved ICE list contains at least one TURN/TURNS relay. Lets the
 * call UI surface an explicit "no relay configured — cross-network calls may
 * fail" state instead of leaving the user on an endless "Connecting…".
 */
export function hasTurn(servers: IceServer[]): boolean {
  return servers.some((s) =>
    normalizeUrls(s.urls).some((u) => /^turns?:/i.test(u)),
  );
}

export async function createCall(
  client: SupabaseClient,
  conversationId: UUID,
  callerId: UUID,
  type: CallType,
): Promise<{ call: Call | null; error: Error | null }> {
  const { data, error } = await client
    .from('calls')
    .insert({ conversation_id: conversationId, caller_id: callerId, type, status: 'ringing' })
    .select()
    .single();
  return { call: data, error };
}

export async function updateCallStatus(
  client: SupabaseClient,
  callId: UUID,
  status: CallStatus,
): Promise<{ error: Error | null }> {
  const patch: Partial<Call> = { status };
  if (status === 'accepted') patch.answered_at = new Date().toISOString();
  if (status === 'ended' || status === 'declined' || status === 'missed') {
    patch.ended_at = new Date().toISOString();
  }
  const { error } = await client.from('calls').update(patch).eq('id', callId);
  return { error };
}

export async function getCallHistory(client: SupabaseClient, limit = 100): Promise<Call[]> {
  const { data } = await client
    .from('calls')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

/**
 * Subscribe to NEW incoming calls for the current user. Fires for every inserted
 * `calls` row the user can see (RLS already limits this to their conversations);
 * the callback should ignore calls where caller_id === me.
 */
export function subscribeToIncomingCalls(
  client: SupabaseClient,
  onCall: (call: Call) => void,
): RealtimeChannel {
  return client
    .channel('calls:incoming')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'calls' },
      (payload) => onCall(payload.new as Call),
    )
    .subscribe();
}

/** Subscribe to status changes (accepted/declined/ended) for a specific call. */
export function subscribeToCallStatus(
  client: SupabaseClient,
  callId: UUID,
  onChange: (call: Call) => void,
): RealtimeChannel {
  return client
    .channel(`calls:status:${callId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}` },
      (payload) => onChange(payload.new as Call),
    )
    .subscribe();
}

// ── WebRTC signaling over a broadcast channel ────────────────────────────────

// 'ready' is the handshake heartbeat: the callee broadcasts it once its signaling
// subscription is truly live, so the caller knows a peer is actually listening
// before it sends the SDP offer. Supabase broadcast does NOT replay messages to
// late subscribers, so without this the offer (sent on a blind timer) was lost
// whenever the callee hadn't subscribed yet — which, for a human-accepted ring,
// is always. See createSignalingChannel's onReady hook.
export type SignalKind = 'ready' | 'offer' | 'answer' | 'candidate' | 'bye';
export interface SignalMessage {
  kind: SignalKind;
  from: UUID;
  /** SDP for offer/answer; ICE candidate JSON for 'candidate'. */
  data?: unknown;
}

export interface SignalingChannel {
  channel: RealtimeChannel;
  send: (msg: SignalMessage) => void;
  close: () => void;
}

/**
 * Open the signaling channel for a call. Both peers join `call:<id>` and
 * broadcast offer/answer/candidate/bye messages to each other.
 *
 * `onReady` fires once THIS peer's subscription is actually live ('SUBSCRIBED').
 * Only after that is it safe to broadcast — anything sent before then is dropped
 * by the realtime server. The callee uses this to start its `ready` heartbeat.
 */
export function createSignalingChannel(
  client: SupabaseClient,
  callId: UUID,
  selfId: UUID,
  onSignal: (msg: SignalMessage) => void,
  onReady?: () => void,
): SignalingChannel {
  const channel = client.channel(`call:${callId}`, {
    config: { broadcast: { self: false } },
  });
  channel
    .on('broadcast', { event: 'signal' }, ({ payload }) => {
      const msg = payload as SignalMessage;
      if (msg.from !== selfId) onSignal(msg);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onReady?.();
    });

  return {
    channel,
    send: (msg: SignalMessage) =>
      channel.send({ type: 'broadcast', event: 'signal', payload: { ...msg, from: selfId } }),
    close: () => {
      client.removeChannel(channel);
    },
  };
}
