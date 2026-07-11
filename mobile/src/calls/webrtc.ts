// Lumixo mobile — production WebRTC call engine (WhatsApp-class reliability).
//
// Fixes for white/blank remote video, ICE recovery, TURN, AEC/NS/AGC, and
// front-camera mirror semantics (local mirrored, remote not mirrored — mirror
// is applied in RTCView, not by flipping the encoded track).
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
  type MediaStreamTrack,
} from 'react-native-webrtc';

type MediaStreamT = MediaStream;
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

// Silence verbose call logs in production (battery + privacy).
const clog = (...args: unknown[]) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('[call]', ...args);
};

const CONNECT_TIMEOUT_MS = 45000;
const ICE_RESTART_GRACE_MS = 4000;
const DISCONNECT_TEARDOWN_MS = 16000;
/** Max ICE restart attempts on flaky mobile networks (was 2 — too low for handoff). */
const MAX_ICE_RESTARTS = 3;

const ICE_SERVERS = buildIceServers(
  process.env.EXPO_PUBLIC_TURN_URL
    ? {
        urls: process.env.EXPO_PUBLIC_TURN_URL,
        username: process.env.EXPO_PUBLIC_TURN_USERNAME,
        credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL,
      }
    : null,
);
const HAS_TURN = hasTurn(ICE_SERVERS);

export interface CallCallbacks {
  onLocalStream: (stream: MediaStreamT) => void;
  onRemoteStream: (stream: MediaStreamT | null) => void;
  onConnected: () => void;
  onEnded: () => void;
  onFacingChange?: (facing: 'user' | 'environment') => void;
}

