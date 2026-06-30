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
 * Default ICE servers: public STUN + a free shared TURN (OpenRelay).
 *
 * TURN is REQUIRED for calls between peers on different networks/NATs — STUN
 * alone only works when both peers can reach each other directly (same LAN or
 * permissive NAT), which is why cross-network mobile calls failed before. The
 * OpenRelay credentials below are a free, best-effort fallback so calls work
 * out of the box; for production reliability set your OWN TURN via env
 * (VITE_TURN_URL/USERNAME/CREDENTIAL on web, EXPO_PUBLIC_TURN_* on mobile) and
 * pass it through buildIceServers().
 */
export const DEFAULT_ICE_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

/**
 * Build the ICE server list, putting an app-configured TURN (from env) ahead of
 * the free defaults. Pass `{ urls, username, credential }` read from each
 * platform's env; falsy/empty urls are ignored.
 */
export function buildIceServers(custom?: IceServer | null): IceServer[] {
  if (custom && custom.urls && (Array.isArray(custom.urls) ? custom.urls.length : true)) {
    return [custom, ...DEFAULT_ICE_SERVERS];
  }
  return DEFAULT_ICE_SERVERS;
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

export type SignalKind = 'offer' | 'answer' | 'candidate' | 'bye';
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
 */
export function createSignalingChannel(
  client: SupabaseClient,
  callId: UUID,
  selfId: UUID,
  onSignal: (msg: SignalMessage) => void,
): SignalingChannel {
  const channel = client.channel(`call:${callId}`, {
    config: { broadcast: { self: false } },
  });
  channel
    .on('broadcast', { event: 'signal' }, ({ payload }) => {
      const msg = payload as SignalMessage;
      if (msg.from !== selfId) onSignal(msg);
    })
    .subscribe();

  return {
    channel,
    send: (msg: SignalMessage) =>
      channel.send({ type: 'broadcast', event: 'signal', payload: { ...msg, from: selfId } }),
    close: () => {
      client.removeChannel(channel);
    },
  };
}
