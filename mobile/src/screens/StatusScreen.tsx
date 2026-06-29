// FUTUREHAT mobile — Status (stories). WhatsApp-grade tray + full-screen player.
// Tray: "My status" (add/manage) + recent updates with seen/unseen rings.
// Player: auto-advancing progress bars, tap nav, hold-to-pause, image/video/text,
// reply-as-DM, and a "seen by" list on your own statuses.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video, type AVPlaybackStatus } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import {
  getActiveStatuses,
  createStatus,
  deleteStatus,
  markStatusViewed,
  getMyViewedStatusIds,
  getStatusViewers,
  startDirectConversation,
  sendMessage,
  getCurrentUser,
  getProfile,
} from '../lib/shared';
import type { Status, StatusViewer, Profile } from '../lib/shared';
import { uploadMediaFromUri } from '../lib/media';
import { formatLastSeen } from '../lib/time';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';

const BG_COLORS = ['#00A884', '#5B6EF5', '#E8638A', '#F7A948', '#9B6EF5', '#0B141A', '#D9544F'];
const IMAGE_DURATION = 5000;

interface Group {
  userId: string;
  profile: Profile | null;
  statuses: Status[];
  allSeen: boolean;
}

function isVideo(s: Status): boolean {
  if (s.type === 'video') return true;
  return !!s.media_url && /\.(mp4|webm|mov|m4v|ogv)/i.test(s.media_url);
}

export default function StatusScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [uid, setUid] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [mine, setMine] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [viewing, setViewing] = useState<Group | null>(null);

  const load = useCallback(async () => {
    const user = await getCurrentUser(supabase);
    const myId = user?.id ?? '';
    setUid(user?.id ?? null);
    const [all, viewed] = await Promise.all([
      getActiveStatuses(supabase),
      getMyViewedStatusIds(supabase),
    ]);

    const byUser = new Map<string, Status[]>();
    for (const s of all) {
      const arr = byUser.get(s.user_id) ?? [];
      arr.push(s);
      byUser.set(s.user_id, arr);
    }

    const buildGroup = async (userId: string, list: Status[]): Promise<Group> => {
      const chron = [...list].reverse(); // oldest-first for playback
      const joined = chron[0].profile;
      const profile = joined
        ? ({ id: joined.id, display_name: joined.display_name, avatar_url: joined.avatar_url } as Profile)
        : await getProfile(supabase, userId);
      return {
        userId,
        profile,
        statuses: chron,
        allSeen: userId === myId ? true : chron.every((s) => viewed.has(s.id)),
      };
    };

    const mineList = byUser.get(myId);
    setMine(mineList && mineList.length ? await buildGroup(myId, mineList) : null);
    byUser.delete(myId);

    const built: Group[] = [];
    for (const [userId, list] of byUser) built.push(await buildGroup(userId, list));
    built.sort((a, b) => {
      if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1;
      return b.statuses[b.statuses.length - 1].created_at.localeCompare(
        a.statuses[a.statuses.length - 1].created_at,
      );
    });
    setGroups(built);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function postText() {
    if (!text.trim()) return;
    await createStatus(supabase, 'text', text.trim(), undefined, bg);
    setText('');
    setComposing(false);
    load();
  }

  async function postMedia() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.7,
      videoMaxDuration: 30,
    });
    if (res.canceled || !res.assets?.length || !uid) return;
    const asset = res.assets[0];
    const video = asset.type === 'video';
    const ext = video ? 'mp4' : 'jpg';
    const { url, error } = await uploadMediaFromUri(uid, asset.uri, `status_${Date.now()}.${ext}`);
    if (error || !url) {
      Alert.alert('Upload failed', error?.message ?? 'Try again.');
      return;
    }
    await createStatus(supabase, video ? 'video' : 'image', undefined, url);
    load();
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.userId}
        ListHeaderComponent={
          <>
            <Pressable
              style={styles.myRow}
              onPress={() => (mine ? setViewing(mine) : setComposing(true))}
            >
              <View>
                <View style={[styles.ring, { borderColor: mine ? colors.primary : 'transparent' }]}>
                  <Avatar uri={mine?.profile?.avatar_url} name="Me" size={52} />
                </View>
                {!mine && (
                  <View style={styles.addBadge}>
                    <Ionicons name="add" size={16} color="#fff" />
                  </View>
                )}
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.name}>My status</Text>
                <Text style={styles.sub}>
                  {mine
                    ? `${mine.statuses.length} update${mine.statuses.length > 1 ? 's' : ''} · ${formatLastSeen(mine.statuses[mine.statuses.length - 1].created_at)}`
                    : 'Tap to add status update'}
                </Text>
              </View>
              {mine && (
                <Pressable hitSlop={10} onPress={() => setComposing(true)}>
                  <Ionicons name="add-circle-outline" size={26} color={colors.textMuted} />
                </Pressable>
              )}
            </Pressable>
            {groups.length > 0 && <Text style={styles.sectionLabel}>RECENT UPDATES</Text>}
          </>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => setViewing(item)}>
            <View style={[styles.ring, { borderColor: item.allSeen ? colors.border : colors.primary }]}>
              <Avatar uri={item.profile?.avatar_url} name={item.profile?.display_name} size={50} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.name}>{item.profile?.display_name ?? 'FUTUREHAT user'}</Text>
              <Text style={styles.sub}>{formatLastSeen(item.statuses[item.statuses.length - 1]?.created_at)}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? null : <Text style={styles.empty}>No recent updates from your contacts.</Text>
        }
      />

      <View style={styles.fabCol}>
        <Pressable style={styles.fabSmall} onPress={() => setComposing(true)}>
          <Ionicons name="pencil" size={20} color={colors.text} />
        </Pressable>
        <Pressable style={styles.fab} onPress={postMedia}>
          <Ionicons name="camera" size={26} color="#fff" />
        </Pressable>
      </View>

      {/* Text composer */}
      <Modal visible={composing} animationType="slide" onRequestClose={() => setComposing(false)}>
        <View style={[styles.composer, { backgroundColor: bg }]}>
          <Pressable style={styles.composerClose} onPress={() => setComposing(false)}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <TextInput
            style={styles.composerInput}
            placeholder="Type a status"
            placeholderTextColor="rgba(255,255,255,0.7)"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={700}
            autoFocus
          />
          <View style={styles.bgRow}>
            {BG_COLORS.map((c) => (
              <Pressable key={c} onPress={() => setBg(c)} style={[styles.bgDot, { backgroundColor: c }, bg === c && styles.bgDotOn]} />
            ))}
          </View>
          <Pressable style={styles.postBtn} onPress={postText}>
            <Ionicons name="send" size={22} color="#fff" />
          </Pressable>
        </View>
      </Modal>

      {/* Story player */}
      <Modal visible={!!viewing} animationType="fade" onRequestClose={() => setViewing(null)} transparent={false}>
        {viewing && (
          <StoryPlayer
            group={viewing}
            isMine={viewing.userId === uid}
            colors={colors}
            onClose={() => setViewing(null)}
            onChanged={load}
          />
        )}
      </Modal>
    </View>
  );
}

