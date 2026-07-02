// FUTUREHAT mobile — call orchestration. Exposes startCall() to the app, listens
// for incoming calls, and renders the incoming-ring + in-call overlays at root.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RTCView, type MediaStream } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

import { supabase } from '../lib/supabase';
import {
  getCurrentUser,
  getProfile,
  createCall,
  updateCallStatus,
  subscribeToIncomingCalls,
  subscribeToCallStatus,
  onAuthChange,
  type Call,
  type CallType,
  type Profile,
  type UUID,
} from '../lib/shared';
import { CallSession } from './webrtc';
import Avatar from '../components/Avatar';
import { useColors } from '../theme';
import { formatTime } from '../lib/time';

interface ActiveCall {
  callId: UUID;
  conversationId: UUID;
  peer: Profile | null;
  type: CallType;
  isCaller: boolean;
}

interface CallContextValue {
  startCall: (conversationId: UUID, peer: Profile, type: CallType) => Promise<void>;
}

const Ctx = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<{ call: Call; peer: Profile | null } | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);

  // Keep our user id in sync with auth. Fetching once on mount is not enough:
  // on a cold start the session is restored from storage *after* this provider
  // mounts, so a one-shot read can latch null forever and silently break calls
  // ("tap does nothing"). Subscribe to auth changes so uid is always correct.
  useEffect(() => {
    let alive = true;
    getCurrentUser(supabase).then((u) => { if (alive) setUid(u?.id ?? null); });
    const { unsubscribe } = onAuthChange(supabase, (_e, session) => {
      if (alive) setUid(session?.user?.id ?? null);
    });
    return () => { alive = false; unsubscribe(); };
  }, []);

  // Listen for incoming calls addressed to my conversations.
  useEffect(() => {
    if (!uid) return;
    const channel = subscribeToIncomingCalls(supabase, async (call) => {
      if (call.caller_id === uid || call.status !== 'ringing') return;
      if (active || incoming) {
        // Busy — auto-decline so the second caller stops ringing instead of
        // timing out (web parity: CallContext busy branch).
        await updateCallStatus(supabase, call.id, 'declined').catch(() => {});
        return;
      }
      const peer = await getProfile(supabase, call.caller_id);
      setIncoming({ call, peer });
      (InCallManager as any).startRingtone('_DEFAULT_');
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid, active, incoming]);

  const startCall = useCallback(
    async (conversationId: UUID, peer: Profile, type: CallType) => {
      if (active) return;
      // Resolve our id on demand if the auth subscription hasn't latched yet,
      // so the very first call right after login still works.
      const me = uid ?? (await getCurrentUser(supabase))?.id ?? null;
      if (!me) return;
      if (!uid) setUid(me); // unblock the in-call render gate ({active && uid})
      const { call, error } = await createCall(supabase, conversationId, me, type);
      if (!call) {
        console.warn('[call] createCall failed:', error?.message);
        return;
      }
      setActive({ callId: call.id, conversationId, peer, type, isCaller: true });
    },
    [uid, active],
  );

  const acceptIncoming = useCallback(async () => {
    if (!incoming) return;
    InCallManager.stopRingtone();
    await updateCallStatus(supabase, incoming.call.id, 'accepted');
    setActive({
      callId: incoming.call.id,
      conversationId: incoming.call.conversation_id,
      peer: incoming.peer,
      type: incoming.call.type,
      isCaller: false,
    });
    setIncoming(null);
  }, [incoming]);

  const declineIncoming = useCallback(async () => {
    if (!incoming) return;
    InCallManager.stopRingtone();
    await updateCallStatus(supabase, incoming.call.id, 'declined');
    setIncoming(null);
  }, [incoming]);

  const endActive = useCallback(async () => {
    if (!active) return;
    await updateCallStatus(supabase, active.callId, 'ended');
    setActive(null);
  }, [active]);

  return (
    <Ctx.Provider value={{ startCall }}>
      {children}
      {incoming && !active && (
        <IncomingCallView
          peer={incoming.peer}
          type={incoming.call.type}
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}
      {active && uid && (
        <ActiveCallView key={active.callId} self={uid} call={active} onHangup={endActive} />
      )}
    </Ctx.Provider>
  );
}

export function useCalls(): CallContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCalls must be used within CallProvider');
  return ctx;
}

// ── Incoming ring UI ─────────────────────────────────────────────────────────
function IncomingCallView({
  peer,
  type,
  onAccept,
  onDecline,
}: {
  peer: Profile | null;
  type: CallType;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.ringContainer]}>
      <Text style={styles.incomingLabel}>Incoming {type} call</Text>
      <Avatar uri={peer?.avatar_url} name={peer?.display_name} size={120} />
      <Text style={styles.peerName}>{peer?.display_name ?? 'FUTUREHAT user'}</Text>
      <View style={styles.ringActions}>
        <CircleButton icon="call" color="#2BD167" label="Accept" onPress={onAccept} />
        <CircleButton icon="close" color="#F15C6D" label="Decline" onPress={onDecline} />
      </View>
    </View>
  );
}

