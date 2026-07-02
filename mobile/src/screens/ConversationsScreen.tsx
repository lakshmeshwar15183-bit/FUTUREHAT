// FUTUREHAT mobile — Chats tab. Loads getMyConversations on focus, shows
// title/avatar/last-message/unread, and routes into a thread.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import {
  getMyConversations,
  getCurrentUser,
  searchAllMessages,
  getPinnedIds,
  pinConversation,
  unpinConversation,
  getMutedIds,
  muteConversation,
  unmuteConversation,
  hideConversation,
  archiveConversation,
  blockUser,
  submitReport,
} from '../lib/shared';
import type { ConversationSummary, MessageSearchHit } from '../lib/shared';
import { getCachedConversations, cacheConversations } from '../lib/localCache';
import { onConnectivity } from '../lib/sync';
import { formatListTimestamp } from '../lib/time';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ConversationsScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [msgHits, setMsgHits] = useState<MessageSearchHit[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<ConversationSummary | null>(null);

  const q = query.trim().toLowerCase();
  const convById = useMemo(() => {
    const m = new Map<string, ConversationSummary>();
    items.forEach((c) => m.set(c.conversation.id, c));
    return m;
  }, [items]);
  const filteredItems = useMemo(() => {
    const base = items.filter((c) => !hiddenIds.has(c.conversation.id)); // hidden chats never listed
    const searched = q ? base.filter((c) => c.title.toLowerCase().includes(q)) : base;
    // Pinned conversations float to the top (WhatsApp-style), otherwise the
    // getMyConversations order (most-recent first) is preserved.
    return [...searched].sort((a, b) => {
      const pa = pinnedIds.has(a.conversation.id) ? 1 : 0;
      const pb = pinnedIds.has(b.conversation.id) ? 1 : 0;
      return pb - pa;
    });
  }, [items, q, hiddenIds, pinnedIds]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setMsgHits([]); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const hits = await searchAllMessages(supabase, term);
      if (alive) setMsgHits(hits.filter((h) => convById.has(h.conversationId)));
    }, 280);
    return () => { alive = false; clearTimeout(t); };
  }, [query, convById]);

  const [offline, setOffline] = useState(false);
  useEffect(() => onConnectivity((o) => setOffline(!o)), []);

  // Resolve my id, then hydrate the list from the LOCAL cache immediately so the
  // chat list appears with zero network wait (WhatsApp-style). The Supabase
  // refresh below runs in the background and overwrites both state and cache.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getCurrentUser(supabase)
        .then(async (u) => {
          const id = u?.id ?? null;
          if (!alive) return;
          setUid(id);
          if (id) {
            const cached = await getCachedConversations(id);
            if (alive && cached.length) {
              setItems(cached);
              setLoading(false); // we have something to show — never block on the network
            }
          }
        })
        .catch(() => {});
      return () => { alive = false; };
    }, []),
  );

  // Background sync: refresh from Supabase, update the UI, and rewrite the cache.
  // On failure (e.g. offline) we keep whatever the cache already gave us.
  const load = useCallback(async () => {
    try {
      const data = await getMyConversations(supabase);
      setItems(data);
      const u = await getCurrentUser(supabase);
      if (u?.id) cacheConversations(u.id, data).catch(() => {});
      // Per-user conversation flags (pin/mute). Degrade to empty on any error.
      Promise.all([getPinnedIds(supabase), getMutedIds(supabase)])
        .then(([pinned, muted]) => {
          setPinnedIds(new Set(pinned));
          setMutedIds(new Set(muted));
        })
        .catch(() => {});
    } catch {
      // keep last known (cached) list on transient errors / offline
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const lastPreview = (c: ConversationSummary): string => {
    const m = c.lastMessage;
    if (!m) return 'Tap to start chatting';
    if (m.is_deleted) return 'This message was deleted';
    const body =
      m.type === 'image' ? '📷 Photo' :
      m.type === 'audio' ? '🎤 Voice message' :
      m.type === 'file' ? '📎 Attachment' :
      (m.content ?? '');
    if (uid && m.sender_id === uid) return `You: ${body}`;
    if (c.conversation.type === 'group') {
      const name = c.participants.find((p) => p.id === m.sender_id)?.display_name;
      return name ? `${name.split(' ')[0]}: ${body}` : body;
    }
    return body;
  };

  // ── Conversation row actions (long-press menu) ──────────────────────────────
  const isPinned = menuFor ? pinnedIds.has(menuFor.conversation.id) : false;
  const isMuted = menuFor ? mutedIds.has(menuFor.conversation.id) : false;
  const menuIsDirect = menuFor?.conversation.type === 'direct';
  const menuPeer = menuFor?.participants.find((p) => p.id !== uid) ?? null;

  async function togglePin() {
    if (!menuFor) return;
    const id = menuFor.conversation.id;
    setMenuFor(null);
    const pinned = pinnedIds.has(id);
    setPinnedIds((prev) => { const n = new Set(prev); pinned ? n.delete(id) : n.add(id); return n; });
    const { error } = pinned ? await unpinConversation(supabase, id) : await pinConversation(supabase, id);
    if (error) setPinnedIds((prev) => { const n = new Set(prev); pinned ? n.add(id) : n.delete(id); return n; });
  }

  async function toggleMute() {
    if (!menuFor) return;
    const id = menuFor.conversation.id;
    setMenuFor(null);
    const muted = mutedIds.has(id);
    setMutedIds((prev) => { const n = new Set(prev); muted ? n.delete(id) : n.add(id); return n; });
    const { error } = muted ? await unmuteConversation(supabase, id) : await muteConversation(supabase, id);
    if (error) setMutedIds((prev) => { const n = new Set(prev); muted ? n.add(id) : n.delete(id); return n; });
  }

  async function doHide() {
    if (!menuFor) return;
    const id = menuFor.conversation.id;
    setMenuFor(null);
    setHiddenIds((prev) => new Set(prev).add(id));
    const { error } = await hideConversation(supabase, id);
    if (error) { setHiddenIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); Alert.alert('Could not hide', error.message); }
  }

  async function doArchive() {
    if (!menuFor) return;
    const id = menuFor.conversation.id;
    setMenuFor(null);
    setHiddenIds((prev) => new Set(prev).add(id)); // archived chats leave the main list
    const { error } = await archiveConversation(supabase, id);
    if (error) { setHiddenIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); Alert.alert('Could not archive', error.message); }
  }

  function doBlock() {
    const peer = menuPeer;
    if (!peer) return;
    setMenuFor(null);
    Alert.alert('Block contact', `Block ${peer.display_name ?? 'this user'}? They won't be able to message you.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          const { error } = await blockUser(supabase, peer.id);
          if (error) Alert.alert('Could not block', error.message);
          else Alert.alert('Blocked', `${peer.display_name ?? 'User'} has been blocked.`);
        },
      },
    ]);
  }

  function doReport() {
    const peer = menuPeer;
    if (!peer) return;
    setMenuFor(null);
    Alert.alert('Report contact', `Report ${peer.display_name ?? 'this user'} to the safety team?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: async () => {
          const { error } = await submitReport(supabase, 'user', peer.id, 'Reported from chat list');
          Alert.alert(error ? 'Could not report' : 'Reported', error ? error.message : 'Thanks — our team will review this.');
        },
      },
    ]);
  }

  // Stable separator so the list doesn't rebuild every separator each render.
  const Separator = useCallback(() => <View style={styles.sep} />, [styles]);

  const renderItem = ({ item }: { item: ConversationSummary }) => (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() =>
        navigation.navigate('Chat', {
          conversationId: item.conversation.id,
          title: item.title,
        })
      }
      onLongPress={() => { Haptics.selectionAsync().catch(() => {}); setMenuFor(item); }}
      delayLongPress={280}
    >
      <Avatar uri={item.avatarUrl} name={item.title} size={52} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.time, item.unreadCount > 0 && styles.timeUnread]}>
            {formatListTimestamp(item.lastMessage?.created_at)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.preview} numberOfLines={1}>
            {lastPreview(item)}
          </Text>
          <View style={styles.rowIcons}>
            {mutedIds.has(item.conversation.id) && (
              <Ionicons name="notifications-off" size={14} color={colors.textFaint} style={{ marginLeft: spacing(1) }} />
            )}
            {pinnedIds.has(item.conversation.id) && (
              <Ionicons name="pin" size={14} color={colors.textFaint} style={{ marginLeft: spacing(1) }} />
            )}
            {item.unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {item.unreadCount > 99 ? '99+' : item.unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {offline && (
        <View style={styles.offlineBar}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineText}>Offline — showing saved chats</Text>
        </View>
      )}
      <FlatList
        data={filteredItems}
        keyExtractor={(c) => c.conversation.id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={14}
        maxToRenderPerBatch={12}
        windowSize={11}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          <View>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search chats and messages"
                placeholderTextColor={colors.textFaint}
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
              />
              {query.length > 0 && (
                <Pressable hitSlop={8} onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </Pressable>
              )}
            </View>
            {msgHits.length > 0 && (
              <View style={styles.hits}>
                <Text style={styles.hitsHead}>MESSAGES</Text>
                {msgHits.slice(0, 12).map((h) => {
                  const conv = convById.get(h.conversationId)!;
                  return (
                    <Pressable
                      key={h.message.id}
                      style={styles.hit}
                      onPress={() => {
                        setQuery('');
                        navigation.navigate('Chat', { conversationId: h.conversationId, title: conv.title });
                      }}
                    >
                      <Avatar uri={conv.avatarUrl} name={conv.title} size={38} />
                      <View style={styles.hitBody}>
                        <Text style={styles.hitTitle} numberOfLines={1}>{conv.title}</Text>
                        <Text style={styles.hitSnippet} numberOfLines={1}>{h.message.content}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={64} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>{q ? 'No matching chats' : 'No conversations yet'}</Text>
              <Text style={styles.emptySub}>
                {q ? 'Try a different search.' : 'Tap the button below to find someone and say hello.'}
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={filteredItems.length === 0 ? styles.flexGrow : undefined}
      />

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={() => navigation.navigate('NewChat')}
      >
        <Ionicons name="create-outline" size={26} color="#fff" />
      </Pressable>

      {/* Conversation long-press action sheet */}
      <Modal visible={!!menuFor} transparent animationType="fade" onRequestClose={() => setMenuFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuFor(null)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{menuFor?.title}</Text>
            <ConvAction icon={isPinned ? 'pin' : 'pin-outline'} label={isPinned ? 'Unpin' : 'Pin'} onPress={togglePin} />
            <ConvAction icon={isMuted ? 'notifications' : 'notifications-off-outline'} label={isMuted ? 'Unmute' : 'Mute'} onPress={toggleMute} />
            <ConvAction icon="eye-off-outline" label="Hide" onPress={doHide} />
            <ConvAction icon="archive-outline" label="Archive" onPress={doArchive} />
            {menuIsDirect && (
              <>
                <ConvAction icon="flag-outline" label="Report" onPress={doReport} />
                <ConvAction icon="ban-outline" label="Block" danger onPress={doBlock} />
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function ConvAction({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const colors = useColors();
  const tint = danger ? colors.danger : colors.text;
  return (
    <Pressable
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(3.5) }, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.textMuted} />
      <Text style={{ color: tint, fontSize: font.body, marginLeft: spacing(4) }}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    offlineBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: colors.textMuted, paddingVertical: 4,
    },
    offlineText: { color: '#fff', fontSize: font.tiny, fontWeight: '600' },
    searchBar: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginHorizontal: spacing(4), marginTop: spacing(2), marginBottom: spacing(2),
      paddingHorizontal: 12, paddingVertical: 8,
      backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: font.body, paddingVertical: 0 },
    hits: { paddingBottom: spacing(2), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, marginBottom: spacing(1) },
    hitsHead: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
    hit: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
    hitBody: { flex: 1, marginLeft: spacing(3) },
    hitTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    hitSnippet: { color: colors.textMuted, fontSize: font.small, marginTop: 1 },
    flexGrow: { flexGrow: 1 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3),
    },
    rowPressed: { backgroundColor: colors.surface },
    rowBody: { flex: 1, marginLeft: spacing(3) },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing(1),
    },
    title: { color: colors.text, fontSize: font.heading, fontWeight: '600', flex: 1 },
    time: { color: colors.textFaint, fontSize: font.tiny, marginLeft: spacing(2) },
    timeUnread: { color: colors.primary },
    preview: { color: colors.textMuted, fontSize: font.small, flex: 1 },
    badge: {
      backgroundColor: colors.primary,
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: spacing(2),
    },
    badgeText: { color: '#fff', fontSize: font.tiny, fontWeight: '700' },
    sep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: spacing(4) + 52 + spacing(3),
    },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(8) },
    emptyTitle: {
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '600',
      marginTop: spacing(4),
    },
    emptySub: {
      color: colors.textMuted,
      fontSize: font.small,
      textAlign: 'center',
      marginTop: spacing(2),
    },
    fab: {
      position: 'absolute',
      right: spacing(5),
      bottom: spacing(6),
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    fabPressed: { backgroundColor: colors.primaryDark },
    rowIcons: { flexDirection: 'row', alignItems: 'center' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: spacing(6),
    },
    sheetTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: 8 },
  });
