// Lumixo mobile — full-screen Status viewer (WhatsApp-grade).
// Auto-advancing progress bars, tap-to-nav, hold-to-pause, swipe-down to dismiss.
// Supports image / text / video / audio, captions, mute toggle, next-media preload,
// reply-as-DM, delete (own), and a live "seen by" list driven by realtime views.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video, Audio, type AVPlaybackStatus } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../../lib/supabase';
import {
  deleteStatus,
  markStatusViewed,
  getStatusViewers,
  getStatusViewCount,
  subscribeStatusViews,
  startDirectConversation,
  sendMessage,
} from '../../lib/shared';
import type { Status, StatusViewer as ViewerRow } from '../../lib/shared';
import { formatLastSeen } from '../../lib/time';
import { useColors, spacing, radius, font, type Palette } from '../../theme';
import Avatar from '../Avatar';
import { type StatusGroup, isVideoStatus, isAudioStatus } from './statusData';
import { Alert } from '../../ui/dialog';

const IMAGE_DURATION = 5000;
const AUDIO_FALLBACK = 15000; // used only until real audio duration is known

export default function StatusViewer({
  group,
  isMine,
  onClose,
  onChanged,
}: {
  group: StatusGroup;
  isMine: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [statuses, setStatuses] = useState<Status[]>(group.statuses);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [viewers, setViewers] = useState<ViewerRow[] | null>(null);
  const [viewCount, setViewCount] = useState(0);
  const [showViewers, setShowViewers] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

  const progress = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const videoRef = useRef<Video>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const dismissY = useRef(new Animated.Value(0)).current;

  const current = statuses[idx];
  const video = current && isVideoStatus(current);
  const audio = current && isAudioStatus(current);

  const goNext = useCallback(() => {
    setIdx((i) => {
      if (i < statuses.length - 1) return i + 1;
      onClose();
      return i;
    });
  }, [statuses.length, onClose]);

  const goPrev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

  // Swipe-down to dismiss the viewer (WhatsApp gesture). Vertical drags translate
  // the whole surface; releasing past a threshold closes, otherwise it springs back.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) dismissY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 120) {
          onClose();
        } else {
          Animated.spring(dismissY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  // Per-slide: reset progress, mark viewed, hide viewers panel, seed view count.
  useEffect(() => {
    if (!current) return;
    progress.setValue(0);
    setShowViewers(false);
    setViewers(null);
    setAudioReady(false);
    markStatusViewed(supabase, current.id, group.userId).then(onChanged).catch(() => {});
    if (isMine) getStatusViewCount(supabase, current.id).then(setViewCount).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Preload the NEXT image so it paints instantly on advance.
  useEffect(() => {
    const nxt = statuses[idx + 1];
    if (nxt && nxt.type === 'image' && nxt.media_url) Image.prefetch(nxt.media_url).catch(() => {});
  }, [idx, statuses]);

  // Live "seen by": subscribe to inserts on this status's views while it's mine.
  useEffect(() => {
    if (!isMine || !current) return;
    const ch = subscribeStatusViews(supabase, current.id, () => {
      getStatusViewCount(supabase, current.id).then(setViewCount).catch(() => {});
      // Refresh the open list too, so names appear live.
      setShowViewers((open) => {
        if (open) getStatusViewers(supabase, current.id).then(setViewers).catch(() => {});
        return open;
      });
    });
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, isMine]);

  // Audio slides: load/unload an expo-av Sound per slide and drive progress by it.
  useEffect(() => {
    if (!current || !audio || !current.media_url) return;
    let alive = true;
    let sound: Audio.Sound | null = null;
    (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const created = await Audio.Sound.createAsync(
          { uri: current.media_url! },
          { shouldPlay: true, isMuted: muted },
          (st: AVPlaybackStatus) => {
            if (!st.isLoaded) return;
            if (st.durationMillis) progress.setValue(st.positionMillis / st.durationMillis);
            if (st.didJustFinish) goNext();
          },
        );
        if (!alive) { created.sound.unloadAsync(); return; }
        sound = created.sound;
        soundRef.current = sound;
        setAudioReady(true);
      } catch {
        // If audio fails to load, fall back to a timed advance so we don't hang.
        if (alive) setAudioReady(false);
      }
    })();
    return () => {
      alive = false;
      sound?.unloadAsync().catch(() => {});
      if (soundRef.current === sound) soundRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, audio]);

  // Pause/resume + mute propagation for audio.
  useEffect(() => {
    const s = soundRef.current;
    if (!s) return;
    s.setIsMutedAsync(muted).catch(() => {});
    (paused ? s.pauseAsync() : s.playAsync()).catch(() => {});
  }, [paused, muted]);

  // Drive the timed progress bar for image/text (video/loaded-audio self-drive).
  useEffect(() => {
    if (!current || video) return;
    if (audio && audioReady) return; // real audio position drives progress
    if (paused) {
      animRef.current?.stop();
      return;
    }
    const total = audio ? AUDIO_FALLBACK : IMAGE_DURATION;
    const remaining = total * (1 - (progress as any).__getValue());
    const anim = Animated.timing(progress, { toValue: 1, duration: remaining, useNativeDriver: false });
    animRef.current = anim;
    anim.start(({ finished }) => { if (finished) goNext(); });
    return () => anim.stop();
  }, [current?.id, paused, video, audio, audioReady, goNext, progress]);

  async function loadViewers() {
    if (viewers) {
      setShowViewers((s) => !s);
      return;
    }
    const v = await getStatusViewers(supabase, current.id);
    setViewers(v);
    setViewCount(v.length);
    setShowViewers(true);
  }

  function onDelete() {
    Alert.alert('Delete status', 'Delete this status update?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteStatus(supabase, current.id);
          onChanged();
          const next = statuses.filter((s) => s.id !== current.id);
          if (!next.length) {
            onClose();
          } else {
            setStatuses(next);
            setIdx((i) => Math.max(0, Math.min(i, next.length - 1)));
          }
        },
      },
    ]);
  }

  async function sendReply() {
    const t = reply.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const { conversationId } = await startDirectConversation(supabase, group.userId);
      if (conversationId) {
        await sendMessage(supabase, conversationId, `↩️ Re: status\n${t}`);
        setReply('');
      }
    } finally {
      setSending(false);
    }
  }

  if (!current) return null;

  const hasSound = video || audio;

  return (
    <Animated.View style={[styles.viewer, { transform: [{ translateY: dismissY }] }]} {...pan.panHandlers}>
      {/* progress bars — top inset for status bar / cutout */}
      <View style={[styles.progressRow, { paddingTop: Math.max(insets.top, 8) + 8 }]}>
        {statuses.map((s, i) => (
          <View key={s.id} style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width:
                    i < idx
                      ? '100%'
                      : i === idx
                      ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                      : '0%',
                },
              ]}
            />
          </View>
        ))}
      </View>

      {/* header */}
      <View style={styles.viewerHeader}>
        <Avatar uri={group.profile?.avatar_url} name={isMine ? 'Me' : group.profile?.display_name} size={36} />
        <View style={styles.viewerHeaderText}>
          <Text style={styles.viewerName}>{isMine ? 'My status' : group.profile?.display_name ?? 'Lumixo user'}</Text>
          <Text style={styles.viewerTime}>{formatLastSeen(current.created_at)}</Text>
        </View>
        {hasSound && (
          <Pressable hitSlop={10} onPress={() => setMuted((m) => !m)} style={styles.headerIcon}>
            <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={22} color="#fff" />
          </Pressable>
        )}
        {isMine && (
          <Pressable hitSlop={10} onPress={onDelete} style={styles.headerIcon}>
            <Ionicons name="trash-outline" size={22} color="#fff" />
          </Pressable>
        )}
        <Pressable hitSlop={10} onPress={onClose} style={styles.headerIcon}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </View>

      {/* content + tap zones */}
      <View style={styles.stage}>
        {video && current.media_url ? (
          <Video
            ref={videoRef}
            source={{ uri: current.media_url }}
            style={styles.media}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={!paused}
            isMuted={muted}
            onPlaybackStatusUpdate={(s: AVPlaybackStatus) => {
              if (!s.isLoaded) return;
              if (s.durationMillis) progress.setValue(s.positionMillis / s.durationMillis);
              if (s.didJustFinish) goNext();
            }}
          />
        ) : audio ? (
          <View style={[styles.audioStage, { backgroundColor: current.background ?? '#5B6EF5' }]}>
            <View style={styles.audioBubble}>
              {audioReady ? (
                <Ionicons name="musical-notes" size={64} color="#fff" />
              ) : (
                <ActivityIndicator color="#fff" size="large" />
              )}
            </View>
            <Text style={styles.audioLabel}>Audio status</Text>
          </View>
        ) : current.type === 'image' && current.media_url ? (
          <Image source={{ uri: current.media_url }} style={styles.media} resizeMode="contain" />
        ) : (
          <View style={[styles.textStatus, { backgroundColor: current.background ?? '#667eea' }]}>
            <Text style={[styles.textStatusText, current.text_color ? { color: current.text_color } : null]}>
              {current.content}
            </Text>
          </View>
        )}

        {/* caption overlay for media statuses */}
        {!!current.caption && (video || audio || current.type === 'image') && (
          <View style={styles.captionWrap} pointerEvents="none">
            <Text style={styles.caption}>{current.caption}</Text>
          </View>
        )}

        {/* tap zones (held = pause) */}
        <Pressable
          style={styles.tapLeft}
          onPress={goPrev}
          onPressIn={() => setPaused(true)}
          onPressOut={() => setPaused(false)}
        />
        <Pressable
          style={styles.tapRight}
          onPress={goNext}
          onPressIn={() => setPaused(true)}
          onPressOut={() => setPaused(false)}
        />
      </View>

      {/* footer — bottom inset for system nav / gesture bar */}
      {isMine ? (
        <View style={[styles.footerMine, { paddingBottom: Math.max(insets.bottom, 8) + 8 }]}>
          <Pressable style={styles.seenBtn} onPress={loadViewers}>
            <Ionicons name="eye-outline" size={18} color="#fff" />
            <Text style={styles.seenText}>{viewCount > 0 ? `Seen by ${viewCount}` : 'Seen by'}</Text>
          </Pressable>
          {showViewers && viewers && (
            <ScrollView style={styles.viewersList}>
              {viewers.length === 0 && <Text style={styles.viewerEmpty}>No views yet</Text>}
              {viewers.map((v) => (
                <View key={v.viewer_id} style={styles.viewerItem}>
                  <Avatar uri={v.profile?.avatar_url} name={v.profile?.display_name} size={32} />
                  <Text style={styles.viewerItemName}>{v.profile?.display_name ?? 'Lumixo user'}</Text>
                  <Text style={styles.viewerItemTime}>{formatLastSeen(v.viewed_at)}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      ) : (
        <View style={[styles.footerReply, { paddingBottom: Math.max(insets.bottom, 8) + 8 }]}>
          <TextInput
            style={styles.replyInput}
            placeholder={`Reply to ${group.profile?.display_name ?? 'status'}…`}
            placeholderTextColor="rgba(255,255,255,0.6)"
            value={reply}
            onChangeText={setReply}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          />
          <Pressable style={styles.replySend} onPress={sendReply} disabled={!reply.trim() || sending}>
            {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={20} color="#fff" />}
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    viewer: { flex: 1, backgroundColor: '#000' },
    progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: spacing(3) },
    progressTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
    progressFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
    viewerHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(3), paddingVertical: spacing(2.5), gap: spacing(2.5) },
    viewerHeaderText: { flex: 1 },
    viewerName: { color: '#fff', fontSize: font.heading, fontWeight: '600' },
    viewerTime: { color: 'rgba(255,255,255,0.7)', fontSize: font.small },
    headerIcon: { padding: spacing(1) },
    stage: { flex: 1, justifyContent: 'center', position: 'relative' },
    media: { width: '100%', height: '100%' },
    audioStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing(6) },
    audioBubble: {
      width: 140, height: 140, borderRadius: 70,
      backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
    },
    audioLabel: { color: 'rgba(255,255,255,0.9)', fontSize: font.heading, fontWeight: '600' },
    textStatus: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(8) },
    textStatusText: { color: '#fff', fontSize: 28, fontWeight: '700', textAlign: 'center' },
    captionWrap: { position: 'absolute', left: 0, right: 0, bottom: spacing(6), paddingHorizontal: spacing(6) },
    caption: {
      color: '#fff', fontSize: font.heading, fontWeight: '600', textAlign: 'center',
      textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 },
    },
    tapLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '32%' },
    tapRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '68%' },
    footerReply: { flexDirection: 'row', alignItems: 'center', gap: spacing(2.5), paddingHorizontal: spacing(3), paddingTop: spacing(3) },
    replyInput: {
      flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)',
      borderWidth: 1, borderRadius: 24, paddingHorizontal: spacing(4), paddingVertical: spacing(2.5),
      color: '#fff', fontSize: font.body,
    },
    replySend: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    footerMine: { paddingHorizontal: spacing(3), paddingTop: spacing(2) },
    seenBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing(2), paddingVertical: spacing(2.5) },
    seenText: { color: '#fff', fontSize: font.body, fontWeight: '500' },
    viewersList: { maxHeight: 240, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: radius.md, padding: spacing(2) },
    viewerEmpty: { color: 'rgba(255,255,255,0.6)', padding: spacing(4), textAlign: 'center' },
    viewerItem: { flexDirection: 'row', alignItems: 'center', gap: spacing(2.5), paddingVertical: spacing(2), paddingHorizontal: spacing(2) },
    viewerItemName: { flex: 1, color: '#fff', fontSize: font.body },
    viewerItemTime: { color: 'rgba(255,255,255,0.6)', fontSize: font.small },
  });
