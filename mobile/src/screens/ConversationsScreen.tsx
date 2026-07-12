// Lumixo mobile — Chats tab. Loads getMyConversations on focus, shows
// title/avatar/last-message/unread, and routes into a thread.
//
// Long-press performance contract (WhatsApp parity):
//  • openChatMenu never awaits network / Supabase / list rebuilds.
//  • Haptics + showSheet fire on the same JS turn as the gesture.
//  • ChatRow is React.memo'd so opening the menu does not re-render the list.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
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
  getFavoriteIds,
  getMutedIds,
  muteConversation,
  unmuteConversation,
  getArchivedIds,
  deleteConversationForMe,
  deleteConversationForEveryone,
  getDeletedConversationIds,
  archiveConversation,
  markConversationRead,
  blockUser,
  submitReport,
  joinPresence,
  leavePresence,
  subscribeToConversationRemovals,
  getPremiumUserIds,
  getServerPremium,
  FREE_LIMITS,
  getMyStreaks,
  processMyStreaks,
  subscribeStreakChanges,
  indexStreaksByConversation,
  isVideoMessage,
} from '../lib/shared';
import type { ConversationSummary, MessageSearchHit, StreakSummary } from '../lib/shared';
import {
  getCachedConversations, cacheConversations, getCache, setCache,
  pendingConversationEffects, reconcileIds, mergeEffects,
} from '../lib/localCache';
import { onConnectivity, queueAction } from '../lib/sync';
import { formatListTimestamp } from '../lib/time';
import { useColors, spacing, radius, font, listPerf, animateLayoutSoft, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import StatusStrip from '../components/status/StatusStrip';
import { useChatLock } from '../security/ChatLock';
import type { RootStackParamList } from '../navigation/types';
import { Alert, showSheet } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Enable smooth height/opacity transitions for the contextual selection bar on
// Android (LayoutAnimation is opt-in there). No-op if already enabled.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const animateSelection = () => animateLayoutSoft();

// Cache-key bases for the per-user conversation flag sets, so pinned/muted/hidden
// state hydrates instantly (offline included) and survives an app restart.
const FLAG_KEY = { pinned: 'pinned', muted: 'muted', hidden: 'hidden', favorites: 'favorites' } as const;

// Primary filter chips (WhatsApp-class: short strip so chats stay above the fold).
// Extra facets (Pinned / Streaks / Locked) live under "More".
type ChatFilter = 'all' | 'unread' | 'groups' | 'favorites' | 'pinned' | 'streaks' | 'locked';
const PRIMARY_CHIPS: { key: ChatFilter; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'unread',    label: 'Unread' },
  { key: 'groups',    label: 'Groups' },
  { key: 'favorites', label: 'Favourites' },
];
const MORE_CHIPS: { key: ChatFilter; label: string }[] = [
  { key: 'pinned',  label: 'Pinned' },
  { key: 'streaks', label: 'Streaks' },
  { key: 'locked',  label: 'Locked' },
];
const ALL_CHIP_LABELS: Record<ChatFilter, string> = {
  all: 'All', unread: 'Unread', groups: 'Groups', favorites: 'Favourites',
  pinned: 'Pinned', streaks: 'Streaks', locked: 'Locked',
};

