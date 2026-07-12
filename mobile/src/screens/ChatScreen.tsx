// Lumixo mobile — the chat thread. Realtime messages, media + voice,
// reactions, reply/edit/delete/forward, typing, presence and read receipts.
// All data flows through the shared API; this screen is presentation + glue.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  sendPush,
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
  type ParticipantRole,
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
} from '../lib/localCache';
import { flushOutbox, onOutboxSent, queueAction } from '../lib/sync';
import { uploadMediaFromUri, guessMime } from '../lib/media';
import { registerMediaHandler, type MediaSubmission } from '../media/mediaSendBridge';
import { formatLastSeen, formatDaySeparator, formatTime } from '../lib/time';
import { useColors, useTheme, spacing, radius, font, type Palette } from '../theme';
import MessageBubble, { type TickStatus, replySummary } from '../components/MessageBubble';
import SwipeToReply from '../components/SwipeToReply';
import MediaViewer, { type ViewerItem } from '../components/MediaViewer';
import { ensureMediaCached, prefetchMedia, registerLocalMedia } from '../lib/mediaCache';
import ForwardSheet, { type ForwardPreview } from '../components/ForwardSheet';
import PollCard from '../components/PollCard';
import ScheduleMessageModal from '../components/ScheduleMessageModal';
import ErrorBoundary from '../components/ErrorBoundary';
import Avatar from '../components/Avatar';
import { STICKERS } from '../lib/stickers';
import { useCalls } from '../calls/CallContext';
import { useChatLock } from '../security/ChatLock';
import type { RootStackParamList } from '../navigation/types';
import { Alert } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Chat'>;
type Rt = RouteProp<RootStackParamList, 'Chat'>;

