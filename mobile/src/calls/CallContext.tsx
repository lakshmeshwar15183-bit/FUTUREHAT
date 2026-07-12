// Lumixo mobile — call orchestration. Exposes startCall() to the app, listens
// for incoming calls, and renders the incoming-ring + in-call overlays at root.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RTCView, type MediaStream } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import * as Haptics from 'expo-haptics';

import { supabase } from '../lib/supabase';
import {
  getCurrentUser,
  getProfile,
  createCall,
  updateCallStatus,
  subscribeToIncomingCalls,
  subscribeToCallStatus,
  onAuthChange,
  sendPush,
  recordStreakActivity,
  buildIceServers,
  hasTurn,
  type Call,
  type CallType,
  type Profile,
  type UUID,
} from '../lib/shared';
import {
  presentCallNotification,
  clearCallNotification,
  presentMissedCallNotification,
  presentOngoingCallNotification,
  clearOngoingCallNotification,
} from '../lib/notifications';
import { CallSession, type ConnectionPath } from './webrtc';
import Avatar from '../components/Avatar';
import { Alert, showConfirm } from '../ui/dialog';

interface ActiveCall {
  callId: UUID;
  conversationId: UUID;
  peer: Profile | null;
  type: CallType;
  isCaller: boolean;
}

interface CallContextValue {
  startCall: (conversationId: UUID, peer: Profile, type: CallType) => Promise<void>;
  /** Accept from notification action / cold start (starts WebRTC as callee). */
  acceptCallById: (callId: UUID) => Promise<void>;
  /** Decline from notification action. */
  declineCallById: (callId: UUID) => Promise<void>;
}

const Ctx = createContext<CallContextValue | null>(null);

