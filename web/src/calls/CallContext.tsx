// FUTUREHAT web — voice/video calling over WebRTC. Shares the calls data layer
// and signaling channel with mobile (@shared/callsApi). Renders a call overlay
// (incoming / outgoing / in-call) and exposes startCall() via context.
//
// Handshake ordering avoids the broadcast race: the callee opens its media +
// signaling channel and only THEN marks the call 'accepted'; the caller waits to
// see 'accepted' before creating and sending its SDP offer, so the callee is
// always subscribed in time to receive it. ICE candidates trickle both ways.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import {
  createCall, updateCallStatus, subscribeToIncomingCalls, subscribeToCallStatus,
  createSignalingChannel, DEFAULT_ICE_SERVERS, type SignalingChannel,
} from '@shared/callsApi';
import { getProfile } from '@shared/api';
import type { Call, CallType } from '@shared/types';
import {
  MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, SpeakerIcon, SpeakerOffIcon,
  CameraFlipIcon, EndCallIcon, PhoneIcon, MinimizeIcon, LockIcon,
} from '../Icons';
import './CallContext.css';

type Phase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

interface CallCtx {
  startCall: (conversationId: string, type: CallType, peerName: string) => void;
  busy: boolean;
}
const Ctx = createContext<CallCtx>({ startCall: () => {}, busy: false });
export const useCall = () => useContext(Ctx);

// Floating local-preview tile dimensions + edge margin (WhatsApp-style).
const PIP_W = 124;
const PIP_H = 174;
const PIP_EDGE = 16;

