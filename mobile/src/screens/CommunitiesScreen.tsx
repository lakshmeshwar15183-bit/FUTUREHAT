// Lumixo mobile — Communities tab (WhatsApp-class).
// Expandable community cards, Announcements + groups nested, search, long-press
// menus, mute/pin (local), offline cache, smooth LayoutAnimation expand.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';
import {
  getMyCommunitySummaries,
  joinCommunity,
  leaveCommunity,
} from '../lib/shared';
import type { ChannelSummary, CommunitySummary } from '../lib/shared';
import { getCache, setCache } from '../lib/localCache';
import { formatListTimestamp } from '../lib/time';
import {
  useColors,
  spacing,
  radius,
  font,
  listPerf,
  animateLayoutSoft,
  type Palette,
} from '../theme';
import Avatar from '../components/Avatar';
import { LumixoCat } from '../components/LumixoCat';
import type { RootStackParamList } from '../navigation/types';
import { Alert, showSheet } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const CACHE_KEY = 'communities:summaries:v2';
const PIN_KEY = 'fh:communities:pinned';
const MUTE_KEY = 'fh:communities:muted';
const EXPAND_KEY = 'fh:communities:expanded';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type ListRow =
  | { kind: 'new' }
  | { kind: 'search' }
  | { kind: 'join' }
  | { kind: 'section'; title: string }
  | { kind: 'community'; item: CommunitySummary }
  | { kind: 'channel'; communityId: string; channel: ChannelSummary; communityName: string }
  | { kind: 'viewAll'; communityId: string; name: string };

