// build-stamp: 2026-07-03T0840 — bump to invalidate Metro's per-file transform
// cache so EXPO_PUBLIC_TURN_* is re-inlined (cache key is source-hash, not env).
// Lumixo mobile — WebRTC call engine. Wraps a single RTCPeerConnection and
// drives the SDP/ICE handshake over the shared Supabase signaling channel.
// Audio uses echo-cancellation + noise-suppression constraints; InCallManager
// handles speaker routing, ringtone and the proximity sensor.
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  type MediaStream,
} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

import { supabase } from '../lib/supabase';
import {
  createSignalingChannel,
  buildIceServers,
  hasTurn,
  type SignalingChannel,
  type SignalMessage,
  type CallType,
  type UUID,
} from '../lib/shared';

// Structured call logging. Every step of the signaling + ICE handshake is logged
// so the EXACT failing step is visible in `adb logcat` (filter on "[call]"). This
// is what turns "stuck on Connecting…" from a black box into an observable
// pipeline: you can see whether the offer/answer crossed, which ICE candidate
// types were gathered (host/srflx/relay ⇒ is TURN working?), and where it stalls.
const clog = (...args: unknown[]) => console.log('[call]', ...args);

// Hard upper bound on reaching 'connected' the first time. ~45s matches a typical
// ring-then-fail window; past this a call that hasn't connected never will.
const CONNECT_TIMEOUT_MS = 45000;

// Production TURN from app env (EXPO_PUBLIC_TURN_*). EXPO_PUBLIC_TURN_URL may be a
// comma-separated list of transport URLs (udp/tcp/tls) under one credential. When
// unset there is NO TURN relay — only STUN — so cross-network calls will fail;
// buildIceServers() no longer bakes in a (dead) default relay.
const ICE_SERVERS = buildIceServers(
  process.env.EXPO_PUBLIC_TURN_URL
    ? {
        urls: process.env.EXPO_PUBLIC_TURN_URL,
        username: process.env.EXPO_PUBLIC_TURN_USERNAME,
        credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL,
      }
    : null,
);
// Whether a relay is actually configured. Logged at call start and used to warn
// so a missing TURN shows up as a clear diagnostic rather than a silent hang.
const HAS_TURN = hasTurn(ICE_SERVERS);

export interface CallCallbacks {
  onLocalStream: (stream: MediaStream) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onConnected: () => void;
  onEnded: () => void;
}

export class CallSession {
  private pc: RTCPeerConnection | null = null;
  private signaling: SignalingChannel | null = null;
  private localStream: MediaStream | null = null;
  private pendingCandidates: RTCIceCandidate[] = [];
  private remoteDescSet = false;
  private ended = false;
  // Handshake state. The caller caches its offer and re-sends it on every `ready`
  // heartbeat until it receives an answer; the callee caches its answer and
  // re-sends it if a duplicate offer arrives (covers a lost answer). The callee
  // pings `ready` until it sees the offer. This makes the SDP exchange resilient
  // to the broadcast channel dropping messages sent before a peer subscribed.
  private cachedOffer: unknown = null;
  private cachedAnswer: unknown = null;
  private answered = false;
  private offerHandled = false;
  private readyTimer: ReturnType<typeof setInterval> | null = null;
  private readyTicks = 0;
  // Reconnect grace: a transient 'disconnected' (network blip, handoff) usually
  // recovers to 'connected' on its own — don't tear the call down instantly.
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Connect watchdog: a hard upper bound on the *initial* connect. If we never
  // reach 'connected' (a wedged handshake where the offer/answer is lost, or an
  // ICE that stalls in 'checking' without ever transitioning to 'failed' — a
  // known RN-WebRTC Android quirk), NOTHING else would ever fire, leaving the UI
  // pinned on "Connecting…" forever. This timer guarantees the call instead ENDS
  // (view unmounts) so the stuck state is impossible. Cleared on first connect.
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  // Guard so we only log the first successful connect (onConnected itself is
  // idempotent on the UI side).
  private connectedOnce = false;

  muted = false;
  videoEnabled: boolean;
  speakerOn: boolean;

  constructor(
    private callId: UUID,
    private selfId: UUID,
    private isCaller: boolean,
    private type: CallType,
    private cb: CallCallbacks,
  ) {
    this.videoEnabled = type === 'video';
    this.speakerOn = type === 'video';
  }

  async start() {
    clog(this.isCaller ? 'CALLER' : 'CALLEE', 'start()', this.type, 'call', this.callId);
    // 1) Local media with quality constraints.
    this.localStream = (await mediaDevices.getUserMedia({
      // echo-cancellation / noise-suppression aren't in the RN-WebRTC TS types
      // but are honoured by the native layer.
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      } as any,
      video:
        this.type === 'video'
          ? { facingMode: 'user', frameRate: 30, width: 1280, height: 720 }
          : false,
    })) as unknown as MediaStream;
    this.cb.onLocalStream(this.localStream);