// ── In-call UI ───────────────────────────────────────────────────────────────
function ActiveCallView({
  self,
  call,
  onHangup,
}: {
  self: UUID;
  call: ActiveCall;
  onHangup: () => void;
}) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const sessionRef = useRef<CallSession | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoOn, setVideoOn] = useState(call.type === 'video');
  const [speaker, setSpeaker] = useState(call.type === 'video');
  const [elapsed, setElapsed] = useState(0);

  // Build + start the WebRTC session.
  useEffect(() => {
    const session = new CallSession(call.callId, self, call.isCaller, call.type, {
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onConnected: () => setConnected(true),
      onEnded: () => onHangup(),
    });
    sessionRef.current = session;
    // If start() rejects (e.g. mic/camera permission denied, or the native WebRTC
    // module failing to init) tear the call down cleanly instead of leaving the
    // call view stuck on "connecting". Log the reason so it's diagnosable.
    session.start().catch((e) => {
      console.log('[call] start() FAILED:', e?.message ?? String(e));
      session.end(false);
    });

    // Watch for the far end declining / ending.
    const statusCh = subscribeToCallStatus(supabase, call.callId, (c) => {
      if (c.status === 'ended' || c.status === 'declined' || c.status === 'missed') {
        session.end(false);
      }
    });

    return () => {
      supabase.removeChannel(statusCh);
      session.end(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Call timer.
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);

  const showVideo = call.type === 'video';
  const timer = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;

  return (
    <View style={[StyleSheet.absoluteFill, styles.callContainer]}>
      {showVideo && remoteStream ? (
        <RTCView streamURL={remoteStream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" />
      ) : (
        <View style={styles.audioBg}>
          <Avatar uri={call.peer?.avatar_url} name={call.peer?.display_name} size={140} />
        </View>
      )}

      {showVideo && localStream && videoOn && (
        <RTCView streamURL={localStream.toURL()} style={[styles.pip, { top: insets.top + 12 }]} objectFit="cover" zOrder={1} />
      )}

      <View style={[styles.callHeader, { top: insets.top + 16 }]}>
        <Text style={styles.callPeer}>{call.peer?.display_name ?? 'FUTUREHAT user'}</Text>
        <Text style={styles.callStatus}>
          {connected ? timer : call.isCaller ? 'Ringing…' : 'Connecting…'}
        </Text>
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + 24 }]}>
        <RoundCtl icon={muted ? 'mic-off' : 'mic'} active={muted} onPress={() => setMuted(sessionRef.current!.toggleMute())} />
        <RoundCtl icon={speaker ? 'volume-high' : 'volume-low'} active={speaker} onPress={() => setSpeaker(sessionRef.current!.toggleSpeaker())} />
        {showVideo && (
          <>
            <RoundCtl icon={videoOn ? 'videocam' : 'videocam-off'} active={!videoOn} onPress={() => setVideoOn(sessionRef.current!.toggleVideo())} />
            <RoundCtl icon="camera-reverse" onPress={() => sessionRef.current!.switchCamera()} />
          </>
        )}
        <Pressable style={styles.hangup} onPress={() => sessionRef.current!.end(true)}>
          <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
        </Pressable>
      </View>

      {!connected && !remoteStream && (
        <ActivityIndicator color="#fff" style={{ position: 'absolute', alignSelf: 'center', bottom: 160 }} />
      )}
    </View>
  );
}

function CircleButton({ icon, color, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; color: string; label: string; onPress: () => void }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable style={[styles.circle, { backgroundColor: color }]} onPress={onPress}>
        <Ionicons name={icon} size={32} color="#fff" />
      </Pressable>
      <Text style={styles.circleLabel}>{label}</Text>
    </View>
  );
}

function RoundCtl({ icon, active, onPress }: { icon: keyof typeof Ionicons.glyphMap; active?: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.ctl, active && styles.ctlActive]} onPress={onPress}>
      <Ionicons name={icon} size={26} color={active ? '#000' : '#fff'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ringContainer: { backgroundColor: '#0B141A', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  incomingLabel: { color: '#8696A0', fontSize: 15, marginBottom: 24 },
  peerName: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 20 },
  ringActions: { flexDirection: 'row', gap: 60, marginTop: 80 },
  circle: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center' },
  circleLabel: { color: '#fff', marginTop: 8, fontSize: 13 },
  callContainer: { backgroundColor: '#0B141A', zIndex: 100 },
  audioBg: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B141A' },
  pip: { position: 'absolute', right: 12, width: 110, height: 160, borderRadius: 12, backgroundColor: '#000' },
  callHeader: { position: 'absolute', alignSelf: 'center', alignItems: 'center' },
  callPeer: { color: '#fff', fontSize: 22, fontWeight: '700' },
  callStatus: { color: '#cfd9d6', fontSize: 14, marginTop: 4 },
  controls: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18 },
  ctl: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ctlActive: { backgroundColor: '#fff' },
  hangup: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#F15C6D', alignItems: 'center', justifyContent: 'center' },
});
