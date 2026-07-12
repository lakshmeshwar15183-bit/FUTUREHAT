var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// entry.js
var entry_exports = {};
__export(entry_exports, {
  CallSession: () => CallSession
});
module.exports = __toCommonJS(entry_exports);

// ../../mobile/src/calls/webrtc.ts
var import_react_native_webrtc = require("/Users/lakshmeshwarpandey/Lumixo/scripts/call-test/mocks/react-native-webrtc.js");
var import_react_native_incall_manager = __toESM(require("/Users/lakshmeshwarpandey/Lumixo/scripts/call-test/mocks/react-native-incall-manager.js"));
var import_supabase = require("/Users/lakshmeshwarpandey/Lumixo/scripts/call-test/mocks/supabase.js");
var import_shared = require("/Users/lakshmeshwarpandey/Lumixo/scripts/call-test/mocks/shared.js");
var clog = (...args) => {
  if (typeof __DEV__ !== "undefined" && __DEV__) console.log("[call]", ...args);
};
var CONNECT_TIMEOUT_MS = 5e4;
var ICE_RESTART_GRACE_MS = 3500;
var DISCONNECT_TEARDOWN_MS = 2e4;
var MAX_ICE_RESTARTS = 5;
var ICE_SERVERS = (0, import_shared.buildIceServers)(
  process.env.EXPO_PUBLIC_TURN_URL ? {
    urls: process.env.EXPO_PUBLIC_TURN_URL,
    username: process.env.EXPO_PUBLIC_TURN_USERNAME,
    credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL
  } : null
);
var HAS_TURN = (0, import_shared.hasTurn)(ICE_SERVERS);
var CallSession = class {
  constructor(callId, selfId, isCaller, type, cb) {
    this.callId = callId;
    this.selfId = selfId;
    this.isCaller = isCaller;
    this.type = type;
    this.cb = cb;
    this.videoEnabled = type === "video";
    this.speakerOn = type === "video";
  }
  pc = null;
  signaling = null;
  localStream = null;
  /** Aggregated remote stream — tracks are added as ontrack fires (audio then video). */
  remoteStream = null;
  pendingCandidates = [];
  remoteDescSet = false;
  ended = false;
  cachedOffer = null;
  cachedAnswer = null;
  answered = false;
  offerHandled = false;
  readyTimer = null;
  readyTicks = 0;
  reconnectTimer = null;
  iceRestartTimer = null;
  connectTimer = null;
  connectedOnce = false;
  iceRestartAttempts = 0;
  facing = "user";
  offerRetryTimer = null;
  /** Serialize makeOffer so concurrent ready signals cannot glare-create offers. */
  offerInFlight = null;
  /** Serialize ICE restart so failed+disconnected dual edges cannot double-offer. */
  iceRestartInFlight = false;
  muted = false;
  videoEnabled;
  speakerOn;
  /** Lower capture + send resolution for weak networks / data saver. */
  lowDataMode = false;
  adaptiveTimer = null;
  lastPath = "unknown";
  async start() {
    clog(this.isCaller ? "CALLER" : "CALLEE", "start()", this.type, "call", this.callId);
    if (this.ended) return;
    let gumStream;
    try {
      gumStream = await import_react_native_webrtc.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          // Android WebRTC extras (ignored if unsupported).
          googEchoCancellation: true,
          googNoiseSuppression: true,
          googAutoGainControl: true,
          googHighpassFilter: true,
          googTypingNoiseDetection: true
        },
        video: this.type === "video" ? {
          facingMode: "user",
          width: { min: 320, ideal: 1280, max: 1920 },
          height: { min: 240, ideal: 720, max: 1080 },
          frameRate: { min: 15, ideal: 30, max: 30 }
        } : false
      });
    } catch (e) {
      clog("getUserMedia failed", e);
      this.end(false);
      throw e;
    }
    if (this.ended) {
      try {
        gumStream.getTracks().forEach((t) => t.stop());
      } catch {
      }
      return;
    }
    this.localStream = gumStream;
    this.localStream.getAudioTracks().forEach((t) => {
      t.enabled = true;
    });
    this.localStream.getVideoTracks().forEach((t) => {
      t.enabled = this.videoEnabled;
    });
    this.cb.onLocalStream(this.localStream);
    this.cb.onFacingChange?.(this.facing);
    this.stopAllTones();
    import_react_native_incall_manager.default.start({
      media: this.type === "video" ? "video" : "audio",
      auto: true,
      ringback: ""
      // always empty — we control tones ourselves
    });
    if (this.isCaller) {
      try {
        import_react_native_incall_manager.default.startRingback("_DTMF_");
      } catch {
      }
    }
    this.applyAudioRoute();
    try {
      import_react_native_incall_manager.default.setKeepScreenOn?.(this.type === "video" || this.speakerOn);
    } catch {
    }
    try {
      import_react_native_incall_manager.default.startProximitySensor?.();
    } catch {
    }
    if (!HAS_TURN) {
      clog(
        "\u26A0\uFE0F NO TURN relay (EXPO_PUBLIC_TURN_* unset) \u2014 STUN only.",
        "Cross-network calls will often fail. Configure TURN for production."
      );
    }
    this.pc = new import_react_native_webrtc.RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 16,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "all"
    });
    this.localStream.getTracks().forEach((t) => {
      this.pc.addTrack(t, this.localStream);
    });
    try {
      await this.preferCodecs();
    } catch {
    }
    this.pc.ontrack = (e) => this.handleRemoteTrack(e);
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        const c = e.candidate.candidate || "";
        const typ = /typ (\w+)/.exec(c)?.[1] ?? "?";
        clog("local ICE", typ);
        this.signaling?.send({ kind: "candidate", from: this.selfId, data: e.candidate });
      } else {
        clog("ICE gathering complete");
      }
    };
    this.pc.onicegatheringstatechange = () => {
      clog("iceGatheringState:", this.pc?.iceGatheringState);
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
      this.stopAllTones();
      this.cb.onReconnecting?.(false);
      if (!this.connectedOnce) {
        this.connectedOnce = true;
        clog("\u2705 CONNECTED");
      }
      this.cb.onConnected();
      void this.probeAndAdapt();
    };
    this.pc.onconnectionstatechange = () => {
      const st = this.pc?.connectionState;
      clog("connectionState:", st);
      if (st === "connected") markConnected();
      else if (st === "disconnected") this.onTransportBlip();
      else if (st === "failed" || st === "closed") {
        if (st === "failed") this.tryIceRestart("connectionState=failed");
        else this.end(false);
      }
    };
    this.pc.oniceconnectionstatechange = () => {
      const st = this.pc?.iceConnectionState;
      clog("iceConnectionState:", st);
      if (st === "connected" || st === "completed") markConnected();
      else if (st === "disconnected") this.onTransportBlip();
      else if (st === "failed") this.tryIceRestart("iceConnectionState=failed");
    };
    this.signaling = (0, import_shared.createSignalingChannel)(
      import_supabase.supabase,
      this.callId,
      this.selfId,
      (msg) => this.onSignal(msg),
      () => this.onChannelReady()
    );
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.connectedOnce || this.ended) return;
      clog(
        "\u23F1\uFE0F connect watchdog expired",
        "conn=",
        this.pc?.connectionState,
        "ice=",
        this.pc?.iceConnectionState
      );
      this.end(false);
    }, CONNECT_TIMEOUT_MS);
    this.adaptiveTimer = setInterval(() => {
      void this.probeAndAdapt();
    }, 2500);
  }
  /**
   * Root white-screen fix: aggregate every remote track into ONE MediaStream and
   * re-emit it whenever a track is added or unmutes. RTCView must re-bind when
   * the first video frame becomes available (audio-only stream → white SurfaceView).
   */
  handleRemoteTrack(e) {
    const track = e?.track;
    if (!track) return;
    clog("ontrack", track.kind, "muted=", track.muted, "readyState=", track.readyState);
    if (!this.remoteStream) {
      const fromEvent = e.streams?.[0];
      this.remoteStream = fromEvent ? fromEvent : new import_react_native_webrtc.MediaStream();
    }
    const already = this.remoteStream.getTracks().some((t) => t.id === track.id);
    if (!already) {
      try {
        this.remoteStream.addTrack(track);
      } catch {
      }
    }
    this.emitRemote();
    const reemit = () => {
      clog("remote track unmute/live", track.kind);
      this.emitRemote();
    };
    try {
      track.onunmute = reemit;
      track.onmute = () => clog("remote track mute", track.kind);
      track.onended = () => {
        clog("remote track ended", track.kind);
        try {
          this.remoteStream?.removeTrack(track);
        } catch {
        }
        this.emitRemote();
      };
    } catch {
    }
  }
  emitRemote() {
    if (!this.remoteStream) {
      this.cb.onRemoteStream(null);
      return;
    }
    this.cb.onRemoteStream(this.remoteStream);
  }
  onTransportBlip() {
    if (this.ended) return;
    this.cb.onReconnecting?.(true);
    if (!this.iceRestartTimer) {
      this.iceRestartTimer = setTimeout(() => {
        this.iceRestartTimer = null;
        const ice = this.pc?.iceConnectionState;
        const cs = this.pc?.connectionState;
        if (ice !== "connected" && ice !== "completed" && cs !== "connected") {
          this.tryIceRestart("disconnect-grace");
        }
      }, ICE_RESTART_GRACE_MS);
    }
    this.scheduleReconnectTeardown();
  }
  async tryIceRestart(reason) {
    if (this.ended || !this.pc) return;
    if (!this.isCaller) {
      clog("ICE blip on callee \u2014 wait for caller restart (", reason, ")");
      return;
    }
    if (this.iceRestartInFlight) return;
    if (this.iceRestartAttempts >= MAX_ICE_RESTARTS) {
      clog("\u274C ICE restart exhausted (", reason, ") \u2192 ending");
      this.end(false);
      return;
    }
    this.iceRestartInFlight = true;
    this.iceRestartAttempts += 1;
    clog("\u{1F504} ICE restart #", this.iceRestartAttempts, reason);
    try {
      this.cachedOffer = null;
      this.answered = false;
      const offer = await this.pc.createOffer({ iceRestart: true });
      if (this.ended || !this.pc) return;
      await this.pc.setLocalDescription(offer);
      this.cachedOffer = offer;
      this.signaling?.send({ kind: "offer", from: this.selfId, data: offer });
    } catch (e) {
      clog("ICE restart failed", e?.message ?? e);
      this.end(false);
    } finally {
      this.iceRestartInFlight = false;
    }
  }
  scheduleReconnectTeardown() {
    if (this.reconnectTimer || this.ended) return;
    clog("disconnected \u2014 teardown in", DISCONNECT_TEARDOWN_MS, "ms if not recovered");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const cs = this.pc?.connectionState;
      const ice = this.pc?.iceConnectionState;
      if (cs !== "connected" && ice !== "connected" && ice !== "completed") {
        clog("reconnect grace expired \u2014 ending");
        this.end(false);
      }
    }, DISCONNECT_TEARDOWN_MS);
  }
  async preferCodecs() {
    const pc = this.pc;
    if (!pc?.getTransceivers) return;
    for (const t of pc.getTransceivers()) {
      if (t.sender?.track?.kind !== "video") continue;
      const caps = RTCRtpSender?.getCapabilities?.("video");
      if (!caps?.codecs?.length || !t.setCodecPreferences) continue;
      const preferred = [
        ...caps.codecs.filter((c) => /h264/i.test(c.mimeType)),
        ...caps.codecs.filter((c) => /vp8/i.test(c.mimeType)),
        ...caps.codecs.filter((c) => !/h264|vp8/i.test(c.mimeType))
      ];
      try {
        t.setCodecPreferences(preferred);
      } catch {
      }
    }
  }
  onChannelReady() {
    clog(this.isCaller ? "CALLER" : "CALLEE", "signaling LIVE");
    if (this.ended) return;
    if (!this.isCaller) this.startReadyHeartbeat();
  }
  startReadyHeartbeat() {
    if (this.readyTimer) return;
    const ping = () => {
      if (this.ended || this.offerHandled || this.readyTicks > 24) {
        this.stopReadyHeartbeat();
        return;
      }
      this.readyTicks += 1;
      this.signaling?.send({ kind: "ready", from: this.selfId });
    };
    ping();
    this.readyTimer = setInterval(ping, 280);
  }
  stopReadyHeartbeat() {
    if (this.readyTimer) {
      clearInterval(this.readyTimer);
      this.readyTimer = null;
    }
  }
  async makeOffer(iceRestart = false) {
    if (!this.pc || this.ended || !this.isCaller) return;
    if (this.answered && !iceRestart) return;
    if (this.offerInFlight) {
      await this.offerInFlight;
      if (!this.ended && !this.answered && this.cachedOffer && !iceRestart) {
        this.signaling?.send({ kind: "offer", from: this.selfId, data: this.cachedOffer });
      }
      return;
    }
    this.offerInFlight = (async () => {
      if (!this.pc || this.ended) return;
      if (!this.cachedOffer || iceRestart) {
        const offer = await this.pc.createOffer({
          iceRestart: !!iceRestart,
          offerToReceiveAudio: true,
          offerToReceiveVideo: this.type === "video"
        });
        if (this.ended || !this.pc) return;
        await this.pc.setLocalDescription(offer);
        this.cachedOffer = offer;
      }
      clog("CALLER \u2192 offer", iceRestart ? "(ICE restart)" : "");
      this.signaling?.send({ kind: "offer", from: this.selfId, data: this.cachedOffer });
      if (!iceRestart && !this.offerRetryTimer) {
        let n = 0;
        this.offerRetryTimer = setInterval(() => {
          if (this.ended || this.answered || n++ > 12) {
            if (this.offerRetryTimer) clearInterval(this.offerRetryTimer);
            this.offerRetryTimer = null;
            return;
          }
          if (this.cachedOffer) {
            this.signaling?.send({ kind: "offer", from: this.selfId, data: this.cachedOffer });
          }
        }, 900);
      }
    })();
    try {
      await this.offerInFlight;
    } finally {
      this.offerInFlight = null;
    }
  }
  async onSignal(msg) {
    if (!this.pc || this.ended) return;
    clog("signal IN:", msg.kind);
    try {
      if (msg.kind === "ready") {
        if (this.isCaller) await this.makeOffer();
      } else if (msg.kind === "offer") {
        const isRestart = this.offerHandled && this.pc.signalingState === "stable";
        if (this.offerHandled && !isRestart) {
          if (this.cachedAnswer) {
            this.signaling?.send({
              kind: "answer",
              from: this.selfId,
              data: this.cachedAnswer
            });
          }
          return;
        }
        this.offerHandled = true;
        this.stopReadyHeartbeat();
        await this.pc.setRemoteDescription(new import_react_native_webrtc.RTCSessionDescription(msg.data));
        this.remoteDescSet = true;
        await this.flushCandidates();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.cachedAnswer = answer;
        clog("CALLEE \u2192 answer");
        this.signaling?.send({ kind: "answer", from: this.selfId, data: answer });
      } else if (msg.kind === "answer") {
        this.stopAllTones();
        if (this.answered && this.pc.signalingState !== "have-local-offer") {
          return;
        }
        if (this.pc.signalingState === "have-local-offer") {
          this.answered = true;
          if (this.offerRetryTimer) {
            clearInterval(this.offerRetryTimer);
            this.offerRetryTimer = null;
          }
          await this.pc.setRemoteDescription(new import_react_native_webrtc.RTCSessionDescription(msg.data));
          this.remoteDescSet = true;
          await this.flushCandidates();
        }
      } else if (msg.kind === "candidate") {
        const cand = new import_react_native_webrtc.RTCIceCandidate(msg.data);
        if (this.remoteDescSet) await this.pc.addIceCandidate(cand);
        else this.pendingCandidates.push(cand);
      } else if (msg.kind === "bye") {
        this.end(false);
      }
    } catch (e) {
      clog("onSignal error", msg.kind, e?.message ?? e);
    }
  }
  async flushCandidates() {
    for (const c of this.pendingCandidates) {
      try {
        await this.pc?.addIceCandidate(c);
      } catch {
      }
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
    this.applyAudioRoute();
    try {
      import_react_native_incall_manager.default.setKeepScreenOn?.(this.type === "video" || this.speakerOn);
    } catch {
    }
    return this.speakerOn;
  }
  /** Earpiece ↔ speaker (InCallManager also routes BT SCO when connected). */
  applyAudioRoute() {
    try {
      import_react_native_incall_manager.default.setForceSpeakerphoneOn(this.speakerOn);
    } catch {
    }
    try {
      if (!this.speakerOn) {
        import_react_native_incall_manager.default.chooseAudioRoute?.("EARPIECE");
      } else {
        import_react_native_incall_manager.default.chooseAudioRoute?.("SPEAKER_PHONE");
      }
    } catch {
    }
  }
  /**
   * Data-saver mode (beyond WhatsApp defaults): drop capture target to ~360p
   * and cap outbound frame rate so weak networks stay audible/visible.
   */
  setLowDataMode(on) {
    this.lowDataMode = on;
    void this.applySenderBitrate(on ? 25e4 : 12e5, on ? 15 : 30);
    return this.lowDataMode;
  }
  async applySenderBitrate(maxBitrate, maxFramerate) {
    try {
      const senders = this.pc?.getSenders?.() ?? [];
      for (const s of senders) {
        if (s.track?.kind !== "video") continue;
        const params = s.getParameters?.() ?? {};
        if (!params.encodings?.length) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = maxBitrate;
        params.encodings[0].maxFramerate = maxFramerate;
        if (this.lowDataMode) {
          params.encodings[0].scaleResolutionDownBy = 2.5;
        } else {
          params.encodings[0].scaleResolutionDownBy = 1;
        }
        await s.setParameters(params);
      }
    } catch (e) {
      clog("applySenderBitrate", e?.message ?? e);
    }
  }
  /** Probe candidate pair + packet loss; adapt bitrate; report path to UI. */
  async probeAndAdapt() {
    if (this.ended || !this.pc || !this.connectedOnce) return;
    try {
      const stats = await this.pc.getStats();
      let path = "unknown";
      let loss = 0;
      let rtt = 0;
      let dLost = 0;
      let dRecv = 0;
      stats.forEach((r) => {
        if (r.type === "candidate-pair" && (r.nominated || r.selected) && r.state === "succeeded") {
          const local = stats.get?.(r.localCandidateId);
          const remote = stats.get?.(r.remoteCandidateId);
          const typ = String(local?.candidateType || remote?.candidateType || "");
          if (/relay/i.test(typ)) path = "relay";
          else if (/host|srflx|prflx/i.test(typ)) path = "direct";
          if (typeof r.currentRoundTripTime === "number") rtt = r.currentRoundTripTime;
        }
        if (r.type === "inbound-rtp" && r.kind === "video") {
          dLost += Number(r.packetsLost || 0);
          dRecv += Number(r.packetsReceived || 0);
        }
      });
      const resolved = path;
      if (resolved !== "unknown" && resolved !== this.lastPath) {
        this.lastPath = resolved;
        this.cb.onConnectionPath?.(resolved);
      }
      loss = dRecv + dLost > 0 ? dLost / (dRecv + dLost) : 0;
      if (!this.lowDataMode && resolved === "relay" && (loss > 0.05 || rtt > 0.35)) {
        void this.applySenderBitrate(35e4, 18);
      } else if (!this.lowDataMode && loss < 0.01 && rtt < 0.12) {
        void this.applySenderBitrate(15e5, 30);
      }
      let q = 4;
      if (loss > 0.08 || rtt > 0.5) q = 1;
      else if (loss > 0.04 || rtt > 0.3) q = 2;
      else if (loss > 0.015 || rtt > 0.15) q = 3;
      this.cb.onQuality?.(q);
    } catch {
    }
  }
  /**
   * Switch front/back camera. Uses replaceTrack when possible so the remote
   * peer keeps a continuous video mid stream (smoother than _switchCamera alone).
   * Facing state is tracked so local RTCView mirror can be toggled (front only).
   */
  async switchCamera() {
    const next = this.facing === "user" ? "environment" : "user";
    try {
      const oldTrack = this.localStream?.getVideoTracks()?.[0];
      if (!oldTrack) return this.facing;
      const fresh = await import_react_native_webrtc.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { exact: next },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      });
      const newTrack = fresh.getVideoTracks()[0];
      if (!newTrack) {
        fresh.getTracks().forEach((t) => t.stop());
        oldTrack._switchCamera?.();
        this.facing = next;
        this.cb.onFacingChange?.(this.facing);
        return this.facing;
      }
      newTrack.enabled = this.videoEnabled;
      const sender = this.pc?.getSenders?.()?.find((s) => s.track && s.track.kind === "video");
      if (sender?.replaceTrack) {
        await sender.replaceTrack(newTrack);
      } else {
        oldTrack._switchCamera?.();
        fresh.getTracks().forEach((t) => t.stop());
        this.facing = next;
        this.cb.onFacingChange?.(this.facing);
        return this.facing;
      }
      try {
        this.localStream?.removeTrack(oldTrack);
      } catch {
      }
      try {
        this.localStream?.addTrack(newTrack);
      } catch {
      }
      oldTrack.stop();
      fresh.getAudioTracks().forEach((t) => t.stop());
      this.facing = next;
      this.cb.onLocalStream(this.localStream);
      this.cb.onFacingChange?.(this.facing);
      return this.facing;
    } catch (e) {
      clog("switchCamera failed, fallback _switchCamera", e?.message ?? e);
      try {
        this.localStream?.getVideoTracks().forEach((t) => t._switchCamera?.());
        this.facing = next;
        this.cb.onFacingChange?.(this.facing);
      } catch {
      }
      return this.facing;
    }
  }
  getFacing() {
    return this.facing;
  }
  async getStats() {
    try {
      return this.pc ? await this.pc.getStats() : null;
    } catch {
      return null;
    }
  }
  /** Stop every local call tone. Safe to call repeatedly. */
  stopAllTones() {
    try {
      import_react_native_incall_manager.default.stopRingback?.();
    } catch {
    }
    try {
      import_react_native_incall_manager.default.stopRingtone?.();
    } catch {
    }
    try {
      import_react_native_incall_manager.default.stopBusytone?.();
    } catch {
    }
  }
  end(sendBye = true) {
    if (this.ended) return;
    this.ended = true;
    this.stopReadyHeartbeat();
    this.stopAllTones();
    if (this.adaptiveTimer) {
      clearInterval(this.adaptiveTimer);
      this.adaptiveTimer = null;
    }
    if (this.offerRetryTimer) {
      clearInterval(this.offerRetryTimer);
      this.offerRetryTimer = null;
    }
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
    if (sendBye) {
      try {
        this.signaling?.send({ kind: "bye", from: this.selfId });
      } catch {
      }
    }
    try {
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.remoteStream?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
        }
      });
      this.pc?.close();
    } catch {
    }
    this.stopAllTones();
    try {
      import_react_native_incall_manager.default.stop();
    } catch {
    }
    this.stopAllTones();
    try {
      import_react_native_incall_manager.default.setKeepScreenOn?.(false);
    } catch {
    }
    try {
      import_react_native_incall_manager.default.stopProximitySensor?.();
    } catch {
    }
    try {
      this.signaling?.close();
    } catch {
    }
    this.localStream = null;
    this.remoteStream = null;
    this.pc = null;
    this.cb.onEnded();
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CallSession
});
