// Lumixo mobile — the chat thread. Realtime messages, media + voice,
// reactions, reply/edit/delete/forward, typing, presence and read receipts.
// All data flows through the shared API; this screen is presentation + glue.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Keyboard,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { useNavigation, useRoute, useFocusEffect, type RouteProp } from '@react-navigation/native';
import {
  setOpenConversation,
  clearConversationNotification,
  syncBadgeFromServer,
} from '../lib/notifications';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import {
  getMessages,
  sendMessage,
  clearRemoteChatNotification,
  editMessage,
  deleteMessage,
  forwardMessage,
  markMessageAsRead,
  markMessageAsDelivered,
  markMessagesAsDelivered,
  getReceipts,
  subscribeToMessages,
  subscribeToReceipts,
  getReactions,
  toggleReaction,
  subscribeToReactions,
  createTypingChannel,
  joinPresence,
  leavePresence,
  getCurrentUser,
  getMyProfile,
  getMyConversations,
  buildTickMap,
  applyReceiptToTickMap,
  computeOutboundTick,
  tickLabel,
  createPoll,
  getPolls,
  getPollVotes,
  votePoll,
  unvotePoll,
  messageMatchesKind,
  getStarredIds,
  starMessage,
  unstarMessage,
  getHiddenMessageIds,
  hideMessageForMe,
  clearChatMessagesForMe,
  deleteConversationForMe,
  reportMessage,
  REPORT_REASONS,
  getChatSettings,
  getPreferences,
  getServerPremium,
  scheduleMessage,
  dispatchDueMessages,
  messageExpired,
  nextMessageExpiry,
  purgeExpiredMessages,
  getDisappearing,
  FREE_LIMITS,
  PREMIUM_LIMITS,
  markViewOnceSeen,
  getViewOnceState,
  isVideoMessage,
  signedMediaUrl,
  getMyGroupRole,
  getPinnedMessageIds,
  pinGroupMessage,
  unpinGroupMessage,
  canPinMessages,
  canSendInGroup,
  permissionsFromConversation,
  getGroupConversation,
  getMutedIds,
  muteConversation,
  unmuteConversation,
  blockUser,
  submitReport as submitSafetyReport,
  type ParticipantRole,
  resolveDisplayName,
  resolveAvatarUrl,
  mergeProfileIdentity,
} from '../lib/shared';
import type { Message, MessageReaction, Profile, ConversationSummary, Poll, PollVote, SearchKind, ChatSettings, ReportReason } from '../lib/shared';
import {
  getCachedMessages,
  cacheMessages,
  upsertCachedMessage,
  getCachedConversations,
  getPendingMessages,
  enqueueOutbox,
  getDraft,
  setDraft,
  uuidv4,
  getNickname,
  getCachedProfile,
  cacheProfile,
  cacheProfiles,
} from '../lib/localCache';
import { flushOutbox, onOutboxSent, onOutboxDeadLetter, queueAction } from '../lib/sync';
import { guessMime } from '../lib/media';
import { registerMediaHandler, type MediaSubmission } from '../media/mediaSendBridge';
import { formatLastSeen, formatDaySeparator, formatTime } from '../lib/time';
import { useColors, useTheme, spacing, radius, font, listPerf, motion, type Palette } from '../theme';
import MessageBubble, { type TickStatus, replySummary } from '../components/MessageBubble';
import SwipeToReply from '../components/SwipeToReply';
import MediaViewer, { type ViewerItem } from '../components/MediaViewer';
import { ensureMediaCached, prefetchMedia } from '../lib/mediaCache';
import ForwardSheet, { type ForwardPreview } from '../components/ForwardSheet';
import PollCard from '../components/PollCard';
import ScheduleMessageModal from '../components/ScheduleMessageModal';
import ErrorBoundary from '../components/ErrorBoundary';
import Avatar from '../components/Avatar';
import { STICKERS } from '../lib/stickers';
import { QUICK_REACTIONS } from '../lib/emojiData';
import EmojiPicker from '../components/EmojiPicker';
import { useCalls } from '../calls/CallContext';
import { useChatLock } from '../security/ChatLock';
import type { RootStackParamList } from '../navigation/types';
import { Alert, showSheet } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Chat'>;
type Rt = RouteProp<RootStackParamList, 'Chat'>;

// WhatsApp quick reaction strip (long-press message).
const QUICK_EMOJI = [...QUICK_REACTIONS];

// WhatsApp-style one-line summary for the reply/edit preview bar — delegates to
// the shared helper so the composer bar and in-bubble quote read identically.
const previewLabel = (m: Message | null | undefined): string => (m ? replySummary(m) : '');

