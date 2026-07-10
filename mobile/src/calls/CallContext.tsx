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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RTCView, type MediaStream } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

import { AppState } from 'react-native';
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
  type Call,
  type CallType,
  type Profile,
  type UUID,
} from '../lib/shared';
import { presentCallNotification, clearCallNotification } from '../lib/notifications';
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
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // Background: also raise a high-priority call notification (system default
      // ringtone via the Calls channel) so the user sees it outside the app.
      if (AppState.currentState !== 'active') {
        void presentCallNotification({
          callId: call.id,
          conversationId: call.conversation_id,
          title: peer?.display_name ?? 'Lumixo',
          video: call.type === 'video',
        });
      }

      // Ring timeout: if the call isn't answered/declined within 60s, auto-decline.
      // This catches cases where the subscription misses the caller's hangup update.
      if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = setTimeout(async () => {
        // Check if the call is still in 'ringing' state. If so, it's a missed call.
        let currentCall = null;
        try {
          const { data } = await supabase
            .from('calls')
            .select('status')
            .eq('id', call.id)
            .single();
          currentCall = data;
        } catch {
          // Query failed, continue with null
        }

        if (currentCall?.status === 'ringing') {
          // Still ringing after 60s — mark as missed and stop ringing
          InCallManager.stopRingtone();
          void clearCallNotification(call.id);
          await updateCallStatus(supabase, call.id, 'missed').catch(() => {});
          setIncoming(null);
        }
      }, 60000);
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid, active, incoming]);

  // Watch the incoming call's row so a caller-hangup (status → ended/declined/
  // missed) stops the ring INSTANTLY. subscribeToIncomingCalls above listens to
  // INSERTs only, so without this the receiver keeps ringing (and the system
  // notification stays up) until the user manually declines.
  useEffect(() => {
    const id = incoming?.call.id;
    if (!id) return;

    let alive = true;

    // Subscribe to real-time status updates
    const ch = subscribeToCallStatus(supabase, id, (c) => {
      if (!alive) return;
      if (c.status === 'ended' || c.status === 'declined' || c.status === 'missed') {
        InCallManager.stopRingtone();
        void clearCallNotification(id);
        setIncoming(null);
      }
    });

    // CRITICAL: Also check the call status immediately. If the subscription
    // isn't ready yet and the caller hangs up before we subscribe, we need to
    // detect it. This prevents the "keeps ringing after caller hangs up" bug.
    // We use a short delay to let the subscription establish, then check once.
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
          InCallManager.stopRingtone();
          void clearCallNotification(id);
          setIncoming(null);
        }
      } catch {
        // If the query fails, the subscription should catch the real update anyway
      }
    }, 500);

    return () => {
      alive = false;
      clearTimeout(checkTimer);
      supabase.removeChannel(ch);
    };
  }, [incoming?.call.id]);

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
      // Notify a backgrounded/killed callee via push (best-effort).
      void sendPush(supabase, {
        conversationId,
        kind: 'call',
        title: peer?.display_name ?? 'Lumixo',
        body: type === 'video' ? 'Incoming video call' : 'Incoming voice call',
        data: { callId: call.id, video: String(type === 'video') },
      });
    },
    [uid, active],
  );

  const acceptIncoming = useCallback(async () => {
    if (!incoming) return;
    if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    InCallManager.stopRingtone();
    void clearCallNotification(incoming.call.id);
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
    if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    InCallManager.stopRingtone();
    void clearCallNotification(incoming.call.id);
    await updateCallStatus(supabase, incoming.call.id, 'declined');
    setIncoming(null);
  }, [incoming]);

  const endActive = useCallback(async () => {
    if (!active) return;
    const conv = active.conversationId;
    await updateCallStatus(supabase, active.callId, 'ended');
    setActive(null);
    // Live streak signal (fire-and-forget). The server checks the real call's
    // connected duration (>15s, answered) itself — a short/unanswered call simply
    // won't qualify. Never sets a score; the daily job is authoritative.
    recordStreakActivity(supabase, conv).catch(() => {});
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
      <Text style={styles.peerName}>{peer?.display_name ?? 'Lumixo user'}</Text>
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
  // Signal-strength quality 1–4 (4 = excellent), mirrors web getStats polling.
  const [netQuality, setNetQuality] = useState(4);
  // WhatsApp-style minimize: shrink the call to a draggable floating bubble so the
  // user can navigate the app mid-call (web CallContext minimize-to-bubble parity).
  const [minimized, setMinimized] = useState(false);

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

  // Network-quality indicator — polls getStats read-only (never touches the PC),
  // deriving a 1–4 score from packet loss + round-trip time. Same thresholds as
  // web CallContext so the bars mean the same thing on both platforms.
  useEffect(() => {
    if (!connected) {
      setNetQuality(4);
      return;
    }
    let prevLost = 0;
    let prevRecv = 0;
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
      const dLost = Math.max(0, lost - prevLost);
      const dRecv = Math.max(0, recv - prevRecv);
      prevLost = lost;
      prevRecv = recv;
      const loss = dRecv + dLost > 0 ? dLost / (dRecv + dLost) : 0;
      let q = 4;
      if (loss > 0.08 || rtt > 0.5) q = 1;
      else if (loss > 0.04 || rtt > 0.3) q = 2;
      else if (loss > 0.015 || rtt > 0.15) q = 3;
      setNetQuality(q);
    }, 2000);
    return () => clearInterval(id);
  }, [connected]);

  const showVideo = call.type === 'video';
  const timer = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;
  const status = connected ? timer : call.isCaller ? 'Ringing…' : 'Connecting…';

  // Draggable minimized bubble position. Sizes differ for video (small window) vs
  // audio (wide pill); the bubble starts pinned to the top-right like WhatsApp.
  const screen = Dimensions.get('window');
  const bubbleW = showVideo ? 124 : 230;
  const bubbleH = showVideo ? 172 : 60;
  const pan = useRef(new Animated.ValueXY({ x: screen.width - bubbleW - 14, y: 0 })).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        pan.setOffset({ x: (pan.x as any)._value, y: (pan.y as any)._value });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
        const cx = Math.max(8, Math.min((pan.x as any)._value, screen.width - bubbleW - 8));
        const cy = Math.max(0, Math.min((pan.y as any)._value, screen.height - bubbleH - 140));
        Animated.spring(pan, { toValue: { x: cx, y: cy }, useNativeDriver: false, friction: 7 }).start();
      },
    }),
  ).current;

  // Minimized floating bubble — a compact, draggable window onto the call. It is
  // NOT an absoluteFill, so touches outside it pass through to the app beneath,
  // which is exactly what lets the user keep using Lumixo during a call.
  if (minimized) {
    return (
      <Animated.View
        style={[styles.bubbleBase, { top: insets.top + 8 }, pan.getLayout()]}
        {...panResponder.panHandlers}
      >
        {showVideo ? (
          <Pressable style={styles.bubbleVideo} onPress={() => setMinimized(false)}>
            {remoteStream ? (
              <RTCView streamURL={remoteStream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" />
            ) : (
              <View style={styles.bubbleVideoPlaceholder}>
                <Avatar uri={call.peer?.avatar_url} name={call.peer?.display_name} size={44} />
              </View>
            )}
            <View style={styles.bubbleOverlayBar}>
              {connected && <NetBars q={netQuality} size={3} />}
              <Text style={styles.bubbleTimer} numberOfLines={1}>{connected ? timer : '…'}</Text>
              <Pressable hitSlop={8} onPress={() => sessionRef.current!.end(true)} style={styles.bubbleHangup}>
                <Ionicons name="call" size={14} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
              </Pressable>
            </View>
          </Pressable>
        ) : (
          <Pressable style={styles.bubblePill} onPress={() => setMinimized(false)}>
            <Avatar uri={call.peer?.avatar_url} name={call.peer?.display_name} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bubblePeer} numberOfLines={1}>{call.peer?.display_name ?? 'Call'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {connected && <NetBars q={netQuality} size={3} />}
                <Text style={styles.bubbleTimer} numberOfLines={1}>{connected ? timer : status}</Text>
              </View>
            </View>
            <Pressable hitSlop={8} onPress={() => sessionRef.current!.end(true)} style={styles.bubbleHangup}>
              <Ionicons name="call" size={16} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            </Pressable>
          </Pressable>
        )}
      </Animated.View>
    );
  }

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

      {/* Minimize (left) · network-quality bars (right) */}
      <Pressable style={[styles.minimizeBtn, { top: insets.top + 12 }]} hitSlop={10} onPress={() => setMinimized(true)}>
        <Ionicons name="chevron-down" size={26} color="#fff" />
      </Pressable>
      <View style={[styles.netTop, { top: insets.top + 16 }]}>
        {connected && <NetBars q={netQuality} size={4} />}
      </View>

      <View style={[styles.callHeader, { top: insets.top + 16 }]}>
        <Text style={styles.callPeer}>{call.peer?.display_name ?? 'Lumixo user'}</Text>
        <Text style={styles.callStatus}>{status}</Text>
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
