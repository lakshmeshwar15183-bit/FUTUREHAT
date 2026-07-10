// Lumixo mobile — Chats tab. Loads getMyConversations on focus, shows
// title/avatar/last-message/unread, and routes into a thread.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  BackHandler,
  FlatList,
  LayoutAnimation,
  Modal,
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
  pinConversation,
  unpinConversation,
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
  getStarredMessages,
} from '../lib/shared';
import type { ConversationSummary, MessageSearchHit, StreakSummary } from '../lib/shared';
import {
  getCachedConversations, cacheConversations, getCache, setCache,
  pendingConversationEffects, reconcileIds, mergeEffects,
} from '../lib/localCache';
import { onConnectivity, queueAction } from '../lib/sync';
import { formatListTimestamp } from '../lib/time';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import StatusStrip from '../components/status/StatusStrip';
import { useChatLock } from '../security/ChatLock';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Enable smooth height/opacity transitions for the contextual selection bar on
// Android (LayoutAnimation is opt-in there). No-op if already enabled.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const animateSelection = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

// Cache-key bases for the per-user conversation flag sets, so pinned/muted/hidden
// state hydrates instantly (offline included) and survives an app restart.
const FLAG_KEY = { pinned: 'pinned', muted: 'muted', hidden: 'hidden' } as const;