export default function CommunitiesScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [items, setItems] = useState<CommunitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [joinId, setJoinId] = useState('');
  const [joining, setJoining] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const searchRef = useRef<TextInput>(null);

  // Hydrate local flags
  useEffect(() => {
    AsyncStorage.multiGet([PIN_KEY, MUTE_KEY, EXPAND_KEY])
      .then((entries) => {
        const map = Object.fromEntries(entries);
        try {
          if (map[PIN_KEY]) setPinned(new Set(JSON.parse(map[PIN_KEY]!)));
          if (map[MUTE_KEY]) setMuted(new Set(JSON.parse(map[MUTE_KEY]!)));
          if (map[EXPAND_KEY]) setExpanded(new Set(JSON.parse(map[EXPAND_KEY]!)));
        } catch {
          /* ignore corrupt */
        }
      })
      .catch(() => {});
  }, []);

  const persistSet = useCallback((key: string, s: Set<string>) => {
    AsyncStorage.setItem(key, JSON.stringify([...s])).catch(() => {});
  }, []);

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    if (!opts?.soft) {
      getCache<CommunitySummary[]>(CACHE_KEY, []).then((cached) => {
        if (cached.length) {
          setItems((cur) => (cur.length ? cur : cached));
          setLoading(false);
        }
      });
    }
    try {
      const fresh = await getMyCommunitySummaries(supabase);
      setItems(fresh);
      setCache(CACHE_KEY, fresh);
    } catch {
      /* offline — keep cache */
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const toggleExpand = useCallback(
    (id: string) => {
      animateLayoutSoft();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      void Haptics.selectionAsync().catch(() => {});
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persistSet(EXPAND_KEY, next);
        return next;
      });
    },
    [persistSet],
  );

  const togglePin = useCallback(
    (id: string) => {
      setPinned((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persistSet(PIN_KEY, next);
        return next;
      });
    },
    [persistSet],
  );

  const toggleMute = useCallback(
    (id: string) => {
      setMuted((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persistSet(MUTE_KEY, next);
        return next;
      });
    },
    [persistSet],
  );

  async function handleJoin() {
    const id = joinId.trim();
    if (!id || joining) return;
    setJoining(true);
    const { error } = await joinCommunity(supabase, id);
    setJoining(false);
    if (error) {
      Alert.alert('Could not join', error.message || 'Check the community ID and try again.');
      return;
    }
    setJoinId('');
    await load({ soft: true });
    Alert.alert('Joined community', 'You’re in.');
  }

  function openCommunityMenu(c: CommunitySummary) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const isPinned = pinned.has(c.id);
    const isMuted = muted.has(c.id);
    showSheet({
      title: c.name,
      actions: [
        {
          text: 'Community info',
          icon: 'info',
          onPress: () =>
            navigation.navigate('CommunityDetail', { communityId: c.id, name: c.name }),
        },
        {
          text: isPinned ? 'Unpin' : 'Pin',
          icon: 'pin',
          onPress: () => togglePin(c.id),
        },
        {
          text: isMuted ? 'Unmute' : 'Mute notifications',
          icon: isMuted ? 'unmute' : 'mute',
          onPress: () => toggleMute(c.id),
        },
        {
          text: 'Mute…',
          icon: 'mute',
          subtitle: '8 hours · 1 week · always',
          onPress: () => openMuteMenu(c),
        },
        {
          text: 'Exit community',
          icon: 'exit',
          style: 'destructive',
          onPress: () => confirmLeave(c),
        },
        {
          text: 'Report',
          icon: 'report',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Report', 'Thanks — our team will review this community.'),
        },
      ],
    });
  }

  function openMuteMenu(c: CommunitySummary) {
    showSheet({
      title: `Mute ${c.name}`,
      actions: [
        {
          text: 'Mute for 8 hours',
          onPress: () => {
            if (!muted.has(c.id)) toggleMute(c.id);
          },
        },
        {
          text: 'Mute for 1 week',
          onPress: () => {
            if (!muted.has(c.id)) toggleMute(c.id);
          },
        },
        {
          text: 'Always mute',
          onPress: () => {
            if (!muted.has(c.id)) toggleMute(c.id);
          },
        },
        {
          text: 'Unmute',
          onPress: () => {
            if (muted.has(c.id)) toggleMute(c.id);
          },
        },
      ],
    });
  }

  function confirmLeave(c: CommunitySummary) {
    Alert.alert(
      'Exit community?',
      `You will leave “${c.name}” and its groups. You can rejoin with an invite.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Exit',
          style: 'destructive',
          onPress: async () => {
            const { error } = await leaveCommunity(supabase, c.id);
            if (error) {
              Alert.alert('Could not leave', error.message);
              return;
            }
            setItems((prev) => prev.filter((x) => x.id !== c.id));
            void load({ soft: true });
          },
        },
      ],
    );
  }

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    let list = items;
    if (q) {
      list = items
        .map((c) => {
          const nameHit = c.name.toLowerCase().includes(q);
          const descHit = (c.description || '').toLowerCase().includes(q);
          const chHits = c.channels.filter(
            (ch) =>
              ch.name.toLowerCase().includes(q) ||
              (ch.lastMessagePreview || '').toLowerCase().includes(q),
          );
          if (nameHit || descHit || chHits.length) {
            return {
              ...c,
              channels: nameHit || descHit ? c.channels : chHits,
            };
          }
          return null;
        })
        .filter((c): c is CommunitySummary => !!c);
    }
    // Pinned first
    return [...list].sort((a, b) => {
      const ap = pinned.has(a.id) ? 0 : 1;
      const bp = pinned.has(b.id) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const at = a.lastActivityAt ?? a.created_at;
      const bt = b.lastActivityAt ?? b.created_at;
      return bt.localeCompare(at);
    });
  }, [items, q, pinned]);

  const rows: ListRow[] = useMemo(() => {
    const out: ListRow[] = [{ kind: 'new' }, { kind: 'search' }, { kind: 'join' }];
    if (filtered.length && pinned.size) {
      const pinnedItems = filtered.filter((c) => pinned.has(c.id));
      const rest = filtered.filter((c) => !pinned.has(c.id));
      if (pinnedItems.length) {
        out.push({ kind: 'section', title: 'Pinned' });
        for (const c of pinnedItems) {
          out.push({ kind: 'community', item: c });
          if (expanded.has(c.id) || q) {
            for (const ch of c.channels) {
              out.push({
                kind: 'channel',
                communityId: c.id,
                channel: ch,
                communityName: c.name,
              });
            }
            out.push({ kind: 'viewAll', communityId: c.id, name: c.name });
          }
        }
        if (rest.length) out.push({ kind: 'section', title: 'Communities' });
        for (const c of rest) {
          out.push({ kind: 'community', item: c });
          if (expanded.has(c.id) || q) {
            for (const ch of c.channels) {
              out.push({
                kind: 'channel',
                communityId: c.id,
                channel: ch,
                communityName: c.name,
              });
            }
            out.push({ kind: 'viewAll', communityId: c.id, name: c.name });
          }
        }
        return out;
      }
    }
    for (const c of filtered) {
      out.push({ kind: 'community', item: c });
      if (expanded.has(c.id) || q) {
        for (const ch of c.channels) {
          out.push({
            kind: 'channel',
            communityId: c.id,
            channel: ch,
            communityName: c.name,
          });
        }
        out.push({ kind: 'viewAll', communityId: c.id, name: c.name });
      }
    }
    return out;
  }, [filtered, expanded, pinned, q]);

  const keyExtractor = useCallback((row: ListRow, i: number) => {
    if (row.kind === 'new') return 'new';
    if (row.kind === 'search') return 'search';
    if (row.kind === 'join') return 'join';
    if (row.kind === 'section') return `sec:${row.title}`;
    if (row.kind === 'community') return `c:${row.item.id}`;
    if (row.kind === 'channel') return `ch:${row.channel.id}`;
    if (row.kind === 'viewAll') return `va:${row.communityId}`;
    return String(i);
  }, []);

  const renderItem = useCallback(
    ({ item: row }: { item: ListRow }) => {
      if (row.kind === 'new') {
        return (
          <Pressable
            style={({ pressed }) => [styles.newRow, pressed && styles.pressed]}
            onPress={() => navigation.navigate('CreateCommunity')}
            accessibilityRole="button"
            accessibilityLabel="New community"
          >
            <View style={styles.newIconWrap}>
              <View style={styles.newIcon}>
                <Ionicons name="people" size={26} color="#fff" />
              </View>
              <View style={styles.newPlus}>
                <Ionicons name="add" size={14} color="#fff" />
              </View>
            </View>
            <View style={styles.newTextCol}>
              <Text style={styles.newLabel}>New community</Text>
              <Text style={styles.newSub}>Bring groups together in one place</Text>
            </View>
          </Pressable>
        );
      }
      if (row.kind === 'search') {
        return (
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={colors.textFaint} />
            <TextInput
              ref={searchRef}
              style={styles.searchInput}
              placeholder="Search communities and groups"
              placeholderTextColor={colors.textFaint}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
              accessibilityLabel="Search communities"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.textFaint} />
              </Pressable>
            )}
          </View>
        );
      }
      if (row.kind === 'join') {
        return (
          <View style={styles.joinRow}>
            <TextInput
              style={styles.joinInput}
              placeholder="Join with community ID"
              placeholderTextColor={colors.textFaint}
              value={joinId}
              onChangeText={setJoinId}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="join"
              onSubmitEditing={() => void handleJoin()}
            />
            <Pressable
              style={[styles.joinBtn, (!joinId.trim() || joining) && styles.joinBtnDisabled]}
              onPress={() => void handleJoin()}
              disabled={!joinId.trim() || joining}
            >
              {joining ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.joinBtnText}>Join</Text>
              )}
            </Pressable>
          </View>
        );
      }
      if (row.kind === 'section') {
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{row.title}</Text>
          </View>
        );
      }
      if (row.kind === 'community') {
        const c = row.item;
        const isOpen = expanded.has(c.id) || !!q;
        const isMuted = muted.has(c.id);
        const isPinned = pinned.has(c.id);
        const unread = c.totalUnread ?? 0;
        return (
          <Pressable
            style={({ pressed }) => [styles.communityRow, pressed && styles.pressed]}
            onPress={() => toggleExpand(c.id)}
            onLongPress={() => openCommunityMenu(c)}
            delayLongPress={280}
            accessibilityRole="button"
            accessibilityState={{ expanded: isOpen }}
            accessibilityLabel={`${c.name}${unread ? `, ${unread} unread` : ''}`}
          >
            <Avatar uri={c.avatar_url} name={c.name} size={52} />
            <View style={styles.commBody}>
              <View style={styles.commTop}>
                <Text style={styles.commName} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={[styles.commTime, unread > 0 && styles.commTimeUnread]}>
                  {formatListTimestamp(c.lastActivityAt)}
                </Text>
              </View>
              <View style={styles.commBottom}>
                <Text style={styles.commPreview} numberOfLines={1}>
                  {c.lastPreview || c.description || 'Tap to view groups'}
                </Text>
                <View style={styles.commMeta}>
                  {isPinned && (
                    <Ionicons name="pin" size={14} color={colors.textFaint} style={{ marginLeft: 4 }} />
                  )}
                  {isMuted && (
                    <Ionicons
                      name="notifications-off"
                      size={14}
                      color={colors.textFaint}
                      style={{ marginLeft: 4 }}
                    />
                  )}
                  {unread > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
                    </View>
                  )}
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.textFaint}
                    style={{ marginLeft: 4 }}
                  />
                </View>
              </View>
            </View>
          </Pressable>
        );
      }
      if (row.kind === 'channel') {
        const ch = row.channel;
        const isAnn = ch.kind === 'announcement';
        const unread = ch.unreadCount ?? 0;
        return (
          <Pressable
            style={({ pressed }) => [styles.channelRow, pressed && styles.pressed]}
            onPress={() =>
              navigation.navigate('Chat', {
                conversationId: ch.conversation_id,
                title: isAnn ? 'Announcements' : ch.name,
              })
            }
            accessibilityRole="button"
            accessibilityLabel={isAnn ? 'Announcements' : ch.name}
          >
            <View style={[styles.channelAvatar, isAnn && styles.annAvatar]}>
              {isAnn ? (
                <Ionicons name="megaphone" size={20} color="#fff" />
              ) : (
                <Avatar uri={null} name={ch.name} size={40} />
              )}
            </View>
            <View style={styles.channelBody}>
              <View style={styles.commTop}>
                <Text style={styles.channelName} numberOfLines={1}>
                  {isAnn ? 'Announcements' : ch.name}
                </Text>
                <Text style={[styles.commTime, unread > 0 && styles.commTimeUnread]}>
                  {formatListTimestamp(ch.lastMessageAt)}
                </Text>
              </View>
              <View style={styles.commBottom}>
                <Text style={styles.commPreview} numberOfLines={1}>
                  {ch.lastMessagePreview || (isAnn ? 'Community announcements' : 'Tap to open group')}
                </Text>
                {unread > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        );
      }
      if (row.kind === 'viewAll') {
        return (
          <Pressable
            style={({ pressed }) => [styles.viewAllRow, pressed && styles.pressed]}
            onPress={() =>
              navigation.navigate('CommunityDetail', {
                communityId: row.communityId,
                name: row.name,
              })
            }
          >
            <View style={styles.viewAllIcon}>
              <Ionicons name="arrow-forward" size={18} color={colors.primary} />
            </View>
            <Text style={styles.viewAllText}>View community</Text>
          </Pressable>
        );
      }
      return null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      styles,
      colors,
      navigation,
      query,
      joinId,
      joining,
      expanded,
      muted,
      pinned,
      q,
      toggleExpand,
    ],
  );

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <FlatList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        initialNumToRender={listPerf.generic.initialNumToRender}
        maxToRenderPerBatch={listPerf.generic.maxToRenderPerBatch}
        windowSize={listPerf.generic.windowSize}
        removeClippedSubviews={listPerf.generic.removeClippedSubviews}
        keyboardShouldPersistTaps="handled"
        onRefresh={() => {
          setRefreshing(true);
          void load({ soft: true });
        }}
        refreshing={refreshing}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <LumixoCat mood="wave" size="md" decorative />
              <Text style={styles.emptyText}>
                {q ? 'No matches' : 'Stay connected with a community'}
              </Text>
              <Text style={styles.emptySub}>
                {q
                  ? 'Try a different search.'
                  : 'Communities bring related groups together and make it easy to get admin announcements.'}
              </Text>
              {!q && (
                <Pressable
                  style={styles.emptyBtn}
                  onPress={() => navigation.navigate('CreateCommunity')}
                >
                  <Text style={styles.emptyBtnText}>New community</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )
        }
        contentContainerStyle={
          items.length === 0 && !loading ? { flexGrow: 1 } : { paddingBottom: spacing(6) }
        }
      />
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    pressed: { opacity: 0.92 },
    newRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3.5),
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    newIconWrap: { width: 52, height: 52 },
    newIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    newPlus: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.primaryDark || colors.primary,
      borderWidth: 2,
      borderColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    newTextCol: { flex: 1, marginLeft: spacing(3.5) },
    newLabel: {
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '600',
    },
    newSub: {
      color: colors.textMuted,
      fontSize: font.small,
      marginTop: 2,
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: spacing(4),
      marginTop: spacing(3),
      marginBottom: spacing(1),
      paddingHorizontal: spacing(3),
      height: 42,
      borderRadius: radius.pill,
      backgroundColor: colors.isLight ? colors.surfaceAlt : colors.surface,
      gap: 8,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: font.body,
      paddingVertical: 0,
    },
    joinRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(2.5),
      gap: spacing(2),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    joinInput: {
      flex: 1,
      backgroundColor: colors.surface,
      color: colors.text,
      borderRadius: radius.pill,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(2.5),
      fontSize: font.small,
    },
    joinBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.pill,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(2.5),
      minWidth: 64,
      alignItems: 'center',
    },
    joinBtnDisabled: { opacity: 0.45 },
    joinBtnText: { color: '#fff', fontSize: font.small, fontWeight: '700' },
    section: {
      paddingHorizontal: spacing(4),
      paddingTop: spacing(3),
      paddingBottom: spacing(1),
      backgroundColor: colors.bg,
    },
    sectionTitle: {
      color: colors.textMuted,
      fontSize: font.small,
      fontWeight: '700',
      letterSpacing: 0.3,
      textTransform: 'uppercase',
    },
    communityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(2.75),
      backgroundColor: colors.surface,
      minHeight: 72,
    },
    commBody: { flex: 1, marginLeft: spacing(3), minWidth: 0 },
    commTop: { flexDirection: 'row', alignItems: 'center' },
    commName: {
      flex: 1,
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '600',
      marginRight: 8,
    },
    commTime: { color: colors.textFaint, fontSize: font.tiny },
    commTimeUnread: { color: colors.primary, fontWeight: '600' },
    commBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
    commPreview: {
      flex: 1,
      color: colors.textMuted,
      fontSize: font.small,
      marginRight: 6,
    },
    commMeta: { flexDirection: 'row', alignItems: 'center' },
    badge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
      marginLeft: 4,
    },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    channelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: spacing(4) + 20,
      paddingRight: spacing(4),
      paddingVertical: spacing(2.25),
      backgroundColor: colors.bg,
      minHeight: 64,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.isLight ? 'rgba(0,0,0,0.04)' : colors.border,
    },
    channelAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    annAvatar: {
      backgroundColor: colors.primary,
    },
    channelBody: { flex: 1, marginLeft: spacing(3), minWidth: 0 },
    channelName: {
      flex: 1,
      color: colors.text,
      fontSize: font.body,
      fontWeight: '600',
      marginRight: 8,
    },
    viewAllRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: spacing(4) + 20,
      paddingRight: spacing(4),
      paddingVertical: spacing(2.5),
      backgroundColor: colors.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      marginBottom: spacing(1),
    },
    viewAllIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.isLight ? 'rgba(0,168,132,0.12)' : 'rgba(0,168,132,0.18)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewAllText: {
      marginLeft: spacing(3),
      color: colors.primary,
      fontSize: font.body,
      fontWeight: '600',
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing(8),
      minHeight: 320,
    },
    emptyText: {
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '700',
      marginTop: spacing(3),
      textAlign: 'center',
    },
    emptySub: {
      color: colors.textMuted,
      fontSize: font.small,
      textAlign: 'center',
      marginTop: spacing(1.5),
      lineHeight: 20,
    },
    emptyBtn: {
      marginTop: spacing(5),
      backgroundColor: colors.primary,
      paddingHorizontal: spacing(6),
      paddingVertical: spacing(3),
      borderRadius: radius.pill,
    },
    emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: font.body },
  });