export class CallSession {
  private pc: RTCPeerConnection | null = null;
  private signaling: SignalingChannel | null = null;
  private localStream: MediaStreamT | null = null;
  /** Aggregated remote stream — tracks are added as ontrack fires (audio then video). */
  private remoteStream: MediaStreamT | null = null;
  private pendingCandidates: RTCIceCandidate[] = [];
  private remoteDescSet = false;
  private ended = false;
  private cachedOffer: unknown = null;
  private cachedAnswer: unknown = null;
  private answered = false;
  private offerHandled = false;
  private readyTimer: ReturnType<typeof setInterval> | null = null;
  private readyTicks = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectedOnce = false;
  private iceRestartAttempts = 0;
  private facing: 'user' | 'environment' = 'user';

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
    // Video calls default to speaker; audio calls default to earpiece.
    this.speakerOn = type === 'video';
  }

  async start() {
    clog(this.isCaller ? 'CALLER' : 'CALLEE', 'start()', this.type, 'call', this.callId);

    // 1) Local media — use ideal constraints (not rigid) so mid/low-end devices
    //    still open a camera; HD when the device can deliver it.
    this.localStream = (await mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      } as any,
      video:
        this.type === 'video'
          ? ({
              facingMode: 'user',
              // Ideal HD; min allows weak devices to still connect.
              width: { min: 320, ideal: 1280, max: 1920 },
              height: { min: 240, ideal: 720, max: 1080 },
              frameRate: { min: 15, ideal: 30, max: 30 },
            } as any)
          : false,
    })) as unknown as MediaStreamT;

    // Ensure audio tracks start enabled (some OEMs start muted).
    this.localStream.getAudioTracks().forEach((t) => {
      t.enabled = true;
    });
    this.localStream.getVideoTracks().forEach((t) => {
      t.enabled = this.videoEnabled;
    });

    this.cb.onLocalStream(this.localStream);
    this.cb.onFacingChange?.(this.facing);

    // 2) Audio session: ringback for caller, media mode for both.
    InCallManager.start({
      media: this.type === 'video' ? 'video' : 'audio',
      auto: true,
      ringback: this.isCaller ? '_DEFAULT_' : undefined,
    } as any);
    InCallManager.setForceSpeakerphoneOn(this.speakerOn);
    // Keep screen awake during video; proximity sensor for earpiece audio calls.
    try {
      if (this.type === 'video') (InCallManager as any).setKeepScreenOn?.(true);
    } catch { /* optional API */ }

    if (!HAS_TURN) {
      clog(
        '⚠️ NO TURN relay (EXPO_PUBLIC_TURN_* unset) — STUN only.',
        'Cross-network calls will often fail. Configure TURN for production.',
      );
    }

    // 3) Peer connection
    this.pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      // Prefer continual gathering so mid-call network changes get new candidates.
      iceTransportPolicy: 'all',
    } as any);

    this.localStream.getTracks().forEach((t) => {
      this.pc!.addTrack(t, this.localStream!);
    });

    // Prefer H264 on Android when available (hardware encode); ignore failures.
    try {
      await this.preferCodecs();
    } catch { /* optional */ }

    (this.pc as any).ontrack = (e: any) => this.handleRemoteTrack(e);

    (this.pc as any).onicecandidate = (e: any) => {
      if (e.candidate) {
        const c: string = e.candidate.candidate || '';
        const typ = /typ (\w+)/.exec(c)?.[1] ?? '?';
        clog('local ICE', typ);
        this.signaling?.send({ kind: 'candidate', from: this.selfId, data: e.candidate });
      } else {
        clog('ICE gathering complete');
      }
    };

    (this.pc as any).onicegatheringstatechange = () => {
      clog('iceGatheringState:', (this.pc as any)?.iceGatheringState);
    };

    const markConnected = () => {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.iceRestartTimer) {
        clearTimeout(this.iceRestartTimer);
        this.iceRestartTimer = null;
      }
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.iceRestartAttempts = 0;
      if (!this.connectedOnce) {
        this.connectedOnce = true;
        clog('✅ CONNECTED');
        try {
          InCallManager.stopRingback?.();
        } catch { /* noop */ }
      }
      this.cb.onConnected();
    };

    (this.pc as any).onconnectionstatechange = () => {
      const st = (this.pc as any)?.connectionState;
      clog('connectionState:', st);
      if (st === 'connected') markConnected();
      else if (st === 'disconnected') this.onTransportBlip();
      else if (st === 'failed' || st === 'closed') {
        if (st === 'failed') this.tryIceRestart('connectionState=failed');
        else this.end(false);
      }
    };

    (this.pc as any).oniceconnectionstatechange = () => {
      const st = (this.pc as any)?.iceConnectionState;
      clog('iceConnectionState:', st);
      if (st === 'connected' || st === 'completed') markConnected();
      else if (st === 'disconnected') this.onTransportBlip();
      else if (st === 'failed') this.tryIceRestart('iceConnectionState=failed');
    };

    // 4) Signaling
    this.signaling = createSignalingChannel(
      supabase,
      this.callId,
      this.selfId,
      (msg) => this.onSignal(msg),
      () => this.onChannelReady(),
    );

    // 5) Connect watchdog
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.connectedOnce || this.ended) return;
      clog(
        '⏱️ connect watchdog expired',
        'conn=',
        (this.pc as any)?.connectionState,
        'ice=',
        (this.pc as any)?.iceConnectionState,
      );
      this.end(false);
    }, CONNECT_TIMEOUT_MS);
  }

  /**
   * Root white-screen fix: aggregate every remote track into ONE MediaStream and
   * re-emit it whenever a track is added or unmutes. RTCView must re-bind when
   * the first video frame becomes available (audio-only stream → white SurfaceView).
   */
  private handleRemoteTrack(e: any) {
    const track: MediaStreamTrack | undefined = e?.track;
    if (!track) return;
    clog('ontrack', track.kind, 'muted=', (track as any).muted, 'readyState=', track.readyState);

    if (!this.remoteStream) {
      // Prefer the stream the browser already grouped, else create our own.
      const fromEvent: MediaStreamT | undefined = e.streams?.[0];
      this.remoteStream = fromEvent
        ? (fromEvent as MediaStreamT)
        : (new MediaStream() as unknown as MediaStreamT);
    }

    const already = this.remoteStream.getTracks().some((t) => t.id === track.id);
    if (!already) {
      try {
        this.remoteStream.addTrack(track);
      } catch {
        // If the event stream already owns the track, ignore.
      }
    }

    // Re-emit so UI rebinds RTCView (critical when video track arrives after audio).
    this.emitRemote();

    // When a muted/black track later produces frames, re-emit again.
    const reemit = () => {
      clog('remote track unmute/live', track.kind);
      this.emitRemote();
    };
    try {
      (track as any).onunmute = reemit;
      (track as any).onmute = () => clog('remote track mute', track.kind);
      (track as any).onended = () => {
        clog('remote track ended', track.kind);
        try {
          this.remoteStream?.removeTrack(track);
        } catch { /* noop */ }
        this.emitRemote();
      };
    } catch { /* event props optional */ }
  }

  private emitRemote() {
    if (!this.remoteStream) {
      this.cb.onRemoteStream(null);
      return;
    }
    // Clone-like signal: pass same stream reference but force React to see a
    // change by always calling the callback (ActiveCallView keys on track ids).
    this.cb.onRemoteStream(this.remoteStream);
  }

  private onTransportBlip() {
    if (this.ended) return;
    // First: attempt ICE restart after a short grace (network handoff recovery).
    if (!this.iceRestartTimer) {
      this.iceRestartTimer = setTimeout(() => {
        this.iceRestartTimer = null;
        const ice = (this.pc as any)?.iceConnectionState;
        const cs = (this.pc as any)?.connectionState;
        if (
          ice !== 'connected' &&
          ice !== 'completed' &&
          cs !== 'connected'
        ) {
          this.tryIceRestart('disconnect-grace');
        }
      }, ICE_RESTART_GRACE_MS);
    }
    this.scheduleReconnectTeardown();
  }

  private async tryIceRestart(reason: string) {
    if (this.ended || !this.pc) return;
    if (this.iceRestartAttempts >= MAX_ICE_RESTARTS) {
      clog('❌ ICE restart exhausted (', reason, ') → ending');
      this.end(false);
      return;
    }
    this.iceRestartAttempts += 1;
    clog('🔄 ICE restart #', this.iceRestartAttempts, reason);
    try {
      // Only the original offerer (caller) should create a restart offer, unless
      // we already have a local offer state from a previous restart.
      if (this.isCaller || (this.pc as any).signalingState === 'stable') {
        this.cachedOffer = null;
        this.answered = false;
        const offer = await this.pc.createOffer({ iceRestart: true } as any);
        await this.pc.setLocalDescription(offer);
        this.cachedOffer = offer;
        this.signaling?.send({ kind: 'offer', from: this.selfId, data: offer });
      }
    } catch (e: any) {
      clog('ICE restart failed', e?.message ?? e);
      this.end(false);
    }
  }

  private scheduleReconnectTeardown() {
    if (this.reconnectTimer || this.ended) return;
    clog('disconnected — teardown in', DISCONNECT_TEARDOWN_MS, 'ms if not recovered');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const cs = (this.pc as any)?.connectionState;
      const ice = (this.pc as any)?.iceConnectionState;
      if (cs !== 'connected' && ice !== 'connected' && ice !== 'completed') {
        clog('reconnect grace expired — ending');
        this.end(false);
      }
    }, DISCONNECT_TEARDOWN_MS);
  }

  private async preferCodecs() {
    // Best-effort: prefer H264 for video on Android HW path when available.
    const pc = this.pc as any;
    if (!pc?.getTransceivers) return;
    for (const t of pc.getTransceivers()) {
      if (t.sender?.track?.kind !== 'video') continue;
      const caps = (RTCRtpSender as any)?.getCapabilities?.('video');
      if (!caps?.codecs?.length || !t.setCodecPreferences) continue;
      const preferred = [
        ...caps.codecs.filter((c: any) => /h264/i.test(c.mimeType)),
        ...caps.codecs.filter((c: any) => /vp8/i.test(c.mimeType)),
        ...caps.codecs.filter((c: any) => !/h264|vp8/i.test(c.mimeType)),
      ];
      try {
        t.setCodecPreferences(preferred);
      } catch { /* ignore */ }
    }
  }

  private onChannelReady() {
    clog(this.isCaller ? 'CALLER' : 'CALLEE', 'signaling LIVE');
    if (this.ended) return;
    if (!this.isCaller) this.startReadyHeartbeat();
  }

  private startReadyHeartbeat() {
    if (this.readyTimer) return;
    const ping = () => {
      if (this.ended || this.offerHandled || this.readyTicks > 16) {
        this.stopReadyHeartbeat();
        return;
      }
      this.readyTicks += 1;
      this.signaling?.send({ kind: 'ready', from: this.selfId });
    };
    ping();
    this.readyTimer = setInterval(ping, 600);
  }

  private stopReadyHeartbeat() {
    if (this.readyTimer) {
      clearInterval(this.readyTimer);
      this.readyTimer = null;
    }
  }

  private async makeOffer(iceRestart = false) {
    if (!this.pc || (this.answered && !iceRestart)) return;
    if (!this.cachedOffer || iceRestart) {
      const offer = await this.pc.createOffer(iceRestart ? ({ iceRestart: true } as any) : {});
      await this.pc.setLocalDescription(offer);
      this.cachedOffer = offer;
    }
    clog('CALLER → offer', iceRestart ? '(ICE restart)' : '');
    this.signaling?.send({ kind: 'offer', from: this.selfId, data: this.cachedOffer });
  }

  private async onSignal(msg: SignalMessage) {
    if (!this.pc || this.ended) return;
    clog('signal IN:', msg.kind);
    try {
      if (msg.kind === 'ready') {
        if (this.isCaller) await this.makeOffer();
      } else if (msg.kind === 'offer') {
        // Handle ICE-restart offers after the first answer by re-answering.
        const isRestart =
          this.offerHandled && (this.pc as any).signalingState === 'stable';
        if (this.offerHandled && !isRestart) {
          if (this.cachedAnswer) {
            this.signaling?.send({
              kind: 'answer',
              from: this.selfId,
              data: this.cachedAnswer,
            });
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
        if (
          this.answered &&
          (this.pc as any).signalingState !== 'have-local-offer'
        ) {
          return;
        }
        if ((this.pc as any).signalingState === 'have-local-offer') {
          this.answered = true;
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data as any));
          this.remoteDescSet = true;
          await this.flushCandidates();
        }
      } else if (msg.kind === 'candidate') {
        const cand = new RTCIceCandidate(msg.data as any);
        if (this.remoteDescSet) await this.pc.addIceCandidate(cand);
        else this.pendingCandidates.push(cand);
      } else if (msg.kind === 'bye') {
        this.end(false);
      }
    } catch (e: any) {
      clog('onSignal error', msg.kind, e?.message ?? e);
    }
  }

  private async flushCandidates() {
    for (const c of this.pendingCandidates) {
      try {
        await this.pc?.addIceCandidate(c);
      } catch { /* noop */ }
    }
    this.pendingCandidates = [];
  }

  toggleMute() {
    this.muted = !this.muted;
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !this.muted;
    });
    return this.muted;
  }

  toggleVideo() {
    this.videoEnabled = !this.videoEnabled;
    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = this.videoEnabled;
    });
    return this.videoEnabled;
  }

  toggleSpeaker() {
    this.speakerOn = !this.speakerOn;
    InCallManager.setForceSpeakerphoneOn(this.speakerOn);
    return this.speakerOn;
  }

  /**
   * Switch front/back camera. Uses replaceTrack when possible so the remote
   * peer keeps a continuous video mid stream (smoother than _switchCamera alone).
   * Facing state is tracked so local RTCView mirror can be toggled (front only).
   */
  async switchCamera(): Promise<'user' | 'environment'> {
    const next: 'user' | 'environment' =
      this.facing === 'user' ? 'environment' : 'user';
    try {
      const oldTrack = this.localStream?.getVideoTracks()?.[0] as any;
      if (!oldTrack) return this.facing;

      // Prefer getUserMedia + replaceTrack for correct orientation on both sides.
      const fresh = (await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { exact: next },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        } as any,
      })) as unknown as MediaStreamT;
      const newTrack = fresh.getVideoTracks()[0] as any;
      if (!newTrack) {
        fresh.getTracks().forEach((t) => t.stop());
        // Fallback: in-place switch.
        oldTrack._switchCamera?.();
        this.facing = next;
        this.cb.onFacingChange?.(this.facing);
        return this.facing;
      }

      newTrack.enabled = this.videoEnabled;
      const sender = (this.pc as any)
        ?.getSenders?.()
        ?.find((s: any) => s.track && s.track.kind === 'video');
      if (sender?.replaceTrack) {
        await sender.replaceTrack(newTrack);
      } else {
        oldTrack._switchCamera?.();
        fresh.getTracks().forEach((t) => t.stop());
        this.facing = next;
        this.cb.onFacingChange?.(this.facing);
        return this.facing;
      }

      // Swap in local stream for preview.
      try {
        this.localStream?.removeTrack(oldTrack);
      } catch { /* noop */ }
      try {
        this.localStream?.addTrack(newTrack);
      } catch { /* noop */ }
      oldTrack.stop();
      // Stop leftover audio from the fresh gUM (we only wanted video).
      fresh.getAudioTracks().forEach((t) => t.stop());

      this.facing = next;
      this.cb.onLocalStream(this.localStream!);
      this.cb.onFacingChange?.(this.facing);
      return this.facing;
    } catch (e: any) {
      clog('switchCamera failed, fallback _switchCamera', e?.message ?? e);
      try {
        this.localStream?.getVideoTracks().forEach((t: any) => t._switchCamera?.());
        this.facing = next;
        this.cb.onFacingChange?.(this.facing);
      } catch { /* noop */ }
      return this.facing;
    }
  }

  getFacing(): 'user' | 'environment' {
    return this.facing;
  }

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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.iceRestartTimer) {
      clearTimeout(this.iceRestartTimer);
      this.iceRestartTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (sendBye) this.signaling?.send({ kind: 'bye', from: this.selfId });
    try {
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.remoteStream?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch { /* noop */ }
      });
      this.pc?.close();
    } catch { /* noop */ }
    try {
      InCallManager.stopRingback?.();
    } catch { /* noop */ }
    InCallManager.stop();
    try {
      (InCallManager as any).setKeepScreenOn?.(false);
    } catch { /* noop */ }
    this.signaling?.close();
    this.cb.onEnded();
  }
}
