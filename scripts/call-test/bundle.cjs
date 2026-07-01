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
var import_react_native_webrtc = require("/Users/lakshmeshwarpandey/FUTUREHAT/scripts/call-test/mocks/react-native-webrtc.js");
var import_react_native_incall_manager = __toESM(require("/Users/lakshmeshwarpandey/FUTUREHAT/scripts/call-test/mocks/react-native-incall-manager.js"));
var import_supabase = require("/Users/lakshmeshwarpandey/FUTUREHAT/scripts/call-test/mocks/supabase.js");
var import_shared = require("/Users/lakshmeshwarpandey/FUTUREHAT/scripts/call-test/mocks/shared.js");
var clog = (...args) => console.log("[call]", ...args);
var CONNECT_TIMEOUT_MS = 45e3;
var ICE_SERVERS = (0, import_shared.buildIceServers)(
  process.env.EXPO_PUBLIC_TURN_URL ? {
    urls: process.env.EXPO_PUBLIC_TURN_URL,
    username: process.env.EXPO_PUBLIC_TURN_USERNAME,
    credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL
  } : null
);
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
  pendingCandidates = [];
  remoteDescSet = false;
  ended = false;
  // Handshake state. The caller caches its offer and re-sends it on every `ready`
  // heartbeat until it receives an answer; the callee caches its answer and
  // re-sends it if a duplicate offer arrives (covers a lost answer). The callee
  // pings `ready` until it sees the offer. This makes the SDP exchange resilient
  // to the broadcast channel dropping messages sent before a peer subscribed.
  cachedOffer = null;
  cachedAnswer = null;
  answered = false;
  offerHandled = false;
  readyTimer = null;
  readyTicks = 0;
  // Reconnect grace: a transient 'disconnected' (network blip, handoff) usually
  // recovers to 'connected' on its own — don't tear the call down instantly.
  reconnectTimer = null;
  // Connect watchdog: a hard upper bound on the *initial* connect. If we never
  // reach 'connected' (a wedged handshake where the offer/answer is lost, or an
  // ICE that stalls in 'checking' without ever transitioning to 'failed' — a
  // known RN-WebRTC Android quirk), NOTHING else would ever fire, leaving the UI
  // pinned on "Connecting…" forever. This timer guarantees the call instead ENDS
  // (view unmounts) so the stuck state is impossible. Cleared on first connect.
  connectTimer = null;
  // Guard so we only log the first successful connect (onConnected itself is
  // idempotent on the UI side).
  connectedOnce = false;
  muted = false;
  videoEnabled;
  speakerOn;
  async start() {
    clog(this.isCaller ? "CALLER" : "CALLEE", "start()", this.type, "call", this.callId);
    this.localStream = await import_react_native_webrtc.mediaDevices.getUserMedia({
      // echo-cancellation / noise-suppression aren't in the RN-WebRTC TS types
      // but are honoured by the native layer.
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: this.type === "video" ? { facingMode: "user", frameRate: 30, width: 1280, height: 720 } : false
    });
    this.cb.onLocalStream(this.localStream);
    import_react_native_incall_manager.default.start({ media: this.type === "video" ? "video" : "audio" });
    import_react_native_incall_manager.default.setForceSpeakerphoneOn(this.speakerOn);
    this.pc = new import_react_native_webrtc.RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.localStream.getTracks().forEach((t) => this.pc.addTrack(t, this.localStream));
    this.pc.ontrack = (e) => {
      clog("ontrack", e.track?.kind, "streams:", e.streams?.length ?? 0);
      if (e.streams && e.streams[0]) this.cb.onRemoteStream(e.streams[0]);
    };
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        const c = e.candidate.candidate || "";
        const typ = /typ (\w+)/.exec(c)?.[1] ?? "?";
        clog("local ICE candidate", typ);
        this.signaling?.send({ kind: "candidate", from: this.selfId, data: e.candidate });
      } else {
        clog("local ICE gathering complete");
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
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      if (!this.connectedOnce) {
        this.connectedOnce = true;
        clog("\u2705 CONNECTED");
      }
      this.cb.onConnected();
    };
    this.pc.onconnectionstatechange = () => {
      const st = this.pc?.connectionState;
      clog("connectionState:", st);
      if (st === "connected") {
        markConnected();
      } else if (st === "disconnected") {
        this.scheduleReconnectTeardown();
      } else if (st === "failed" || st === "closed") {
        clog("connectionState terminal:", st, "\u2192 ending");
        this.end(false);
      }
    };
    this.pc.oniceconnectionstatechange = () => {
      const st = this.pc?.iceConnectionState;
      clog("iceConnectionState:", st);
      if (st === "connected" || st === "completed") {
        markConnected();
      } else if (st === "disconnected") {
        this.scheduleReconnectTeardown();
      } else if (st === "failed") {
        clog("\u274C iceConnectionState failed \u2014 no reachable candidate pair (check TURN)");
        this.end(false);
      }
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
        "\u23F1\uFE0F connect watchdog expired \u2014 never reached connected. states:",
        "conn=",
        this.pc?.connectionState,
        "ice=",
        this.pc?.iceConnectionState,
        "sig=",
        this.pc?.signalingState,
        "\u2192 ending (no stuck Connecting\u2026)"
      );
      this.end(false);
    }, CONNECT_TIMEOUT_MS);
  }
  // A transient 'disconnected' on either state machine: give ICE ~12s to recover
  // (network blip / wifi↔cellular handoff) before tearing the call down. Only
  // ends if BOTH state machines are still not connected when the grace expires.
  scheduleReconnectTeardown() {
    if (this.reconnectTimer || this.ended) return;
    clog("disconnected \u2014 12s grace before teardown");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const cs = this.pc?.connectionState;
      const ice = this.pc?.iceConnectionState;
      if (cs !== "connected" && ice !== "connected" && ice !== "completed") {
        clog("reconnect grace expired \u2014 ending");
        this.end(false);
      }
    }, 12e3);
  }
  // Called when our own signaling subscription goes live.
  onChannelReady() {
    clog(this.isCaller ? "CALLER" : "CALLEE", "signaling channel LIVE");
    if (this.ended) return;
    if (!this.isCaller) this.startReadyHeartbeat();
  }
  startReadyHeartbeat() {
    if (this.readyTimer) return;
    const ping = () => {
      if (this.ended || this.offerHandled || this.readyTicks > 12) {
        this.stopReadyHeartbeat();
        return;
      }
      this.readyTicks += 1;
      this.signaling?.send({ kind: "ready", from: this.selfId });
    };
    ping();
    this.readyTimer = setInterval(ping, 700);
  }
  stopReadyHeartbeat() {
    if (this.readyTimer) {
      clearInterval(this.readyTimer);
      this.readyTimer = null;
    }
  }
  // Caller: build the offer once, cache it, and (re)broadcast it. Re-sending the
  // SAME cached SDP on each `ready` is safe and covers a dropped first offer.
  async makeOffer() {
    if (!this.pc || this.answered) return;
    if (!this.cachedOffer) {
      const offer = await this.pc.createOffer({});
      await this.pc.setLocalDescription(offer);
      this.cachedOffer = offer;
    }
    clog("CALLER \u2192 offer");
    this.signaling?.send({ kind: "offer", from: this.selfId, data: this.cachedOffer });
  }
  async onSignal(msg) {
    if (!this.pc || this.ended) return;
    clog("signal IN:", msg.kind);
    try {
      if (msg.kind === "ready") {
        if (this.isCaller) await this.makeOffer();
      } else if (msg.kind === "offer") {
        if (this.offerHandled) {
          if (this.cachedAnswer) {
            this.signaling?.send({ kind: "answer", from: this.selfId, data: this.cachedAnswer });
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
        if (this.answered || this.pc.signalingState !== "have-local-offer") return;
        this.answered = true;
        await this.pc.setRemoteDescription(new import_react_native_webrtc.RTCSessionDescription(msg.data));
        this.remoteDescSet = true;
        await this.flushCandidates();
      } else if (msg.kind === "candidate") {
        const cand = new import_react_native_webrtc.RTCIceCandidate(msg.data);
        if (this.remoteDescSet) await this.pc.addIceCandidate(cand);
        else this.pendingCandidates.push(cand);
      } else if (msg.kind === "bye") {
        this.end(false);
      }
    } catch {
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
    this.localStream?.getAudioTracks().forEach((t) => t.enabled = !this.muted);
    return this.muted;
  }
  toggleVideo() {
    this.videoEnabled = !this.videoEnabled;
    this.localStream?.getVideoTracks().forEach((t) => t.enabled = this.videoEnabled);
    return this.videoEnabled;
  }
  toggleSpeaker() {
    this.speakerOn = !this.speakerOn;
    import_react_native_incall_manager.default.setForceSpeakerphoneOn(this.speakerOn);
    return this.speakerOn;
  }
  switchCamera() {
    this.localStream?.getVideoTracks().forEach((t) => t._switchCamera?.());
  }
  end(sendBye = true) {
    if (this.ended) return;
    this.ended = true;
    this.stopReadyHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (sendBye) this.signaling?.send({ kind: "bye", from: this.selfId });
    try {
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.pc?.close();
    } catch {
    }
    import_react_native_incall_manager.default.stop();
    this.signaling?.close();
    this.cb.onEnded();
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CallSession
});