/** Central tone killer — call from every transition (answer/decline/end/timeout). */
function stopAllCallTones() {
  try { InCallManager.stopRingback?.(); } catch { /* noop */ }
  try { InCallManager.stopRingtone?.(); } catch { /* noop */ }
  try { (InCallManager as any).stopBusytone?.(); } catch { /* noop */ }
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<{ call: Call; peer: Profile | null } | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs avoid re-subscribing the INSERT channel on every active/incoming change
  // (that race was causing missed hangups + stuck ring).
  const activeRef = useRef<ActiveCall | null>(null);
  const incomingRef = useRef<{ call: Call; peer: Profile | null } | null>(null);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { incomingRef.current = incoming; }, [incoming]);

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

  // Listen for incoming calls (stable subscription — do NOT depend on active/incoming).
  useEffect(() => {
    if (!uid) return;
    const channel = subscribeToIncomingCalls(supabase, async (call) => {
      if (call.caller_id === uid || call.status !== 'ringing') return;
      if (activeRef.current || incomingRef.current) {
        // Busy — decline so caller gets a terminal state (no stuck "Ringing…").
        await updateCallStatus(supabase, call.id, 'declined').catch(() => {});
        return;
      }
      const peer = await getProfile(supabase, call.caller_id);
      if (activeRef.current || incomingRef.current) {
        await updateCallStatus(supabase, call.id, 'declined').catch(() => {});
        return;
      }
      setIncoming({ call, peer });
      stopAllCallTones();
      if (AppState.currentState === 'active') {
        try {
          (InCallManager as any).startRingtone('_DEFAULT_');
        } catch { /* noop */ }
      }
      // Foreground only — NotificationsBridge owns background tray (avoids double ring notif).
      if (AppState.currentState === 'active') {
        void presentCallNotification({
          callId: call.id,
          conversationId: call.conversation_id,
          title: peer?.display_name ?? 'Lumixo',
          video: call.type === 'video',
          avatarUrl: peer?.avatar_url ?? undefined,
        });
      }

      if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = setTimeout(async () => {
        let currentCall: { status?: string } | null = null;
        try {
          const { data } = await supabase
            .from('calls')
            .select('status')
            .eq('id', call.id)
            .single();
          currentCall = data;
        } catch { /* continue */ }

        if (currentCall?.status === 'ringing') {
          stopAllCallTones();
          void clearCallNotification(call.id);
          await updateCallStatus(supabase, call.id, 'missed').catch(() => {});
          void presentMissedCallNotification({
            callId: call.id,
            conversationId: call.conversation_id,
            title: peer?.display_name ?? 'Someone',
            isVideo: call.type === 'video',
          });
          setIncoming((cur) => (cur?.call.id === call.id ? null : cur));
        }
      }, 60_000);
    });
    return () => {
      supabase.removeChannel(channel);
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
    };
  }, [uid]);

  // Watch the incoming call's row so a caller-hangup (status → ended/declined/
  // missed) stops the ring INSTANTLY. subscribeToIncomingCalls above listens to
  // INSERTs only, so without this the receiver keeps ringing (and the system
  // notification stays up) until the user manually declines.
  useEffect(() => {
    const id = incoming?.call.id;
    if (!id) return;

    let alive = true;

    // Subscribe to real-time status updates
    const clearIncomingRing = () => {
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
      stopAllCallTones();
      void clearCallNotification(id);
      setIncoming(null);
    };

    const ch = subscribeToCallStatus(supabase, id, (c) => {
      if (!alive) return;
      if (c.status === 'ended' || c.status === 'declined' || c.status === 'missed' || c.status === 'accepted') {
        // accepted: UI transitions to ActiveCallView via acceptIncoming; status
        // accepted from *remote* while we still show incoming means caller cancelled?
        // Only clear ring UI for terminal states here.
        if (c.status === 'accepted') return;
        clearIncomingRing();
      }
    });

    // Poll once after subscribe attaches — catches hangup that raced the channel.
    const checkTimer = setTimeout(async () => {
      if (!alive) return;
      try {
        const { data: call } = await supabase
          .from('calls')
          .select('status')
          .eq('id', id)
          .single();
        if (!alive || !call) return;
        if (call.status === 'ended' || call.status === 'declined' || call.status === 'missed') {
          clearIncomingRing();
        }
      } catch { /* subscription remains primary */ }
    }, 400);

    return () => {
      alive = false;
      clearTimeout(checkTimer);
      supabase.removeChannel(ch);
    };
  }, [incoming?.call.id]);

  const startCall = useCallback(
    async (conversationId: UUID, peer: Profile, type: CallType) => {
      if (activeRef.current) return;
      // Pre-flight: warn if TURN missing (cross-network will fail) — better than silent hang.
      const ice = buildIceServers(
        process.env.EXPO_PUBLIC_TURN_URL
          ? {
              urls: process.env.EXPO_PUBLIC_TURN_URL,
              username: process.env.EXPO_PUBLIC_TURN_USERNAME,
              credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL,
            }
          : null,
      );
      if (!hasTurn(ice)) {
        const proceed = await showConfirm({
          title: 'Weak call network setup',
          message: 'No TURN relay is configured. Calls may only work on the same Wi‑Fi. Continue anyway?',
          confirmText: 'Call anyway',
          cancelText: 'Cancel',
        });
        if (!proceed) return;
      }
      const me = uid ?? (await getCurrentUser(supabase))?.id ?? null;
      if (!me) return;
      if (!uid) setUid(me);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const { call, error } = await createCall(supabase, conversationId, me, type);
      if (!call) {
        console.warn('[call] createCall failed:', error?.message);
        Alert.alert('Could not start call', error?.message ?? 'Try again.');
        return;
      }
      setActive({ callId: call.id, conversationId, peer, type, isCaller: true });
      const meProfile = await getProfile(supabase, me).catch(() => null);
      void sendPush(supabase, {
        conversationId,
        kind: 'call',
        title: meProfile?.display_name ?? 'Lumixo',
        body: type === 'video' ? 'Incoming video call' : 'Incoming voice call',
        data: {
          callId: call.id,
          video: String(type === 'video'),
          type: 'call',
        },
      });
    },
    [uid],
  );

  const acceptIncoming = useCallback(async () => {
    if (!incoming) return;
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    stopAllCallTones();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    void clearCallNotification(incoming.call.id);
    const snap = incoming;
    setIncoming(null);
    await updateCallStatus(supabase, snap.call.id, 'accepted');
    setActive({
      callId: snap.call.id,
      conversationId: snap.call.conversation_id,
      peer: snap.peer,
      type: snap.call.type,
      isCaller: false,
    });
  }, [incoming]);

  const declineIncoming = useCallback(async () => {
    if (!incoming) return;
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    stopAllCallTones();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    void clearCallNotification(incoming.call.id);
    const id = incoming.call.id;
    setIncoming(null);
    await updateCallStatus(supabase, id, 'declined');
  }, [incoming]);

  /**
   * Accept from tray action. Previously only flipped DB status → caller thought
   * we answered but WebRTC never started (no ActiveCallView). Always promote to
   * active callee session.
   */
  const acceptCallById = useCallback(async (callId: UUID) => {
    if (!callId) return;
    if (activeRef.current?.callId === callId) {
      void clearCallNotification(callId);
      return;
    }
    // Already showing the ring UI for this call — reuse acceptIncoming path.
    const inc = incomingRef.current;
    if (inc?.call.id === callId) {
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
      stopAllCallTones();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      void clearCallNotification(callId);
      setIncoming(null);
      await updateCallStatus(supabase, callId, 'accepted').catch(() => {});
      setActive({
        callId: inc.call.id,
        conversationId: inc.call.conversation_id,
        peer: inc.peer,
        type: inc.call.type,
        isCaller: false,
      });
      return;
    }
    if (activeRef.current) {
      // Busy on another call — decline this one so caller isn't stuck.
      await updateCallStatus(supabase, callId, 'declined').catch(() => {});
      void clearCallNotification(callId);
      return;
    }

    try {
      const { data: row } = await supabase
        .from('calls')
        .select('id, conversation_id, caller_id, type, status')
        .eq('id', callId)
        .maybeSingle();
      if (!row) {
        void clearCallNotification(callId);
        return;
      }
      const call = row as Call;
      if (['ended', 'declined', 'missed'].includes(call.status)) {
        void clearCallNotification(callId);
        return;
      }
      const me = uid ?? (await getCurrentUser(supabase))?.id ?? null;
      if (!me || call.caller_id === me) {
        void clearCallNotification(callId);
        return;
      }
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
      stopAllCallTones();
      void clearCallNotification(callId);
      setIncoming(null);
      if (call.status === 'ringing') {
        await updateCallStatus(supabase, callId, 'accepted').catch(() => {});
      }
      const peer = await getProfile(supabase, call.caller_id).catch(() => null);
      setActive({
        callId: call.id,
        conversationId: call.conversation_id,
        peer,
        type: call.type,
        isCaller: false,
      });
    } catch (e) {
      console.warn('[call] acceptCallById failed', e);
    }
  }, [uid]);

  const declineCallById = useCallback(async (callId: UUID) => {
    if (!callId) return;
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    stopAllCallTones();
    void clearCallNotification(callId);
    if (incomingRef.current?.call.id === callId) {
      setIncoming(null);
    }
    await updateCallStatus(supabase, callId, 'declined').catch(() => {});
  }, []);

  const endActive = useCallback(async (status: 'ended' | 'missed' = 'ended') => {
    const cur = activeRef.current;
    if (!cur) return;
    // Clear first so re-entrant onEnded/cleanup cannot double-end.
    activeRef.current = null;
    setActive(null);
    stopAllCallTones();
    void clearCallNotification(cur.callId);
    void clearOngoingCallNotification(cur.callId);
    await updateCallStatus(supabase, cur.callId, status).catch(() => {});
    // Cancel signal for any device still showing the ring UI.
    void sendPush(supabase, {
      conversationId: cur.conversationId,
      kind: 'system',
      title: 'Call ended',
      body: status,
      data: { callId: cur.callId, type: 'call_status', status },
    });
    recordStreakActivity(supabase, cur.conversationId).catch(() => {});
  }, []);

  return (
    <Ctx.Provider value={{ startCall, acceptCallById, declineCallById }}>
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
        <ActiveCallView
          key={active.callId}
          self={uid}
          call={active}
          onHangup={(st) => {
            void endActive(st ?? 'ended');
          }}
        />
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
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.ringContainer]}>
      <Text style={styles.incomingLabel}>
        Incoming {type === 'video' ? 'video' : 'voice'} call
      </Text>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Avatar uri={peer?.avatar_url} name={peer?.display_name} size={128} />
      </Animated.View>
      <Text style={styles.peerName}>{peer?.display_name ?? 'Lumixo user'}</Text>
      <Text style={styles.incomingHint}>Lumixo · end-to-end media (DTLS/SRTP)</Text>
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
  onHangup: (status?: 'ended' | 'missed') => void | Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const sessionRef = useRef<CallSession | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  // Generation counters force RTCView remount when tracks are added/unmuted
  // (root fix for white/blank remote: SurfaceView must re-bind after first frame).
  const [remoteGen, setRemoteGen] = useState(0);
  const [localGen, setLocalGen] = useState(0);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoOn, setVideoOn] = useState(call.type === 'video');
  const [speaker, setSpeaker] = useState(call.type === 'video');
  const [elapsed, setElapsed] = useState(0);
  const [netQuality, setNetQuality] = useState(4);
  const [minimized, setMinimized] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [connPath, setConnPath] = useState<ConnectionPath>('unknown');
  const [lowData, setLowData] = useState(false);
  const lastTapRef = useRef(0);
  const connectedRef = useRef(false);

  // Build + start the WebRTC session once per call id.
  useEffect(() => {
    let remoteTick = 0;
    let localTick = 0;
    let finished = false;
    const finish = (status: 'ended' | 'missed' = 'ended') => {
      if (finished) return;
      finished = true;
      stopAllCallTones();
      void onHangup(status);
    };

    const session = new CallSession(call.callId, self, call.isCaller, call.type, {
      onLocalStream: (s) => {
        setLocalStream(s);
        localTick += 1;
        setLocalGen(localTick);
      },
      onRemoteStream: (s) => {
        setRemoteStream(s);
        remoteTick += 1;
        setRemoteGen(remoteTick);
      },
      onConnected: () => {
        stopAllCallTones();
        setConnected(true);
        connectedRef.current = true;
        setReconnecting(false);
        if (ringTimer) {
          clearTimeout(ringTimer);
          ringTimer = null;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        void presentOngoingCallNotification({
          callId: call.callId,
          conversationId: call.conversationId,
          title: call.peer?.display_name ?? 'Call',
          video: call.type === 'video',
          connected: true,
        });
      },
      onEnded: () => finish('ended'),
      onFacingChange: (f) => setFacing(f),
      onReconnecting: (r) => setReconnecting(r),
      onConnectionPath: (p) => setConnPath(p),
      onQuality: (q) => setNetQuality(q),
    });
    sessionRef.current = session;
    // Sticky ongoing tray immediately (Connecting…) so user can return to the app.
    void presentOngoingCallNotification({
      callId: call.callId,
      conversationId: call.conversationId,
      title: call.peer?.display_name ?? 'Call',
      video: call.type === 'video',
      connected: false,
    });
    session.start().catch((e) => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[call] start() FAILED:', e?.message ?? String(e));
      }
      session.end(false);
      finish('ended');
    });

    // Caller no-answer timeout (WhatsApp ~45–60s) → missed.
    let ringTimer: ReturnType<typeof setTimeout> | null = null;
    if (call.isCaller) {
      ringTimer = setTimeout(() => {
        if (finished || sessionRef.current !== session || connectedRef.current) return;
        void updateCallStatus(supabase, call.callId, 'missed').catch(() => {});
        session.end(true);
        finish('missed');
      }, 55_000);
    }

    const statusCh = subscribeToCallStatus(supabase, call.callId, (c) => {
      if (c.status === 'ended' || c.status === 'declined' || c.status === 'missed') {
        stopAllCallTones();
        // Busy tone for caller when peer declines (classic telephony UX).
        if (c.status === 'declined' && call.isCaller) {
          try {
            (InCallManager as any).startBusytone?.('_BUSY_');
            setTimeout(() => {
              try { (InCallManager as any).stopBusytone?.(); } catch { /* noop */ }
            }, 1400);
          } catch { /* optional */ }
        }
        session.end(false);
        finish(c.status === 'missed' ? 'missed' : 'ended');
      }
      if (c.status === 'accepted') {
        stopAllCallTones();
        session.stopAllTones();
      }
    });

    return () => {
      if (ringTimer) clearTimeout(ringTimer);
      supabase.removeChannel(statusCh);
      session.end(false);
      if (!finished) {
        finished = true;
        stopAllCallTones();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);

  // Quality also pushed from CallSession.onQuality (adaptive probe). Keep a light
  // fallback poll so bars still move if stats API shape differs.
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(async () => {
      const stats = await sessionRef.current?.getStats();
      if (!stats) return;
      let lost = 0;
      let recv = 0;
      let rtt = 0;
      stats.forEach((report: any) => {
        if (report.type === 'inbound-rtp') {
          lost += Number(report.packetsLost || 0);
          recv += Number(report.packetsReceived || 0);
        }
        if (
          report.type === 'candidate-pair' &&
          report.nominated &&
          typeof report.currentRoundTripTime === 'number'
        ) {
          rtt = report.currentRoundTripTime;
        }
      });
      const loss = recv + lost > 0 ? lost / (recv + lost) : 0;
      let q: 1 | 2 | 3 | 4 = 4;
      if (loss > 0.08 || rtt > 0.5) q = 1;
      else if (loss > 0.04 || rtt > 0.3) q = 2;
      else if (loss > 0.015 || rtt > 0.15) q = 3;
      setNetQuality(q);
    }, 4000);
    return () => clearInterval(id);
  }, [connected]);

  const showVideo = call.type === 'video';
  const timer = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;
  const status = reconnecting
    ? 'Reconnecting…'
    : connected
      ? timer
      : call.isCaller
        ? 'Ringing…'
        : 'Connecting…';

  const pathLabel =
    connPath === 'relay' ? 'Secured via relay' : connPath === 'direct' ? 'Direct connection' : null;

  // Remote has a *live* video track (not just audio) — otherwise RTCView paints white.
  const remoteHasVideo = !!(
    remoteStream &&
    remoteStream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled)
  );
  const localHasVideo = !!(
    localStream &&
    videoOn &&
    localStream.getVideoTracks().some((t) => t.readyState === 'live')
  );
  // WhatsApp: local preview is mirrored only for front camera.
  const localMirror = facing === 'user';

  const remoteUrl = remoteStream ? remoteStream.toURL() : '';
  const localUrl = localStream ? localStream.toURL() : '';
  const remoteTrackKey = remoteStream
    ? remoteStream.getTracks().map((t) => `${t.id}:${t.readyState}`).join('|')
    : '';
  const localTrackKey = localStream
    ? localStream.getTracks().map((t) => `${t.id}:${t.readyState}`).join('|')
    : '';

  // ── Draggable local PiP (WhatsApp-style) ───────────────────────────────────
  const screen = Dimensions.get('window');
  const pipW = 110;
  const pipH = 160;
  const pipPan = useRef(
    new Animated.ValueXY({ x: screen.width - pipW - 14, y: insets.top + 12 }),
  ).current;
  const pipResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        pipPan.setOffset({ x: (pipPan.x as any)._value, y: (pipPan.y as any)._value });
        pipPan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pipPan.x, dy: pipPan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        pipPan.flattenOffset();
        const cx = Math.max(8, Math.min((pipPan.x as any)._value, screen.width - pipW - 8));
        const cy = Math.max(
          insets.top + 8,
          Math.min((pipPan.y as any)._value, screen.height - pipH - 180),
        );
        Animated.spring(pipPan, {
          toValue: { x: cx, y: cy },
          useNativeDriver: false,
          friction: 7,
        }).start();
      },
    }),
  ).current;

  // Double-tap remote (or empty area) to switch camera — WhatsApp parity.
  function onDoubleTapSwitch() {
    if (!showVideo) return;
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      lastTapRef.current = 0;
      void sessionRef.current?.switchCamera();
    } else {
      lastTapRef.current = now;
    }
  }

  // Minimized bubble
  const bubbleW = showVideo ? 124 : 230;
  const bubbleH = showVideo ? 172 : 60;
  const bubblePan = useRef(
    new Animated.ValueXY({ x: screen.width - bubbleW - 14, y: 0 }),
  ).current;
  const bubbleResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        bubblePan.setOffset({
          x: (bubblePan.x as any)._value,
          y: (bubblePan.y as any)._value,
        });
        bubblePan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: bubblePan.x, dy: bubblePan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        bubblePan.flattenOffset();
        const cx = Math.max(8, Math.min((bubblePan.x as any)._value, screen.width - bubbleW - 8));
        const cy = Math.max(0, Math.min((bubblePan.y as any)._value, screen.height - bubbleH - 140));
        Animated.spring(bubblePan, {
          toValue: { x: cx, y: cy },
          useNativeDriver: false,
          friction: 7,
        }).start();
      },
    }),
  ).current;

  if (minimized) {
    return (
      <Animated.View
        style={[styles.bubbleBase, { top: insets.top + 8 }, bubblePan.getLayout()]}
        {...bubbleResponder.panHandlers}
      >
        {showVideo ? (
          <Pressable style={styles.bubbleVideo} onPress={() => setMinimized(false)}>
            {remoteHasVideo && remoteUrl ? (
              <RTCView
                key={`bub-r-${remoteGen}-${remoteTrackKey}`}
                streamURL={remoteUrl}
                style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}
                objectFit="cover"
                mirror={false}
                zOrder={0}
              />
            ) : (
              <View style={styles.bubbleVideoPlaceholder}>
                <Avatar uri={call.peer?.avatar_url} name={call.peer?.display_name} size={44} />
              </View>
            )}
            <View style={styles.bubbleOverlayBar}>
              {connected && <NetBars q={netQuality} size={3} />}
              <Text style={styles.bubbleTimer} numberOfLines={1}>
                {connected ? timer : '…'}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => sessionRef.current!.end(true)}
                style={styles.bubbleHangup}
              >
                <Ionicons
                  name="call"
                  size={14}
                  color="#fff"
                  style={{ transform: [{ rotate: '135deg' }] }}
                />
              </Pressable>
            </View>
          </Pressable>
        ) : (
          <Pressable style={styles.bubblePill} onPress={() => setMinimized(false)}>
            <Avatar uri={call.peer?.avatar_url} name={call.peer?.display_name} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bubblePeer} numberOfLines={1}>
                {call.peer?.display_name ?? 'Call'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {connected && <NetBars q={netQuality} size={3} />}
                <Text style={styles.bubbleTimer} numberOfLines={1}>
                  {connected ? timer : status}
                </Text>
              </View>
            </View>
            <Pressable
              hitSlop={8}
              onPress={() => sessionRef.current!.end(true)}
              style={styles.bubbleHangup}
            >
              <Ionicons
                name="call"
                size={16}
                color="#fff"
                style={{ transform: [{ rotate: '135deg' }] }}
              />
            </Pressable>
          </Pressable>
        )}
      </Animated.View>
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.callContainer]}>
      {/* Full-screen remote — BLACK base (never white). Only mount RTCView when a
          live video track exists; otherwise show avatar (WhatsApp connecting state). */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onDoubleTapSwitch}>
        {showVideo && remoteHasVideo && remoteUrl ? (
          <RTCView
            key={`remote-${remoteGen}-${remoteTrackKey}`}
            streamURL={remoteUrl}
            style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}
            objectFit="cover"
            mirror={false}
            zOrder={0}
          />
        ) : (
          <View style={styles.audioBg}>
            <Avatar uri={call.peer?.avatar_url} name={call.peer?.display_name} size={140} />
            {showVideo && connected && !remoteHasVideo && (
              <Text style={styles.waitingVideo}>Waiting for video…</Text>
            )}
          </View>
        )}
      </Pressable>

      {/* Local PiP — mirrored for front camera only; draggable; rounded. */}
      {showVideo && localHasVideo && localUrl && (
        <Animated.View
          style={[styles.pipWrap, pipPan.getLayout()]}
          {...pipResponder.panHandlers}
        >
          <Pressable
            onPress={() => {
              // Single tap on PiP also switches camera (quick toggle).
              void sessionRef.current?.switchCamera();
            }}
            style={styles.pipInner}
          >
            <RTCView
              key={`local-${localGen}-${localTrackKey}-${facing}`}
              streamURL={localUrl}
              style={styles.pipVideo}
              objectFit="cover"
              mirror={localMirror}
              zOrder={1}
            />
          </Pressable>
        </Animated.View>
      )}

      <Pressable
        style={[styles.minimizeBtn, { top: insets.top + 12 }]}
        hitSlop={10}
        onPress={() => setMinimized(true)}
      >
        <Ionicons name="chevron-down" size={26} color="#fff" />
      </Pressable>
      <View style={[styles.netTop, { top: insets.top + 16 }]}>
        {connected && <NetBars q={netQuality} size={4} />}
      </View>

      <View style={[styles.callHeader, { top: insets.top + 16 }]} pointerEvents="none">
        <Text style={styles.callPeer}>{call.peer?.display_name ?? 'Lumixo user'}</Text>
        <Text style={styles.callStatus}>{status}</Text>
        {!!pathLabel && connected && !reconnecting && (
          <Text style={styles.pathLabel}>{pathLabel}</Text>
        )}
      </View>

      {/* Banners WhatsApp doesn't show — quality transparency. */}
      {reconnecting && (
        <View style={styles.bannerWarn}>
          <ActivityIndicator color="#fff" size="small" />
          <Text style={styles.bannerText}>Reconnecting — keep the call open</Text>
        </View>
      )}
      {!reconnecting && connected && netQuality <= 2 && (
        <View style={[styles.bannerWarn, netQuality <= 1 && styles.bannerDanger]}>
          <Ionicons name="cellular-outline" size={14} color="#fff" />
          <Text style={styles.bannerText}>
            {netQuality <= 1 ? 'Poor connection' : 'Weak connection'}
            {lowData ? ' · Data saver on' : ' · try Data saver'}
          </Text>
        </View>
      )}

      <View style={[styles.controls, { paddingBottom: insets.bottom + 24 }]}>
        <RoundCtl
          icon={muted ? 'mic-off' : 'mic'}
          active={muted}
          onPress={() => setMuted(sessionRef.current!.toggleMute())}
        />
        <RoundCtl
          icon={speaker ? 'volume-high' : 'volume-low'}
          active={speaker}
          onPress={() => setSpeaker(sessionRef.current!.toggleSpeaker())}
        />
        {showVideo && (
          <>
            <RoundCtl
              icon={videoOn ? 'videocam' : 'videocam-off'}
              active={!videoOn}
              onPress={() => setVideoOn(sessionRef.current!.toggleVideo())}
            />
            <RoundCtl
              icon="camera-reverse"
              onPress={() => {
                void sessionRef.current?.switchCamera();
              }}
            />
            <RoundCtl
              icon="speedometer-outline"
              active={lowData}
              onPress={() => {
                const next = sessionRef.current!.setLowDataMode(!lowData);
                setLowData(next);
                Haptics.selectionAsync().catch(() => {});
              }}
            />
          </>
        )}
        <Pressable
          style={styles.hangup}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
            sessionRef.current!.end(true);
          }}
        >
          <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
        </Pressable>
      </View>

      {(!connected || reconnecting) && (
        <ActivityIndicator
          color="#fff"
          style={{ position: 'absolute', alignSelf: 'center', bottom: 160 }}
        />
      )}
    </View>
  );
}