// ── Full-screen story player ────────────────────────────────────────────────

function StoryPlayer({
  group,
  isMine,
  colors,
  onClose,
  onChanged,
}: {
  group: Group;
  isMine: boolean;
  colors: Palette;
  onClose: () => void;
  onChanged: () => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [statuses, setStatuses] = useState<Status[]>(group.statuses);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [viewers, setViewers] = useState<StatusViewer[] | null>(null);
  const [showViewers, setShowViewers] = useState(false);

  const progress = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const videoRef = useRef<Video>(null);

  const current = statuses[idx];
  const video = current && isVideo(current);

  const goNext = useCallback(() => {
    setIdx((i) => {
      if (i < statuses.length - 1) return i + 1;
      onClose();
      return i;
    });
  }, [statuses.length, onClose]);

  const goPrev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

  // Per-slide: reset progress, mark viewed, hide viewers panel.
  useEffect(() => {
    if (!current) return;
    progress.setValue(0);
    setShowViewers(false);
    setViewers(null);
    markStatusViewed(supabase, current.id, group.userId).then(onChanged).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Drive the timed progress bar for image/text (video drives its own).
  useEffect(() => {
    if (!current || video) return;
    if (paused) {
      animRef.current?.stop();
      return;
    }
    const remaining = IMAGE_DURATION * (1 - (progress as any).__getValue());
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: remaining,
      useNativeDriver: false,
    });
    animRef.current = anim;
    anim.start(({ finished }) => {
      if (finished) goNext();
    });
    return () => anim.stop();
  }, [current?.id, paused, video, goNext, progress]);

  async function loadViewers() {
    if (viewers) {
      setShowViewers((s) => !s);
      return;
    }
    const v = await getStatusViewers(supabase, current.id);
    setViewers(v);
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

  return (
    <View style={styles.viewer}>
      {/* progress bars */}
      <View style={styles.progressRow}>
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
          <Text style={styles.viewerName}>{isMine ? 'My status' : group.profile?.display_name ?? 'FUTUREHAT user'}</Text>
          <Text style={styles.viewerTime}>{formatLastSeen(current.created_at)}</Text>
        </View>
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
            isMuted={false}
            onPlaybackStatusUpdate={(s: AVPlaybackStatus) => {
              if (!s.isLoaded) return;
              if (s.durationMillis) progress.setValue(s.positionMillis / s.durationMillis);
              if (s.didJustFinish) goNext();
            }}
          />
        ) : current.type === 'image' && current.media_url ? (
          <Image source={{ uri: current.media_url }} style={styles.media} resizeMode="contain" />
        ) : (
          <View style={[styles.textStatus, { backgroundColor: current.background ?? '#667eea' }]}>
            <Text style={styles.textStatusText}>{current.content}</Text>
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

      {/* footer */}
      {isMine ? (
        <View style={styles.footerMine}>
          <Pressable style={styles.seenBtn} onPress={loadViewers}>
            <Ionicons name="eye-outline" size={18} color="#fff" />
            <Text style={styles.seenText}>
              {viewers ? `Seen by ${viewers.length}` : 'Seen by'}
            </Text>
          </Pressable>
          {showViewers && viewers && (
            <ScrollView style={styles.viewersList}>
              {viewers.length === 0 && <Text style={styles.viewerEmpty}>No views yet</Text>}
              {viewers.map((v) => (
                <View key={v.viewer_id} style={styles.viewerItem}>
                  <Avatar uri={v.profile?.avatar_url} name={v.profile?.display_name} size={32} />
                  <Text style={styles.viewerItemName}>{v.profile?.display_name ?? 'FUTUREHAT user'}</Text>
                  <Text style={styles.viewerItemTime}>{formatLastSeen(v.viewed_at)}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      ) : (
        <View style={styles.footerReply}>
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
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    myRow: { flexDirection: 'row', alignItems: 'center', padding: spacing(4), backgroundColor: colors.surface },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(2.5) },
    ring: { borderWidth: 2.5, borderRadius: 32, padding: 2.5 },
    addBadge: {
      position: 'absolute',
      bottom: -2,
      right: -2,
      backgroundColor: colors.primary,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.surface,
    },
    rowBody: { marginLeft: spacing(3), flex: 1 },
    name: { color: colors.text, fontSize: font.heading, fontWeight: '500' },
    sub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: font.small,
      fontWeight: '700',
      letterSpacing: 0.5,
      paddingHorizontal: spacing(4),
      paddingTop: spacing(3),
      paddingBottom: spacing(1),
    },
    empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing(8) },
    fabCol: { position: 'absolute', right: spacing(5), bottom: spacing(6), alignItems: 'center', gap: spacing(3) },
    fabSmall: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    fab: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 6 },

    composer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(6) },
    composerClose: { position: 'absolute', top: spacing(12), left: spacing(5) },
    composerInput: { color: '#fff', fontSize: 26, fontWeight: '600', textAlign: 'center', width: '100%' },
    bgRow: { flexDirection: 'row', gap: spacing(3), position: 'absolute', bottom: spacing(20), flexWrap: 'wrap', justifyContent: 'center' },
    bgDot: { width: 32, height: 32, borderRadius: 16 },
    bgDotOn: { borderWidth: 3, borderColor: '#fff' },
    postBtn: { position: 'absolute', bottom: spacing(8), right: spacing(6), width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },

    // player
    viewer: { flex: 1, backgroundColor: '#000' },
    progressRow: { flexDirection: 'row', gap: 4, paddingTop: spacing(12), paddingHorizontal: spacing(3) },
    progressTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
    progressFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
    viewerHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(3), paddingVertical: spacing(2.5), gap: spacing(2.5) },
    viewerHeaderText: { flex: 1 },
    viewerName: { color: '#fff', fontSize: font.heading, fontWeight: '600' },
    viewerTime: { color: 'rgba(255,255,255,0.7)', fontSize: font.small },
    headerIcon: { padding: spacing(1) },
    stage: { flex: 1, justifyContent: 'center', position: 'relative' },
    media: { width: '100%', height: '100%' },
    textStatus: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(8) },
    textStatusText: { color: '#fff', fontSize: 28, fontWeight: '700', textAlign: 'center' },
    tapLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '32%' },
    tapRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '68%' },

    footerReply: { flexDirection: 'row', alignItems: 'center', gap: spacing(2.5), padding: spacing(3), paddingBottom: spacing(6) },
    replyInput: {
      flex: 1,
      backgroundColor: 'rgba(255,255,255,0.12)',
      borderColor: 'rgba(255,255,255,0.25)',
      borderWidth: 1,
      borderRadius: 24,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(2.5),
      color: '#fff',
      fontSize: font.body,
    },
    replySend: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },

    footerMine: { paddingHorizontal: spacing(3), paddingBottom: spacing(6), paddingTop: spacing(2) },
    seenBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing(2), paddingVertical: spacing(2.5) },
    seenText: { color: '#fff', fontSize: font.body, fontWeight: '500' },
    viewersList: { maxHeight: 240, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: radius.md, padding: spacing(2) },
    viewerEmpty: { color: 'rgba(255,255,255,0.6)', padding: spacing(4), textAlign: 'center' },
    viewerItem: { flexDirection: 'row', alignItems: 'center', gap: spacing(2.5), paddingVertical: spacing(2), paddingHorizontal: spacing(2) },
    viewerItemName: { flex: 1, color: '#fff', fontSize: font.body },
    viewerItemTime: { color: 'rgba(255,255,255,0.6)', fontSize: font.small },
  });
