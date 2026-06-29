// FUTUREHAT web — voice/video calling over WebRTC. Shares the calls data layer
// and signaling channel with mobile (@shared/callsApi). Renders a call overlay
// (incoming / outgoing / in-call) and exposes startCall() via context.
//
// Handshake ordering avoids the broadcast race: the callee opens its media +
// signaling channel and only THEN marks the call 'accepted'; the caller waits to
// see 'accepted' before creating and sending its SDP offer, so the callee is
// always subscribed in time to receive it. ICE candidates trickle both ways.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import {
  createCall, updateCallStatus, subscribeToIncomingCalls, subscribeToCallStatus,
  createSignalingChannel, DEFAULT_ICE_SERVERS, type SignalingChannel,
} from '@shared/callsApi';
import { getProfile } from '@shared/api';
import type { Call, CallType } from '@shared/types';
import './CallContext.css';

type Phase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

interface CallCtx {
  startCall: (conversationId: string, type: CallType, peerName: string) => void;
  busy: boolean;
}
const Ctx = createContext<CallCtx>({ startCall: () => {}, busy: false });
export const useCall = () => useContext(Ctx);

export function CallProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const myId = profile?.id;

  const [phase, setPhase] = useState<Phase>('idle');
  const [callType, setCallType] = useState<CallType>('audio');
  const [peerName, setPeerName] = useState('');
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [duration, setDuration] = useState(0);

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

  // ── teardown ──────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (durationTimer.current) { clearInterval(durationTimer.current); durationTimer.current = null; }
    try { signaling.current?.send({ kind: 'bye', from: myId! }); } catch {}
    signaling.current?.close(); signaling.current = null;
    if (statusChannel.current) { supabase.removeChannel(statusChannel.current); statusChannel.current = null; }
    pc.current?.getSenders().forEach((s) => s.track?.stop());
    pc.current?.close(); pc.current = null;
    localStream.current?.getTracks().forEach((t) => t.stop()); localStream.current = null;
    call.current = null; isCaller.current = false;
    setMuted(false); setCamOff(false); setDuration(0);
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
      if (remoteVideo.current) remoteVideo.current.srcObject = remote;
      if (remoteAudio.current) remoteAudio.current.srcObject = remote;
    };
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === 'connected') startActive();
      if (conn.connectionState === 'failed' || conn.connectionState === 'disconnected') endCall(false);
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
    if (!incoming || !myId) return;
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

  useEffect(() => () => cleanup(), [cleanup]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const showOverlay = phase !== 'idle';
  const isVideo = callType === 'video';

  return (
    <Ctx.Provider value={{ startCall, busy: phase !== 'idle' }}>
      {children}
      <AnimatePresence>
        {showOverlay && (
          <motion.div className={`call-overlay ${isVideo ? 'video' : 'audio'}`}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {isVideo && (
              <>
                <video ref={remoteVideo} className="call-remote-video" autoPlay playsInline />
                <video ref={localVideo} className="call-local-video" autoPlay playsInline muted />
              </>
            )}
            <audio ref={remoteAudio} autoPlay />

            <div className="call-info">
              <div className="call-avatar">{peerName[0]?.toUpperCase() || '☎'}</div>
              <div className="call-name">{peerName}</div>
              <div className="call-status">
                {phase === 'incoming' && `Incoming ${callType} call…`}
                {phase === 'outgoing' && 'Calling…'}
                {phase === 'connecting' && 'Connecting…'}
                {phase === 'active' && fmt(duration)}
                {phase === 'ended' && 'Call ended'}
              </div>
            </div>

            <div className="call-controls">
              {phase === 'incoming' ? (
                <>
                  <button className="call-btn decline" onClick={decline} title="Decline">✕</button>
                  <button className="call-btn accept" onClick={accept} title="Accept">📞</button>
                </>
              ) : phase === 'ended' ? null : (
                <>
                  <button className={`call-btn ${muted ? 'on' : ''}`} onClick={toggleMute} title="Mute">{muted ? '🔇' : '🎙️'}</button>
                  {isVideo && <button className={`call-btn ${camOff ? 'on' : ''}`} onClick={toggleCam} title="Camera">{camOff ? '📷' : '🎥'}</button>}
                  <button className="call-btn decline" onClick={() => endCall(true)} title="Hang up">✕</button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