    // 2) Audio routing + ringback.
    InCallManager.start({ media: this.type === 'video' ? 'video' : 'audio' });
    InCallManager.setForceSpeakerphoneOn(this.speakerOn);

    // 3) Peer connection. iceCandidatePoolSize pre-gathers candidates so the
    //    handshake has them ready the moment the remote description lands (faster
    //    connect). bundlePolicy 'max-bundle' + rtcpMuxPolicy 'require' keep audio
    //    and video on a single transport, which minimizes the number of candidate
    //    pairs TURN has to relay.
    if (!HAS_TURN) {
      clog(
        '⚠️ NO TURN relay configured (EXPO_PUBLIC_TURN_* unset) — STUN only.',
        'Calls will connect on the same/permissive network but FAIL across',
        'different networks/NATs. Provision TURN for production.',
      );
    }
    this.pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    } as any);
    this.localStream.getTracks().forEach((t) => this.pc!.addTrack(t, this.localStream!));

    (this.pc as any).ontrack = (e: any) => {
      clog('ontrack', e.track?.kind, 'streams:', e.streams?.length ?? 0);
      if (e.streams && e.streams[0]) this.cb.onRemoteStream(e.streams[0]);
    };
    (this.pc as any).onicecandidate = (e: any) => {
      if (e.candidate) {
        // Candidate "typ" tells us host/srflx/relay — if we NEVER see a relay
        // candidate, TURN isn't working (the usual cause of cross-network fails).
        const c: string = e.candidate.candidate || '';
        const typ = /typ (\w+)/.exec(c)?.[1] ?? '?';
        clog('local ICE candidate', typ);
        this.signaling?.send({ kind: 'candidate', from: this.selfId, data: e.candidate });
      } else {
        clog('local ICE gathering complete');
      }
    };
    (this.pc as any).onicegatheringstatechange = () => {
      clog('iceGatheringState:', (this.pc as any)?.iceGatheringState);
    };
    // Fire "connected" on EITHER the aggregated connectionState OR the ICE
    // connection state. react-native-webrtc's aggregated `connectionState` is
    // unreliable on some Android builds (it can stay 'connecting' even after media
    // flows) — `iceConnectionState` reaching connected/completed is the dependable
    // signal. Listening to both is what actually clears the stuck "Connecting…".
    const markConnected = () => {
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
      if (!this.connectedOnce) { this.connectedOnce = true; clog('✅ CONNECTED'); }
      this.cb.onConnected();
    };
    (this.pc as any).onconnectionstatechange = () => {
      const st = (this.pc as any)?.connectionState;
      clog('connectionState:', st);
      if (st === 'connected') {
        markConnected();
      } else if (st === 'disconnected') {
        this.scheduleReconnectTeardown();
      } else if (st === 'failed' || st === 'closed') {
        clog('connectionState terminal:', st, '→ ending');
        this.end(false);
      }
    };
    (this.pc as any).oniceconnectionstatechange = () => {
      const st = (this.pc as any)?.iceConnectionState;
      clog('iceConnectionState:', st);
      if (st === 'connected' || st === 'completed') {
        markConnected();
      } else if (st === 'disconnected') {
        this.scheduleReconnectTeardown();
      } else if (st === 'failed') {
        // ICE failed: no working candidate pair (commonly dead/blocked TURN on a
        // symmetric NAT). Surface it instead of hanging on "Connecting…".
        clog('❌ iceConnectionState failed — no reachable candidate pair (check TURN)');
        this.end(false);
      }
    };

    // 4) Signaling. onChannelReady fires once OUR subscription is live, so we
    //    never broadcast into the void.
    this.signaling = createSignalingChannel(
      supabase,
      this.callId,
      this.selfId,
      (msg) => this.onSignal(msg),
      () => this.onChannelReady(),
    );
    // The caller's offer is now driven by the callee's `ready` heartbeat (see
    // onSignal), not a blind timer — that timer was the root cause of calls
    // never connecting (offer sent before the callee had subscribed).

    // 5) Connect watchdog — the failsafe that makes a permanently-stuck
    //    "Connecting…" impossible: if we haven't connected by the deadline, end.
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.connectedOnce || this.ended) return;
      clog(
        '⏱️ connect watchdog expired — never reached connected. states:',
        'conn=', (this.pc as any)?.connectionState,
        'ice=', (this.pc as any)?.iceConnectionState,
        'sig=', (this.pc as any)?.signalingState,
        '→ ending (no stuck Connecting…)',
      );
      this.end(false);
    }, CONNECT_TIMEOUT_MS);
  }

  // A transient 'disconnected' on either state machine: give ICE ~12s to recover
  // (network blip / wifi↔cellular handoff) before tearing the call down. Only
  // ends if BOTH state machines are still not connected when the grace expires.
  private scheduleReconnectTeardown() {
    if (this.reconnectTimer || this.ended) return;
    clog('disconnected — 12s grace before teardown');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const cs = (this.pc as any)?.connectionState;
      const ice = (this.pc as any)?.iceConnectionState;
      if (cs !== 'connected' && ice !== 'connected' && ice !== 'completed') {
        clog('reconnect grace expired — ending');
        this.end(false);
      }
    }, 12000);
  }

  // Called when our own signaling subscription goes live.
  private onChannelReady() {
    clog(this.isCaller ? 'CALLER' : 'CALLEE', 'signaling channel LIVE');
    if (this.ended) return;
    // The callee announces itself and keeps announcing until the offer lands, so
    // a `ready` lost before the caller subscribed doesn't wedge the call.
    if (!this.isCaller) this.startReadyHeartbeat();
  }

  private startReadyHeartbeat() {
    if (this.readyTimer) return;
    const ping = () => {
      if (this.ended || this.offerHandled || this.readyTicks > 12) {
        this.stopReadyHeartbeat();
        return;
      }
      this.readyTicks += 1;
      this.signaling?.send({ kind: 'ready', from: this.selfId });
    };
    ping();
    this.readyTimer = setInterval(ping, 700);
  }

  private stopReadyHeartbeat() {
    if (this.readyTimer) {
      clearInterval(this.readyTimer);
      this.readyTimer = null;
    }
  }

  // Caller: build the offer once, cache it, and (re)broadcast it. Re-sending the
  // SAME cached SDP on each `ready` is safe and covers a dropped first offer.
  private async makeOffer() {
    if (!this.pc || this.answered) return;
    if (!this.cachedOffer) {
      const offer = await this.pc.createOffer({});
      await this.pc.setLocalDescription(offer);
      this.cachedOffer = offer;
    }
    clog('CALLER → offer');
    this.signaling?.send({ kind: 'offer', from: this.selfId, data: this.cachedOffer });
  }

  private async onSignal(msg: SignalMessage) {
    if (!this.pc || this.ended) return;
    clog('signal IN:', msg.kind);
    try {
      if (msg.kind === 'ready') {
        // A peer is listening — send (or re-send) our offer.
        if (this.isCaller) await this.makeOffer();
      } else if (msg.kind === 'offer') {
        // Callee. Ignore duplicate offers once we've answered, but DO re-send our
        // cached answer in case the first answer was lost.
        if (this.offerHandled) {
          if (this.cachedAnswer) {
            this.signaling?.send({ kind: 'answer', from: this.selfId, data: this.cachedAnswer });
          }
          return;
        }
        this.offerHandled = true;
        this.stopReadyHeartbeat();
        await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data as any));
        this.remoteDescSet = true;
        await this.flushCandidates();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.cachedAnswer = answer;
        clog('CALLEE → answer');
        this.signaling?.send({ kind: 'answer', from: this.selfId, data: answer });
      } else if (msg.kind === 'answer') {
        // Caller. Only accept the first answer (state must be have-local-offer).
        if (this.answered || (this.pc as any).signalingState !== 'have-local-offer') return;
        this.answered = true;
        await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data as any));
        this.remoteDescSet = true;
        await this.flushCandidates();
      } else if (msg.kind === 'candidate') {
        const cand = new RTCIceCandidate(msg.data as any);
        if (this.remoteDescSet) await this.pc.addIceCandidate(cand);
        else this.pendingCandidates.push(cand);
      } else if (msg.kind === 'bye') {
        this.end(false);
      }
    } catch {
      // ignore malformed signals
    }
  }

  private async flushCandidates() {
    for (const c of this.pendingCandidates) {
      try {
        await this.pc?.addIceCandidate(c);
      } catch {
        /* noop */
      }
    }
    this.pendingCandidates = [];
  }

  toggleMute() {
    this.muted = !this.muted;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
    return this.muted;
  }

  toggleVideo() {
    this.videoEnabled = !this.videoEnabled;
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = this.videoEnabled));
    return this.videoEnabled;
  }

  toggleSpeaker() {
    this.speakerOn = !this.speakerOn;
    InCallManager.setForceSpeakerphoneOn(this.speakerOn);
    return this.speakerOn;
  }

  switchCamera() {
    this.localStream?.getVideoTracks().forEach((t: any) => t._switchCamera?.());
  }

  // Read-only stats sample for the network-quality indicator. Never touches the
  // peer connection — just reads the latest RTCStatsReport (Map-like: forEach).
  async getStats(): Promise<any | null> {
    try {
      return this.pc ? await (this.pc as any).getStats() : null;
    } catch {
      return null;
    }
  }

  end(sendBye = true) {
    if (this.ended) return;
    this.ended = true;
    this.stopReadyHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
    if (sendBye) this.signaling?.send({ kind: 'bye', from: this.selfId });
    try {
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.pc?.close();
    } catch {
      /* noop */
    }
    InCallManager.stop();
    this.signaling?.close();
    this.cb.onEnded();
  }
}
