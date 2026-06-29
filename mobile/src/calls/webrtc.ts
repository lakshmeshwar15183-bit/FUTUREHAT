// FUTUREHAT mobile — WebRTC call engine. Wraps a single RTCPeerConnection and
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
  DEFAULT_ICE_SERVERS,
  type SignalingChannel,
  type SignalMessage,
  type CallType,
  type UUID,
} from '../lib/shared';

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

    // 3) Peer connection.
    this.pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
    this.localStream.getTracks().forEach((t) => this.pc!.addTrack(t, this.localStream!));

    (this.pc as any).ontrack = (e: any) => {
      if (e.streams && e.streams[0]) this.cb.onRemoteStream(e.streams[0]);
    };
    (this.pc as any).onicecandidate = (e: any) => {
      if (e.candidate) {
        this.signaling?.send({ kind: 'candidate', from: this.selfId, data: e.candidate });
      }
    };
    (this.pc as any).onconnectionstatechange = () => {
      const st = (this.pc as any)?.connectionState;
      if (st === 'connected') this.cb.onConnected();
      if (st === 'failed' || st === 'closed' || st === 'disconnected') this.end(false);
    };

    // 4) Signaling.
    this.signaling = createSignalingChannel(supabase, this.callId, this.selfId, (msg) =>
      this.onSignal(msg),
    );

    // 5) Caller kicks off the offer. Callee waits for it.
    if (this.isCaller) {
      // small delay so the callee has time to subscribe to the channel
      setTimeout(() => this.makeOffer(), 800);
    }
  }

  private async makeOffer() {
    if (!this.pc) return;
    const offer = await this.pc.createOffer({});
    await this.pc.setLocalDescription(offer);
    this.signaling?.send({ kind: 'offer', from: this.selfId, data: offer });
  }

  private async onSignal(msg: SignalMessage) {
    if (!this.pc) return;
    try {
      if (msg.kind === 'offer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data as any));
        this.remoteDescSet = true;
        await this.flushCandidates();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.signaling?.send({ kind: 'answer', from: this.selfId, data: answer });
      } else if (msg.kind === 'answer') {
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

  end(sendBye = true) {
    if (this.ended) return;
    this.ended = true;
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