const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
// Full reaction palette shown when the user taps "＋" on the quick-emoji row —
// mirrors the web emoji picker so reactions reach parity across platforms.
const MORE_EMOJI = [
  '👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉', '👏', '💯',
  '😍', '🤔', '😭', '😅', '🙌', '💪', '✅', '❌', '👀', '🤝',
  '😎', '🥳', '😴', '🤯', '😇', '🤗', '😡', '💔', '⭐', '🚀',
];

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
    getDisappearing(supabase, conversationId).then(setDisappearSecs).catch(() => {});
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

  // Dispatch scheduled messages whose send-time has arrived — on open + every 60s.
  // Mirrors web ChatView (dispatchDueMessages). Without this, messages scheduled
  // on mobile would sit in the queue and never actually send.
  useEffect(() => {
    void dispatchDueMessages(supabase).catch(() => {});
    const id = setInterval(() => { void dispatchDueMessages(supabase).catch(() => {}); }, 60000);
    return () => clearInterval(id);
  }, []);
  const [isGroup, setIsGroup] = useState(false);
  const [myGroupRole, setMyGroupRole] = useState<ParticipantRole | null>(null);
  const [groupSendBlocked, setGroupSendBlocked] = useState(false);
  const [groupPerms, setGroupPerms] = useState(permissionsFromConversation(null));
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [typingName, setTypingName] = useState<string | null>(null);

  const [text, setText] = useState('');
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
      if (myId) {
        const cachedConvs = await getCachedConversations(myId);
        const cs = cachedConvs.find((s) => s.conversation.id === conversationId);
        if (cs && active) {
          const group = cs.conversation.type === 'group';
          setIsGroup(group);
          setPeers(cs.participants.filter((p) => p.id !== myId));
          setChatAvatarUrl(cs.avatarUrl ?? null);
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
        applyReceipts(rc);
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

        // mark unread incoming as read (unless ghost mode suppresses receipts)
        if (!ghostRef.current) {
          msgs
            .filter((m) => m.sender_id !== myId)
            .forEach((m) => markMessageAsRead(supabase, m.id).catch(() => {}));
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
            setPeers(summary.participants.filter((p) => p.id !== myId));
            setChatAvatarUrl(summary.avatarUrl ?? null);
          }
        } catch { /* offline */ }
      }
    })();
    return () => {
      active = false;
    };
  }, [conversationId, setMsgs]);

  const applyReceipts = useCallback((rows: { message_id: string; status: string }[]) => {
    setReceipts((prev) => {
      const next = new Map(prev);
      for (const r of rows) {
        const cur = next.get(r.message_id);
        if (r.status === 'read' || cur !== 'read') {
          next.set(r.message_id, r.status as TickStatus);
        }
      }
      return next;
    });
  }, []);

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
        if (incoming.sender_id !== uid && !ghostRef.current) {
          markMessageAsRead(supabase, incoming.id).catch(() => {});
        }
        requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
      },
      (updated) => {
        setMsgs((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        upsertCachedMessage(conversationId, updated).catch(() => {});
      },
    );

    const rxChannel = subscribeToReactions(supabase, conversationId, () => {
      getReactions(
        supabase,
        messagesRef.current.map((m) => m.id),
      ).then(setReactions);
    });

    const rcChannel = subscribeToReceipts(supabase, conversationId, (r) =>
      applyReceipts([r as any]),
    );

    const presenceChannel = joinPresence(supabase, uid, setOnlineIds);

    const tc = createTypingChannel(supabase, conversationId, (p) => {
      if (p.userId === uid) return;
      setTypingName(p.typing ? p.name : null);
      if (p.typing) {
        if (typingTimeout.current) clearTimeout(typingTimeout.current);
        typingTimeout.current = setTimeout(() => setTypingName(null), 4000);
      }
    });
    typingChannel.current = tc;

    return () => {
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

  // Restore a persisted draft when the chat opens.
  useEffect(() => {
    getDraft(conversationId).then((d) => { if (d) setText(d); }).catch(() => {});
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
    return off;
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
  const headerAvatarUri = isGroup
    ? chatAvatarUrl
    : (peers[0]?.avatar_url ?? chatAvatarUrl);
  const headerAvatarName = isGroup ? params.title : (peers[0]?.display_name ?? params.title);

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
                {params.title}
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
      // Group calling: open group info for voice/video entry; 1:1 keeps direct call buttons.
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable hitSlop={8} onPress={() => setSearchOpen((v) => !v)}>
            <Ionicons name="search-outline" size={21} color={colors.text} />
          </Pressable>
          {isGroup ? (
            <Pressable
              hitSlop={8}
              onPress={() => navigation.navigate('GroupInfo', { conversationId })}
              style={{ marginLeft: 18 }}
            >
              <Ionicons name="information-circle-outline" size={24} color={colors.text} />
            </Pressable>
          ) : (
            <>
              <Pressable hitSlop={8} onPress={() => placeCall('audio')} style={{ marginLeft: 18 }}>
                <Ionicons name="call-outline" size={22} color={colors.text} />
              </Pressable>
              <Pressable hitSlop={8} onPress={() => placeCall('video')} style={{ marginLeft: 18 }}>
                <Ionicons name="videocam-outline" size={24} color={colors.text} />
              </Pressable>
            </>
          )}
        </View>
      ),
    });
  }, [navigation, params.title, subtitle, peers, colors, styles, selectionMode, selectedIds, isGroup, ghost, disappearSecs, conversationId, headerAvatarUri, headerAvatarName, typingName]);

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

  async function handleSend() {
    const body = text.trim();
    if (!body || sending) return;
    if (groupSendBlocked) {
      Alert.alert('Only admins', 'Only admins can send messages in this group.');
      return;
    }
    setText('');
    setDraft(conversationId, '').catch(() => {}); // clear persisted draft
    typingChannel.current?.notify({ userId: uid ?? '', name: selfNameRef.current, typing: false });

    if (editing) {
      const target = editing;
      setEditing(null);
      await editMessage(supabase, target.id, body);
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
    // flushOutbox sends it (reusing tempId as the row id) and removes it from the
    // queue on success; the onOutboxSent listener swaps the pending row for the
    // confirmed one. If offline, it stays queued and auto-sends on reconnect.
    flushOutbox().catch(() => {});

    // Fast-path FCM for killed recipients. messageId (= tempId / row id) enables
    // server-side dedupe so the DB outbox trigger does not double-deliver.
    void sendPush(supabase, {
      conversationId,
      kind: isGroup ? 'group' : 'message',
      title: isGroup ? (params.title || 'Group') : 'New message',
      body,
      data: {
        messageId: tempId,
        messageType: 'text',
        type: 'message',
        senderId: uid ?? '',
      },
    });
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

  async function sendMedia(
    uri: string,
    fileName: string,
    type: 'image' | 'video' | 'file' | 'audio',
    caption?: string,
    mediaMeta?: import('../lib/shared').MediaMeta,
  ) {
    setSending(true);
    try {
      const { url, error } = await uploadMediaFromUri(conversationId, uri, fileName);
      if (error || !url) {
        Alert.alert('Upload failed', error?.message ?? 'Could not upload file.');
        return;
      }
      // Map remote URL → local file so we never re-download our own send.
      void registerLocalMedia(url, uri);
      // Documents: store filename in content for the bubble label.
      const body =
        type === 'file'
          ? (caption?.trim() || fileName)
          : (caption ?? (type === 'audio' ? '' : ''));
      const { message } = await sendMessage(
        supabase, conversationId, body, type, url, undefined, undefined, mediaMeta,
      );
      if (message) {
        setMsgs((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        setReceipts((prev) => new Map(prev).set(message.id, 'sent'));
        upsertCachedMessage(conversationId, message).catch(() => {}); // keep offline cache warm
      }
    } finally {
      setSending(false);
    }
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

  // Premium stickers — sent as an image message carrying the SVG data URI
  // (web parity: ChatView.sendSticker). No upload needed.
  async function sendSticker(url: string) {
    setStickersOpen(false);
    const { message } = await sendMessage(supabase, conversationId, '', 'image', url);
    if (message) {
      setMsgs((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      setReceipts((prev) => new Map(prev).set(message.id, 'sent'));
      upsertCachedMessage(conversationId, message).catch(() => {});
    }
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
    const res = await markViewOnceSeen(supabase, msg.id);
    setVoSpent((prev) => new Set(prev).add(msg.id));  // lock locally regardless
    if (res && res.first_view === false && res.consumed) {
      Alert.alert('View Once', 'You’ve already viewed this once. It can’t be opened again.');
      return;
    }
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

  // Delete-for-me: hide a single message locally for this user only (unlike
  // delete-for-everyone). Backed by hidden_messages.
  async function deleteForMe() {
    if (!selected) return;
    const target = selected;
    setSelected(null);
    setHiddenIds((prev) => new Set(prev).add(target.id));
    // Instant + durable: hide locally now, queue the server write (auto-retries).
    queueAction('hideMessage', { messageId: target.id });
  }

  // Message info — delivery/read status + timestamps, mirroring web's info view.
  function showInfo() {
    if (!selected) return;
    const target = selected;
    setSelected(null);
    const mine = target.sender_id === uid;
    const rc = receipts.get(target.id);
    const status = target.pending ? 'Sending…' : rc === 'read' ? 'Read' : rc === 'delivered' ? 'Delivered' : 'Sent';
    const lines = [
      `Sent: ${new Date(target.created_at).toLocaleString()}`,
      target.edited_at ? `Edited: ${new Date(target.edited_at).toLocaleString()}` : null,
      mine ? `Status: ${status}` : null,
      starredIds.has(target.id) ? 'Starred: yes' : null,
    ].filter(Boolean).join('\n');
    Alert.alert('Message info', lines || 'No details available.');
  }

  // Report a message (WhatsApp/Telegram style): confirm → pick a reason → submit.
  // Only offered on messages you did NOT send. Step 1 is the confirmation dialog.
  function startReport() {
    if (!selected) return;
    const target = selected;
    setSelected(null);
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

  async function doDelete() {
    if (!selected) return;
    const target = selected;
    const mine = target.sender_id === uid;
    const buttons: any[] = [{ text: 'Cancel', style: 'cancel' }];
    // Delete-for-me is available on any message; delete-for-everyone only on own.
    buttons.push({ text: 'Delete for me', onPress: deleteForMe });
    if (mine) {
      buttons.push({
        text: 'Unsend',
        style: 'destructive',
        onPress: async () => {
          setSelected(null);
          await deleteMessage(supabase, target.id);
          setMsgs((prev) => prev.map((m) => (m.id === target.id ? { ...m, is_deleted: true } : m)));
        },
      });
    }
    Alert.alert('Delete message', 'Choose how to delete this message.', buttons);
  }

  // Bulk delete for multi-select (delete-for-everyone).
  async function deleteMany(ids: string[]) {
    Alert.alert('Unsend messages', `Unsend ${ids.length} message${ids.length === 1 ? '' : 's'}? This removes ${ids.length === 1 ? 'it' : 'them'} for everyone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unsend',
        style: 'destructive',
        onPress: async () => {
          exitSelection();
          await Promise.all(ids.map((id) => deleteMessage(supabase, id).catch(() => {})));
          setMsgs((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, is_deleted: true } : m)));
        },
      },
    ]);
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
    const mine = msg.sender_id === uid;
    const buttons: any[] = [{ text: 'Cancel', style: 'cancel' }];
    buttons.push({
      text: 'Delete for me',
      onPress: () => {
        setViewerUrl(null);
        setHiddenIds((prev) => new Set(prev).add(msg.id));
        queueAction('hideMessage', { messageId: msg.id });
      },
    });
    if (mine) {
      buttons.push({
        text: 'Unsend',
        style: 'destructive',
        onPress: async () => {
          setViewerUrl(null);
          await deleteMessage(supabase, msg.id);
          setMsgs((prev) => prev.map((m) => (m.id === msg.id ? { ...m, is_deleted: true } : m)));
        },
      });
    }
    Alert.alert('Delete media', 'Choose how to delete this message.', buttons);
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
    for (const p of peers) m.set(p.id, p.display_name);
    return m;
  }, [peers]);

  // Image/video messages — backs the swipeable full-screen viewer (web MediaLightbox parity).
  const viewerItems = useMemo<ViewerItem[]>(() => messages
    .filter((m) => !m.is_deleted && m.media_url && (m.type === 'image' || isVideoMessage(m)))
    .map((m) => {
      const mine = m.sender_id === uid;
      const rc = receipts.get(m.id);
      const status = mine
        ? (m.pending ? 'Sending…' : rc === 'read' ? 'Read' : rc === 'delivered' ? 'Delivered' : 'Sent')
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
          tick={mine ? (msg.pending ? 'sending' : receipts.get(msg.id) ?? 'sent') : undefined}
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
        initialNumToRender={18}
        maxToRenderPerBatch={12}
        windowSize={11}
        updateCellsBatchingPeriod={40}
        onScroll={(e) => {
          const bottom = e.nativeEvent.contentOffset.y < 240;
          atBottomRef.current = bottom;
          setAtBottom(bottom);
        }}
        scrollEventThrottle={80}
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
          <Pressable onPress={() => { Keyboard.dismiss(); setAttachOpen(true); }} hitSlop={8}>
            <Ionicons name="add-circle-outline" size={28} color={colors.textMuted} />
          </Pressable>
          {!text.trim() && (
            <Pressable
              onPress={() => { Keyboard.dismiss(); void pickImage(true); }}
              hitSlop={8}
              style={{ marginLeft: 2 }}
            >
              <Ionicons name="camera-outline" size={26} color={colors.textMuted} />
            </Pressable>
          )}
          <TextInput
            style={styles.input}
            placeholder="Message"
            placeholderTextColor={colors.textFaint}
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
          >
            <Ionicons name="happy-outline" size={26} color={colors.textMuted} />
          </Pressable>
          {text.trim().length > 0 ? (
            <Pressable onPress={handleSend} style={({ pressed }) => [styles.sendBtn, pressed && styles.sendBtnPressed]} disabled={sending}>
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
              {/* Open the full emoji palette — reaction parity with web. */}
              <Pressable onPress={() => setEmojiPickerOpen(true)} hitSlop={6} style={styles.reactionAdd}>
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
                <ActionRow icon="checkmark-circle-outline" label="Select" onPress={() => { if (selected) enterSelection(selected); setSelected(null); }} />
                {selected?.type === 'text' && (
                  <ActionRow
                    icon="copy"
                    label="Copy"
                    onPress={async () => {
                      if (selected?.content) await Clipboard.setStringAsync(selected.content);
                      setSelected(null);
                    }}
                  />
                )}
                <ActionRow icon="arrow-redo" label="Forward" onPress={openForward} />
                {isGroup && canPinMessages(myGroupRole, groupPerms) && (
                  <ActionRow
                    icon="pin"
                    label={selected && pinnedIds.has(selected.id) ? 'Unpin' : 'Pin'}
                    onPress={togglePin}
                  />
                )}
                <ActionRow icon="information-circle-outline" label="Info" onPress={showInfo} />
                {selected?.sender_id === uid && selected?.type === 'text' && (
                  <ActionRow
                    icon="create"
                    label="Edit"
                    onPress={() => { setEditing(selected); setText(selected?.content ?? ''); setSelected(null); }}
                  />
                )}
                {!!uid && selected?.sender_id !== uid && (
                  <ActionRow icon="flag-outline" label="Report" danger onPress={startReport} />
                )}
                <ActionRow icon="trash" label="Delete" danger onPress={doDelete} />
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

      {/* Full emoji reaction picker */}
      <Modal visible={emojiPickerOpen} transparent animationType="fade" onRequestClose={() => setEmojiPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEmojiPickerOpen(false)}>
          <Pressable style={[styles.sheet, styles.emojiPickerSheet, { paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>React{!isPremium ? '  ·  extras are Lumixo+' : ''}</Text>
            <View style={styles.emojiGrid}>
              {MORE_EMOJI.map((e) => {
                // Free tier reacts with the 6 quick emojis; the rest are premium
                // (mirrors web QUICK_EMOJIS vs PREMIUM_EMOJIS gating).
                const locked = !isPremium && !QUICK_EMOJI.includes(e);
                return (
                  <Pressable
                    key={e}
                    hitSlop={4}
                    style={styles.emojiGridCell}
                    onPress={() => {
                      if (locked) {
                        setEmojiPickerOpen(false);
                        Alert.alert(
                          'Premium reaction',
                          'Upgrade to Lumixo+ to react with the full emoji set.',
                          [{ text: 'Not now', style: 'cancel' }, { text: 'Upgrade', onPress: () => navigation.navigate('Premium') }],
                        );
                        return;
                      }
                      setEmojiPickerOpen(false);
                      react(e);
                    }}
                  >
                    <Text style={[styles.emojiGridText, locked && { opacity: 0.35 }]}>{e}</Text>
                    {locked && <Text style={styles.emojiLock}>🔒</Text>}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Composer emoji picker — inserts into the message draft */}
      <Modal visible={emojiComposerOpen} transparent animationType="fade" onRequestClose={() => setEmojiComposerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEmojiComposerOpen(false)}>
          <Pressable style={[styles.sheet, styles.emojiPickerSheet, { paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Emoji</Text>
            <View style={styles.emojiGrid}>
              {MORE_EMOJI.map((e) => (
                <Pressable
                  key={e}
                  hitSlop={4}
                  style={styles.emojiGridCell}
                  onPress={() => onChangeText(text + e)}
                >
                  <Text style={styles.emojiGridText}>{e}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

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
        <Ionicons name={icon} size={26} color="#fff" />
      </View>
      <Text style={[attachStyles.tileLabel, { color: colors.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

function ActionRow({
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
      style={({ pressed }) => [msgMenuStyles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={21} color={tint} />
      <Text style={[msgMenuStyles.label, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

// Compact, Material-style rows for the message context menu.
const msgMenuStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 10, borderRadius: 12 },
  label: { fontSize: 15.5, marginLeft: 16, fontWeight: '500' },
});

const attachStyles = StyleSheet.create({
  opt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  circle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15, marginLeft: 14, fontWeight: '500' },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13 },
  actionLabel: { fontSize: 16, marginLeft: 16 },
  tile: { width: '25%', alignItems: 'center', paddingVertical: 10 },
  tileCircle: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  tileLabel: { fontSize: 12, fontWeight: '600' },
});

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    listContent: { paddingVertical: 8 },
    encNote: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 5, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, opacity: 0.75,
    },
    encNoteText: { color: colors.textMuted, fontSize: font.tiny },
    daySep: { alignItems: 'center', marginVertical: 10 },
    daySepText: {
      color: colors.textMuted, fontSize: font.tiny, fontWeight: '600',
      backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 5,
      borderRadius: radius.sm, overflow: 'hidden',
    },
    headerPerson: { flexDirection: 'row', alignItems: 'center', maxWidth: 220 },
    headerTextCol: { marginLeft: 10, flexShrink: 1, minWidth: 0 },
    headerTitle: { color: colors.text, fontSize: font.heading, fontWeight: '600', flexShrink: 1 },
    headerTitleRow: { flexDirection: 'row', alignItems: 'center' },
    headerSub: { color: colors.textMuted, fontSize: font.tiny, marginTop: 1 },
    headerSubTyping: { color: colors.primary, fontWeight: '600' },
    systemNotice: { alignItems: 'center', marginVertical: 8, paddingHorizontal: 24 },
    systemPill: {
      flexDirection: 'row', alignItems: 'center', maxWidth: '90%',
      backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 6,
      borderRadius: radius.md, overflow: 'hidden',
    },
    systemNoticeText: { color: colors.textMuted, fontSize: font.tiny, textAlign: 'center', flexShrink: 1 },
    lockGateText: { color: colors.text, fontSize: font.heading, fontWeight: '600', marginTop: 14 },
    lockGateBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18,
      backgroundColor: colors.primary, paddingHorizontal: 22, paddingVertical: 11, borderRadius: radius.pill,
    },
    lockGateBtnText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
    headerActions: { flexDirection: 'row', alignItems: 'center' },
    searchBar: {
      backgroundColor: colors.surface, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 8,
    },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 6,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: font.body, paddingVertical: 2 },
    searchCount: { color: colors.textMuted, fontSize: font.small, minWidth: 36, textAlign: 'right' },
    searchChips: { flexDirection: 'row', gap: 6 },
    searchChip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
    searchChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    searchChipText: { color: colors.textMuted, fontSize: font.small, fontWeight: '600' },
    searchChipTextActive: { color: '#fff' },
    previewBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    previewLine: { width: 3, height: 32, borderRadius: 2, backgroundColor: colors.primary, marginRight: 8 },
    previewTitle: { color: colors.primary, fontSize: font.small, fontWeight: '700' },
    previewText: { color: colors.textMuted, fontSize: font.small },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 10,
      paddingTop: 6,
      backgroundColor: colors.surface,
    },
    searchNoResults: { color: colors.textMuted, fontSize: font.small, paddingTop: 8, paddingBottom: 2 },
    jumpLatest: {
      position: 'absolute',
      right: 14,
      bottom: 78,
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    input: {
      flex: 1,
      color: colors.text,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.lg,
      paddingHorizontal: 14,
      paddingTop: Platform.OS === 'ios' ? 10 : 6,
      paddingBottom: Platform.OS === 'ios' ? 10 : 6,
      marginHorizontal: 8,
      maxHeight: 120,
      fontSize: font.body,
    },
    sendBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnPressed: { transform: [{ scale: 0.9 }], opacity: 0.9 },
    recordingComposer: { alignItems: 'center', paddingHorizontal: 16, minHeight: 52 },
    recordingPill: { flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 12 },
    recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger, marginRight: 8 },
    recText: { color: colors.textMuted, fontSize: font.small, fontWeight: '600' },
    attachGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 4, marginBottom: 4 },
    attachMore: {
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
      paddingTop: 4, marginTop: 4,
    },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    // ── WhatsApp-style message context menu (premium bottom sheet) ──────────────
    msgBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    msgSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingHorizontal: 12,
      paddingTop: 8,
      // Premium elevation.
      shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.18, shadowRadius: 14, elevation: 16,
    },
    grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 10 },
    reactionBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      alignSelf: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.pill,
      paddingHorizontal: 8, paddingVertical: 6,
      marginBottom: 10,
      gap: 2,
    },
    reactionBtn: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
    reactionBtnPressed: { transform: [{ scale: 1.25 }], backgroundColor: colors.surface },
    reactionEmoji: { fontSize: 27 },
    reactionAdd: {
      width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface, marginLeft: 2,
    },
    // Cap the menu so the sheet never dominates the screen (≤45% target).
    menuScroll: { maxHeight: Math.round(Dimensions.get('window').height * 0.42) },
    menuCard: { paddingBottom: 2 },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: 20,
      paddingTop: 16,
    },
    sheetTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: 8 },
    reportTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginTop: 2 },
    reportSubtitle: { color: colors.textMuted, fontSize: font.small, marginTop: 2, marginBottom: 6 },
    reportNote: {
      color: colors.text, fontSize: font.body, backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10,
      minHeight: 44, maxHeight: 100,
    },
    stickerGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingTop: 4 },
    stickerCell: { width: '23%', aspectRatio: 1, marginBottom: 10, alignItems: 'center', justifyContent: 'center' },
    stickerImg: { width: '100%', height: '100%', borderRadius: 12 },
    forwardSheet: { maxHeight: '60%' },
    pollSheet: { maxHeight: '80%' },
    pollInput: {
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: font.body,
      marginBottom: 8,
    },
    pollAddOpt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    pollAddOptText: { color: colors.primary, fontSize: font.body, fontWeight: '600', marginLeft: 6 },
    pollToggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    pollToggleText: { color: colors.text, fontSize: font.body, marginLeft: 10 },
    pollCreate: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
    pollCreateText: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
    forwardRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    forwardName: { color: colors.text, fontSize: font.body },
    emojiRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingVertical: 10,
      marginBottom: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    emoji: { fontSize: 30 },
    emojiMore: {
      width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    emojiPickerSheet: { maxHeight: '55%' },
    emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    emojiGridCell: { width: '16.66%', alignItems: 'center', paddingVertical: 10 },
    emojiGridText: { fontSize: 30 },
    emojiLock: { position: 'absolute', bottom: 6, right: '28%', fontSize: 11 },
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