// Signal-strength style network indicator (1–4 bars).
function NetBars({ q, light }: { q: number; light?: boolean }) {
  const label = ['', 'Poor connection', 'Weak connection', 'Good connection', 'Excellent connection'][q] || '';
  return (
    <span className={`call-net ${light ? 'light' : ''} ${q <= 1 ? 'bad' : q === 2 ? 'mid' : ''}`} title={label} aria-label={label}>
      {[1, 2, 3, 4].map((i) => <i key={i} className={i <= q ? 'on' : ''} />)}
    </span>
  );
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const myId = profile?.id;

  const [phase, setPhase] = useState<Phase>('idle');
  const [callType, setCallType] = useState<CallType>('audio');
  const [peerName, setPeerName] = useState('');
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [duration, setDuration] = useState(0);
  // PiP: which video is the small floating tile (false = local is PiP, like WhatsApp)
  // and the tile's committed position (null = default bottom-right corner).
  const [localExpanded, setLocalExpanded] = useState(false);
  const [pip, setPip] = useState<{ x: number; y: number } | null>(null);
  // WhatsApp-style auto-hiding chrome + minimize-to-bubble.
  const [controlsVisible, setControlsVisible] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false, el: null as HTMLElement | null });
  const lastTapRef = useRef(0);
  const facingMode = useRef<'user' | 'environment'>('user');
  // Crossfade / loading / immersive / network-quality (all UI-only).
  const [remoteReady, setRemoteReady] = useState(false);
  const [localReady, setLocalReady] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [netQuality, setNetQuality] = useState(4);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const backdropVideo = useRef<HTMLVideoElement | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  const controlsRef = useRef(true);
  const lastRemoteTapRef = useRef(0);
  // Pinch-to-zoom / pan state for the full remote video.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef({ startDist: 0, startScale: 1, scale: 1, panX: 0, panY: 0, sPanX: 0, sPanY: 0, moved: false });

  const call = useRef<Call | null>(null);
  const isCaller = useRef(false);
  const pc = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const signaling = useRef<SignalingChannel | null>(null);
  const statusChannel = useRef<ReturnType<typeof subscribeToCallStatus> | null>(null);
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const durationTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const accepting = useRef(false); // guards against a double-tap on Accept

  // ── teardown ──────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (durationTimer.current) { clearInterval(durationTimer.current); durationTimer.current = null; }
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    try { signaling.current?.send({ kind: 'bye', from: myId! }); } catch {}
    signaling.current?.close(); signaling.current = null;
    if (statusChannel.current) { supabase.removeChannel(statusChannel.current); statusChannel.current = null; }
    pc.current?.getSenders().forEach((s) => s.track?.stop());
    pc.current?.close(); pc.current = null;
    localStream.current?.getTracks().forEach((t) => t.stop()); localStream.current = null;
    remoteStream.current = null;
    call.current = null; isCaller.current = false; accepting.current = false;
    setMuted(false); setCamOff(false); setSpeakerOn(true); setDuration(0);
    setLocalExpanded(false); setPip(null);
    setControlsVisible(true); setMinimized(false);
    setRemoteReady(false); setLocalReady(false); setNetQuality(4);
    pinch.current = { startDist: 0, startScale: 1, scale: 1, panX: 0, panY: 0, sPanX: 0, sPanY: 0, moved: false };
    pointers.current.clear();
    try { if (document.fullscreenElement) void document.exitFullscreen?.(); } catch { /* noop */ }
    setImmersive(false);
    facingMode.current = 'user';
  }, [myId]);

  const endCall = useCallback(async (markEnded = true) => {
    const active = call.current;
    cleanup();
    setPhase('ended');
    if (active && markEnded) await updateCallStatus(supabase, active.id, 'ended').catch(() => {});
    setTimeout(() => setPhase('idle'), 900);
  }, [cleanup]);

  // ── media + peer connection ─────────────────────────────────────────────────
  async function getMedia(type: CallType) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
    localStream.current = stream;
    if (type === 'video' && localVideo.current) localVideo.current.srcObject = stream;
    return stream;
  }

  function buildPc(stream: MediaStream) {
    const conn = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
    stream.getTracks().forEach((t) => conn.addTrack(t, stream));
    conn.onicecandidate = (e) => {
      if (e.candidate) signaling.current?.send({ kind: 'candidate', from: myId!, data: e.candidate.toJSON() });
    };
    conn.ontrack = (e) => {
      const [remote] = e.streams;
      remoteStream.current = remote;
      if (remoteVideo.current) remoteVideo.current.srcObject = remote;
      if (remoteAudio.current) remoteAudio.current.srcObject = remote;
      if (backdropVideo.current && !localExpanded) backdropVideo.current.srcObject = remote;
    };
    let closed = false; // scoped to this connection — fire endCall at most once
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === 'connected') startActive();
      if ((conn.connectionState === 'failed' || conn.connectionState === 'disconnected') && !closed) {
        closed = true;
        endCall(false);
      }
    };
    pc.current = conn;
    return conn;
  }

  function startActive() {
    setPhase((p) => (p === 'active' ? p : 'active'));
    if (!durationTimer.current) {
      durationTimer.current = setInterval(() => setDuration((d) => d + 1), 1000);
    }
  }

  function openSignaling(callId: string, type: CallType) {
    signaling.current = createSignalingChannel(supabase, callId, myId!, async (msg) => {
      const conn = pc.current;
      try {
        if (msg.kind === 'offer' && conn) {
          await conn.setRemoteDescription(new RTCSessionDescription(msg.data as RTCSessionDescriptionInit));
          const answer = await conn.createAnswer();
          await conn.setLocalDescription(answer);
          signaling.current?.send({ kind: 'answer', from: myId!, data: answer });
        } else if (msg.kind === 'answer' && conn) {
          await conn.setRemoteDescription(new RTCSessionDescription(msg.data as RTCSessionDescriptionInit));
        } else if (msg.kind === 'candidate' && conn) {
          await conn.addIceCandidate(new RTCIceCandidate(msg.data as RTCIceCandidateInit));
        } else if (msg.kind === 'bye') {
          endCall(false);
        }
      } catch { /* ignore malformed/late signaling */ }
    });
    void type;
  }

  // ── outgoing ────────────────────────────────────────────────────────────────
  const startCall = useCallback(async (conversationId: string, type: CallType, name: string) => {
    if (!myId || phase !== 'idle') return;
    isCaller.current = true;
    setCallType(type); setPeerName(name); setPhase('outgoing');
    try {
      const { call: created, error } = await createCall(supabase, conversationId, myId, type);
      if (error || !created) throw error || new Error('Could not start call');
      call.current = created;
      const stream = await getMedia(type);
      buildPc(stream);
      openSignaling(created.id, type);
      // Wait for the callee to accept, then send the offer.
      statusChannel.current = subscribeToCallStatus(supabase, created.id, async (c) => {
        if (c.status === 'accepted' && pc.current && pc.current.signalingState === 'stable') {
          setPhase('connecting');
          const offer = await pc.current.createOffer();
          await pc.current.setLocalDescription(offer);
          signaling.current?.send({ kind: 'offer', from: myId, data: offer });
        } else if (c.status === 'declined' || c.status === 'ended' || c.status === 'missed') {
          endCall(false);
        }
      });
    } catch {
      await endCall(false);
    }
  }, [myId, phase, endCall]);

  // ── incoming ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!myId) return;
    const channel = subscribeToIncomingCalls(supabase, async (incoming) => {
      if (incoming.caller_id === myId || incoming.status !== 'ringing') return;
      if (phase !== 'idle' || call.current) {
        await updateCallStatus(supabase, incoming.id, 'declined').catch(() => {});
        return;
      }
      call.current = incoming; isCaller.current = false;
      setCallType(incoming.type);
      const p = await getProfile(supabase, incoming.caller_id).catch(() => null);
      setPeerName(p?.display_name || 'Incoming call');
      setPhase('incoming');
    });
    return () => { supabase.removeChannel(channel); };
  }, [myId, phase]);

  async function accept() {
    const incoming = call.current;
    if (!incoming || !myId || accepting.current) return;
    accepting.current = true;
    setPhase('connecting');
    try {
      const stream = await getMedia(incoming.type);
      buildPc(stream);
      openSignaling(incoming.id, incoming.type);
      // Subscribe to status (for caller hangups) then mark accepted last, so we
      // are listening on the signaling channel before the caller sends the offer.
      statusChannel.current = subscribeToCallStatus(supabase, incoming.id, (c) => {
        if (c.status === 'ended' || c.status === 'declined') endCall(false);
      });
      await updateCallStatus(supabase, incoming.id, 'accepted');
    } catch {
      await decline();
    }
  }

  async function decline() {
    const incoming = call.current;
    cleanup();
    setPhase('idle');
    if (incoming) await updateCallStatus(supabase, incoming.id, 'declined').catch(() => {});
  }

  // ── controls ────────────────────────────────────────────────────────────────
  function toggleMute() {
    const track = localStream.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setMuted(!track.enabled); }
  }
  function toggleCam() {
    const track = localStream.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setCamOff(!track.enabled); }
  }

  // Front/back camera swap. Uses sender.replaceTrack so the SDP/negotiation is
  // untouched (no renegotiation) and the peer connection is never rebuilt — only
  // the local video track is hot-swapped in place on the existing MediaStream.
  async function switchCamera() {
    const stream = localStream.current;
    if (!stream) return;
    const next = facingMode.current === 'user' ? 'environment' : 'user';
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: next } });
      const newTrack = fresh.getVideoTracks()[0];
      if (!newTrack) { fresh.getTracks().forEach((t) => t.stop()); return; }
      const sender = pc.current?.getSenders().find((s) => s.track?.kind === 'video');
      await sender?.replaceTrack(newTrack);
      newTrack.enabled = !camOff;
      const old = stream.getVideoTracks()[0];
      if (old) { stream.removeTrack(old); old.stop(); }
      stream.addTrack(newTrack);
      facingMode.current = next;
      // Re-point the preview at the same stream so it picks up the new track.
      if (localVideo.current) localVideo.current.srcObject = stream;
    } catch { /* device busy / no second camera — keep current track */ }
  }

  // Best-effort speaker/output routing. setSinkId is supported on desktop Chrome/
  // Edge and recent Android Chrome; where unavailable we still flip the visual
  // state so the control stays meaningful (matches WhatsApp's speaker toggle).
  async function toggleSpeaker() {
    const next = !speakerOn;
    setSpeakerOn(next);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outs = devices.filter((d) => d.kind === 'audiooutput');
      const target = next
        ? outs.find((d) => /speaker|external/i.test(d.label)) ?? outs.find((d) => d.deviceId === 'default') ?? outs[0]
        : outs.find((d) => /earpiece|receiver|headset|default/i.test(d.label)) ?? outs[0];
      const sinkId = target?.deviceId;
      if (sinkId) {
        await (remoteAudio.current as unknown as { setSinkId?: (id: string) => Promise<void> })?.setSinkId?.(sinkId);
        await (remoteVideo.current as unknown as { setSinkId?: (id: string) => Promise<void> })?.setSinkId?.(sinkId);
      }
    } catch { /* setSinkId unsupported — visual state already updated */ }
  }

  // ── Auto-hiding chrome + minimize (UI ONLY) ──────────────────────────────────
  const isVideoCall = callType === 'video';
  // Show controls when a video call goes active, then fade them after a few seconds.
  useEffect(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    if (phase === 'active' && isVideoCall && !minimized) {
      setControlsVisible(true);
      hideTimer.current = setTimeout(() => setControlsVisible(false), 4500);
    } else {
      setControlsVisible(true);
    }
    return () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
  }, [phase, isVideoCall, minimized]);

  function toggleControls() {
    if (minimized) return;
    setControlsVisible((v) => {
      const next = !v;
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
      if (next && phase === 'active' && isVideoCall) {
        hideTimer.current = setTimeout(() => setControlsVisible(false), 4500);
      }
      return next;
    });
  }
  function minimize() { setMinimized(true); setControlsVisible(false); }
  function restore() { setMinimized(false); setControlsVisible(true); }

  // Immersive (browser) fullscreen on double-tap of the remote video.
  function toggleImmersive() {
    setImmersive((v) => {
      const next = !v;
      try {
        if (next) void overlayRef.current?.requestFullscreen?.();
        else if (document.fullscreenElement) void document.exitFullscreen?.();
      } catch { /* fullscreen blocked — keep CSS immersive */ }
      return next;
    });
  }
  // Sync immersive state if the user leaves fullscreen with Esc.
  useEffect(() => {
    function onFs() { if (!document.fullscreenElement) setImmersive(false); }
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Keep a ref mirror of control visibility so mousemove doesn't spam re-renders.
  useEffect(() => { controlsRef.current = controlsVisible; }, [controlsVisible]);
  // Desktop: moving the mouse reveals chrome + cursor; both auto-hide when idle.
  function revealChrome() {
    if (!isVideoCall || phase !== 'active' || minimized) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!controlsRef.current) setControlsVisible(true);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 4500);
  }

  // Network-quality indicator — polls getStats (read-only; never touches the PC).
  useEffect(() => {
    if (phase !== 'active') { setNetQuality(4); return; }
    let prevLost = 0, prevRecv = 0;
    const id = setInterval(async () => {
      const conn = pc.current;
      if (!conn) return;
      try {
        const stats = await conn.getStats();
        let lost = 0, recv = 0, rtt = 0;
        stats.forEach((report) => {
          const r = report as unknown as Record<string, number | string | boolean>;
          if (r.type === 'inbound-rtp') { lost += Number(r.packetsLost || 0); recv += Number(r.packetsReceived || 0); }
          if (r.type === 'candidate-pair' && r.nominated && typeof r.currentRoundTripTime === 'number') rtt = r.currentRoundTripTime;
        });
        const dLost = Math.max(0, lost - prevLost), dRecv = Math.max(0, recv - prevRecv);
        prevLost = lost; prevRecv = recv;
        const loss = dRecv + dLost > 0 ? dLost / (dRecv + dLost) : 0;
        let q = 4;
        if (loss > 0.08 || rtt > 0.5) q = 1;
        else if (loss > 0.04 || rtt > 0.3) q = 2;
        else if (loss > 0.015 || rtt > 0.15) q = 3;
        setNetQuality(q);
      } catch { /* stats unavailable */ }
    }, 2000);
    return () => clearInterval(id);
  }, [phase]);

  // Point the blurred backdrop at whichever stream currently fills the screen.
  useEffect(() => {
    const b = backdropVideo.current;
    if (!b) return;
    const full = localExpanded ? localStream.current : (remoteStream.current ?? localStream.current);
    if (full && b.srcObject !== full) b.srcObject = full;
  }, [localExpanded, remoteReady, localReady, phase]);

  // Reset pinch-zoom whenever the remote leaves the full slot or we minimize.
  useEffect(() => {
    pinch.current = { startDist: 0, startScale: 1, scale: 1, panX: 0, panY: 0, sPanX: 0, sPanY: 0, moved: false };
    pointers.current.clear();
    const rv = remoteVideo.current;
    if (rv) { rv.style.transition = 'transform .25s ease'; rv.style.transform = ''; }
  }, [localExpanded, minimized]);

  // ── Pinch-to-zoom + pan + tap/double-tap on the FULL remote video ────────────
  function applyZoom(animate: boolean) {
    const rv = remoteVideo.current;
    if (!rv) return;
    const p = pinch.current;
    rv.style.transition = animate ? 'transform .25s ease' : 'none';
    rv.style.transform = p.scale > 1.001 ? `translate3d(${p.panX}px, ${p.panY}px, 0) scale(${p.scale})` : '';
  }
  function clampPan() {
    const rv = remoteVideo.current, p = pinch.current;
    if (!rv) return;
    const maxX = (rv.clientWidth * (p.scale - 1)) / 2;
    const maxY = (rv.clientHeight * (p.scale - 1)) / 2;
    p.panX = Math.max(-maxX, Math.min(maxX, p.panX));
    p.panY = Math.max(-maxY, Math.min(maxY, p.panY));
  }
  function twoPointerDist() {
    const pts = [...pointers.current.values()];
    return pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  }
  function onFullDown(e: RPointerEvent<HTMLVideoElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    p.moved = false;
    if (pointers.current.size === 2) { p.startDist = twoPointerDist(); p.startScale = p.scale; }
    else { p.sPanX = e.clientX; p.sPanY = e.clientY; }
  }
  function onFullMove(e: RPointerEvent<HTMLVideoElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (pointers.current.size >= 2 && p.startDist > 0) {
      p.scale = Math.min(4, Math.max(1, p.startScale * (twoPointerDist() / p.startDist)));
      p.moved = true; clampPan(); applyZoom(false);
    } else if (pointers.current.size === 1 && p.scale > 1.001) {
      p.panX += e.clientX - p.sPanX; p.panY += e.clientY - p.sPanY;
      p.sPanX = e.clientX; p.sPanY = e.clientY;
      p.moved = true; clampPan(); applyZoom(false);
    }
  }
  function onFullUp(e: RPointerEvent<HTMLVideoElement>) {
    const wasMoved = pinch.current.moved;
    pointers.current.delete(e.pointerId);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const p = pinch.current;
    if (pointers.current.size < 2) p.startDist = 0;
    if (p.scale <= 1.02) { p.scale = 1; p.panX = 0; p.panY = 0; applyZoom(true); }
    if (pointers.current.size === 0 && !wasMoved) onRemoteTap();
  }
  function onRemoteTap() {
    if (minimized) { restore(); return; }
    const now = performance.now();
    if (now - lastRemoteTapRef.current < 280) {
      lastRemoteTapRef.current = 0;
      toggleControls();   // revert the toggle the first tap fired …
      toggleImmersive();  // … and switch immersive instead (double-tap)
    } else {
      lastRemoteTapRef.current = now;
      toggleControls();
    }
  }

  // ── Draggable / swappable local preview (UI ONLY — never touches streams/pc) ──
  function clampPip(x: number, y: number) {
    return {
      x: Math.max(PIP_EDGE, Math.min(x, window.innerWidth - PIP_W - PIP_EDGE)),
      y: Math.max(PIP_EDGE, Math.min(y, window.innerHeight - PIP_H - PIP_EDGE)),
    };
  }
  // Remember the tile's last position across calls (and the swap) via localStorage.
  function loadPip() {
    if (typeof window === 'undefined') return { x: PIP_EDGE, y: PIP_EDGE };
    try {
      const raw = localStorage.getItem('fh.call.pip');
      if (raw) { const p = JSON.parse(raw); if (typeof p?.x === 'number' && typeof p?.y === 'number') return clampPip(p.x, p.y); }
    } catch { /* ignore */ }
    return { x: window.innerWidth - PIP_W - PIP_EDGE, y: window.innerHeight - PIP_H - PIP_EDGE };
  }
  function savePip(p: { x: number; y: number }) {
    try { localStorage.setItem('fh.call.pip', JSON.stringify(p)); } catch { /* ignore */ }
  }
  const pipPos = pip ?? loadPip();

  // Re-clamp the tile into view after rotation / resize.
  useEffect(() => {
    function clamp() {
      setPip((p) => (p ? clampPip(p.x, p.y) : p));
    }
    window.addEventListener('resize', clamp);
    window.addEventListener('orientationchange', clamp);
    return () => { window.removeEventListener('resize', clamp); window.removeEventListener('orientationchange', clamp); };
  }, []);

  function onPipDown(e: RPointerEvent<HTMLVideoElement>) {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    el.style.transition = 'none';        // follow the finger 1:1 while dragging
    el.style.transform = 'translate3d(0,0,0)';
    dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, ox: 0, oy: 0, moved: false, el };
  }
  function onPipMove(e: RPointerEvent<HTMLVideoElement>) {
    const d = dragRef.current;
    if (!d.active || !d.el) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
    // Move via a compositor-only transform — no layout, no React re-render, no
    // MediaStream churn. The committed left/top stays put; only the transform shifts.
    d.el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  }
  function onPipUp(e: RPointerEvent<HTMLVideoElement>) {
    const d = dragRef.current;
    if (!d.active || !d.el) return;
    d.active = false;
    const el = d.el;
    try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (!d.moved) {
      el.style.transition = ''; el.style.transform = '';
      // A tap (no drag) swaps full ⇄ PiP. A *fast* second tap is the second half
      // of a double-tap "quick switch" — swallow it so the pair nets one toggle
      // (the first tap already flipped) instead of bouncing back to the start.
      const now = e.timeStamp;
      if (now - lastTapRef.current < 280) { lastTapRef.current = 0; return; }
      lastTapRef.current = now;
      setLocalExpanded((v) => !v);
      return;
    }
    // Snap to nearest side. Commit the current visual position into left/top with
    // the transform zeroed (no jump), then let the CSS left/top transition animate
    // to the snapped corner on the next frame.
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const x = rect.left + rect.width / 2 < vw / 2 ? PIP_EDGE : vw - rect.width - PIP_EDGE;
    const y = Math.max(PIP_EDGE, Math.min(rect.top, vh - rect.height - PIP_EDGE));
    el.style.transition = 'none';
    el.style.transform = 'translate3d(0,0,0)';
    el.style.left = `${rect.left}px`; el.style.top = `${rect.top}px`;
    el.style.right = 'auto'; el.style.bottom = 'auto';
    void el.offsetWidth;                 // flush the start frame before transitioning
    el.style.transition = '';            // restore CSS transition for the snap
    setPip({ x, y });                    // React commits left/top → animates to corner
    savePip({ x, y });                   // remember for next time
  }

  useEffect(() => () => cleanup(), [cleanup]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const showOverlay = phase !== 'idle';
  const isVideo = callType === 'video';
  const statusText =
    phase === 'incoming' ? `Incoming ${callType} call…` :
    phase === 'outgoing' ? 'Ringing' :
    phase === 'connecting' ? 'Connecting' :
    phase === 'active' ? fmt(duration) :
    phase === 'ended' ? 'Call ended' : '';
  const ringing = phase === 'incoming' || phase === 'outgoing' || phase === 'connecting';
  // The centred avatar "stage" shows for audio always, and for video until the
  // remote frames arrive — then it crossfades to the live video + top bar.
  const showStage = !isVideo || !remoteReady;
  const showTopbar = isVideo && remoteReady && phase !== 'ended';
  // Audio chrome is always shown; video chrome auto-hides after a few seconds.
  const chromeShown = !isVideo || controlsVisible;

  return (
    <Ctx.Provider value={{ startCall, busy: phase !== 'idle' }}>
      {children}
      <AnimatePresence>
        {showOverlay && (
          <motion.div
            ref={overlayRef}
            className={`call-overlay ${isVideo ? 'video' : 'audio'} ${minimized ? 'minimized' : ''} ${immersive ? 'immersive' : ''} ${chromeShown ? 'chrome-on' : 'chrome-off'} ${remoteReady ? 'remote-on' : ''} ${localReady ? 'local-on' : ''}`}
            onMouseMove={revealChrome}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>

            {isVideo && <video ref={backdropVideo} className="call-backdrop" autoPlay playsInline muted />}

            {isVideo && (
              <>
                <video
                  ref={remoteVideo}
                  className={`call-vid remote ${localExpanded ? 'pip' : 'full'}`}
                  style={localExpanded ? { left: pipPos.x, top: pipPos.y } : undefined}
                  autoPlay playsInline
                  onPlaying={() => setRemoteReady(true)}
                  onPointerDown={localExpanded ? onPipDown : onFullDown}
                  onPointerMove={localExpanded ? onPipMove : onFullMove}
                  onPointerUp={localExpanded ? onPipUp : onFullUp}
                  onPointerCancel={localExpanded ? onPipUp : onFullUp}
                />
                <video
                  ref={localVideo}
                  className={`call-vid local ${localExpanded ? 'full' : 'pip'}`}
                  style={!localExpanded ? { left: pipPos.x, top: pipPos.y } : undefined}
                  autoPlay playsInline muted
                  onPlaying={() => setLocalReady(true)}
                  onPointerDown={!localExpanded ? onPipDown : undefined}
                  onPointerMove={!localExpanded ? onPipMove : undefined}
                  onPointerUp={!localExpanded ? onPipUp : undefined}
                  onClick={localExpanded ? (minimized ? restore : toggleControls) : undefined}
                />
                {!localExpanded && !localReady && !camOff && (
                  <div className="call-cam-loading" style={{ left: pipPos.x, top: pipPos.y }}>
                    <span className="call-spinner" />
                    <span className="call-cam-label">Starting camera…</span>
                  </div>
                )}
              </>
            )}
            <audio ref={remoteAudio} autoPlay />

            {isVideo && <div className="call-scrim top" />}
            {isVideo && <div className="call-scrim bottom" />}

            {minimized ? (
              <motion.button className="call-restore" onClick={restore} title="Return to call"
                initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                <span className="call-restore-dot" />
                {phase === 'active' ? fmt(duration) : (statusText || 'On call')}
              </motion.button>
            ) : (
              <>
                {showTopbar && (
                  <div className="call-topbar">
                    <button className="call-icon-btn" onClick={minimize} aria-label="Minimize" title="Minimize">
                      <MinimizeIcon size={26} />
                    </button>
                    <div className="call-topinfo">
                      <div className="call-name sm">{peerName}</div>
                      <div className="call-substatus"><LockIcon size={12} /> {fmt(duration)} · Encrypted</div>
                    </div>
                    <NetBars q={netQuality} />
                  </div>
                )}

                <AnimatePresence>
                  {showStage && (
                    <motion.div className="call-info" key="stage"
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
                      <div className={`call-avatar ${ringing ? 'ringing' : ''}`}>
                        {peerName[0]?.toUpperCase() || '☎'}
                      </div>
                      <div className="call-name">{peerName}</div>
                      <div className="call-status">
                        {statusText}
                        {(phase === 'outgoing' || phase === 'connecting') && <span className="call-dots"><i /><i /><i /></span>}
                      </div>
                      {!isVideo && phase === 'active' && <NetBars q={netQuality} light />}
                      {phase !== 'ended' && (
                        <div className="call-encrypted"><LockIcon size={13} /> End-to-end encrypted</div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="call-controls">
                  {phase === 'incoming' ? (
                    <>
                      <div className="call-btn-wrap">
                        <button className="call-btn end" onClick={decline} aria-label="Decline" title="Decline"><EndCallIcon size={30} /></button>
                        <span className="call-btn-label">Decline</span>
                      </div>
                      <div className="call-btn-wrap">
                        <button className="call-btn accept" onClick={accept} aria-label="Accept" title="Accept">{isVideo ? <VideoIcon size={28} /> : <PhoneIcon size={28} />}</button>
                        <span className="call-btn-label">Accept</span>
                      </div>
                    </>
                  ) : phase === 'ended' ? null : (
                    <>
                      <button className={`call-btn ${muted ? 'active' : ''}`} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>{muted ? <MicOffIcon size={26} /> : <MicIcon size={26} />}</button>
                      <button className={`call-btn ${speakerOn ? 'active' : ''}`} onClick={toggleSpeaker} aria-label="Speaker" title="Speaker">{speakerOn ? <SpeakerIcon size={26} /> : <SpeakerOffIcon size={26} />}</button>
                      {isVideo && <button className={`call-btn ${camOff ? 'active' : ''}`} onClick={toggleCam} aria-label={camOff ? 'Turn camera on' : 'Turn camera off'} title={camOff ? 'Turn camera on' : 'Turn camera off'}>{camOff ? <VideoOffIcon size={26} /> : <VideoIcon size={26} />}</button>}
                      {isVideo && <button className="call-btn" onClick={switchCamera} aria-label="Switch camera" title="Switch camera"><CameraFlipIcon size={26} /></button>}
                      <button className="call-btn end" onClick={() => endCall(true)} aria-label="Hang up" title="Hang up"><EndCallIcon size={30} /></button>
                    </>
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