// Pure helpers — kept outside the screen so row renders never capture unstable closures.
function lastPreviewBody(c: ConversationSummary): string {
  const m = c.lastMessage;
  if (!m) return 'Tap to start chatting';
  if (m.is_deleted) return 'This message was deleted';
  if (m.type === 'system') return m.content ?? '';
  if (m.type === 'image') return /\.gif(\?|#|$)/i.test(m.media_url ?? '') ? '🎞️ GIF' : '📷 Photo';
  if (m.type === 'audio') return '🎤 Voice message';
  if (m.type === 'video' || isVideoMessage(m)) return '🎥 Video';
  if (m.type === 'file') return m.content?.trim() ? `📄 ${m.content}` : '📄 Document';
  if (m.content?.startsWith('📊')) return m.content;
  return m.content ?? '';
}

function lastPreviewMine(c: ConversationSummary, uid: string | null): boolean {
  return (
    !!uid &&
    !!c.lastMessage &&
    !c.lastMessage.is_deleted &&
    c.lastMessage.sender_id === uid &&
    c.lastMessage.type !== 'system'
  );
}

function previewLine(item: ConversationSummary, uid: string | null, isGroup: boolean): string {
  const body = lastPreviewBody(item);
  if (lastPreviewMine(item, uid)) return body;
  if (!item.lastMessage || item.lastMessage.is_deleted || item.lastMessage.type === 'system') {
    return body;
  }
  if (isGroup) {
    const name = item.participants.find((p) => p.id === item.lastMessage?.sender_id)?.display_name;
    return name ? `${name.split(' ')[0]}: ${body}` : body;
  }
  return body;
}

type ChatRowStyles = ReturnType<typeof makeStyles>;

type ChatRowProps = {
  item: ConversationSummary;
  uid: string | null;
  selected: boolean;
  selectionGen: number;
  isFav: boolean;
  isMuted: boolean;
  isPinned: boolean;
  peerOnline: boolean;
  peerPremium: boolean;
  locked: boolean;
  streakEmoji: string;
  streakScore: number | string;
  colors: Palette;
  styles: ChatRowStyles;
  selectionMode: boolean;
  onPressChat: (item: ConversationSummary) => void;
  onLongPressChat: (id: string) => void;
  onToggleSelect: (id: string) => void;
};

/** Memoized conversation row — long-press must not re-render the whole list. */
const ChatRow = React.memo(function ChatRow({
  item,
  uid,
  selected,
  selectionGen,
  isFav,
  isMuted,
  isPinned,
  peerOnline,
  peerPremium,
  locked,
  streakEmoji,
  streakScore,
  colors,
  styles,
  selectionMode,
  onPressChat,
  onLongPressChat,
  onToggleSelect,
}: ChatRowProps) {
  const id = item.conversation.id;
  const isGroup = item.conversation.type === 'group';
  const disappearing = (item.conversation.disappear_seconds ?? 0) > 0;
  const mine = lastPreviewMine(item, uid);

  return (
    <Pressable
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed]}
      onPress={() => (selectionMode ? onToggleSelect(id) : onPressChat(item))}
      onLongPress={() => (selectionMode ? onToggleSelect(id) : onLongPressChat(id))}
      delayLongPress={280}
    >
      <View>
        <Avatar uri={item.avatarUrl} name={item.title} size={48} />
        {peerOnline && !selected && <View style={styles.onlineDot} />}
        {disappearing && !selected && (
          <View style={styles.disappearBadge}>
            <Ionicons name="timer-outline" size={11} color="#fff" />
          </View>
        )}
        {selected ? (
          <View style={styles.checkOverlay} key={`sel-on-${id}-${selectionGen}`}>
            <Ionicons name="checkmark" size={16} color="#fff" />
          </View>
        ) : null}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <View style={styles.titleWrap}>
            {isGroup && (
              <Ionicons name="people" size={14} color={colors.textMuted} style={{ marginRight: 4 }} />
            )}
            <Text
              style={[styles.title, item.unreadCount > 0 && styles.titleUnread]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {isFav && (
              <Ionicons name="star" size={13} color="#f5b800" style={{ marginLeft: 4 }} />
            )}
            {peerPremium && !isFav && (
              <Ionicons name="sparkles" size={12} color={colors.primary} style={{ marginLeft: 4 }} />
            )}
          </View>
          <Text style={[styles.time, item.unreadCount > 0 && styles.timeUnread]}>
            {formatListTimestamp(item.lastMessage?.created_at)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <View style={styles.previewWrap}>
            {mine && (
              <Ionicons
                name="checkmark-done"
                size={16}
                color={colors.textFaint}
                style={styles.previewTick}
              />
            )}
            <Text
              style={[styles.preview, item.unreadCount > 0 && styles.previewUnread]}
              numberOfLines={1}
            >
              {mine ? lastPreviewBody(item) : previewLine(item, uid, isGroup)}
            </Text>
          </View>
          <View style={styles.rowIcons}>
            {streakEmoji !== '' && (
              <Text
                style={styles.streakEmoji}
                allowFontScaling={false}
                accessibilityLabel={`Streak ${streakScore}`}
              >
                {streakEmoji}
              </Text>
            )}
            {locked && (
              <Ionicons name="lock-closed" size={13} color={colors.textFaint} style={{ marginLeft: spacing(1) }} />
            )}
            {isMuted && (
              <Ionicons name="notifications-off" size={14} color={colors.textFaint} style={{ marginLeft: spacing(1) }} />
            )}
            {isPinned && (
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
});

export default function ConversationsScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const chatLock = useChatLock();

  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [msgHits, setMsgHits] = useState<MessageSearchHit[]>([]);
  // Ordered pin list (WhatsApp: first-pinned stays first). Set is derived for O(1) has().
  const [pinnedOrder, setPinnedOrder] = useState<string[]>([]);
  const pinnedIds = useMemo(() => new Set(pinnedOrder), [pinnedOrder]);
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [premiumIds, setPremiumIds] = useState<Set<string>>(new Set());
  const [isPremium, setIsPremium] = useState(false);
  // Streak emoji per conversation (server-authoritative score → tier). Hydrated
  // from local cache first (instant/offline), then refreshed in the background.
  const [streaks, setStreaks] = useState<Record<string, StreakSummary>>({});
  // WhatsApp-style multi-select: a non-empty set puts the list in selection mode
  // and swaps the top bar for a contextual action bar.
  // Use a Map-like Set + generation counter so FlatList rows re-render immediately
  // when selection changes (extraData alone is not always enough with memoized rows).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectionGen, setSelectionGen] = useState(0);
  const selectionMode = selectedIds.size > 0;

  // Filter chips — primary four always visible; "More" expands secondary facets.
  // Favourites are true favourite chats (favorite_conversations), not starred msgs.
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [moreFilters, setMoreFilters] = useState(false);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  const q = query.trim().toLowerCase();
  const convById = useMemo(() => {
    const m = new Map<string, ConversationSummary>();
    items.forEach((c) => m.set(c.conversation.id, c));
    return m;
  }, [items]);
  // Locked chats (0027) present in the list — hidden until the Locked area is
  // authenticated this session (chatLock.unlocked). Counted for the header entry.
  const lockedCount = useMemo(
    () => items.filter((c) => chatLock.isLocked(c.conversation.id)).length,
    [items, chatLock],
  );

  const filteredItems = useMemo(() => {
    // Archived / deleted-for-me chats never appear on the main list (they live in
    // Settings › Archived chats); a chat is un-hidden by unarchiving or a new msg.
    const base0 = items.filter((c) => !hiddenIds.has(c.conversation.id));
    // Locked chats stay hidden (no preview, not openable) until the Locked area is
    // unlocked with device authentication this session — EXCEPT when the Locked
    // chip is active, which surfaces the (still-locked) rows so the user can tap
    // through the auth prompt to reveal them.
    const base = chatLock.unlocked || filter === 'locked'
      ? base0
      : base0.filter((c) => !chatLock.isLocked(c.conversation.id));
    // Chip filters (WhatsApp/Telegram folder pattern). `all` short-circuits.
    const faceted = base.filter((c) => {
      const id = c.conversation.id;
      switch (filter) {
        case 'unread':    return c.unreadCount > 0;
        case 'groups':    return c.conversation.type === 'group';
        case 'favorites': return favIds.has(id);
        case 'pinned':    return pinnedIds.has(id);
        case 'streaks':   return (streaks[id]?.score ?? 0) > 0;
        case 'locked':    return chatLock.isLocked(id);
        default:          return true;
      }
    });
    const searched = q ? faceted.filter((c) => c.title.toLowerCase().includes(q)) : faceted;
    // Pinned conversations float to the top in pin order (oldest pin first).
    // Unpinned keep getMyConversations recency order.
    const pinIndex = new Map(pinnedOrder.map((id, i) => [id, i]));
    return [...searched].sort((a, b) => {
      const ai = pinIndex.has(a.conversation.id) ? pinIndex.get(a.conversation.id)! : 1e9;
      const bi = pinIndex.has(b.conversation.id) ? pinIndex.get(b.conversation.id)! : 1e9;
      if (ai !== bi) return ai - bi;
      // Both unpinned (or same pin rank) — preserve list order (stable sort).
      return 0;
    });
  }, [items, q, hiddenIds, pinnedOrder, chatLock, filter, favIds, streaks]);

  // Per-conversation peer helpers for direct chats (presence dot + premium badge).
  const peerOf = useCallback(
    (c: ConversationSummary) =>
      c.conversation.type === 'direct' ? c.participants.find((p) => p.id !== uid) ?? null : null,
    [uid],
  );

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

  // Global presence — mark direct-chat peers online with a green dot (web parity).
  useEffect(() => {
    let channel: ReturnType<typeof joinPresence> | null = null;
    let alive = true;
    getCurrentUser(supabase)
      .then((me) => {
        if (!alive || !me?.id) return;
        channel = joinPresence(supabase, me.id, (ids) => { if (alive) setOnlineIds(ids); });
      })
      .catch(() => {});
    return () => {
      alive = false;
      leavePresence(channel); // shared room: unhook this screen only
    };
  }, []);

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
            // Instant hydrate: list + the pin/mute/hidden flag sets, all from
            // local cache, so the chats AND their badges/order appear offline
            // with zero network wait. The background load() reconciles later.
            const [cached, pinned, muted, hidden, favs, cachedStreaks] = await Promise.all([
              getCachedConversations(id),
              getCache<string[]>(`${FLAG_KEY.pinned}:${id}`, []),
              getCache<string[]>(`${FLAG_KEY.muted}:${id}`, []),
              getCache<string[]>(`${FLAG_KEY.hidden}:${id}`, []),
              getCache<string[]>(`${FLAG_KEY.favorites}:${id}`, []),
              getCache<StreakSummary[]>(`streaks:${id}`, []),
            ]);
            if (!alive) return;
            if (pinned.length) setPinnedOrder(pinned);
            if (muted.length) setMutedIds(new Set(muted));
            if (hidden.length) setHiddenIds(new Set(hidden));
            if (favs.length) setFavIds(new Set(favs));
            if (cachedStreaks.length) setStreaks(indexStreaksByConversation(cachedStreaks));
            if (cached.length) {
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
      // Per-user conversation flags (pin/mute/hidden) + premium wiring. Hidden
      // must be loaded here so hidden chats stay hidden across reloads (web parity).
      // Capture in-flight pin/mute/archive effects BEFORE the server reads, so an
      // action that syncs (and leaves the queue) mid-read is still honoured.
      const effBefore = await Promise.all([
        pendingConversationEffects(['pin'], ['unpin']),
        pendingConversationEffects(['mute'], ['unmute']),
        pendingConversationEffects(['archive'], ['unarchive']),
        pendingConversationEffects(['favorite'], ['unfavorite']),
      ]);
      Promise.all([
        getPinnedIds(supabase),
        getMutedIds(supabase),
        getArchivedIds(supabase),
        getDeletedConversationIds(supabase),
        getFavoriteIds(supabase),
      ])
        .then(async ([pinned, muted, archived, deleted, favorites]) => {
          // Fold in optimistic pin/mute/archive/favorite still queued (not yet
          // synced) so this background server read never reverts a flag the user
          // just toggled. Merge before/after queue snapshots so the change survives
          // even if its sync landed (and dequeued) between the two awaits.
          const [pinEffA, muteEffA, arcEffA, favEffA] = await Promise.all([
            pendingConversationEffects(['pin'], ['unpin']),
            pendingConversationEffects(['mute'], ['unmute']),
            pendingConversationEffects(['archive'], ['unarchive']),
            pendingConversationEffects(['favorite'], ['unfavorite']),
          ]);
          const pinEff = mergeEffects(effBefore[0], pinEffA);
          const muteEff = mergeEffects(effBefore[1], muteEffA);
          const arcEff = mergeEffects(effBefore[2], arcEffA);
          const favEff = mergeEffects(effBefore[3], favEffA);
          // Preserve server pin order, then apply add/remove effects.
          const pinnedSet = reconcileIds(pinned, pinEff);
          const pinnedOrdered = [
            ...pinned.filter((id) => pinnedSet.has(id)),
            ...[...pinnedSet].filter((id) => !pinned.includes(id)),
          ];
          const mutedSet = reconcileIds(muted, muteEff);
          const favSet = reconcileIds(favorites, favEff);
          setPinnedOrder(pinnedOrdered);
          setMutedIds(mutedSet);
          setFavIds(favSet);
          // Archived + "Delete for me" chats leave the main list.
          const hiddenSet = reconcileIds([...archived, ...deleted], arcEff);
          setHiddenIds(hiddenSet);
          if (uid) {
            setCache(`${FLAG_KEY.pinned}:${uid}`, pinnedOrdered).catch(() => {});
            setCache(`${FLAG_KEY.muted}:${uid}`, [...mutedSet]).catch(() => {});
            setCache(`${FLAG_KEY.hidden}:${uid}`, [...hiddenSet]).catch(() => {});
            setCache(`${FLAG_KEY.favorites}:${uid}`, [...favSet]).catch(() => {});
          }
        })
        .catch(() => {});
      getPremiumUserIds(supabase).then((ids) => setPremiumIds(new Set(ids))).catch(() => {});
      getServerPremium(supabase).then(setIsPremium).catch(() => {});
      // Streaks: finalise any of the caller's pending days (idempotent server-side
      // catch-up — never computes points on-device), then refresh the authoritative
      // summaries and rewrite the local cache so the emoji is instant next launch.
      (async () => {
        await processMyStreaks(supabase).catch(() => 0);
        const list = await getMyStreaks(supabase).catch(() => [] as StreakSummary[]);
        setStreaks(indexStreaksByConversation(list));
        const u2 = await getCurrentUser(supabase).catch(() => null);
        if (u2?.id) setCache(`streaks:${u2.id}`, list).catch(() => {});
      })();
    } catch {
      // keep last known (cached) list on transient errors / offline
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
      chatLock.refresh();
    }, [load, chatLock.refresh]),
  );

  // Instantly drop conversations from the visible list AND the offline cache.
  // This is the single source of "the chat is gone now": removing from `items`
  // makes it vanish immediately regardless of filters, and rewriting the cache
  // stops it resurrecting on the next focus / cold open (the reported "only
  // disappears after pull-to-refresh" bug — the optimistic hide alone was being
  // undone by the background load() + a stale cache). Idempotent.
  const dropConversationsLocally = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const idSet = new Set(ids);
    animateSelection();
    setItems((prev) => {
      const next = prev.filter((c) => !idSet.has(c.conversation.id));
      if (next.length !== prev.length && uid) cacheConversations(uid, next).catch(() => {});
      return next;
    });
  }, [uid]);

  // Flip a flag set (muted/hidden/favorites) locally AND persist it to cache in one
  // step, so the change is instant, offline-safe, and survives an app restart.
  const setFlagSet = useCallback((
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    keyBase: string,
    ids: string[],
    add: boolean,
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (add ? next.add(id) : next.delete(id)));
      if (uid) setCache(`${keyBase}:${uid}`, [...next]).catch(() => {});
      return next;
    });
  }, [uid]);

  /** Pin order-preserving add/remove (WhatsApp: new pins append to the end). */
  const setPinnedFlags = useCallback((ids: string[], add: boolean) => {
    setPinnedOrder((prev) => {
      let next: string[];
      if (add) {
        const existing = new Set(prev);
        next = [...prev, ...ids.filter((id) => !existing.has(id))];
      } else {
        const drop = new Set(ids);
        next = prev.filter((id) => !drop.has(id));
      }
      if (uid) setCache(`${FLAG_KEY.pinned}:${uid}`, next).catch(() => {});
      return next;
    });
  }, [uid]);

  // Realtime: keep every device in sync. When a chat is deleted for everyone
  // (participant rows cascade-delete) or deleted for me on another device
  // (deleted_conversations insert), drop it here too — no manual refresh needed.
  useEffect(() => {
    if (!uid) return;
    const ch = subscribeToConversationRemovals(supabase, uid, (cid) => dropConversationsLocally([cid]));
    return () => { supabase.removeChannel(ch); };
  }, [uid, dropConversationsLocally]);

  // Realtime: when the authoritative streak score changes (award/penalty/milestone),
  // refresh the summaries + cache so the chat-list emoji updates without a manual
  // reload. One debounced channel; cleaned up on unmount (no duplicate subscriptions).
  useEffect(() => {
    if (!uid) return;
    const sub = subscribeStreakChanges(supabase, async () => {
      const list = await getMyStreaks(supabase).catch(() => [] as StreakSummary[]);
      setStreaks(indexStreaksByConversation(list));
      setCache(`streaks:${uid}`, list).catch(() => {});
    });
    return () => sub.unsubscribe();
  }, [uid]);

  // ── Multi-select mode (WhatsApp-style) ──────────────────────────────────────
  // Selection is a set of conversation ids. Always return a NEW Set instance so
  // React + FlatList (extraData) re-render every affected row immediately — this
  // is what fixes the "blue checkmark stays after deselect" bug.
  const toggleSelect = useCallback((id: string) => {
    animateSelection();
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    setSelectionGen((g) => g + 1);
  }, []);
  const enterSelection = useCallback((id: string) => {
    Haptics.selectionAsync().catch(() => {});
    animateSelection();
    setSelectedIds(new Set([id]));
    setSelectionGen((g) => g + 1);
  }, []);
  const clearSelection = useCallback(() => {
    animateSelection();
    setSelectedIds(new Set());
    setSelectionGen((g) => g + 1);
  }, []);

  // Hardware Back exits selection mode instead of leaving the tab (Android).
  useEffect(() => {
    if (!selectionMode) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      clearSelection();
      return true;
    });
    return () => sub.remove();
  }, [selectionMode, clearSelection]);

  // Derived facts about the current selection that drive which actions show and
  // whether they read as the "on" or "off" (toggle) variant.
  const selConvs = useMemo(
    () => [...selectedIds].map((id) => convById.get(id)).filter((c): c is ConversationSummary => !!c),
    [selectedIds, convById],
  );
  const selCount = selectedIds.size;
  const allPinned = selCount > 0 && selConvs.every((c) => pinnedIds.has(c.conversation.id));
  const allMuted = selCount > 0 && selConvs.every((c) => mutedIds.has(c.conversation.id));
  const allHidden = selCount > 0 && selConvs.every((c) => hiddenIds.has(c.conversation.id));
  const anyUnread = selConvs.some((c) => c.unreadCount > 0);
  const allVisibleSelected = filteredItems.length > 0 && selCount >= filteredItems.length;
  const singleDirect = selCount === 1 && selConvs[0]?.conversation.type === 'direct';
  const singleConv = selCount === 1 ? selConvs[0] : null;
  const singlePeer = singleDirect ? singleConv?.participants.find((p) => p.id !== uid) ?? null : null;

  // Pin / unpin the whole selection (mixed → pin all; all-pinned → unpin all).
  function batchPin() {
    const ids = selConvs.map((c) => c.conversation.id);
    const unpin = allPinned;
    if (!unpin) {
      const toPin = ids.filter((id) => !pinnedIds.has(id));
      if (!isPremium && pinnedOrder.length + toPin.length > FREE_LIMITS.pinnedChats) {
        clearSelection();
        Alert.alert(
          'Pin limit reached',
          `Free accounts can pin up to ${FREE_LIMITS.pinnedChats} chats. Upgrade to Lumixo+ for unlimited pins.`,
          [{ text: 'Not now', style: 'cancel' }, { text: 'Upgrade', onPress: () => navigation.navigate('Premium') }],
        );
        return;
      }
    }
    clearSelection();
    setPinnedFlags(ids, !unpin);
    ids.forEach((id) => queueAction(unpin ? 'unpin' : 'pin', { conversationId: id }));
  }

  function batchFavorite() {
    const ids = selConvs.map((c) => c.conversation.id);
    const remove = ids.length > 0 && ids.every((id) => favIds.has(id));
    clearSelection();
    setFlagSet(setFavIds, FLAG_KEY.favorites, ids, !remove);
    ids.forEach((id) => queueAction(remove ? 'unfavorite' : 'favorite', { conversationId: id }));
  }

  /** Single-chat pin/unpin (long-press menu). Runs only after the sheet is already open. */
  const togglePinOne = useCallback((id: string) => {
    const was = pinnedIds.has(id);
    if (!was && !isPremium && pinnedOrder.length >= FREE_LIMITS.pinnedChats) {
      Alert.alert(
        'Pin limit reached',
        `Free accounts can pin up to ${FREE_LIMITS.pinnedChats} chats. Upgrade to Lumixo+ for unlimited pins.`,
        [{ text: 'Not now', style: 'cancel' }, { text: 'Upgrade', onPress: () => navigation.navigate('Premium') }],
      );
      return;
    }
    setPinnedFlags([id], !was);
    queueAction(was ? 'unpin' : 'pin', { conversationId: id });
  }, [pinnedIds, isPremium, pinnedOrder.length, navigation]);

  const toggleFavoriteOne = useCallback((id: string) => {
    const was = favIds.has(id);
    setFlagSet(setFavIds, FLAG_KEY.favorites, [id], !was);
    queueAction(was ? 'unfavorite' : 'favorite', { conversationId: id });
  }, [favIds]);

  // Live menu metadata via ref so openChatMenu stays identity-stable and never
  // re-renders every chat row when pins/favs/mutes change.
  const menuMetaRef = useRef({
    pinnedIds,
    favIds,
    mutedIds,
    convById,
    togglePinOne,
    toggleFavoriteOne,
    enterSelection,
    deleteOneChat: (_id: string) => {},
  });
  menuMetaRef.current.pinnedIds = pinnedIds;
  menuMetaRef.current.favIds = favIds;
  menuMetaRef.current.mutedIds = mutedIds;
  menuMetaRef.current.convById = convById;
  menuMetaRef.current.togglePinOne = togglePinOne;
  menuMetaRef.current.toggleFavoriteOne = toggleFavoriteOne;
  menuMetaRef.current.enterSelection = enterSelection;

  /**
   * Long-press → haptic + sheet. Must be synchronous, zero network, zero list work.
   * showSheet stages content on the pre-mounted host and animates in the same frame.
   */
  const openChatMenu = useCallback((id: string) => {
    // Fire haptic first (native, non-blocking) then open the pre-mounted sheet.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const m = menuMetaRef.current;
    const isPinned = m.pinnedIds.has(id);
    const isFav = m.favIds.has(id);
    const isMuted = m.mutedIds.has(id);
    const title = m.convById.get(id)?.title ?? 'Chat';
    showSheet({
      title,
      actions: [
        {
          text: isPinned ? 'Unpin chat' : 'Pin chat',
          icon: 'info',
          onPress: () => m.togglePinOne(id),
        },
        {
          text: isFav ? 'Remove from favourites' : 'Add to favourites',
          icon: 'success',
          onPress: () => m.toggleFavoriteOne(id),
        },
        {
          text: isMuted ? 'Unmute' : 'Mute',
          icon: 'settings',
          onPress: () => {
            setFlagSet(setMutedIds, FLAG_KEY.muted, [id], !isMuted);
            queueAction(isMuted ? 'unmute' : 'mute', { conversationId: id });
          },
        },
        {
          text: 'Archive',
          icon: 'file',
          onPress: () => {
            setFlagSet(setHiddenIds, FLAG_KEY.hidden, [id], true);
            queueAction('archive', { conversationId: id });
          },
        },
        {
          text: 'Select',
          icon: 'check',
          onPress: () => m.enterSelection(id),
        },
        {
          text: 'Delete chat',
          icon: 'trash',
          style: 'destructive',
          onPress: () => m.deleteOneChat(id),
        },
      ],
    });
  }, []);

  function deleteOneChat(id: string) {
    const conv = convById.get(id);
    const canEveryone =
      !!conv &&
      (conv.conversation.type === 'direct' || conv.conversation.created_by === uid);
    const buttons: any[] = [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete for me',
        style: 'destructive',
        onPress: () => {
          dropConversationsLocally([id]);
          queueAction('deleteForMe', { conversationId: id });
        },
      },
    ];
    if (canEveryone) {
      buttons.push({
        text: 'Delete for everyone',
        style: 'destructive',
        onPress: () => {
          dropConversationsLocally([id]);
          queueAction('deleteForEveryone', { conversationId: id });
        },
      });
    }
    Alert.alert(
      'Delete chat?',
      canEveryone
        ? 'Delete this chat just for you, or delete it for everyone in the conversation.'
        : 'This removes the chat from your list. The other person will still have their copy.',
      buttons,
    );
  }
  menuMetaRef.current.deleteOneChat = deleteOneChat;

  async function batchMute() {
    const ids = selConvs.map((c) => c.conversation.id);
    const unmute = allMuted;
    clearSelection();
    setFlagSet(setMutedIds, FLAG_KEY.muted, ids, !unmute);
    ids.forEach((id) => queueAction(unmute ? 'unmute' : 'mute', { conversationId: id }));
  }

  async function batchArchive() {
    const ids = selConvs.map((c) => c.conversation.id);
    clearSelection();
    setFlagSet(setHiddenIds, FLAG_KEY.hidden, ids, true); // archived chats leave the main list
    ids.forEach((id) => queueAction('archive', { conversationId: id }));
  }

  // "Delete chat for me" (WhatsApp-style): clears the thread for THIS user only —
  // every message is hidden and the conversation leaves the list. The other person
  // keeps their copy. deleteConversationForMe() does both server-side writes.
  function batchDelete() {
    const ids = selConvs.map((c) => c.conversation.id);
    if (!ids.length) return;

    // "Delete for everyone" is offered only on a SINGLE chat the user is allowed
    // to wipe for all: a direct chat, or a group they created. (Telegram parity.)
    const canEveryone =
      selCount === 1 && !!singleConv &&
      (singleConv.conversation.type === 'direct' || singleConv.conversation.created_by === uid);

    const buttons: any[] = [{ text: 'Cancel', style: 'cancel' }];
    buttons.push({
      text: 'Delete for me',
      style: 'destructive',
      onPress: () => {
        clearSelection();
        // Instant + durable: drop from the list AND the offline cache right away,
        // then queue the server writes (auto-retries on reconnect — never blocks).
        dropConversationsLocally(ids);
        ids.forEach((id) => queueAction('deleteForMe', { conversationId: id }));
      },
    });
    if (canEveryone) {
      buttons.push({
        text: 'Delete for everyone',
        style: 'destructive',
        onPress: () => {
          const id = ids[0];
          clearSelection();
          dropConversationsLocally([id]);
          queueAction('deleteForEveryone', { conversationId: id });
        },
      });
    }

    Alert.alert(
      ids.length > 1 ? `Delete ${ids.length} chats?` : 'Delete chat?',
      canEveryone
        ? 'Delete this chat just for you, or delete it for everyone in the conversation.'
        : 'This removes the chat from your list. The other person will still have their copy.',
      buttons,
    );
  }

  function batchUnhide() {
    const ids = selConvs.map((c) => c.conversation.id);
    clearSelection();
    setFlagSet(setHiddenIds, FLAG_KEY.hidden, ids, false);
    ids.forEach((id) => queueAction('unarchive', { conversationId: id }));
  }

  async function batchMarkRead() {
    const ids = selConvs.filter((c) => c.unreadCount > 0).map((c) => c.conversation.id);
    clearSelection();
    if (!ids.length) return;
    setItems((prev) => prev.map((c) => (ids.includes(c.conversation.id) ? { ...c, unreadCount: 0 } : c)));
    ids.forEach((id) => queueAction('markRead', { conversationId: id }));
    // A background load() reconciles the true count on next focus/refresh.
  }

  function batchBlock() {
    const peer = singlePeer;
    if (!peer) return;
    const name = peer.display_name ?? 'this user';
    Alert.alert('Block contact', `Block ${name}? They won't be able to message you.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          clearSelection();
          // Instant feedback; the block syncs in the background (auto-retries).
          queueAction('block', { userId: peer.id });
          Alert.alert('Blocked', `${name} has been blocked.`);
        },
      },
    ]);
  }

  function batchReport() {
    const peer = singlePeer;
    if (!peer) return;
    Alert.alert('Report contact', `Report ${peer.display_name ?? 'this user'} to the safety team?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: async () => {
          clearSelection();
          const { error } = await submitReport(supabase, 'user', peer.id, 'Reported from chat list');
          Alert.alert(error ? 'Could not report' : 'Reported', error ? error.message : 'Thanks — our team will review this.');
        },
      },
    ]);
  }

  function viewInfo() {
    const peer = singlePeer;
    const conv = singleConv;
    if (!peer || !conv) return;
    clearSelection();
    navigation.navigate('Profile', { userId: peer.id, conversationId: conv.conversation.id });
  }

  function openOverflow() {
    const actions: Array<{
      text: string;
      onPress?: () => void | Promise<void>;
      style?: 'default' | 'destructive' | 'primary' | 'cancel';
      icon?: 'check' | 'person' | 'report' | 'block' | 'info' | 'success';
      subtitle?: string;
    }> = [
      {
        text: allVisibleSelected ? 'Deselect all' : 'Select all',
        icon: 'check',
        onPress: () => toggleSelectAll(),
      },
    ];
    if (anyUnread) {
      actions.push({ text: 'Mark as read', icon: 'success', onPress: () => batchMarkRead() });
    }
    actions.push({
      text: allFav ? 'Remove from favourites' : 'Add to favourites',
      icon: 'success',
      onPress: () => batchFavorite(),
    });
    actions.push({
      text: allPinned ? 'Unpin chat' : 'Pin chat',
      icon: 'info',
      onPress: () => batchPin(),
    });
    if (allHidden) {
      actions.push({
        text: selCount > 1 ? 'Unhide chats' : 'Unhide',
        icon: 'info',
        onPress: () => batchUnhide(),
      });
    }
    if (singleDirect) {
      actions.push(
        { text: 'View contact', icon: 'person', onPress: () => viewInfo() },
        { text: 'Report', icon: 'report', onPress: () => batchReport() },
        { text: 'Block', icon: 'block', style: 'destructive', onPress: () => batchBlock() },
      );
    }
    showSheet({ title: 'Chat actions', actions });
  }

  function toggleSelectAll() {
    animateSelection();
    const visible = filteredItems.map((c) => c.conversation.id);
    setSelectedIds((prev) => (prev.size >= visible.length ? new Set() : new Set(visible)));
    setSelectionGen((g) => g + 1);
  }

  // Stable separator so the list doesn't rebuild every separator each render.
  const Separator = useCallback(() => <View style={styles.sep} />, [styles]);

  // Open chat — mark-read is optimistic and deferred; navigation is immediate.
  const onPressChat = useCallback(
    (item: ConversationSummary) => {
      const id = item.conversation.id;
      if (item.unreadCount > 0) {
        setItems((prev) =>
          prev.map((c) => (c.conversation.id === id ? { ...c, unreadCount: 0 } : c)),
        );
        queueAction('markRead', { conversationId: id });
      }
      navigation.navigate('Chat', { conversationId: id, title: item.title });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: ConversationSummary }) => {
      const id = item.conversation.id;
      const peer = peerOf(item);
      const isGroup = item.conversation.type === 'group';
      return (
        <ChatRow
          item={item}
          uid={uid}
          selected={selectedIds.has(id)}
          selectionGen={selectionGen}
          selectionMode={selectionMode}
          isFav={favIds.has(id)}
          isMuted={mutedIds.has(id)}
          isPinned={pinnedIds.has(id)}
          peerOnline={!!peer && onlineIds.has(peer.id)}
          peerPremium={!!peer && premiumIds.has(peer.id)}
          locked={chatLock.isLocked(id)}
          streakEmoji={!isGroup ? (streaks[id]?.tier ?? '') : ''}
          streakScore={!isGroup ? (streaks[id]?.score ?? '') : ''}
          colors={colors}
          styles={styles}
          onPressChat={onPressChat}
          onLongPressChat={openChatMenu}
          onToggleSelect={toggleSelect}
        />
      );
    },
    [
      peerOf,
      uid,
      selectedIds,
      selectionGen,
      selectionMode,
      favIds,
      mutedIds,
      pinnedIds,
      onlineIds,
      premiumIds,
      chatLock,
      streaks,
      colors,
      styles,
      onPressChat,
      openChatMenu,
      toggleSelect,
    ],
  );

  const allFav = selCount > 0 && selConvs.every((c) => favIds.has(c.conversation.id));

  return (
    <View style={styles.container}>
      {offline && (
        <View style={styles.offlineBar}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineText}>Offline — showing saved chats</Text>
        </View>
      )}

      {/* WhatsApp-style contextual action bar — replaces the search bar while
          one or more chats are selected. Icons adapt to the selection state. */}
      {selectionMode && (
        <View style={styles.selBar}>
          <Pressable hitSlop={10} onPress={clearSelection}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.selCount}>{selCount}</Text>
          <View style={styles.selActions}>
            <SelIcon name={allPinned ? 'pin' : 'pin-outline'} onPress={batchPin} />
            <SelIcon name={allFav ? 'star' : 'star-outline'} onPress={batchFavorite} />
            <SelIcon name={allMuted ? 'notifications' : 'notifications-off-outline'} onPress={batchMute} />
            <SelIcon name="archive-outline" onPress={batchArchive} />
            <SelIcon name="trash-outline" onPress={batchDelete} danger />
            <SelIcon name="ellipsis-vertical" onPress={openOverflow} />
          </View>
        </View>
      )}

      <FlatList
        data={filteredItems}
        keyExtractor={(c) => c.conversation.id}
        renderItem={renderItem}
        // Cheap identity for external row state — avoid joining every fav/pin id (jank).
        extraData={`${selectionGen}:${filter}:${pinnedOrder.length}:${favIds.size}:${mutedIds.size}:${onlineIds.size}`}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={listPerf.chatList.initialNumToRender}
        maxToRenderPerBatch={listPerf.chatList.maxToRenderPerBatch}
        windowSize={listPerf.chatList.windowSize}
        updateCellsBatchingPeriod={listPerf.chatList.updateCellsBatchingPeriod}
        removeClippedSubviews={listPerf.chatList.removeClippedSubviews}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={selectionMode ? null : (
          <View>
            {/* Search bar sits directly below the tab-header title. */}
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
            {/* Primary filter chips — short strip so more chats stay on screen. */}
            {q === '' && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
                keyboardShouldPersistTaps="handled"
              >
                {PRIMARY_CHIPS.map((chip) => {
                  const active = filter === chip.key;
                  return (
                    <Pressable
                      key={chip.key}
                      onPress={() => {
                        animateLayoutSoft();
                        setMoreFilters(false);
                        setFilter(chip.key);
                      }}
                      style={({ pressed }) => [
                        styles.chip,
                        active && styles.chipActive,
                        pressed && !active && styles.chipPressed,
                      ]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {chip.label}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => {
                    animateLayoutSoft();
                    setMoreFilters((v) => !v);
                  }}
                  style={({ pressed }) => [
                    styles.chip,
                    (moreFilters || MORE_CHIPS.some((c) => c.key === filter)) && styles.chipActive,
                    pressed && styles.chipPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      (moreFilters || MORE_CHIPS.some((c) => c.key === filter)) && styles.chipTextActive,
                    ]}
                  >
                    {MORE_CHIPS.some((c) => c.key === filter) && !moreFilters
                      ? ALL_CHIP_LABELS[filter]
                      : 'More'}
                  </Text>
                </Pressable>
              </ScrollView>
            )}
            {q === '' && moreFilters && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
                keyboardShouldPersistTaps="handled"
              >
                {MORE_CHIPS.map((chip) => {
                  const active = filter === chip.key;
                  return (
                    <Pressable
                      key={chip.key}
                      onPress={() => {
                        animateLayoutSoft();
                        setFilter(chip.key);
                        setMoreFilters(false);
                      }}
                      style={({ pressed }) => [
                        styles.chip,
                        active && styles.chipActive,
                        pressed && !active && styles.chipPressed,
                      ]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {chip.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            {/* Compact "My Status" row (~58dp) — below the chips, above chats. */}
            {q === '' && <StatusStrip />}
            {/* Locked-chats gate stays available while the Locked chip is active
                so the user can authenticate to reveal previews inline. */}
            {lockedCount > 0 && q === '' && (filter === 'locked' || !chatLock.unlocked) && (
              <Pressable
                style={styles.hiddenToggle}
                onPress={async () => {
                  if (chatLock.unlocked) { chatLock.relock(); return; }
                  await chatLock.unlock('Unlock chats');
                }}
              >
                <Ionicons name={chatLock.unlocked ? 'lock-open' : 'lock-closed'} size={15} color={colors.primary} />
                <Text style={styles.hiddenToggleText}>
                  {chatLock.unlocked ? 'Hide locked chats' : `Locked chats (${lockedCount})`}
                </Text>
              </Pressable>
            )}
            {/* Archived chats are reached from Settings › Archived chats — no
                inline reveal row on the main list (WhatsApp parity). */}
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
        )}
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
              <Text style={styles.emptyTitle}>
                {q
                  ? 'No matching chats'
                  : filter !== 'all'
                  ? `No ${ALL_CHIP_LABELS[filter].toLowerCase()} chats`
                  : 'No conversations yet'}
              </Text>
              <Text style={styles.emptySub}>
                {q
                  ? 'Try a different search.'
                  : filter !== 'all'
                  ? 'Try a different filter, or start a new chat.'
                  : 'Find someone you know and say hello.'}
              </Text>
              {!q && (
                <View style={styles.emptyActions}>
                  <Pressable
                    style={({ pressed }) => [styles.emptyBtnPrimary, pressed && { opacity: 0.88 }]}
                    onPress={() => navigation.navigate('NewChat')}
                  >
                    <Ionicons name="create-outline" size={18} color="#fff" />
                    <Text style={styles.emptyBtnPrimaryText}>Start a chat</Text>
                  </Pressable>
                  {filter === 'all' && (
                    <Pressable
                      style={({ pressed }) => [styles.emptyBtnSecondary, pressed && { opacity: 0.88 }]}
                      onPress={() => navigation.navigate('NewGroup')}
                    >
                      <Text style={styles.emptyBtnSecondaryText}>Create a group</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          ) : null
        }
        contentContainerStyle={filteredItems.length === 0 ? styles.flexGrow : undefined}
      />

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={() => navigation.navigate('NewChat')}
        accessibilityRole="button"
        accessibilityLabel="New chat"
      >
        <Ionicons name="create-outline" size={24} color="#fff" />
      </Pressable>

    </View>
  );
}

// A single icon button in the contextual selection bar.
function SelIcon({
  name,
  onPress,
  danger,
}: {
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  danger?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [{ paddingHorizontal: spacing(2.5) }, pressed && { opacity: 0.5 }]}
    >
      <Ionicons name={name} size={22} color={danger ? colors.danger : colors.text} />
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    offlineBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: colors.textMuted, paddingVertical: 5,
    },
    offlineText: { color: '#fff', fontSize: font.tiny, fontWeight: '600' },
    searchBar: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginHorizontal: spacing(3.5),
      marginTop: spacing(1.5), marginBottom: spacing(1),
      paddingHorizontal: 12, paddingVertical: 7,
      backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
      minHeight: 40,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: font.body, paddingVertical: 0 },
    chipsRow: {
      paddingHorizontal: spacing(3),
      paddingBottom: spacing(1.5),
      gap: spacing(1.5),
      alignItems: 'center',
    },
    chip: {
      paddingHorizontal: spacing(2.75),
      paddingVertical: spacing(1.25),
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    chipPressed: { opacity: 0.65 },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.textMuted, fontSize: 12.5, fontWeight: '600' },
    chipTextActive: { color: '#fff' },
    hits: { paddingBottom: spacing(2), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, marginBottom: spacing(1) },
    hitsHead: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', letterSpacing: 0.4, paddingHorizontal: spacing(4), paddingVertical: spacing(1.5) },
    hit: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
    hitBody: { flex: 1, marginLeft: spacing(3) },
    hitTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    hitSnippet: { color: colors.textMuted, fontSize: font.small, marginTop: 1 },
    flexGrow: { flexGrow: 1 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(3.5),
      paddingVertical: spacing(2.5),
    },
    rowPressed: { backgroundColor: colors.isLight ? 'rgba(0,0,0,0.04)' : colors.surface },
    rowSelected: { backgroundColor: colors.primary + '1A' },
    checkOverlay: {
      position: 'absolute', right: -2, bottom: -2,
      width: 18, height: 18, borderRadius: 9,
      backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: colors.bg,
    },
    selBar: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing(3), height: 52,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    selCount: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginLeft: spacing(3), flex: 1 },
    selActions: { flexDirection: 'row', alignItems: 'center' },
    rowBody: { flex: 1, marginLeft: spacing(3), minWidth: 0 },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 3,
    },
    titleWrap: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
    title: {
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '600',
      flexShrink: 1,
      letterSpacing: -0.15,
    },
    titleUnread: { fontWeight: '700' },
    previewWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
    previewTick: { marginRight: 3, flexShrink: 0 },
    previewUnread: { color: colors.text, fontWeight: '500' },
    onlineDot: {
      position: 'absolute', right: 0, bottom: 0,
      width: 12, height: 12, borderRadius: 6,
      backgroundColor: '#25D366', borderWidth: 2, borderColor: colors.bg,
    },
    disappearBadge: {
      position: 'absolute', right: -2, top: -2,
      width: 16, height: 16, borderRadius: 8,
      backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderColor: colors.bg,
    },
    hiddenToggle: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      marginHorizontal: spacing(4), marginBottom: spacing(1.5),
      paddingVertical: spacing(1),
    },
    hiddenToggleText: { color: colors.primary, fontSize: font.small, fontWeight: '600' },
    time: { color: colors.textFaint, fontSize: 11.5, marginLeft: spacing(2), fontWeight: '500' },
    timeUnread: { color: colors.primary, fontWeight: '600' },
    preview: { color: colors.textMuted, fontSize: font.small, flexShrink: 1, lineHeight: 17 },
    badge: {
      backgroundColor: colors.primary,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 5,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: spacing(2),
    },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    sep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: spacing(3.5) + 48 + spacing(3),
      opacity: colors.isLight ? 0.85 : 1,
    },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(8) },
    emptyTitle: {
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '600',
      marginTop: spacing(3),
      letterSpacing: -0.2,
    },
    emptySub: {
      color: colors.textMuted,
      fontSize: font.small,
      textAlign: 'center',
      marginTop: spacing(1.5),
      lineHeight: 18,
      paddingHorizontal: spacing(4),
    },
    emptyActions: { marginTop: spacing(4), alignItems: 'center', gap: spacing(2), width: '100%' },
    emptyBtnPrimary: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.primary, paddingHorizontal: spacing(5), paddingVertical: 11,
      borderRadius: radius.pill, minWidth: 168, justifyContent: 'center',
    },
    emptyBtnPrimaryText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
    emptyBtnSecondary: {
      paddingHorizontal: spacing(4), paddingVertical: spacing(2),
    },
    emptyBtnSecondaryText: { color: colors.primary, fontSize: font.body, fontWeight: '600' },
    fab: {
      position: 'absolute',
      right: spacing(4),
      bottom: spacing(5),
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.22,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 5,
    },
    fabPressed: { backgroundColor: colors.primaryDark, transform: [{ scale: 0.96 }] },
    rowIcons: { flexDirection: 'row', alignItems: 'center' },
    streakEmoji: { fontSize: 14, marginLeft: spacing(1) },
  });