// Merge two message arrays by id (server rows win over optimistic ones with the
// same id), then sort chronologically for the (inverted) thread. Used to reconcile
// cache + network + outbox without duplicates.
function mergeById(primary: Message[], extra: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const m of primary) map.set(m.id, m);
  for (const m of extra) if (!map.has(m.id)) map.set(m.id, m);
  return [...map.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

// The thread renders messages and polls interleaved by time.
type TimelineItem =
  | { kind: 'msg'; id: string; at: string; message: Message; grouped?: boolean }
  | { kind: 'poll'; id: string; at: string; poll: Poll }
  | { kind: 'day'; id: string; at: string; label: string };

// Wrapped in an ErrorBoundary (see default export at the bottom) so a render
// throw shows a recoverable fallback instead of a blank chat screen.
function ChatScreenInner() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const { conversationId } = params;

  // Tell the notifications bridge which chat is open so it never notifies for it,
  // clear the tray entry, and re-sync the launcher badge from the server.
  useFocusEffect(
    useCallback(() => {
      setOpenConversation(conversationId);
      void clearConversationNotification(conversationId);
      // Multi-device: clear tray on phone B when this chat is open here.
      void clearRemoteChatNotification(supabase, conversationId);
      void syncBadgeFromServer();
      return () => setOpenConversation(null);
    }, [conversationId]),
  );

  const colors = useColors();
  const { wallpaperColor, isPremium } = useTheme();
  const insets = useSafeAreaInsets();
  const { startCall } = useCalls();
  const chatLock = useChatLock();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Chat Lock (0027): if this chat is locked and the Locked area isn't already
  // unlocked this session, require device authentication before showing anything.
  const [gateOk, setGateOk] = useState(false);
  const gateBusy = useRef(false);
  const needsGate = chatLock.isLocked(conversationId) && !chatLock.unlocked && !gateOk;
  useEffect(() => {
    if (!needsGate || gateBusy.current) return;
    gateBusy.current = true;
    (async () => {
      const ok = await chatLock.authenticate('Unlock chat');
      gateBusy.current = false;
      if (ok) setGateOk(true);
      else navigation.goBack();
    })();
  }, [needsGate, chatLock, navigation]);

  // Disappearing-messages timer for this chat (0 = off) — drives the header badge.
  const [disappearSecs, setDisappearSecs] = useState(0);
  useEffect(() => {
    let alive = true;
    getDisappearing(supabase, conversationId)
      .then((s) => { if (alive) setDisappearSecs(s); })
      .catch(() => {});
    return () => { alive = false; };
  }, [conversationId]);

  // WhatsApp-identical keyboard handling. We do NOT use KeyboardAvoidingView:
  // targetSdk 35 forces edge-to-edge on Android 15+, which makes the manifest's
  // `adjustResize` a no-op (the window no longer shrinks for the IME), so the
  // composer would sit BEHIND the keyboard. Instead we read the live IME height
  // from reanimated's useAnimatedKeyboard (driven off the system WindowInsets
  // animation, so it tracks the keyboard 1:1 with matching speed/curve) and pad
  // the whole thread up by it — works under forced edge-to-edge and on iOS, with
  // no hardcoded offsets. When the keyboard is down we fall back to the bottom
  // safe-area inset (gesture-nav bar / home indicator).
  const keyboard = useAnimatedKeyboard();
  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboard.height.value, insets.bottom),
  }));

  const [uid, setUid] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [receipts, setReceipts] = useState<Map<string, TickStatus>>(new Map());
  const [loading, setLoading] = useState(true);

  const [peers, setPeers] = useState<Profile[]>([]);
  const peersRef = useRef<Profile[]>([]);
  useEffect(() => { peersRef.current = peers; }, [peers]);
  // Header avatar: group avatar_url from conversation, or peer avatar for DMs.
  const [chatAvatarUrl, setChatAvatarUrl] = useState<string | null>(null);

  // Dispatch scheduled messages whose send-time has arrived — on open + while
  // foreground (every 60s). Pause interval in background to save battery.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const kick = () => { void dispatchDueMessages(supabase).catch(() => {}); };
    const arm = () => {
      if (id) clearInterval(id);
      id = setInterval(kick, 60_000);
    };
    kick();
    arm();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { kick(); arm(); }
      else if (id) { clearInterval(id); id = null; }
    });
    return () => {
      if (id) clearInterval(id);
      sub.remove();
    };
  }, []);
  const [isGroup, setIsGroup] = useState(false);
  const [myGroupRole, setMyGroupRole] = useState<ParticipantRole | null>(null);
  const [groupSendBlocked, setGroupSendBlocked] = useState(false);
  const [groupPerms, setGroupPerms] = useState(permissionsFromConversation(null));
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [typingName, setTypingName] = useState<string | null>(null);

  const [text, setText] = useState('');
  // Keep latest draft for multi-emoji inserts (picker stays open like WhatsApp).
  const textRef = useRef(text);
  textRef.current = text;
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [selected, setSelected] = useState<Message | null>(null);
  // Report-message flow: `reportTarget` opens the reason picker; `reportBusy`
  // guards against double-submit while the RPC is in flight.
  const [reportTarget, setReportTarget] = useState<Message | null>(null);
  const [reportDetails, setReportDetails] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiComposerOpen, setEmojiComposerOpen] = useState(false);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  // Disappearing messages (0022): a tick that advances to the next-soonest
  // `expires_at` so expired messages drop from the timeline live (no polling).
  const [now, setNow] = useState<number>(() => Date.now());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [attachOpen, setAttachOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  // View-Once (0030): ids of View-Once messages the current user has already
  // consumed (server-authoritative). Once spent, the bubble shows an opened state
  // and can't be re-opened. Hydrated on load for messages sent TO me.
  const [voSpent, setVoSpent] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchKind, setSearchKind] = useState<SearchKind>('all');
  const [activeMatch, setActiveMatch] = useState(0);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardList, setForwardList] = useState<ConversationSummary[]>([]);
  /** Mute state for chat ⋮ menu. */
  const [chatMuted, setChatMuted] = useState(false);
  // Messages queued to forward (from a message menu, multi-select, or the media
  // viewer) + an optional media preview shown on the ForwardSheet confirm step.
  const [forwardSources, setForwardSources] = useState<Message[]>([]);
  const [forwardPreview, setForwardPreview] = useState<ForwardPreview | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recSecs, setRecSecs] = useState(0); // live elapsed seconds while recording (web parity)
  // Hold-to-record: slide left past threshold cancels instead of sending on release.
  // Guards against the common race where pressOut fires before createAsync resolves
  // (permission dialog / cold start) — without this the UI can stick in recording mode.
  const recCancelRef = useRef(false);
  const recStartX = useRef(0);
  const [recCanceling, setRecCanceling] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recStartingRef = useRef(false);
  /** null while finger is down; boolean = desired send/cancel after async start finishes. */
  const recPendingStopRef = useRef<boolean | null>(null);
  const recStoppingRef = useRef(false);
  const recStartedAtRef = useRef(0);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  const [sending, setSending] = useState(false);
  // Whether pressing Return sends the message (WhatsApp-style), from Chat settings.
  const [enterToSend, setEnterToSend] = useState(true);
  // Floating "jump to latest" button appears once the user scrolls up an inverted list.
  const [atBottom, setAtBottom] = useState(true);
  // Ref mirror so the keyboard-show listener can read "am I at the bottom?" at
  // fire time without re-subscribing every scroll.
  const atBottomRef = useRef(true);

  const [polls, setPolls] = useState<Poll[]>([]);
  const [pollVotes, setPollVotes] = useState<Map<string, PollVote[]>>(new Map());
  const [pollBuilder, setPollBuilder] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollMultiple, setPollMultiple] = useState(false);

  const listRef = useRef<FlatList<TimelineItem>>(null);
  const typingChannel = useRef<ReturnType<typeof createTypingChannel> | null>(null);
  // Ghost mode (premium): when on, suppress read receipts + typing broadcasts, so
  // the peer can't see that you've read or are typing. Read via a ref inside
  // realtime callbacks so toggling never needs a re-subscribe (mirrors web).
  const ghostRef = useRef(false);
  const [ghost, setGhost] = useState(false); // header 👻 indicator mirror of ghostRef
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMsgs = useCallback((updater: (prev: Message[]) => Message[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      messagesRef.current = next;
      return next;
    });
  }, []);

  // Keep the latest message in view as the keyboard opens. The composer already
  // follows the keyboard via useAnimatedKeyboard (padding), which shrinks the
  // inverted list from the bottom; if the user was at the newest message we nudge
  // it back to offset 0 so the last bubble stays visible above the composer.
  /** Message held for reaction while the action sheet is fully dismissed. */
  const pendingReactMsg = useRef<Message | null>(null);
  /** After loading deep history, scroll to oldest once the list lays out. */
  const scrollToOldestPending = useRef(false);

  // Covers open/close, emoji keyboard, and height changes (each fires a fresh
  // show event); rotation re-runs via new metrics.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const onShow = Keyboard.addListener(showEvt, () => {
      if (atBottomRef.current) {
        requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
      }
    });
    return () => onShow.remove();
  }, []);

  const loadPolls = useCallback(async () => {
    const ps = await getPolls(supabase, conversationId);
    setPolls(ps);
    const entries = await Promise.all(
      ps.map(async (p) => [p.id, await getPollVotes(supabase, p.id)] as const),
    );
    setPollVotes(new Map(entries));
  }, [conversationId]);

  const onVotePoll = useCallback(
    async (poll: Poll, optionIndex: number) => {
      // Multiple-choice: re-tapping a chosen option toggles it back off (web parity).
      // Otherwise cast a vote (votePoll clears prior votes for single-choice).
      const already =
        poll.multiple &&
        (pollVotes.get(poll.id) ?? []).some(
          (v) => v.user_id === uid && v.option_index === optionIndex,
        );
      if (already) {
        await unvotePoll(supabase, poll.id, optionIndex);
      } else {
        await votePoll(supabase, poll.id, optionIndex, poll.multiple);
      }
      const fresh = await getPollVotes(supabase, poll.id);
      setPollVotes((prev) => new Map(prev).set(poll.id, fresh));
    },
    [uid, pollVotes],
  );

  async function submitPoll() {
    const q = pollQuestion.trim();
    const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2) {
      Alert.alert('Incomplete poll', 'Add a question and at least two options.');
      return;
    }
    setPollBuilder(false);
    const { error } = await createPoll(supabase, conversationId, q, opts, pollMultiple);
    if (error) {
      Alert.alert('Could not create poll', error.message);
      return;
    }
    setPollQuestion('');
    setPollOptions(['', '']);
    setPollMultiple(false);
    await loadPolls();
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
  }

  // ── Bootstrap: who am I, conversation peers, history ──────────────────────
  // Local-first: paint cached messages + queued (outbox) messages INSTANTLY with
  // no network wait or spinner (WhatsApp-style), then reconcile with Supabase in
  // the background. If we're offline the cached view simply stays.
  useEffect(() => {
    let active = true;
    (async () => {
      const user = await getCurrentUser(supabase); // local session read — instant
      if (!active) return;
      const myId = user?.id ?? null;
      setUid(myId);

      // 1) INSTANT: cached thread + anything still queued in the outbox.
      const [cachedMsgs, pending] = await Promise.all([
        getCachedMessages(conversationId),
        getPendingMessages(conversationId),
      ]);
      if (active && (cachedMsgs.length || pending.length)) {
        setMsgs(() => mergeById(cachedMsgs, pending));
        setLoading(false); // never block on the network once we have something
      }

      // 2) INSTANT: header peers from the cached conversation list (no network).
      // Never paint "Unknown" — prefer cached conversation title + profile rows.
      if (myId) {
        const cachedConvs = await getCachedConversations(myId);
        const cs = cachedConvs.find((s) => s.conversation.id === conversationId);
        if (cs && active) {
          const group = cs.conversation.type === 'group';
          setIsGroup(group);
          const peerList = cs.participants.filter((p) => p.id !== myId);
          // Enrich each peer from per-profile cache (stronger offline identity).
          const enriched = await Promise.all(
            peerList.map(async (p) => {
              const cachedP = await getCachedProfile(p.id).catch(() => null);
              return (mergeProfileIdentity(cachedP, p) as Profile) ?? p;
            }),
          );
          setPeers(enriched);
          setChatAvatarUrl(cs.avatarUrl ?? enriched[0]?.avatar_url ?? null);
          if (cs.title && !/^unknown$/i.test(cs.title)) {
            setHeaderTitle(cs.title);
          }
          cacheProfiles(enriched).catch(() => {});
          if (group) {
            Promise.all([
              getMyGroupRole(supabase, conversationId),
              getGroupConversation(supabase, conversationId),
              getPinnedMessageIds(supabase, conversationId),
            ])
              .then(([role, gconv, pins]) => {
                if (!active) return;
                setMyGroupRole(role);
                const perms = permissionsFromConversation(gconv ?? cs.conversation);
                setGroupPerms(perms);
                setGroupSendBlocked(!canSendInGroup(role, perms));
                setPinnedIds(new Set(pins));
              })
              .catch(() => {});
          } else {
            setMyGroupRole(null);
            setGroupSendBlocked(false);
            setGroupPerms(permissionsFromConversation(null));
            setPinnedIds(new Set());
          }
        }
      }

      // Disappearing messages (0022): opportunistic physical cleanup of expired
      // messages in my conversations. Fire-and-forget; the query + client filter
      // already hide expired ones regardless.
      purgeExpiredMessages(supabase).catch(() => {});

      // 3) BACKGROUND: fetch fresh history, merge with pending, refresh cache.
      try {
        const msgs = await getMessages(supabase, conversationId, 100);
        if (!active) return;
        const pend = await getPendingMessages(conversationId);
        setMsgs(() => mergeById(msgs, pend));
        setLoading(false);
        cacheMessages(conversationId, msgs).catch(() => {});
        // Offline-first: permanently cache media already in the thread so opens
        // are instant next time (and work fully offline).
        void prefetchMedia(
          msgs.filter((m) => m.media_url && !m.is_deleted).map((m) => m.media_url!),
          3,
        );

        const ids = msgs.map((m) => m.id);
        const [rx, rc] = await Promise.all([getReactions(supabase, ids), getReceipts(supabase, ids)]);
        if (!active) return;
        setReactions(rx);
        // Single source of truth: rebuild ticks from receipts. Preserve local
        // sending/failed states for optimistic outbox rows still in flight.
        const mineIds = msgs.filter((m) => m.sender_id === myId).map((m) => m.id);
        const built = buildTickMap(rc, myId, mineIds);
        setReceipts((prev) => {
          const next = new Map(built);
          for (const [id, t] of prev) {
            if (t === 'sending' || t === 'failed') next.set(id, t);
          }
          return next;
        });
        loadPolls().catch(() => {});

        // Per-user message extras (star + delete-for-me). Degrade to empty if the
        // 0011/0014 migrations aren't applied — the shared helpers already do.
        Promise.all([getStarredIds(supabase), getHiddenMessageIds(supabase)])
          .then(([starred, hidden]) => {
            if (!active) return;
            setStarredIds(new Set(starred));
            setHiddenIds(new Set(hidden));
          })
          .catch(() => {});

        // Pipeline: delivered first (device has the message), then read unless ghost.
        const incomingIds = msgs.filter((m) => m.sender_id !== myId).map((m) => m.id);
        if (incomingIds.length) {
          markMessagesAsDelivered(supabase, incomingIds).catch(() => {});
          if (!ghostRef.current) {
            incomingIds.forEach((id) => markMessageAsRead(supabase, id).catch(() => {}));
          }
        }
      } catch {
        // Offline / transient error: keep the cached view already on screen.
        if (active) setLoading(false);
      }

      // Fallback peer resolution if the conversation wasn't in the cache yet
      // (e.g. opened via a deep link before the Chats tab was visited).
      if (myId && peersRef.current.length === 0) {
        try {
          const summaries = await getMyConversations(supabase);
          const summary = summaries.find((s) => s.conversation.id === conversationId);
          if (summary && active) {
            setIsGroup(summary.conversation.type === 'group');
            const peerList = summary.participants.filter((p) => p.id !== myId);
            const enriched = await Promise.all(
              peerList.map(async (p) => {
                const cachedP = await getCachedProfile(p.id).catch(() => null);
                return (mergeProfileIdentity(cachedP, p) as Profile) ?? p;
              }),
            );
            setPeers((prev) => {
              // Monotonic: never replace a peer that already has a real name with empty.
              if (!prev.length) return enriched;
              return enriched.map((p) => {
                const old = prev.find((x) => x.id === p.id);
                return (mergeProfileIdentity(old, p) as Profile) ?? p;
              });
            });
            setChatAvatarUrl(summary.avatarUrl ?? enriched[0]?.avatar_url ?? null);
            if (summary.title && !/^unknown$/i.test(summary.title)) {
              setHeaderTitle((t) => (/^unknown$/i.test(t) ? summary.title : t));
            }
            cacheProfiles(enriched).catch(() => {});
          }
        } catch { /* offline */ }
      }
    })();
    return () => {
      active = false;
    };
  }, [conversationId, setMsgs]);

  // Monotonic receipt merge via shared messageStatus (never downgrade ticks).
  const applyReceipts = useCallback((rows: { message_id: string; user_id: string; status: string }[]) => {
    setReceipts((prev) => {
      let next = prev;
      for (const r of rows) {
        next = applyReceiptToTickMap(next, r, uid);
      }
      return next === prev ? prev : next;
    });
  }, [uid]);

  // ── Realtime subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    if (!uid) return;

    const msgChannel = subscribeToMessages(
      supabase,
      conversationId,
      (incoming) => {
        // Replace any optimistic row sharing this id (offline send confirmed), or
        // append if new. Keep the local cache in sync so a reopen is instant.
        setMsgs((prev) => (prev.some((m) => m.id === incoming.id)
          ? prev.map((m) => (m.id === incoming.id ? incoming : m))
          : [...prev, incoming]));
        upsertCachedMessage(conversationId, incoming).catch(() => {});
        // A system message means the disappearing timer was just changed — refresh
        // the header indicator to match.
        if (incoming.type === 'system') {
          getDisappearing(supabase, conversationId).then(setDisappearSecs).catch(() => {});
        }
        if (incoming.sender_id !== uid) {
          // Always mark delivered on device receipt; read only when not in ghost mode.
          markMessageAsDelivered(supabase, incoming.id).catch(() => {});
          if (!ghostRef.current) {
            markMessageAsRead(supabase, incoming.id).catch(() => {});
          }
        }
        requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
      },
      (updated) => {
        setMsgs((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        upsertCachedMessage(conversationId, updated).catch(() => {});
      },
    );

    let alive = true;
    const rxChannel = subscribeToReactions(supabase, conversationId, () => {
      getReactions(
        supabase,
        messagesRef.current.map((m) => m.id),
      ).then((r) => { if (alive) setReactions(r); }).catch(() => {});
    });

    const rcChannel = subscribeToReceipts(supabase, conversationId, (r) =>
      applyReceipts([r]),
    );

    const presenceChannel = joinPresence(supabase, uid, (ids) => {
      if (alive) setOnlineIds(ids);
    });

    const tc = createTypingChannel(supabase, conversationId, (p) => {
      if (!alive || p.userId === uid) return;
      setTypingName(p.typing ? p.name : null);
      if (p.typing) {
        if (typingTimeout.current) clearTimeout(typingTimeout.current);
        typingTimeout.current = setTimeout(() => {
          if (alive) setTypingName(null);
        }, 4000);
      }
    });
    typingChannel.current = tc;

    return () => {
      alive = false;
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(rxChannel);
      supabase.removeChannel(rcChannel);
      leavePresence(presenceChannel); // shared room: unhook this screen only
      supabase.removeChannel(tc.channel);
      // Cancel any pending "typing…" auto-clear so it can't fire setTypingName
      // after this screen has unmounted (no state updates after unmount).
      if (typingTimeout.current) { clearTimeout(typingTimeout.current); typingTimeout.current = null; }
    };
  }, [uid, conversationId, setMsgs, applyReceipts]);

  // Restore a persisted draft when the chat opens (cancel on switch — no cross-chat bleed).
  useEffect(() => {
    let alive = true;
    getDraft(conversationId)
      .then((d) => { if (alive && d) setText(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [conversationId]);

  // When a queued (offline) message finally sends, swap its optimistic row for
  // the confirmed server row and flip its tick from clock → sent.
  useEffect(() => {
    const off = onOutboxSent((item, sentId) => {
      if (item.conversationId !== conversationId) return;
      setReceipts((prev) => {
        const next = new Map(prev);
        next.delete(item.tempId);
        next.set(sentId, 'sent');
        return next;
      });
      // tempId === sentId (we reuse the id), so the row is already correct; just
      // clear the pending flag so the clock disappears.
      setMsgs((prev) => prev.map((m) => (m.id === sentId ? { ...m, pending: false } : m)));
    });
    // Permanently failed after MAX_OUTBOX_ATTEMPTS — surface failed state (no silent drop).
    const offDead = onOutboxDeadLetter((item) => {
      if (item.conversationId !== conversationId) return;
      setReceipts((prev) => {
        const next = new Map(prev);
        next.set(item.tempId, 'failed' as TickStatus);
        return next;
      });
      setMsgs((prev) =>
        prev.map((m) => (m.id === item.tempId ? { ...m, pending: false, failed: true } as typeof m : m)),
      );
    });
    return () => {
      off();
      offDead();
    };
  }, [conversationId]);

  // ── Header (title + presence / typing subtitle) ───────────────────────────
  const peerOnline = peers.some((p) => onlineIds.has(p.id));
  const subtitle = typingName
    ? isGroup
      ? `${typingName} is typing…`
      : 'typing…'
    : isGroup
      ? `${peers.length + 1} members`
      : peerOnline
        ? 'online'
        : formatLastSeen(peers[0]?.last_seen);
  // Direct chats prefer the peer avatar; groups use conversation avatar.
  const [peerNickname, setPeerNickname] = useState<string | null>(null);
  const [headerTitle, setHeaderTitle] = useState(params.title);

  // Load local nickname + never let a weak network peer wipe the nav title.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (isGroup || !uid || !peers[0]?.id) {
        if (alive) {
          setPeerNickname(null);
          if (params.title && !/^unknown$/i.test(params.title)) setHeaderTitle(params.title);
        }
        return;
      }
      const nick = await getNickname(uid, peers[0].id).catch(() => null);
      if (!alive) return;
      setPeerNickname(nick);
      const name = resolveDisplayName(peers[0], {
        nickname: nick,
        fallback: params.title,
      });
      setHeaderTitle(name);
    })();
    return () => { alive = false; };
  }, [uid, peers, isGroup, params.title]);

  const headerAvatarUri = isGroup
    ? chatAvatarUrl
    : (resolveAvatarUrl(peers[0], chatAvatarUrl));
  const headerAvatarName = isGroup
    ? (headerTitle || params.title)
    : resolveDisplayName(peers[0], { nickname: peerNickname, fallback: headerTitle || params.title });

  function openHeaderProfile() {
    if (isGroup) {
      navigation.navigate('GroupInfo', { conversationId });
    } else if (peers[0]) {
      navigation.navigate('Profile', { userId: peers[0].id, conversationId });
    }
  }

  useEffect(() => {
    if (selectionMode) {
      navigation.setOptions({
        headerTitle: () => <Text style={styles.headerTitle}>{selectedIds.size} selected</Text>,
        headerLeft: () => (
          <Pressable hitSlop={8} onPress={exitSelection}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        ),
        headerRight: () => (
          <View style={styles.headerActions}>
            <Pressable hitSlop={8} onPress={copySelected}>
              <Ionicons name="copy-outline" size={21} color={colors.text} />
            </Pressable>
            <Pressable hitSlop={8} onPress={forwardSelectedMany} style={{ marginLeft: 18 }}>
              <Ionicons name="arrow-redo-outline" size={22} color={colors.text} />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => deleteMany([...selectedIds])} style={{ marginLeft: 18 }}>
              <Ionicons name="trash-outline" size={21} color={colors.danger} />
            </Pressable>
          </View>
        ),
      });
      return;
    }
    navigation.setOptions({
      headerLeft: undefined,
      headerTitle: () => (
        <Pressable onPress={openHeaderProfile} style={styles.headerPerson}>
          <Avatar uri={headerAvatarUri} name={headerAvatarName} size={36} />
          <View style={styles.headerTextCol}>
            <View style={styles.headerTitleRow}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {headerTitle || params.title}
              </Text>
              {/* Disappearing-messages indicator (WhatsApp parity). */}
              {disappearSecs > 0 && (
                <Ionicons name="timer-outline" size={14} color={colors.textMuted} style={{ marginLeft: 5 }} />
              )}
              {ghost && (
                <Ionicons name="eye-off-outline" size={13} color={colors.textMuted} style={{ marginLeft: 5 }} />
              )}
            </View>
            {!!subtitle && (
              <Text style={[styles.headerSub, typingName ? styles.headerSubTyping : null]} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
        </Pressable>
      ),
      // Call buttons (1:1) + overflow ⋮ menu (WhatsApp-class chat options).
      headerRight: () => (
        <View style={styles.headerActions}>
          {!isGroup && (
            <>
              <Pressable
                hitSlop={10}
                onPress={() => placeCall('audio')}
                accessibilityLabel="Voice call"
                style={{ marginLeft: 12 }}
              >
                <Ionicons name="call-outline" size={22} color={colors.text} />
              </Pressable>
              <Pressable
                hitSlop={10}
                onPress={() => placeCall('video')}
                accessibilityLabel="Video call"
                style={{ marginLeft: 14 }}
              >
                <Ionicons name="videocam-outline" size={23} color={colors.text} />
              </Pressable>
            </>
          )}
          <Pressable
            hitSlop={10}
            onPress={openChatMenu}
            accessibilityLabel="More options"
            style={{ marginLeft: 12, padding: 2 }}
          >
            <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, params.title, headerTitle, headerAvatarName, subtitle, peers, colors, styles, selectionMode, selectedIds, isGroup, ghost, disappearSecs, conversationId, headerAvatarUri, typingName, chatMuted, chatLock, starredIds, peerNickname]);

  function placeCall(kind: 'audio' | 'video') {
    // Only reachable from direct chats (call buttons are hidden in groups).
    const peer = peers[0];
    if (!peer) return;
    startCall(conversationId, peer, kind);
  }

  // ── Compose / send ────────────────────────────────────────────────────────
  // Honour the "Enter to send" chat setting (mirrors web). Defaults to true.
  useEffect(() => {
    getChatSettings(supabase).then((s) => setEnterToSend(s.enterToSend)).catch(() => {});
  }, []);

  // Load ghost mode = premium AND ghost_mode pref (mirrors web `isPremium && prefs.ghost_mode`).
  useEffect(() => {
    Promise.all([getServerPremium(supabase).catch(() => false), getPreferences(supabase).catch(() => null)])
      .then(([premium, prefs]) => { const g = !!premium && !!prefs?.ghost_mode; ghostRef.current = g; setGhost(g); })
      .catch(() => {});
  }, []);

  // First name used in group typing broadcasts ("Asha is typing…").
  const selfNameRef = useRef<string>('User');
  useEffect(() => {
    let alive = true;
    getMyProfile(supabase)
      .then((p) => {
        if (!alive || !p?.display_name) return;
        selfNameRef.current = p.display_name.trim().split(/\s+/)[0] || 'User';
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [uid]);

  function onChangeText(t: string) {
    setText(t);
    setDraft(conversationId, t).catch(() => {}); // persist draft so it survives close/offline
    // Ghost mode: never broadcast typing.
    if (!ghostRef.current) {
      typingChannel.current?.notify({
        userId: uid ?? '',
        name: selfNameRef.current,
        typing: t.length > 0,
      });
    }
  }

  // WhatsApp-style Return-to-send. On a hardware keyboard, Enter without Shift
  // sends; Shift+Enter inserts a newline. Soft keyboards fall through to the
  // returnKeyType="send" / onSubmitEditing path below.
  function onInputKeyPress(e: any) {
    if (!enterToSend) return;
    const ne = e?.nativeEvent ?? {};
    if (ne.key === 'Enter' && !ne.shiftKey) {
      e.preventDefault?.();
      handleSend();
    }
  }

  // Re-entrancy guard: `sending` state is not set for text, so double-tap/Enter
  // can race two handleSends before re-render without this ref.
  const sendInFlight = useRef(false);

  async function handleSend() {
    const body = text.trim();
    if (!body || sendInFlight.current) return;
    if (groupSendBlocked) {
      Alert.alert('Only admins', 'Only admins can send messages in this group.');
      return;
    }
    sendInFlight.current = true;
    try {
      setText('');
      setDraft(conversationId, '').catch(() => {}); // clear persisted draft
      typingChannel.current?.notify({ userId: uid ?? '', name: selfNameRef.current, typing: false });

      if (editing) {
        const target = editing;
        setEditing(null);
        // Optimistic + durable action queue (works offline).
        setMsgs((prev) =>
          prev.map((m) =>
            m.id === target.id
              ? { ...m, content: body, edited_at: new Date().toISOString() }
              : m,
          ),
        );
        await queueAction('editMessage', { messageId: target.id, content: body });
        return;
      }

      const replyId = reply?.id;
      setReply(null);

      // Optimistic: render the message immediately with a client-generated id and a
      // "sending" (clock) tick. The SAME id is used for the server insert so the
      // realtime echo dedupes cleanly.
      const tempId = uuidv4();
      const optimistic: Message = {
        id: tempId,
        conversation_id: conversationId,
        sender_id: uid ?? '',
        type: 'text',
        content: body,
        media_url: null,
        reply_to: replyId ?? null,
        is_deleted: false,
        created_at: new Date().toISOString(),
        edited_at: null,
        pending: true,
      };
      setMsgs((prev) => [...prev, optimistic]);
      setReceipts((prev) => new Map(prev).set(tempId, 'sending'));
      upsertCachedMessage(conversationId, optimistic).catch(() => {});
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));

      // Queue durably first so the message survives an app kill, then try to send.
      await enqueueOutbox({
        tempId,
        conversationId,
        senderId: uid ?? '',
        content: body,
        type: 'text',
        replyTo: replyId,
        createdAt: optimistic.created_at,
        attempts: 0,
      });
      // flushOutbox inserts then sendPush (with messageId dedupe). Do NOT push
      // here — FCM can arrive before the row exists (ghost notification).
      flushOutbox().catch(() => {});
    } finally {
      sendInFlight.current = false;
    }
  }

  // Free tier caps uploads at 5 MB; premium lifts it to 100 MB (web parity via
  // FREE_LIMITS/PREMIUM_LIMITS). Returns true if the file is within the limit.
  function withinUploadLimit(bytes: number | undefined): boolean {
    if (bytes == null) return true; // size unknown — let the server be the backstop
    const limit = isPremium ? PREMIUM_LIMITS.uploadBytes : FREE_LIMITS.uploadBytes;
    if (bytes <= limit) return true;
    if (!isPremium) {
      Alert.alert(
        'File too large',
        `Free accounts can send files up to ${Math.round(FREE_LIMITS.uploadBytes / (1024 * 1024))} MB. Upgrade to Lumixo+ to send files up to ${Math.round(PREMIUM_LIMITS.uploadBytes / (1024 * 1024))} MB.`,
        [{ text: 'Not now', style: 'cancel' }, { text: 'Upgrade', onPress: () => navigation.navigate('Premium') }],
      );
    } else {
      Alert.alert('File too large', `This file exceeds the ${Math.round(PREMIUM_LIMITS.uploadBytes / (1024 * 1024))} MB limit.`);
    }
    return false;
  }

  /** Camera / mic / document path — same durable outbox as MediaPreview (survives kill + offline). */
  async function sendMedia(
    uri: string,
    fileName: string,
    type: 'image' | 'video' | 'file' | 'audio',
    caption?: string,
    mediaMeta?: import('../lib/shared').MediaMeta,
  ) {
    const body =
      type === 'file'
        ? (caption?.trim() || fileName)
        : (caption ?? '');
    const tempId = uuidv4();
    const optimistic: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: uid ?? '',
      type,
      content: body,
      media_url: uri,
      reply_to: null,
      is_deleted: false,
      created_at: new Date().toISOString(),
      edited_at: null,
      pending: true,
      media_meta: (mediaMeta ?? null) as Message['media_meta'],
    };
    setMsgs((prev) => [...prev, optimistic]);
    setReceipts((prev) => new Map(prev).set(tempId, 'sending'));
    upsertCachedMessage(conversationId, optimistic).catch(() => {});
    await enqueueOutbox({
      tempId,
      conversationId,
      senderId: uid ?? '',
      content: body,
      type,
      createdAt: optimistic.created_at,
      attempts: 0,
      localUri: uri,
      fileName,
      mediaMeta: mediaMeta as Record<string, unknown> | undefined,
    });
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
    flushOutbox().catch(() => {});
  }

  // Open the full-screen media picker (replaces the old bottom-sheet gallery).
  function openMediaPicker() {
    setAttachOpen(false);
    navigation.navigate('MediaPicker', { conversationId });
  }

  // Receive finished attachments from the MediaPreview editor (via the send bridge).
  // Each is rendered optimistically and DURABLY QUEUED with its local file:// URI, so
  // the actual upload happens in flushOutbox — surviving an app kill and auto-sending
  // on reconnect (offline upload queue, spec §13). No network wait blocks the UI.
  const sendMediaSubmission = useCallback(async (sub: MediaSubmission) => {
    for (const item of sub.items) {
      const tempId = uuidv4();
      const optimistic: Message = {
        id: tempId,
        conversation_id: conversationId,
        sender_id: uid ?? '',
        type: item.type,
        content: item.caption ?? '',
        media_url: item.uri,               // local preview until the upload completes
        reply_to: null,
        is_deleted: false,
        created_at: new Date().toISOString(),
        edited_at: null,
        pending: true,
        media_meta: (item.mediaMeta ?? null) as Message['media_meta'],
      };
      setMsgs((prev) => [...prev, optimistic]);
      setReceipts((prev) => new Map(prev).set(tempId, 'sending'));
      upsertCachedMessage(conversationId, optimistic).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await enqueueOutbox({
        tempId,
        conversationId,
        senderId: uid ?? '',
        content: item.caption ?? '',
        type: item.type,
        createdAt: optimistic.created_at,
        attempts: 0,
        localUri: item.uri,                // flushOutbox uploads this, then inserts
        fileName: item.fileName,
        mediaMeta: item.mediaMeta as Record<string, unknown> | undefined,
      });
    }
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
    flushOutbox().catch(() => {});
  }, [conversationId, uid]);

  // Register this chat as the handler for media coming back from the picker while
  // it's mounted; unregister on unmount so a backgrounded chat never receives it.
  useEffect(() => {
    const off = registerMediaHandler(conversationId, (sub) => { void sendMediaSubmission(sub); });
    return off;
  }, [conversationId, sendMediaSubmission]);

  // Premium stickers — durable outbox (same offline path as text/media).
  // Data-URI mediaUrl needs no upload; flush inserts the row on reconnect.
  async function sendSticker(url: string) {
    setStickersOpen(false);
    if (groupSendBlocked) {
      Alert.alert('Only admins', 'Only admins can send messages in this group.');
      return;
    }
    const tempId = uuidv4();
    const optimistic: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: uid ?? '',
      type: 'image',
      content: '',
      media_url: url,
      reply_to: null,
      is_deleted: false,
      created_at: new Date().toISOString(),
      edited_at: null,
      pending: true,
    };
    setMsgs((prev) => [...prev, optimistic]);
    setReceipts((prev) => new Map(prev).set(tempId, 'sending'));
    upsertCachedMessage(conversationId, optimistic).catch(() => {});
    await enqueueOutbox({
      tempId,
      conversationId,
      senderId: uid ?? '',
      content: '',
      type: 'image',
      mediaUrl: url,
      createdAt: optimistic.created_at,
      attempts: 0,
    });
    flushOutbox().catch(() => {});
  }

  // Open a media message, enforcing View Once (0030). For a View-Once item the
  // RECIPIENT may open exactly once (server-authoritative via mark_view_once_seen);
  // the SENDER can re-see their own. A spent item shows an alert and never reopens.
  const openMedia = useCallback(async (msg: Message) => {
    const url = msg.media_url;
    if (!url) return;
    const vo = msg.media_meta?.viewOnce;
    if (!vo) { setViewerUrl(url); return; }          // normal media
    const mine = msg.sender_id === uid;
    if (mine) { setViewerUrl(url); return; }         // sender may re-see their own
    if (voSpent.has(msg.id)) {
      Alert.alert('View Once', 'You’ve already viewed this once. It can’t be opened again.');
      return;
    }
    // Consume server-side FIRST (one open, authoritative), then reveal.
    // Fail closed: network error must not open media (would burn the one view locally).
    const res = await markViewOnceSeen(supabase, msg.id);
    if (!res) {
      Alert.alert('View Once', 'Could not open. Check your connection and try again.');
      return;
    }
    if (res.consumed && res.first_view === false) {
      setVoSpent((prev) => new Set(prev).add(msg.id));
      Alert.alert('View Once', 'You’ve already viewed this once. It can’t be opened again.');
      return;
    }
    setVoSpent((prev) => new Set(prev).add(msg.id));
    setViewerUrl(url);
  }, [uid, voSpent]);

  // Hydrate which View-Once messages I've already consumed, so a reopened chat shows
  // them as spent (not re-openable). Only checks View-Once items sent TO me.
  useEffect(() => {
    if (!uid) return;
    const pending = messages.filter(
      (m) => m.media_meta?.viewOnce && m.sender_id !== uid && !voSpent.has(m.id),
    );
    if (!pending.length) return;
    let alive = true;
    (async () => {
      const spent: string[] = [];
      for (const m of pending) {
        // eslint-disable-next-line no-await-in-loop
        const st = await getViewOnceState(supabase, m.id).catch(() => null);
        if (st && st.seen) spent.push(m.id);
      }
      if (alive && spent.length) setVoSpent((prev) => new Set([...prev, ...spent]));
    })();
    return () => { alive = false; };
  }, [messages, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scheduled messages (premium) — persist the current draft to send later
  // (web parity: ChatView.handleSchedule). Future-time validation lives in the
  // modal; on success we clear the composer.
  async function doSchedule(when: Date) {
    const body = text.trim();
    if (!body) { setScheduleOpen(false); return; }
    const { error } = await scheduleMessage(supabase, conversationId, body, when);
    setScheduleOpen(false);
    if (error) { Alert.alert('Could not schedule', error.message); return; }
    setText('');
    Alert.alert('Scheduled', `Your message will send ${when.toLocaleString()}.`);
  }

  // Camera capture (photo or short video). Gallery path is MediaPicker.
  async function pickImage(fromCamera: boolean) {
    setAttachOpen(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.7,
      videoMaxDuration: 60,
      allowsEditing: false,
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    if (!withinUploadLimit(a.fileSize)) return;
    const isVid = a.type === 'video' || /\.(mp4|mov|m4v)(\?|$)/i.test(a.uri);
    const name =
      a.fileName ??
      (isVid ? `video_${Date.now()}.mp4` : `photo_${Date.now()}.jpg`);
    await sendMedia(a.uri, name, isVid ? 'video' : 'image');
    void fromCamera;
  }

  async function pickDocument() {
    setAttachOpen(false);
    const res = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    if (!withinUploadLimit(a.size ?? undefined)) return;
    await sendMedia(a.uri, a.name || `file_${Date.now()}`, 'file');
  }

  /** Open a document attachment (cache → share sheet / OS open). */
  async function openDocument(msg: Message) {
    const url = msg.media_url;
    if (!url) return;
    try {
      const local = await ensureMediaCached(url);
      const target = local ?? (await signedMediaUrl(supabase, url)) ?? url;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(target, {
          dialogTitle: msg.content || 'Document',
          mimeType: guessMime(msg.content || url),
        });
      } else {
        await Share.share({ url: target, message: msg.content || 'Document' });
      }
    } catch {
      Alert.alert('Could not open', 'Download failed. Check your connection and try again.');
    }
  }

  // ── Voice notes ───────────────────────────────────────────────────────────
  // Tick the elapsed-recording counter once per second while a recording is live.
  useEffect(() => {
    if (!recording) { setRecSecs(0); return; }
    setRecSecs(0);
    const id = setInterval(() => setRecSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  async function startRecording() {
    // Ignore re-entry (double press-in) and in-flight starts.
    if (recordingRef.current || recStartingRef.current || recStoppingRef.current) return;
    recStartingRef.current = true;
    recPendingStopRef.current = null;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        recStartingRef.current = false;
        recPendingStopRef.current = null;
        return;
      }
      // User already released during the permission prompt — do not start.
      if (recPendingStopRef.current !== null) {
        recStartingRef.current = false;
        recPendingStopRef.current = null;
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      if (recPendingStopRef.current !== null) {
        recStartingRef.current = false;
        recPendingStopRef.current = null;
        return;
      }
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      // Released mid-createAsync: discard immediately, never flash stuck UI.
      if (recPendingStopRef.current !== null) {
        const wantSend = recPendingStopRef.current;
        recPendingStopRef.current = null;
        recStartingRef.current = false;
        try {
          await rec.stopAndUnloadAsync();
          const uri = rec.getURI();
          // Only auto-send if they held long enough and didn't cancel.
          const heldMs = Date.now() - recStartedAtRef.current;
          if (wantSend && !recCancelRef.current && uri && heldMs >= 400) {
            await sendMedia(uri, `voice_${Date.now()}.m4a`, 'audio');
          }
        } catch { /* discard */ }
        return;
      }
      recCancelRef.current = false;
      setRecCanceling(false);
      recStartedAtRef.current = Date.now();
      setRecording(rec);
      recordingRef.current = rec;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch {
      setRecording(null);
      recordingRef.current = null;
    } finally {
      recStartingRef.current = false;
    }
  }

  async function stopRecording(send: boolean) {
    if (recStoppingRef.current) return;
    const rec = recordingRef.current;
    if (!rec) return;
    recStoppingRef.current = true;
    try {
      // Drop ultra-short taps (accidental) so we never send a broken note.
      const heldMs = Date.now() - recStartedAtRef.current;
      const shouldSend = send && !recCancelRef.current && heldMs >= 400;
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      setRecording(null);
      recordingRef.current = null;
      setRecCanceling(false);
      if (shouldSend && uri) await sendMedia(uri, `voice_${Date.now()}.m4a`, 'audio');
      else if (!shouldSend) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    } catch {
      setRecording(null);
      recordingRef.current = null;
      setRecCanceling(false);
    } finally {
      recStoppingRef.current = false;
      recPendingStopRef.current = null;
    }
  }

  function onMicPressIn(e: { nativeEvent: { pageX: number } }) {
    recStartX.current = e.nativeEvent.pageX;
    recCancelRef.current = false;
    recPendingStopRef.current = null;
    recStartedAtRef.current = Date.now();
    setRecCanceling(false);
    void startRecording();
  }

  function onMicTouchMove(e: { nativeEvent: { pageX: number } }) {
    // Track cancel even while start is still in flight so release uses correct intent.
    if (!recordingRef.current && !recStartingRef.current) return;
    const dx = e.nativeEvent.pageX - recStartX.current;
    const canceling = dx < -64;
    if (canceling !== recCancelRef.current) {
      recCancelRef.current = canceling;
      setRecCanceling(canceling);
      if (canceling) Haptics.selectionAsync().catch(() => {});
    }
  }

  function onMicPressOut() {
    const send = !recCancelRef.current;
    if (recordingRef.current) {
      void stopRecording(send);
      return;
    }
    // Still starting — remember the release intent so startRecording can finish cleanly.
    if (recStartingRef.current) {
      recPendingStopRef.current = send;
    }
  }

  // ── Multi-select ──────────────────────────────────────────────────────────
  function enterSelection(m: Message) {
    setSelectionMode(true);
    setSelectedIds(new Set([m.id]));
  }
  function toggleSelect(m: Message) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }
  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }
  async function copySelected() {
    const texts = messagesRef.current.filter((m) => selectedIds.has(m.id) && m.content).map((m) => m.content as string);
    if (texts.length) await Clipboard.setStringAsync(texts.join('\n'));
    exitSelection();
  }
  // Open the forward sheet for a set of source messages (+ optional media preview).
  async function beginForward(sources: Message[], preview: ForwardPreview | null = null) {
    if (!sources.length) return;
    setForwardSources(sources);
    setForwardPreview(preview);
    setForwardOpen(true);
    // Fetch recipients lazily; the sheet renders its own loading-empty state until here.
    const list = await getMyConversations(supabase);
    setForwardList(list);
  }

  function previewFor(m: Message): ForwardPreview | null {
    if (m.type === 'image' && m.media_url) return { kind: 'image', url: m.media_url, caption: m.content };
    if (m.media_url && isVideoMessage(m)) return { kind: 'video', url: m.media_url, caption: m.content };
    return null;
  }

  async function forwardSelectedMany() {
    const sources = messagesRef.current.filter((m) => selectedIds.has(m.id));
    await beginForward(sources);
  }

  // ── Message actions ───────────────────────────────────────────────────────
  // Toggle a reaction. From the action sheet `target` is omitted (uses `selected`);
  // tapping an existing reaction pill passes the message directly so the sheet
  // needn't be open (WhatsApp/web parity — tap a pill to add/remove your reaction).
  async function react(emoji: string, target?: Message) {
    const t = target ?? selected;
    if (!t) return;
    if (!target) setSelected(null);
    await toggleReaction(supabase, t.id, emoji);
    getReactions(supabase, messagesRef.current.map((m) => m.id)).then(setReactions);
  }

  async function togglePin() {
    if (!selected || !isGroup) return;
    const target = selected;
    setSelected(null);
    const was = pinnedIds.has(target.id);
    const res = was
      ? await unpinGroupMessage(supabase, conversationId, target.id)
      : await pinGroupMessage(supabase, conversationId, target.id);
    if (res.error) {
      Alert.alert('Pin', res.error.message);
      return;
    }
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (was) next.delete(target.id);
      else next.add(target.id);
      return next;
    });
  }

  // Star / unstar a message (per-user bookmark). Optimistic; the browser screen
  // reads the same starred_messages table.
  async function toggleStar() {
    if (!selected) return;
    const target = selected;
    setSelected(null);
    const isStarred = starredIds.has(target.id);
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (isStarred) next.delete(target.id); else next.add(target.id);
      return next;
    });
    // Instant + durable: queue the (un)star so it syncs in the background and
    // auto-retries on reconnect — never blocks the UI, never reverts on offline.
    queueAction(isStarred ? 'unstar' : 'star', { messageId: target.id });
  }

  // ── Chat overflow (⋮) — WhatsApp-class chat options ──────────────────────
  useEffect(() => {
    let alive = true;
    getMutedIds(supabase)
      .then((ids) => { if (alive) setChatMuted(ids.includes(conversationId)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [conversationId]);

  async function goToFirstMessage() {
    try {
      scrollToOldestPending.current = true;
      // Load a deep history slice so "first" is meaningful for long threads.
      const deep = await getMessages(supabase, conversationId, 1000);
      if (deep.length) {
        setMsgs((prev) => mergeById(deep, prev));
        cacheMessages(conversationId, deep).catch(() => {});
      }
      // Actual scroll runs in FlatList onContentSizeChange (after layout).
      // Fallback if content size does not fire (short threads).
      setTimeout(() => {
        if (!scrollToOldestPending.current) return;
        scrollToOldestPending.current = false;
        try { listRef.current?.scrollToEnd({ animated: true }); } catch { /* ignore */ }
      }, 400);
    } catch {
      scrollToOldestPending.current = false;
      Alert.alert('Could not jump', 'Try again in a moment.');
    }
  }

  async function clearThisChat(keepStarred: boolean) {
    const { error, cleared } = await clearChatMessagesForMe(supabase, conversationId, { keepStarred });
    if (error) {
      Alert.alert('Could not clear chat', error.message);
      return;
    }
    // Update local UI: hide cleared messages (respect keepStarred).
    setHiddenIds((prev) => {
      const next = new Set(prev);
      for (const m of messagesRef.current) {
        if (keepStarred && starredIds.has(m.id)) continue;
        next.add(m.id);
      }
      return next;
    });
    Alert.alert(
      'Chat cleared',
      cleared
        ? keepStarred
          ? 'Messages cleared except starred. Media saved outside Lumixo is untouched.'
          : 'Messages cleared for you. Media saved outside Lumixo is untouched.'
        : 'Nothing to clear.',
    );
  }

  function confirmClearChat() {
    Alert.alert(
      'Clear this chat?',
      'Messages are removed from this device only. The conversation stays in your list. Media already saved to your gallery is not deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear except starred',
          onPress: () => { void clearThisChat(true); },
        },
        {
          text: 'Clear all messages',
          style: 'destructive',
          onPress: () => { void clearThisChat(false); },
        },
      ],
    );
  }

  function confirmDeleteChat() {
    Alert.alert(
      'Delete this chat?',
      'The conversation will be removed from your list. Media already saved on your device is not deleted. The other person keeps their copy.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete chat',
          style: 'destructive',
          onPress: async () => {
            const { error } = await deleteConversationForMe(supabase, conversationId);
            if (error) Alert.alert('Could not delete', error.message);
            else navigation.goBack();
          },
        },
      ],
    );
  }

  function openChatMenu() {
    // Prebuilt actions — showSheet presents same-frame on DialogHost (no Modal cold start).
    const peer = peers[0];
    showSheet({
      title: isGroup ? 'Group options' : 'Chat options',
      actions: [
        {
          text: isGroup ? 'Group info' : 'View contact',
          icon: isGroup ? 'group' : 'person',
          onPress: openHeaderProfile,
        },
        ...(!isGroup && peer
          ? [{
              text: peerNickname ? 'Edit nickname' : 'Add nickname',
              icon: 'edit' as const,
              onPress: () => {
                if (peer) navigation.navigate('Profile', { userId: peer.id, conversationId });
              },
            }]
          : []),
        {
          text: 'Search',
          icon: 'search',
          onPress: () => setSearchOpen(true),
        },
        {
          text: 'Media, links & docs',
          icon: 'photo',
          onPress: () => {
            if (isGroup) navigation.navigate('GroupInfo', { conversationId });
            else if (peer) navigation.navigate('Profile', { userId: peer.id, conversationId });
          },
        },
        {
          text: 'Starred messages',
          icon: 'star',
          onPress: () => navigation.navigate('Starred' as any),
        },
        {
          text: chatMuted ? 'Unmute notifications' : 'Mute notifications',
          icon: chatMuted ? 'unmute' : 'mute',
          onPress: async () => {
            if (chatMuted) {
              await unmuteConversation(supabase, conversationId).catch(() => {});
              setChatMuted(false);
            } else {
              await muteConversation(supabase, conversationId).catch(() => {});
              setChatMuted(true);
            }
          },
        },
        {
          text: 'Wallpaper',
          icon: 'wallpaper',
          onPress: () => navigation.navigate('Appearance' as any),
        },
        {
          text: 'Go to first message',
          icon: 'first',
          subtitle: 'Jump to the oldest message',
          onPress: () => { void goToFirstMessage(); },
        },
        {
          text: 'Export chat',
          icon: 'export',
          onPress: () => { void exportChatTranscript(); },
        },
        {
          text: 'Clear chat',
          icon: 'clear',
          onPress: confirmClearChat,
        },
        {
          text: 'Delete chat',
          icon: 'trash',
          style: 'destructive',
          onPress: confirmDeleteChat,
        },
        ...(!isGroup && peer
          ? [
              {
                text: 'Block',
                icon: 'block' as const,
                style: 'destructive' as const,
                onPress: () => {
                  Alert.alert(
                    'Block contact?',
                    `${peer.display_name || 'This user'} won’t be able to message or call you.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Block',
                        style: 'destructive',
                        onPress: async () => {
                          const { error } = await blockUser(supabase, peer.id);
                          if (error) Alert.alert('Could not block', error.message);
                          else Alert.alert('Blocked', `${peer.display_name || 'User'} is blocked.`);
                        },
                      },
                    ],
                  );
                },
              },
              {
                text: 'Report',
                icon: 'report' as const,
                style: 'destructive' as const,
                onPress: () => {
                  Alert.alert('Report contact?', 'Our safety team will review this report.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Report',
                      style: 'destructive',
                      onPress: async () => {
                        const { error } = await submitSafetyReport(
                          supabase,
                          'user',
                          peer.id,
                          'other',
                          'Reported from chat menu',
                        );
                        if (error) Alert.alert('Could not report', error.message);
                        else Alert.alert('Thanks', 'Report submitted.');
                      },
                    },
                  ]);
                },
              },
            ]
          : [
              {
                text: 'Report group',
                icon: 'report' as const,
                style: 'destructive' as const,
                onPress: () => {
                  Alert.alert('Report group?', 'Our safety team will review this group.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Report',
                      style: 'destructive',
                      onPress: async () => {
                        const { error } = await submitSafetyReport(
                          supabase,
                          'conversation',
                          conversationId,
                          'other',
                          'Reported from chat menu',
                        );
                        if (error) Alert.alert('Could not report', error.message);
                        else Alert.alert('Thanks', 'Report submitted.');
                      },
                    },
                  ]);
                },
              },
            ]),
        ...(chatLock.isLocked(conversationId)
          ? [{
              text: 'Chat lock is on',
              icon: 'lock' as const,
              subtitle: 'Managed in contact / group settings',
              onPress: () => {
                if (isGroup) navigation.navigate('GroupInfo', { conversationId });
                else if (peer) navigation.navigate('Profile', { userId: peer.id, conversationId });
              },
            }]
          : [{
              text: 'Chat lock',
              icon: 'lock' as const,
              subtitle: 'Lock this chat with device biometrics',
              onPress: () => {
                if (isGroup) navigation.navigate('GroupInfo', { conversationId });
                else if (peer) navigation.navigate('Profile', { userId: peer.id, conversationId });
              },
            }]),
      ],
    });
  }

  async function exportChatTranscript() {
    try {
      const { data } = await supabase
        .from('messages')
        .select('content, type, created_at, sender_id, is_deleted')
        .eq('conversation_id', conversationId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .limit(500);
      const nameById = new Map(
        peers.map((p) => [
          p.id,
          resolveDisplayName(p, {
            nickname: !isGroup && p.id === peers[0]?.id ? peerNickname : null,
            fallback: 'Contact',
          }),
        ]),
      );
      if (uid) nameById.set(uid, 'You');
      const lines = (data || []).map((m: any) => {
        const who = nameById.get(m.sender_id) || 'Contact';
        const body =
          m.type === 'system'
            ? m.content
            : m.type === 'text'
              ? m.content
              : `[${m.type}] ${m.content || ''}`.trim();
        return `[${new Date(m.created_at).toLocaleString()}] ${who}: ${body || ''}`;
      });
      const title = headerTitle || params.title || (isGroup ? 'Group' : 'Chat');
      await Share.share({ message: `Lumixo — ${title}\n\n${lines.join('\n')}` });
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || 'Could not export chat');
    }
  }

  /** Close the RN message Modal fully before opening DialogHost (no stacked UI). */
  function afterMessageSheetClosed(fn: () => void) {
    setSelected(null);
    setTimeout(fn, motion.sheetCloseMs + 30);
  }

  // Delete-for-me: hide a single message locally for this user only (unlike
  // delete-for-everyone). Backed by hidden_messages.
  function hideOneMessage(messageId: string) {
    setHiddenIds((prev) => new Set(prev).add(messageId));
    queueAction('hideMessage', { messageId });
  }

  // Message info — delivery/read status + timestamps, mirroring web's info view.
  function showInfo() {
    if (!selected) return;
    const target = selected;
    afterMessageSheetClosed(() => {
      const mine = target.sender_id === uid;
      const tick = computeOutboundTick({
        messageId: target.id,
        pending: target.pending,
        failed: !!(target as { failed?: boolean }).failed,
        senderId: uid,
        tickMap: receipts,
      });
      const status = tickLabel(tick);
      const lines = [
        `Sent: ${new Date(target.created_at).toLocaleString()}`,
        target.edited_at ? `Edited: ${new Date(target.edited_at).toLocaleString()}` : null,
        mine ? `Status: ${status}` : null,
        starredIds.has(target.id) ? 'Starred: yes' : null,
      ].filter(Boolean).join('\n');
      Alert.alert('Message info', lines || 'No details available.');
    });
  }

  // Report a message (WhatsApp/Telegram style): confirm → pick a reason → submit.
  // Only offered on messages you did NOT send. Step 1 is the confirmation dialog.
  function startReport() {
    if (!selected) return;
    const target = selected;
    afterMessageSheetClosed(() => {
      Alert.alert(
        'Report message',
        'Report this message to the Lumixo moderators?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Report',
            style: 'destructive',
            onPress: () => { setReportDetails(''); setReportTarget(target); },
          },
        ],
      );
    });
  }

  // Step 2: a reason was chosen — submit and give clear success/failure feedback.
  async function submitReport(reason: ReportReason) {
    const target = reportTarget;
    if (!target || reportBusy) return;
    setReportBusy(true);
    const { error } = await reportMessage(supabase, target.id, reason, reportDetails.trim() || undefined);
    setReportBusy(false);
    setReportTarget(null);
    setReportDetails('');
    if (error) {
      Alert.alert('Could not report', error.message);
    } else {
      Alert.alert('Report submitted', 'Thanks — our moderators will review this message.');
    }
  }

  /** WhatsApp delete flow: close action sheet first, then a single confirm dialog. */
  function doDelete() {
    if (!selected) return;
    const target = selected;
    const mine = target.sender_id === uid && !target.is_deleted;
    afterMessageSheetClosed(() => {
      const buttons: Array<{
        text: string;
        style?: 'cancel' | 'destructive' | 'default';
        onPress?: () => void | Promise<void>;
      }> = [{ text: 'Cancel', style: 'cancel' }];
      // Always available: delete for me only.
      buttons.push({
        text: 'Delete for me',
        onPress: () => hideOneMessage(target.id),
      });
      // Own messages only: delete for everyone (unsend).
      if (mine) {
        buttons.push({
          text: 'Delete for everyone',
          style: 'destructive',
          onPress: async () => {
            await deleteMessage(supabase, target.id);
            setMsgs((prev) =>
              prev.map((m) => (m.id === target.id ? { ...m, is_deleted: true, content: null, media_url: null } : m)),
            );
          },
        });
      }
      Alert.alert(
        'Delete message?',
        mine
          ? 'Delete for me removes it from your chat only. Delete for everyone removes it for all participants.'
          : 'This message will be removed from your chat only. Media already saved on your device is not deleted.',
        buttons,
      );
    });
  }

  // Bulk delete for multi-select.
  async function deleteMany(ids: string[]) {
    const mineIds = messagesRef.current
      .filter((m) => ids.includes(m.id) && m.sender_id === uid && !m.is_deleted)
      .map((m) => m.id);
    const onlyMine = mineIds.length === ids.length && ids.length > 0;
    Alert.alert(
      onlyMine ? 'Delete messages?' : 'Delete for me?',
      onlyMine
        ? `Delete ${ids.length} message${ids.length === 1 ? '' : 's'} for everyone, or for you only?`
        : `Remove ${ids.length} message${ids.length === 1 ? '' : 's'} from your chat only.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete for me',
          onPress: () => {
            exitSelection();
            ids.forEach((id) => hideOneMessage(id));
          },
        },
        ...(onlyMine
          ? [{
              text: 'Delete for everyone',
              style: 'destructive' as const,
              onPress: async () => {
                exitSelection();
                await Promise.all(ids.map((id) => deleteMessage(supabase, id).catch(() => {})));
                setMsgs((prev) =>
                  prev.map((m) =>
                    ids.includes(m.id) ? { ...m, is_deleted: true, content: null, media_url: null } : m,
                  ),
                );
              },
            }]
          : []),
      ],
    );
  }

  async function openForward() {
    if (!selected) return;
    const src = selected;
    setSelected(null);
    await beginForward([src], previewFor(src));
  }

  // ── Media viewer actions (forward / delete a single item by its message id) ──
  function forwardFromViewer(item: ViewerItem) {
    const msg = messageById.get(item.id);
    if (!msg) return;
    void beginForward([msg], previewFor(msg));
  }

  function deleteFromViewer(item: ViewerItem) {
    const msg = messageById.get(item.id);
    if (!msg) return;
    const mine = msg.sender_id === uid && !msg.is_deleted;
    setViewerUrl(null);
    setTimeout(() => {
      const buttons: Array<{
        text: string;
        style?: 'cancel' | 'destructive' | 'default';
        onPress?: () => void | Promise<void>;
      }> = [{ text: 'Cancel', style: 'cancel' }];
      buttons.push({
        text: 'Delete for me',
        onPress: () => hideOneMessage(msg.id),
      });
      if (mine) {
        buttons.push({
          text: 'Delete for everyone',
          style: 'destructive',
          onPress: async () => {
            await deleteMessage(supabase, msg.id);
            setMsgs((prev) =>
              prev.map((m) => (m.id === msg.id ? { ...m, is_deleted: true, content: null, media_url: null } : m)),
            );
          },
        });
      }
      Alert.alert('Delete message?', undefined, buttons);
    }, motion.sheetCloseMs + 30);
  }

  // Forward the queued source messages to every chosen target (multi-recipient).
  async function doForward(targetIds: string[]) {
    const sources = forwardSources;
    for (const targetId of targetIds) {
      for (const m of sources) {
        // eslint-disable-next-line no-await-in-loop
        await forwardMessage(supabase, targetId, { type: m.type, content: m.content, media_url: m.media_url });
      }
    }
    setForwardOpen(false);
    setForwardSources([]);
    setForwardPreview(null);
    if (selectionMode) exitSelection();
  }

  const reactionsByMsg = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const arr = map.get(r.message_id) ?? [];
      arr.push(r);
      map.set(r.message_id, arr);
    }
    return map;
  }, [reactions]);

  // Merge messages and polls into one chronological timeline, then insert day
  // separators and flag consecutive same-sender messages (WhatsApp grouping).
  const timeline = useMemo<TimelineItem[]>(() => {
    const merged: TimelineItem[] = [
      ...messages
        // delete-for-me: never show to this user. is_deleted: an UNSENT message
        // (Instagram-style) vanishes entirely for everyone — no tombstone. The
        // realtime UPDATE (is_deleted → true) makes it disappear live on all clients.
        // messageExpired: disappearing message (0022) past its expiry — hide it
        // instantly; the `now` tick re-runs this filter as each one expires.
        .filter((m) => !hiddenIds.has(m.id) && !m.is_deleted && !messageExpired(m, now))
        .map((m): TimelineItem => ({ kind: 'msg', id: m.id, at: m.created_at, message: m })),
      ...polls.map((p): TimelineItem => ({ kind: 'poll', id: `poll:${p.id}`, at: p.created_at, poll: p })),
    ];
    merged.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    const GROUP_WINDOW_MS = 5 * 60 * 1000;
    const out: TimelineItem[] = [];
    let lastDay = '';
    let prevMsg: Message | null = null;
    for (const it of merged) {
      const day = formatDaySeparator(it.at);
      if (day !== lastDay) {
        out.push({ kind: 'day', id: `day:${day}:${it.id}`, at: it.at, label: day });
        lastDay = day;
        prevMsg = null; // a new day always restarts grouping
      }
      if (it.kind === 'msg') {
        const grouped = !!prevMsg && prevMsg.sender_id === it.message.sender_id &&
          new Date(it.at).getTime() - new Date(prevMsg.created_at).getTime() < GROUP_WINDOW_MS;
        out.push({ ...it, grouped });
        prevMsg = it.message;
      } else {
        out.push(it);
        prevMsg = null; // a poll breaks the run
      }
    }
    return out;
  }, [messages, polls, hiddenIds, now]);

  // Disappearing messages (0022): schedule ONE self-rescheduling timer to the
  // next-soonest expiry so expired messages drop live, with no polling. Mirrors
  // the StatusStrip expiry-timer pattern.
  useEffect(() => {
    const next = nextMessageExpiry(messages, now);
    if (next === null) return;
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, next - now) + 250);
    return () => clearTimeout(id);
  }, [messages, now]);

  // Index messages + peers once per data change so each row is an O(1) lookup
  // instead of an O(n) .find() that ran for every visible bubble on every render.
  const messageById = useMemo(() => {
    const m = new Map<string, Message>();
    for (const msg of messages) m.set(msg.id, msg);
    return m;
  }, [messages]);
  const peerNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const p of peers) {
      const nick = !isGroup && p.id === peers[0]?.id ? peerNickname : null;
      m.set(p.id, resolveDisplayName(p, { nickname: nick, fallback: null }));
    }
    return m;
  }, [peers, peerNickname, isGroup]);

  // Image/video messages — backs the swipeable full-screen viewer (web MediaLightbox parity).
  const viewerItems = useMemo<ViewerItem[]>(() => messages
    .filter((m) => !m.is_deleted && m.media_url && (m.type === 'image' || isVideoMessage(m)))
    .map((m) => {
      const mine = m.sender_id === uid;
      const status = mine
        ? tickLabel(computeOutboundTick({
            messageId: m.id,
            pending: m.pending,
            failed: !!(m as { failed?: boolean }).failed,
            senderId: uid,
            tickMap: receipts,
          }))
        : null;
      return {
        id: m.id,
        url: m.media_url!,
        kind: m.type === 'image' ? ('image' as const) : ('video' as const),
        caption: m.type === 'image' ? (m.content || null) : null,
        sender: mine ? 'You' : (peerNameById.get(m.sender_id) || null),
        time: formatTime(m.created_at),
        createdAt: m.created_at,
        mine,
        status,
        meta: m.media_meta ?? null,
        viewOnce: !!m.media_meta?.viewOnce,
      };
    }),
    [messages, uid, peerNameById, receipts]);
  const viewerIndex = viewerUrl ? Math.max(0, viewerItems.findIndex((v) => v.url === viewerUrl)) : -1;

  // Plain function (not useCallback): MessageBubble is React.memo'd with a
  // data-aware comparator that ignores callback identity, so recreating this each
  // render does NOT re-render the bubbles. The O(1) maps above are the real win.
  const renderItem = ({ item }: { item: TimelineItem }) => {
    if (item.kind === 'day') {
      return (
        <View style={styles.daySep}>
          <Text style={styles.daySepText}>{item.label}</Text>
        </View>
      );
    }
    if (item.kind === 'poll') {
      return (
        <PollCard
          poll={item.poll}
          votes={pollVotes.get(item.poll.id) ?? []}
          myUserId={uid}
          onVote={(optionIndex) => onVotePoll(item.poll, optionIndex)}
        />
      );
    }
    const msg = item.message;
    // System messages (0027): centered WhatsApp-style info notice. Not selectable,
    // replyable, editable or deletable — just an informational pill.
    if (msg.type === 'system') {
      // Call system lines: "Voice call · 1:23 [call:uuid]" — strip tag, show call icon.
      // Tap → call back (WhatsApp+).
      const raw = msg.content ?? '';
      const callMatch = raw.match(/\[call:([0-9a-f-]{36})\]\s*$/i);
      const text = callMatch ? raw.replace(/\s*\[call:[0-9a-f-]{36}\]\s*$/i, '').trim() : raw;
      const isCallLine = !!callMatch || /^(missed|declined|cancelled|voice|video)\b/i.test(text);
      const isMissed = /^missed\b/i.test(text);
      const isVideoCall = /\bvideo\b/i.test(text);
      const onCallBack = isCallLine && !isGroup && peers[0]
        ? () => placeCall(isVideoCall ? 'video' : 'audio')
        : undefined;
      return (
        <View style={styles.systemNotice}>
          <Pressable
            style={styles.systemPill}
            onPress={onCallBack}
            disabled={!onCallBack}
            accessibilityRole={onCallBack ? 'button' : undefined}
            accessibilityLabel={onCallBack ? `Call back: ${text}` : undefined}
          >
            <Ionicons
              name={isCallLine ? (isMissed ? 'call' : 'call-outline') : 'timer-outline'}
              size={12}
              color={isMissed ? colors.danger : colors.textMuted}
              style={{ marginRight: 5, transform: isMissed ? [{ rotate: '135deg' }] : undefined }}
            />
            <Text style={[styles.systemNoticeText, isMissed && { color: colors.danger }]}>{text}</Text>
            {!!onCallBack && (
              <Ionicons
                name={isVideoCall ? 'videocam' : 'call'}
                size={14}
                color={colors.primary}
                style={{ marginLeft: 8 }}
              />
            )}
          </Pressable>
        </View>
      );
    }
    const mine = msg.sender_id === uid;
    const replyTo = msg.reply_to ? messageById.get(msg.reply_to) ?? null : null;
    const senderName = isGroup ? peerNameById.get(msg.sender_id) ?? null : null;
    return (
      <SwipeToReply
        enabled={!selectionMode && !msg.is_deleted}
        tint={colors.primary}
        onReply={() => { setEditing(null); setReply(msg); }}
        // Long-press is a native RNGH gesture on the wrapper (covers the whole
        // bubble) so it fires fast and reliably even with the keyboard open —
        // deleted messages are inert. See SwipeToReply for the gesture wiring.
        onLongPress={msg.is_deleted ? undefined : () => {
          if (selectionMode) {
            Haptics.selectionAsync().catch(() => {});
            toggleSelect(msg);
          } else {
            // Firmer WhatsApp-style buzz as the context menu opens.
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            setSelected(msg);
          }
        }}
      >
        <MessageBubble
          message={msg}
          mine={mine}
          myId={uid}
          grouped={item.grouped}
          senderName={senderName}
          replyTo={replyTo}
          onReplyPress={replyTo ? () => scrollToMessage(replyTo.id) : undefined}
          reactions={reactionsByMsg.get(msg.id)}
          onReactionPress={(emoji) => react(emoji, msg)}
          starred={starredIds.has(msg.id)}
          tick={mine
            ? computeOutboundTick({
                messageId: msg.id,
                pending: msg.pending,
                failed: !!(msg as { failed?: boolean }).failed,
                senderId: uid,
                tickMap: receipts,
              })
            : undefined}
          selected={selectionMode && selectedIds.has(msg.id)}
          selectionMode={selectionMode}
          onPress={selectionMode ? () => toggleSelect(msg) : undefined}
          onOpenImage={() => (selectionMode ? toggleSelect(msg) : void openMedia(msg))}
          onOpenDocument={(m) => (selectionMode ? toggleSelect(m) : void openDocument(m))}
          viewOnceSpent={voSpent.has(msg.id)}
          highlight={searchActive ? search : ''}
          activeMatch={msg.id === activeMatchId}
        />
      </SwipeToReply>
    );
  };

  const inverted = useMemo(() => [...timeline].reverse(), [timeline]);

  // In-chat search: jump between matching messages (no filtering).
  const search = searchTerm.trim().toLowerCase();
  const searchActive = searchOpen && (!!search || searchKind !== 'all');
  const matchIds = useMemo(() => {
    if (!searchActive) return [] as string[];
    return messages
      .filter((m) => !m.is_deleted && messageMatchesKind(m, searchKind) && (!search || (m.content ?? '').toLowerCase().includes(search)))
      .map((m) => m.id);
  }, [messages, search, searchKind, searchActive]);
  const activeMatchId = matchIds[activeMatch];

  const scrollToMessage = useCallback((id: string) => {
    const idx = inverted.findIndex((it) => it.id === id);
    if (idx >= 0) {
      try { listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 }); } catch { /* measured later */ }
    }
  }, [inverted]);
  function jumpMatch(delta: number) {
    if (matchIds.length === 0) return;
    const next = (activeMatch + delta + matchIds.length) % matchIds.length;
    setActiveMatch(next);
    scrollToMessage(matchIds[next]);
  }
  useEffect(() => {
    if (!searchActive || matchIds.length === 0) { setActiveMatch(0); return; }
    setActiveMatch(0);
    const t = setTimeout(() => scrollToMessage(matchIds[0]), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searchKind, searchActive]);

  // Locked chat: block the thread behind a device-auth gate.
  if (needsGate) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={54} color={colors.textFaint} />
        <Text style={styles.lockGateText}>This chat is locked</Text>
        <Pressable
          style={styles.lockGateBtn}
          onPress={async () => { const ok = await chatLock.authenticate('Unlock chat'); if (ok) setGateOk(true); }}
        >
          <Ionicons name="finger-print" size={18} color="#fff" />
          <Text style={styles.lockGateBtnText}>Unlock</Text>
        </Pressable>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <Animated.View
      style={[styles.flex, wallpaperColor ? { backgroundColor: wallpaperColor } : null, keyboardStyle]}
    >
      {searchOpen && (
        <View style={styles.searchBar}>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              autoFocus
              style={styles.searchInput}
              placeholder="Search in this chat"
              placeholderTextColor={colors.textFaint}
              value={searchTerm}
              onChangeText={setSearchTerm}
              returnKeyType="search"
              onSubmitEditing={() => jumpMatch(1)}
            />
            {searchActive && (
              <Text style={styles.searchCount}>
                {matchIds.length === 0 ? '0' : `${activeMatch + 1}/${matchIds.length}`}
              </Text>
            )}
            <Pressable hitSlop={8} disabled={matchIds.length === 0} onPress={() => jumpMatch(-1)}>
              <Ionicons name="chevron-up" size={20} color={matchIds.length ? colors.text : colors.textFaint} />
            </Pressable>
            <Pressable hitSlop={8} disabled={matchIds.length === 0} onPress={() => jumpMatch(1)} style={{ marginLeft: 12 }}>
              <Ionicons name="chevron-down" size={20} color={matchIds.length ? colors.text : colors.textFaint} />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => { setSearchOpen(false); setSearchTerm(''); setSearchKind('all'); }} style={{ marginLeft: 12 }}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          <View style={styles.searchChips}>
            {(['all', 'media', 'links', 'docs', 'voice'] as SearchKind[]).map((k) => (
              <Pressable key={k} onPress={() => setSearchKind(k)} style={[styles.searchChip, searchKind === k && styles.searchChipActive]}>
                <Text style={[styles.searchChipText, searchKind === k && styles.searchChipTextActive]}>
                  {k === 'all' ? 'All' : k === 'media' ? 'Media' : k === 'links' ? 'Links' : k === 'docs' ? 'Docs' : 'Voice'}
                </Text>
              </Pressable>
            ))}
          </View>
          {searchActive && matchIds.length === 0 && (
            <Text style={styles.searchNoResults}>
              {searchTerm.trim() ? `No messages match “${searchTerm.trim()}”.` : 'No messages match this filter.'}
            </Text>
          )}
        </View>
      )}

      <FlatList
        ref={listRef}
        data={inverted}
        inverted
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        // "handled" (not the default "never") lets a long-press on a bubble land
        // WHILE the keyboard is open: without it the list swallows the first
        // touch to dismiss the keyboard, so the bubble never sees it and the
        // user had to close the keyboard before the actions menu would open.
        // Taps on empty list space still dismiss the keyboard as before.
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={
          <View style={styles.encNote}>
            <Ionicons name="lock-closed" size={11} color={colors.textMuted} />
            <Text style={styles.encNoteText}>Encrypted in transit</Text>
          </View>
        }
        initialNumToRender={listPerf.messageList.initialNumToRender}
        maxToRenderPerBatch={listPerf.messageList.maxToRenderPerBatch}
        windowSize={listPerf.messageList.windowSize}
        updateCellsBatchingPeriod={listPerf.messageList.updateCellsBatchingPeriod}
        removeClippedSubviews={listPerf.messageList.removeClippedSubviews}
        onScroll={(e) => {
          const bottom = e.nativeEvent.contentOffset.y < 240;
          // Only re-render when the jump-to-latest FAB visibility flips.
          if (atBottomRef.current !== bottom) {
            atBottomRef.current = bottom;
            setAtBottom(bottom);
          }
        }}
        // 16ms ≈ 60fps sampling; state only updates on FAB visibility edge.
        scrollEventThrottle={16}
        onContentSizeChange={() => {
          // Reliable jump after deep history load ("Go to first message").
          if (!scrollToOldestPending.current) return;
          scrollToOldestPending.current = false;
          try {
            listRef.current?.scrollToEnd({ animated: true });
          } catch {
            try { listRef.current?.scrollToOffset({ offset: 999999, animated: true }); } catch { /* ignore */ }
          }
        }}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            try { listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }); } catch { /* give up */ }
          }, 120);
        }}
      />

      {/* Jump-to-latest button (shown once scrolled up), mirrors web. */}
      {!atBottom && (
        <Pressable
          style={styles.jumpLatest}
          onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
          hitSlop={6}
        >
          <Ionicons name="chevron-down" size={24} color={colors.text} />
        </Pressable>
      )}

      {/* Reply / edit preview bar */}
      {(reply || editing) && (
        <View style={styles.previewBar}>
          <View style={styles.previewLine} />
          <View style={{ flex: 1 }}>
            <Text style={styles.previewTitle}>{editing ? 'Edit message' : 'Reply'}</Text>
            <Text style={styles.previewText} numberOfLines={1}>
              {previewLabel(editing ?? reply)}
            </Text>
          </View>
          <Pressable
            hitSlop={8}
            onPress={() => {
              setReply(null);
              setEditing(null);
              setText('');
            }}
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      {/* Composer — hold mic to record; slide left to cancel (WhatsApp-class). */}
      {recording ? (
        <View style={[styles.composer, styles.recordingComposer, { paddingBottom: 6 }]}>
          <Ionicons
            name={recCanceling ? 'trash' : 'mic'}
            size={22}
            color={recCanceling ? colors.danger : colors.primary}
          />
          <View style={styles.recordingPill}>
            <View style={[styles.recDot, recCanceling && { backgroundColor: colors.danger }]} />
            <Text style={[styles.recText, recCanceling && { color: colors.danger }]}>
              {recCanceling
                ? 'Release to cancel'
                : `${Math.floor(recSecs / 60)}:${String(recSecs % 60).padStart(2, '0')}  ·  ← slide to cancel`}
            </Text>
          </View>
        </View>
      ) : (
        <View style={[styles.composer, { paddingBottom: 6 }]}>
          <Pressable
            onPress={() => { Keyboard.dismiss(); setAttachOpen(true); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Attach"
          >
            <Ionicons name="add-circle-outline" size={28} color={colors.textMuted} />
          </Pressable>
          {!text.trim() && (
            <Pressable
              onPress={() => { Keyboard.dismiss(); void pickImage(true); }}
              hitSlop={8}
              style={{ marginLeft: 2 }}
              accessibilityRole="button"
              accessibilityLabel="Camera"
            >
              <Ionicons name="camera-outline" size={26} color={colors.textMuted} />
            </Pressable>
          )}
          <TextInput
            style={styles.input}
            placeholder="Message"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="Message"
            value={text}
            onChangeText={onChangeText}
            onKeyPress={onInputKeyPress}
            onSubmitEditing={enterToSend ? handleSend : undefined}
            blurOnSubmit={false}
            returnKeyType={enterToSend ? 'send' : 'default'}
            multiline
          />
          <Pressable
            onPress={() => { Keyboard.dismiss(); setEmojiComposerOpen(true); }}
            hitSlop={8}
            style={{ marginRight: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Emoji"
          >
            <Ionicons name="happy-outline" size={26} color={colors.textMuted} />
          </Pressable>
          {text.trim().length > 0 ? (
            <Pressable
              onPress={handleSend}
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Save edit' : 'Send message'}
              style={({ pressed }) => [styles.sendBtn, pressed && styles.sendBtnPressed]}
              disabled={sending}
            >
              <Ionicons name={editing ? 'checkmark' : 'send'} size={20} color="#fff" />
            </Pressable>
          ) : (
            <Pressable
              onPressIn={onMicPressIn}
              onPressOut={onMicPressOut}
              onTouchMove={onMicTouchMove}
              // Fallback tap still starts/stops if press-in path fails on some OEMs.
              delayLongPress={400}
              style={({ pressed }) => [styles.sendBtn, pressed && styles.sendBtnPressed]}
            >
              <Ionicons name="mic" size={20} color="#fff" />
            </Pressable>
          )}
        </View>
      )}

      {/* Attachment sheet — primary grid + demoted premium actions */}
      <Modal visible={attachOpen} transparent animationType="slide" onRequestClose={() => setAttachOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAttachOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Share</Text>
            <View style={styles.attachGrid}>
              <AttachTile icon="image" label="Gallery" color="#5B6EF5" onPress={openMediaPicker} />
              <AttachTile icon="camera" label="Camera" color="#E8638A" onPress={() => pickImage(true)} />
              <AttachTile icon="document" label="Document" color="#F7A948" onPress={pickDocument} />
              <AttachTile
                icon="bar-chart"
                label="Poll"
                color="#00A884"
                onPress={() => {
                  setAttachOpen(false);
                  setPollBuilder(true);
                }}
              />
            </View>
            <View style={styles.attachMore}>
              <AttachOption
                icon="happy"
                label={isPremium ? 'Stickers' : 'Stickers'}
                color="#F45D9C"
                locked={!isPremium}
                onPress={() => {
                  setAttachOpen(false);
                  if (isPremium) setStickersOpen(true);
                  else
                    Alert.alert('Stickers', 'Premium stickers are a Lumixo+ feature.', [
                      { text: 'Not now', style: 'cancel' },
                      { text: 'See Lumixo+', onPress: () => navigation.navigate('Premium') },
                    ]);
                }}
              />
              <AttachOption
                icon="time"
                label={isPremium ? 'Schedule' : 'Schedule'}
                color="#7A6FF0"
                locked={!isPremium}
                onPress={() => {
                  setAttachOpen(false);
                  if (!isPremium) {
                    Alert.alert('Schedule message', 'Scheduled messages are a Lumixo+ feature.', [
                      { text: 'Not now', style: 'cancel' },
                      { text: 'See Lumixo+', onPress: () => navigation.navigate('Premium') },
                    ]);
                    return;
                  }
                  if (!text.trim()) {
                    Alert.alert('Nothing to schedule', 'Type a message first, then schedule it.');
                    return;
                  }
                  setScheduleOpen(true);
                }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Sticker picker (premium) */}
      <Modal visible={stickersOpen} transparent animationType="slide" onRequestClose={() => setStickersOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setStickersOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Stickers</Text>
            <View style={styles.stickerGrid}>
              {STICKERS.map((s) => (
                <Pressable key={s.id} onPress={() => sendSticker(s.url)} style={styles.stickerCell}>
                  <Image source={{ uri: s.url }} style={styles.stickerImg} contentFit="contain" />
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Schedule message (premium) */}
      <ScheduleMessageModal
        visible={scheduleOpen}
        draft={text}
        onCancel={() => setScheduleOpen(false)}
        onConfirm={doSchedule}
      />

      {/* Poll builder */}
      <Modal visible={pollBuilder} transparent animationType="slide" onRequestClose={() => setPollBuilder(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPollBuilder(false)}>
          <Pressable style={[styles.sheet, styles.pollSheet, { paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>New poll</Text>
            <TextInput
              style={styles.pollInput}
              placeholder="Ask a question"
              placeholderTextColor={colors.textFaint}
              value={pollQuestion}
              onChangeText={setPollQuestion}
            />
            {pollOptions.map((opt, i) => (
              <TextInput
                key={i}
                style={styles.pollInput}
                placeholder={`Option ${i + 1}`}
                placeholderTextColor={colors.textFaint}
                value={opt}
                onChangeText={(t) => setPollOptions((prev) => prev.map((o, j) => (j === i ? t : o)))}
              />
            ))}
            {pollOptions.length < 6 && (
              <Pressable style={styles.pollAddOpt} onPress={() => setPollOptions((prev) => [...prev, ''])}>
                <Ionicons name="add" size={18} color={colors.primary} />
                <Text style={styles.pollAddOptText}>Add option</Text>
              </Pressable>
            )}
            <Pressable style={styles.pollToggle} onPress={() => setPollMultiple((v) => !v)}>
              <Ionicons name={pollMultiple ? 'checkbox' : 'square-outline'} size={20} color={colors.primary} />
              <Text style={styles.pollToggleText}>Allow multiple answers</Text>
            </Pressable>
            <Pressable style={styles.pollCreate} onPress={submitPoll}>
              <Text style={styles.pollCreateText}>Create poll</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Message action sheet */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.msgBackdrop} onPress={() => setSelected(null)}>
          <Pressable style={[styles.msgSheet, { paddingBottom: insets.bottom + 10 }]} onPress={() => {}}>
            <View style={styles.grabber} />

            {/* Reaction bar — compact rounded pill; reactions work exactly as before. */}
            <View style={styles.reactionBar}>
              {QUICK_EMOJI.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => react(e)}
                  hitSlop={6}
                  style={({ pressed }) => [styles.reactionBtn, pressed && styles.reactionBtnPressed]}
                >
                  <Text style={styles.reactionEmoji}>{e}</Text>
                </Pressable>
              ))}
              {/* Full emoji palette — close action sheet first (no stacked modals). */}
              <Pressable
                onPress={() => {
                  pendingReactMsg.current = selected;
                  afterMessageSheetClosed(() => setEmojiPickerOpen(true));
                }}
                hitSlop={6}
                style={styles.reactionAdd}
                accessibilityLabel="More reactions"
              >
                <Ionicons name="add" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            {/* Menu — compact list card. All existing actions preserved. */}
            <ScrollView style={styles.menuScroll} bounces={false} showsVerticalScrollIndicator={false}>
              <View style={styles.menuCard}>
                <ActionRow icon="arrow-undo" label="Reply" onPress={() => { setReply(selected); setSelected(null); }} />
                <ActionRow
                  icon={selected && starredIds.has(selected.id) ? 'star' : 'star-outline'}
                  label={selected && starredIds.has(selected.id) ? 'Unstar' : 'Star'}
                  onPress={toggleStar}
                />
                <ActionRow
                  icon="checkbox-outline"
                  label="Select messages"
                  subtitle="Choose multiple to forward or delete"
                  onPress={() => { if (selected) enterSelection(selected); setSelected(null); }}
                />
                {selected?.type === 'text' && (
                  <ActionRow
                    icon="copy-outline"
                    label="Copy"
                    onPress={async () => {
                      if (selected?.content) await Clipboard.setStringAsync(selected.content);
                      setSelected(null);
                    }}
                  />
                )}
                <ActionRow icon="arrow-redo-outline" label="Forward" onPress={openForward} />
                {isGroup && canPinMessages(myGroupRole, groupPerms) && (
                  <ActionRow
                    icon="pin-outline"
                    label={selected && pinnedIds.has(selected.id) ? 'Unpin' : 'Pin'}
                    onPress={togglePin}
                  />
                )}
                <ActionRow icon="information-circle-outline" label="Info" onPress={showInfo} />
                {selected?.sender_id === uid && selected?.type === 'text' && (
                  <ActionRow
                    icon="create-outline"
                    label="Edit"
                    onPress={() => { setEditing(selected); setText(selected?.content ?? ''); setSelected(null); }}
                  />
                )}
                {!!uid && selected?.sender_id !== uid && (
                  <ActionRow icon="flag-outline" label="Report" danger onPress={startReport} />
                )}
                <ActionRow icon="trash-outline" label="Delete" danger onPress={doDelete} />
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Report-message reason picker (step 2 of the report flow). */}
      <Modal visible={!!reportTarget} transparent animationType="slide" onRequestClose={() => setReportTarget(null)}>
        <Pressable style={styles.backdrop} onPress={() => !reportBusy && setReportTarget(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
            <Text style={styles.reportTitle}>Report message</Text>
            <Text style={styles.reportSubtitle}>Why are you reporting this message?</Text>
            {REPORT_REASONS.map((r) => (
              <Pressable
                key={r.value}
                style={attachStyles.actionRow}
                disabled={reportBusy}
                onPress={() => submitReport(r.value)}
              >
                <Ionicons name="flag-outline" size={20} color={colors.textMuted} />
                <Text style={[attachStyles.actionLabel, { color: colors.text }]}>{r.label}</Text>
              </Pressable>
            ))}
            <TextInput
              style={styles.reportNote}
              placeholder="Add a note (optional)"
              placeholderTextColor={colors.textMuted}
              value={reportDetails}
              onChangeText={setReportDetails}
              editable={!reportBusy}
              multiline
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Full emoji reaction picker — WhatsApp-class categories + search + recent */}
      <EmojiPicker
        visible={emojiPickerOpen}
        mode="reaction"
        title="React"
        onClose={() => {
          setEmojiPickerOpen(false);
          pendingReactMsg.current = null;
        }}
        onSelect={(e) => {
          const target = pendingReactMsg.current;
          pendingReactMsg.current = null;
          setEmojiPickerOpen(false);
          void react(e, target ?? undefined);
        }}
      />

      {/* Composer emoji picker — stays open while inserting (WhatsApp parity) */}
      <EmojiPicker
        visible={emojiComposerOpen}
        mode="composer"
        title="Emoji"
        onClose={() => setEmojiComposerOpen(false)}
        onSelect={(e) => onChangeText(textRef.current + e)}
      />

      {/* Forward picker — multi-recipient with search, recents, groups & preview */}
      <ForwardSheet
        visible={forwardOpen}
        onClose={() => { setForwardOpen(false); setForwardSources([]); setForwardPreview(null); }}
        conversations={forwardList}
        onConfirm={doForward}
        preview={forwardPreview}
        count={forwardSources.length}
      />

      {/* Full-screen media viewer (swipe / zoom / video) */}
      {viewerIndex >= 0 && (
        <MediaViewer
          items={viewerItems}
          index={viewerIndex}
          onClose={() => setViewerUrl(null)}
          onForward={forwardFromViewer}
          onDelete={deleteFromViewer}
        />
      )}
    </Animated.View>
  );
}

function AttachOption({
  icon,
  label,
  color,
  onPress,
  locked,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
  locked?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable style={attachStyles.opt} onPress={onPress}>
      <View style={[attachStyles.circle, { backgroundColor: color, opacity: locked ? 0.75 : 1 }]}>
        <Ionicons name={icon} size={22} color="#fff" />
      </View>
      <Text style={[attachStyles.label, { color: colors.text }]}>{label}</Text>
      {locked ? (
        <Ionicons name="lock-closed" size={14} color={colors.textFaint} style={{ marginLeft: 'auto' }} />
      ) : null}
    </Pressable>
  );
}

/** WhatsApp-style 2×2 tile for primary attach actions. */
function AttachTile({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable style={attachStyles.tile} onPress={onPress}>
      <View style={[attachStyles.tileCircle, { backgroundColor: color }]}>
        <Ionicons name={icon} size={22} color="#fff" />
      </View>
      <Text style={[attachStyles.tileLabel, { color: colors.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

function ActionRow({
  icon,
  label,
  subtitle,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const colors = useColors();
  const tint = danger ? colors.danger : colors.text;
  return (
    <Pressable
      style={({ pressed }) => [msgMenuStyles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[msgMenuStyles.iconWrap, danger && { backgroundColor: colors.danger + '14' }]}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <View style={msgMenuStyles.textCol}>
        <Text style={[msgMenuStyles.label, { color: tint }]} numberOfLines={1}>{label}</Text>
        {!!subtitle && (
          <Text style={[msgMenuStyles.sub, { color: colors.textMuted }]} numberOfLines={1}>{subtitle}</Text>
        )}
      </View>
    </Pressable>
  );
}

// WhatsApp-class density: 48pt rows, aligned icons, tight type.
const msgMenuStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(128,128,128,0.08)',
  },
  textCol: { flex: 1, minWidth: 0 },
  label: { fontSize: 15.5, fontWeight: '600', letterSpacing: -0.15 },
  sub: { fontSize: 12, marginTop: 1, lineHeight: 15 },
});

const attachStyles = StyleSheet.create({
  opt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  circle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15, marginLeft: 12, fontWeight: '500' },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  actionLabel: { fontSize: 15, marginLeft: 14 },
  tile: { width: '25%', alignItems: 'center', paddingVertical: 8 },
  tileCircle: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  tileLabel: { fontSize: 11.5, fontWeight: '600' },
});

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    listContent: { paddingVertical: 6 },
    encNote: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 5, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, opacity: 0.72,
    },
    encNoteText: { color: colors.textMuted, fontSize: font.tiny },
    daySep: { alignItems: 'center', marginVertical: 8 },
    daySepText: {
      color: colors.textMuted, fontSize: 11.5, fontWeight: '600',
      backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 4,
      borderRadius: radius.sm, overflow: 'hidden',
    },
    headerPerson: { flexDirection: 'row', alignItems: 'center', maxWidth: 220 },
    headerTextCol: { marginLeft: 9, flexShrink: 1, minWidth: 0 },
    headerTitle: { color: colors.text, fontSize: font.heading, fontWeight: '600', flexShrink: 1, letterSpacing: -0.15 },
    headerTitleRow: { flexDirection: 'row', alignItems: 'center' },
    headerSub: { color: colors.textMuted, fontSize: font.tiny, marginTop: 0 },
    headerSubTyping: { color: colors.primary, fontWeight: '600' },
    systemNotice: { alignItems: 'center', marginVertical: 6, paddingHorizontal: 24 },
    systemPill: {
      flexDirection: 'row', alignItems: 'center', maxWidth: '90%',
      backgroundColor: colors.surface, paddingHorizontal: 11, paddingVertical: 5,
      borderRadius: radius.md, overflow: 'hidden',
    },
    systemNoticeText: { color: colors.textMuted, fontSize: font.tiny, textAlign: 'center', flexShrink: 1 },
    lockGateText: { color: colors.text, fontSize: font.heading, fontWeight: '600', marginTop: 14 },
    lockGateBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16,
      backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 11, borderRadius: radius.pill,
    },
    lockGateBtnText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
    headerActions: { flexDirection: 'row', alignItems: 'center' },
    searchBar: {
      backgroundColor: colors.surface, paddingHorizontal: 12, paddingTop: 7, paddingBottom: 7,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 6,
    },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: 11, paddingVertical: 5,
      minHeight: 36,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: font.body, paddingVertical: 2 },
    searchCount: { color: colors.textMuted, fontSize: font.small, minWidth: 36, textAlign: 'right' },
    searchChips: { flexDirection: 'row', gap: 6 },
    searchChip: { paddingHorizontal: 11, paddingVertical: 3, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    searchChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    searchChipText: { color: colors.textMuted, fontSize: 12.5, fontWeight: '600' },
    searchChipTextActive: { color: '#fff' },
    previewBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    previewLine: { width: 3, height: 28, borderRadius: 2, backgroundColor: colors.primary, marginRight: 8 },
    previewTitle: { color: colors.primary, fontSize: font.small, fontWeight: '700' },
    previewText: { color: colors.textMuted, fontSize: font.small },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 8,
      paddingTop: 5,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.isLight ? 'rgba(0,0,0,0.06)' : colors.border,
    },
    searchNoResults: { color: colors.textMuted, fontSize: font.small, paddingTop: 6, paddingBottom: 2 },
    jumpLatest: {
      position: 'absolute',
      right: 12,
      bottom: 74,
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.16,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    input: {
      flex: 1,
      color: colors.text,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingTop: Platform.OS === 'ios' ? 9 : 6,
      paddingBottom: Platform.OS === 'ios' ? 9 : 6,
      marginHorizontal: 6,
      maxHeight: 110,
      fontSize: font.body,
      lineHeight: 20,
    },
    sendBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnPressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },
    recordingComposer: { alignItems: 'center', paddingHorizontal: 14, minHeight: 48 },
    recordingPill: { flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 10 },
    recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger, marginRight: 8 },
    recText: { color: colors.textMuted, fontSize: font.small, fontWeight: '600' },
    attachGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 2, marginBottom: 2 },
    attachMore: {
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
      paddingTop: 4, marginTop: 2,
    },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    // ── Message context menu (compact WhatsApp-class sheet) ─────────────────
    msgBackdrop: { flex: 1, backgroundColor: colors.isLight ? 'rgba(12,18,22,0.4)' : 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    msgSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 10,
      paddingTop: 6,
      shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.14, shadowRadius: 12, elevation: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
    },
    grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.textFaint, opacity: 0.4, marginBottom: 10 },
    reactionBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      alignSelf: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.pill,
      paddingHorizontal: 8, paddingVertical: 5,
      marginBottom: 8,
      gap: 2,
    },
    reactionBtn: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: radius.pill, minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
    reactionBtnPressed: { transform: [{ scale: 1.15 }], backgroundColor: colors.surface },
    reactionEmoji: { fontSize: 24 },
    reactionAdd: {
      width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface, marginLeft: 2,
    },
    menuScroll: { maxHeight: Math.round(Dimensions.get('window').height * 0.42) },
    menuCard: { paddingBottom: 4, gap: 1 },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    sheetTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: 6, letterSpacing: -0.15 },
    reportTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginTop: 2 },
    reportSubtitle: { color: colors.textMuted, fontSize: font.small, marginTop: 2, marginBottom: 6 },
    reportNote: {
      color: colors.text, fontSize: font.body, backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8,
      minHeight: 44, maxHeight: 100,
    },
    stickerGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingTop: 4 },
    stickerCell: { width: '23%', aspectRatio: 1, marginBottom: 8, alignItems: 'center', justifyContent: 'center' },
    stickerImg: { width: '100%', height: '100%', borderRadius: 10 },
    forwardSheet: { maxHeight: '60%' },
    pollSheet: { maxHeight: '80%' },
    pollInput: {
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: font.body,
      marginBottom: 8,
      minHeight: 42,
    },
    pollAddOpt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    pollAddOptText: { color: colors.primary, fontSize: font.body, fontWeight: '600', marginLeft: 6 },
    pollToggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
    pollToggleText: { color: colors.text, fontSize: font.body, marginLeft: 10 },
    pollCreate: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
    pollCreateText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
    forwardRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    forwardName: { color: colors.text, fontSize: font.body },
    emojiRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingVertical: 8,
      marginBottom: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    emoji: { fontSize: 26 },
    emojiMore: {
      width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    emojiPickerSheet: { maxHeight: '52%' },
    emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    emojiGridCell: { width: '16.66%', alignItems: 'center', paddingVertical: 8 },
    emojiGridText: { fontSize: 26 },
    emojiLock: { position: 'absolute', bottom: 4, right: '28%', fontSize: 10 },
  });

// Public screen: the chat UI guarded by an ErrorBoundary. Any exception thrown
// while rendering the conversation (message list, action-sheet modals, bubbles)
// is caught here and shown as a recoverable "Try again" state — the screen can
// never silently go blank.
export default function ChatScreen() {
  return (
    <ErrorBoundary label="ChatScreen">
      <ChatScreenInner />
    </ErrorBoundary>
  );
}