// WhatsApp/Telegram-style filter chips shown below the search bar. `all` means
// no filter; every other value narrows the visible list. Order here is the
// display order in the horizontal strip.
type ChatFilter = 'all' | 'unread' | 'groups' | 'favorites' | 'pinned' | 'streaks' | 'locked';
const FILTER_CHIPS: { key: ChatFilter; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'unread',    label: 'Unread' },
  { key: 'groups',    label: 'Groups' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'pinned',    label: 'Pinned' },
  { key: 'streaks',   label: 'Streaks' },
  { key: 'locked',    label: 'Locked' },
];

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
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [premiumIds, setPremiumIds] = useState<Set<string>>(new Set());
  const [isPremium, setIsPremium] = useState(false);
  // Streak emoji per conversation (server-authoritative score → tier). Hydrated
  // from local cache first (instant/offline), then refreshed in the background.
  const [streaks, setStreaks] = useState<Record<string, StreakSummary>>({});
  // WhatsApp-style multi-select: a non-empty set puts the list in selection mode
  // and swaps the top bar for a contextual action bar. `overflowOpen` toggles the
  // "⋮" menu of less-common actions.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [overflowOpen, setOverflowOpen] = useState(false);
  const selectionMode = selectedIds.size > 0;

  // Filter chips (All / Unread / Groups / Favorites / Pinned / Streaks / Locked)
  // — narrow the visible list to a facet. `favIds` is the set of conversations
  // that contain at least one starred message, so Favorites acts as a "bookmarked
  // chats" filter without needing a new DB table.
  const [filter, setFilter] = useState<ChatFilter>('all');
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
    // Pinned conversations float to the top (WhatsApp-style), otherwise the
    // getMyConversations order (most-recent first) is preserved.
    return [...searched].sort((a, b) => {
      const pa = pinnedIds.has(a.conversation.id) ? 1 : 0;
      const pb = pinnedIds.has(b.conversation.id) ? 1 : 0;
      return pb - pa;
    });
  }, [items, q, hiddenIds, pinnedIds, chatLock, filter, favIds, streaks]);

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
            const [cached, pinned, muted, hidden, cachedStreaks] = await Promise.all([
              getCachedConversations(id),
              getCache<string[]>(`${FLAG_KEY.pinned}:${id}`, []),
              getCache<string[]>(`${FLAG_KEY.muted}:${id}`, []),
              getCache<string[]>(`${FLAG_KEY.hidden}:${id}`, []),
              getCache<StreakSummary[]>(`streaks:${id}`, []),
            ]);
            if (!alive) return;
            if (pinned.length) setPinnedIds(new Set(pinned));
            if (muted.length) setMutedIds(new Set(muted));
            if (hidden.length) setHiddenIds(new Set(hidden));
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
      ]);
      Promise.all([
        getPinnedIds(supabase),
        getMutedIds(supabase),
        getArchivedIds(supabase),
        getDeletedConversationIds(supabase),
      ])
        .then(async ([pinned, muted, archived, deleted]) => {
          // Fold in optimistic pin/mute/archive/unarchive still queued (not yet
          // synced) so this background server read never reverts a flag the user
          // just toggled — the "archived chat pops back into the list" race. The
          // queue is the source of truth for in-flight changes; the server is the
          // source of truth for everything else. Merge the before/after queue
          // snapshots so the change survives even if its sync landed (and dequeued)
          // in the window between the two awaits.
          const [pinEffA, muteEffA, arcEffA] = await Promise.all([
            pendingConversationEffects(['pin'], ['unpin']),
            pendingConversationEffects(['mute'], ['unmute']),
            pendingConversationEffects(['archive'], ['unarchive']),
          ]);
          const pinEff = mergeEffects(effBefore[0], pinEffA);
          const muteEff = mergeEffects(effBefore[1], muteEffA);
          const arcEff = mergeEffects(effBefore[2], arcEffA);
          const pinnedSet = reconcileIds(pinned, pinEff);
          const mutedSet = reconcileIds(muted, muteEff);
          setPinnedIds(pinnedSet);
          setMutedIds(mutedSet);
          // Archived + "Delete for me" chats leave the main list. Merge them into
          // one hidden set, then apply pending archive/unarchive on top; a chat
          // revived by a new message is restored by clearing its row.
          const hiddenSet = reconcileIds([...archived, ...deleted], arcEff);
          setHiddenIds(hiddenSet);
          // Refresh the flag caches (reconciled values) so the next cold/offline
          // open is accurate and still reflects the pending changes.
          if (uid) {
            setCache(`${FLAG_KEY.pinned}:${uid}`, [...pinnedSet]).catch(() => {});
            setCache(`${FLAG_KEY.muted}:${uid}`, [...mutedSet]).catch(() => {});
            setCache(`${FLAG_KEY.hidden}:${uid}`, [...hiddenSet]).catch(() => {});
          }
        })
        .catch(() => {});
      getPremiumUserIds(supabase).then((ids) => setPremiumIds(new Set(ids))).catch(() => {});
      getServerPremium(supabase).then(setIsPremium).catch(() => {});
      // Favorites chip — chats containing any starred message. Cached-tolerant:
      // on failure (offline) we keep whatever we had.
      getStarredMessages(supabase)
        .then((rows) => setFavIds(new Set(rows.map((r) => r.conversation_id))))
        .catch(() => {});
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

  // Flip a flag set (pinned/muted/hidden) locally AND persist it to cache in one
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

  const lastPreview = (c: ConversationSummary): string => {
    const m = c.lastMessage;
    if (!m) return 'Tap to start chatting';
    if (m.is_deleted) return 'This message was deleted';
    // System notices (disappearing-messages on/off) show verbatim, no "You:" prefix.
    if (m.type === 'system') return m.content ?? '';
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

  // ── Multi-select mode (WhatsApp-style) ──────────────────────────────────────
  // Selection is a set of conversation ids. Entering/leaving it animates the
  // contextual bar in/out. All batch actions call the SAME shared functions the
  // web app uses, so state stays in sync across devices.
  const toggleSelect = useCallback((id: string) => {
    animateSelection();
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);
  const enterSelection = useCallback((id: string) => {
    Haptics.selectionAsync().catch(() => {});
    animateSelection();
    setSelectedIds(new Set([id]));
  }, []);
  const clearSelection = useCallback(() => {
    animateSelection();
    setSelectedIds(new Set());
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
  async function batchPin() {
    const ids = selConvs.map((c) => c.conversation.id);
    const unpin = allPinned;
    if (!unpin) {
      const toPin = ids.filter((id) => !pinnedIds.has(id));
      // Free tier caps pinned chats (web parity via FREE_LIMITS).
      if (!isPremium && pinnedIds.size + toPin.length > FREE_LIMITS.pinnedChats) {
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
    // Instant + durable: flip local state, persist the flag to cache, and queue
    // the sync. No await, no revert — offline just means it syncs on reconnect.
    setFlagSet(setPinnedIds, FLAG_KEY.pinned, ids, !unpin);
    ids.forEach((id) => queueAction(unpin ? 'unpin' : 'pin', { conversationId: id }));
  }

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

  function toggleSelectAll() {
    animateSelection();
    const visible = filteredItems.map((c) => c.conversation.id);
    setSelectedIds((prev) => (prev.size >= visible.length ? new Set() : new Set(visible)));
  }

  // Stable separator so the list doesn't rebuild every separator each render.
  const Separator = useCallback(() => <View style={styles.sep} />, [styles]);

  const renderItem = ({ item }: { item: ConversationSummary }) => {
    const peer = peerOf(item);
    const peerOnline = !!peer && onlineIds.has(peer.id);
    const peerPremium = !!peer && premiumIds.has(peer.id);
    const isGroup = item.conversation.type === 'group';
    const id = item.conversation.id;
    const selected = selectedIds.has(id);
    const disappearing = (item.conversation.disappear_seconds ?? 0) > 0;
    const locked = chatLock.isLocked(id);
    // Server-authoritative streak emoji for this pair (empty string when no streak
    // or score 0). Direct chats only — group chats have no pair streak.
    const streakEmoji = !isGroup ? (streaks[id]?.tier ?? '') : '';
    return (
    <Pressable
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed]}
      onPress={() =>
        selectionMode
          ? toggleSelect(id)
          : navigation.navigate('Chat', { conversationId: id, title: item.title })
      }
      onLongPress={() => (selectionMode ? toggleSelect(id) : enterSelection(id))}
      delayLongPress={280}
    >
      <View>
        <Avatar uri={item.avatarUrl} name={item.title} size={48} />
        {peerOnline && !selected && <View style={styles.onlineDot} />}
        {/* Disappearing-messages timer indicator (WhatsApp parity) — subtle clock. */}
        {disappearing && !selected && (
          <View style={styles.disappearBadge}>
            <Ionicons name="timer-outline" size={11} color="#fff" />
          </View>
        )}
        {selected && (
          <View style={styles.checkOverlay}>
            <Ionicons name="checkmark" size={16} color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <View style={styles.titleWrap}>
            {isGroup && (
              <Ionicons name="people" size={14} color={colors.textMuted} style={{ marginRight: 4 }} />
            )}
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            {peerPremium && (
              <Ionicons name="star" size={13} color="#f5b800" style={{ marginLeft: 4 }} />
            )}
          </View>
          <Text style={[styles.time, item.unreadCount > 0 && styles.timeUnread]}>
            {formatListTimestamp(item.lastMessage?.created_at)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.preview} numberOfLines={1}>
            {lastPreview(item)}
          </Text>
          <View style={styles.rowIcons}>
            {/* Streak tier emoji (server-authoritative). Sits with the right-side
                indicator cluster, adjacent to the unread badge. Real data only. */}
            {streakEmoji !== '' && (
              <Text
                style={styles.streakEmoji}
                allowFontScaling={false}
                accessibilityLabel={`Streak ${streaks[id]?.score ?? ''}`}
              >
                {streakEmoji}
              </Text>
            )}
            {locked && (
              <Ionicons name="lock-closed" size={13} color={colors.textFaint} style={{ marginLeft: spacing(1) }} />
            )}
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
  };

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
            <SelIcon name={allMuted ? 'notifications' : 'notifications-off-outline'} onPress={batchMute} />
            <SelIcon name="archive-outline" onPress={batchArchive} />
            <SelIcon name="trash-outline" onPress={batchDelete} danger />
            <SelIcon name="ellipsis-vertical" onPress={() => setOverflowOpen(true)} />
          </View>
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
            {/* Filter chips (WhatsApp/Telegram folder-style) — hidden while
                searching so results aren't accidentally narrowed. */}
            {q === '' && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
                keyboardShouldPersistTaps="handled"
              >
                {FILTER_CHIPS.map((chip) => {
                  const active = filter === chip.key;
                  return (
                    <Pressable
                      key={chip.key}
                      onPress={() => {
                        // Smooth cross-fade + reflow when the chip flips.
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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
                  ? `No ${FILTER_CHIPS.find((f) => f.key === filter)?.label.toLowerCase() ?? ''} chats`
                  : 'No conversations yet'}
              </Text>
              <Text style={styles.emptySub}>
                {q
                  ? 'Try a different search.'
                  : filter !== 'all'
                  ? 'Try a different filter.'
                  : 'Tap the button below to find someone and say hello.'}
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

      {/* Selection "⋮" overflow menu — less-common / context-specific actions.
          Single direct chats additionally get View contact / Report / Block. */}
      <Modal visible={overflowOpen} transparent animationType="fade" onRequestClose={() => setOverflowOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOverflowOpen(false)}>
          <View style={styles.sheet}>
            <ConvAction
              icon={allVisibleSelected ? 'ellipse-outline' : 'checkmark-done-outline'}
              label={allVisibleSelected ? 'Deselect all' : 'Select all'}
              onPress={() => { setOverflowOpen(false); toggleSelectAll(); }}
            />
            {anyUnread && (
              <ConvAction icon="mail-open-outline" label="Mark as read" onPress={() => { setOverflowOpen(false); batchMarkRead(); }} />
            )}
            {allHidden && (
              <ConvAction icon="eye-outline" label={selCount > 1 ? 'Unhide chats' : 'Unhide'} onPress={() => { setOverflowOpen(false); batchUnhide(); }} />
            )}
            {singleDirect && (
              <>
                <ConvAction icon="person-circle-outline" label="View contact" onPress={() => { setOverflowOpen(false); viewInfo(); }} />
                <ConvAction icon="flag-outline" label="Report" onPress={() => { setOverflowOpen(false); batchReport(); }} />
                <ConvAction icon="ban-outline" label="Block" danger onPress={() => { setOverflowOpen(false); batchBlock(); }} />
              </>
            )}
          </View>
        </Pressable>
      </Modal>
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
      marginHorizontal: spacing(4),
      // Tight top spacing so more chats are visible immediately (WhatsApp/Telegram parity).
      marginTop: spacing(1.5), marginBottom: spacing(1.5),
      paddingHorizontal: 12, paddingVertical: 8,
      backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: font.body, paddingVertical: 0 },
    // Horizontal filter-chip strip. Chips are pill-shaped; the active one uses
    // the primary tint. LayoutAnimation smooths the swap between chips.
    chipsRow: {
      paddingHorizontal: spacing(3),
      paddingBottom: spacing(1.5),
      gap: spacing(2),
      alignItems: 'center',
    },
    chip: {
      paddingHorizontal: spacing(3),
      paddingVertical: spacing(1.5),
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    chipPressed: { opacity: 0.65 },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.textMuted, fontSize: font.small, fontWeight: '600' },
    chipTextActive: { color: '#fff' },
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
      // Slightly tighter row so more chats fit on screen — readability preserved
      // via the 15/13 heading/preview pairing and the 48dp avatar.
      paddingVertical: spacing(2.25),
    },
    rowPressed: { backgroundColor: colors.surface },
    rowSelected: { backgroundColor: colors.primary + '22' },
    checkOverlay: {
      position: 'absolute', right: -2, bottom: -2,
      width: 20, height: 20, borderRadius: 10,
      backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: colors.bg,
    },
    selBar: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing(4), height: 56,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
      elevation: 4,
      shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    },
    selCount: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginLeft: spacing(4), flex: 1 },
    selActions: { flexDirection: 'row', alignItems: 'center' },
    rowBody: { flex: 1, marginLeft: spacing(3) },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing(1),
    },
    titleWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    title: { color: colors.text, fontSize: font.heading, fontWeight: '600', flexShrink: 1 },
    onlineDot: {
      position: 'absolute', right: 0, bottom: 0,
      width: 14, height: 14, borderRadius: 7,
      backgroundColor: '#25D366', borderWidth: 2, borderColor: colors.bg,
    },
    disappearBadge: {
      position: 'absolute', right: -2, top: -2,
      width: 18, height: 18, borderRadius: 9,
      backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderColor: colors.bg,
    },
    hiddenToggle: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      marginHorizontal: spacing(4), marginBottom: spacing(2),
      paddingVertical: spacing(1),
    },
    hiddenToggleText: { color: colors.primary, fontSize: font.small, fontWeight: '600' },
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
      marginLeft: spacing(4) + 48 + spacing(3),
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
    streakEmoji: { fontSize: 15, marginLeft: spacing(1) },
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