// Signal-strength network indicator (1–4 bars), mirrors web NetBars. Green when
// good, amber when weak, red when poor; inactive bars are dim.
function NetBars({ q, size = 4 }: { q: number; size?: number }) {
  const color = q <= 1 ? '#F15C6D' : q === 2 ? '#F5B942' : '#2BD167';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
      {[1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={{
            width: size,
            height: size * (i + 1),
            borderRadius: 1,
            backgroundColor: i <= q ? color : 'rgba(255,255,255,0.3)',
          }}
        />
      ))}
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
  incomingLabel: { color: '#8696A0', fontSize: 15, marginBottom: 24, letterSpacing: 0.3 },
  incomingHint: { color: 'rgba(134,150,160,0.75)', fontSize: 12, marginTop: 8 },
  peerName: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 20 },
  ringActions: { flexDirection: 'row', gap: 60, marginTop: 80 },
  circle: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center' },
  circleLabel: { color: '#fff', marginTop: 8, fontSize: 13 },
  callContainer: { backgroundColor: '#000', zIndex: 100 },
  audioBg: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B141A',
  },
  waitingVideo: { color: 'rgba(255,255,255,0.65)', marginTop: 14, fontSize: 14 },
  // Draggable local preview — black base so SurfaceView never flashes white.
  pipWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 110,
    height: 160,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#000',
    zIndex: 20,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  pipInner: { flex: 1, backgroundColor: '#000' },
  pipVideo: { width: '100%', height: '100%', backgroundColor: '#000' },
  callHeader: { position: 'absolute', alignSelf: 'center', alignItems: 'center' },
  callPeer: { color: '#fff', fontSize: 22, fontWeight: '700' },
  callStatus: { color: '#cfd9d6', fontSize: 14, marginTop: 4 },
  pathLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 4, fontWeight: '600' },
  bannerWarn: {
    position: 'absolute',
    top: '22%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 185, 66, 0.92)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 30,
    maxWidth: '88%',
  },
  bannerDanger: { backgroundColor: 'rgba(241, 92, 109, 0.94)' },
  bannerText: { color: '#fff', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  minimizeBtn: { position: 'absolute', left: 16, zIndex: 10 },
  netTop: { position: 'absolute', right: 20, alignItems: 'flex-end', zIndex: 10 },
  bubbleBase: { position: 'absolute', left: 0, borderRadius: 16, overflow: 'hidden', backgroundColor: '#0B141A', zIndex: 300, elevation: 12, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  bubbleVideo: { width: 124, height: 172 },
  bubbleVideoPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B141A' },
  bubbleOverlayBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.45)' },
  bubblePill: { width: 230, height: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 },
  bubblePeer: { color: '#fff', fontSize: 13, fontWeight: '700' },
  bubbleTimer: { color: '#cfd9d6', fontSize: 12, flex: 1 },
  bubbleHangup: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F15C6D', alignItems: 'center', justifyContent: 'center' },
  controls: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18 },
  ctl: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ctlActive: { backgroundColor: '#fff' },
  hangup: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#F15C6D', alignItems: 'center', justifyContent: 'center' },
});
