// Lumixo web — Chat view: messages, realtime, media, reactions, typing,
// presence, reply/forward/edit/delete, premium ghost mode, scheduling, AI, stickers.

import { useState, useEffect, useRef, useMemo, type FormEvent, type ChangeEvent, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from './AuthContext';
import { usePremium } from './PremiumContext';
import { usePresence } from './PresenceContext';
import { useUpgrade } from './premium/UpgradeProvider';
import { useCall } from './calls/CallContext';
import { PremiumBadge } from './premium/PremiumBadge';
import { supabase } from './supabase';
import {
  getMessages, sendMessage, subscribeToMessages, markMessageAsRead, markMessageAsDelivered,
  markMessagesAsDelivered, uploadMedia,
  getReceipts, subscribeToReceipts, getReactions, toggleReaction, subscribeToReactions,
  createTypingChannel, editMessage, deleteMessageForEveryone, forwardMessage, getMyConversations,
  messageMatchesKind, messageExpired, nextMessageExpiry, purgeExpiredMessages, getDisappearing, type SearchKind,
  markViewOnceSeen, getViewOnceState,
  buildTickMap, applyReceiptToTickMap, computeOutboundTick, tickGlyph, tickIsRead,
  resolveDisplayName,
  deletedMessageLabel,
  deletedReplyLabel,
  isModerationRemoved,
  canDeleteMessageForEveryone,
  shouldOmitDeletedFromTimeline,
  mergeMessagesById,
  mergeNetworkMessages,
  latestSyncedCreatedAt,
  oldestCreatedAt,
  MSG_OPEN_LIMIT,
  type TickStatus,
} from '@shared/api';
import {
  getCachedMessages,
  cacheMessages,
  upsertCachedMessage,
  removeCachedMessages,
  mergeCachedDelta,
  getDraft,
  setDraft,
} from './lib/messageCache';
import { getNickname } from './lib/nicknames';
import { sendPush } from '@shared/pushApi';
import { scheduleMessage, getScheduledMessages, dispatchDueMessages } from '@shared/premiumApi';
import { createPoll, getPolls } from '@shared/communitiesApi';
import type { Poll } from '@shared/communitiesApi';
import { aiRewrite, aiTranslate, aiSummarize, aiSmartReply } from '@shared/aiClient';
import { PollCard } from './communities/PollCard';
import { VoiceMessage } from './voice/VoiceMessage';
import { ContactProfileModal } from './profile/ContactProfileModal';
import { MediaLightbox, type MediaItem } from './media/MediaLightbox';
import './media/MediaLightbox.css';
import { MediaComposer } from './media/MediaComposer';
import { getStarredIds, starMessage, unstarMessage, getHiddenMessageIds, hideMessageForMe } from '@shared/messageExtras';
import { pinGroupMessage, unpinGroupMessage, getPinnedMessageIds, canPinMessages, getMyGroupRole, permissionsFromConversation, canSendInGroup } from '@shared/groupsApi';
import {
  nextPinnedId,
  activeMentionQuery,
  applyMention,
} from '@shared/groupChatExtras';
import { safeHref } from './util/safeUrl';
import { SignedImage, SignedVideo, SignedLink } from './lib/SignedMedia';
import {
  PhoneIcon, VideoIcon, SearchIcon, PaperclipIcon, PollIcon, ClockIcon, MicIcon, SendIcon,
  StarIcon, ReplyIcon, ForwardIcon, CopyIcon, EditIcon, TrashIcon, SmileIcon, MinimizeIcon,
  LockIcon,
} from './Icons';
import { FREE_LIMITS, PREMIUM_LIMITS } from '@shared/premium/features';
import type { ConversationSummary, Message, MessageReaction, ParticipantRole } from '@shared/types';
import { formatDistanceToNow, format, isToday, isYesterday, isSameDay } from 'date-fns';
import { spring } from './motion';
import { STICKERS, STICKER_PACKS, stickerMediaMeta, type Sticker } from './premium/stickers';
import { GroupInfoModal } from './GroupInfoModal';
import {
  enqueueSend,
  enqueueEdit,
  flushOutbox,
  onOutboxEvent,
  getOutboxForConversation,
  optimisticFromOutbox,
} from './lib/outbox';
import './ChatView.css';

interface Props {
  conversation: ConversationSummary;
  isOtherPremium?: boolean;
  onBack: () => void;
  onConversationGone?: () => void;
}

// WhatsApp-style reactions: free full quick set (no premium gate on emoji).
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MORE_EMOJIS = ['🔥', '🎉', '🥳', '💯', '👀', '🤝', '✨', '🫶', '👏', '🙌', '😍', '🤔', '😭', '😡', '🤩', '💪', '✅', '⭐', '🚀', '💔'];
const LANGUAGES = ['English', 'Hindi', 'Spanish', 'French', 'Japanese', 'German'];
const TYPING_TIMEOUT = 2500;
/** Windowed history: only mount the newest N messages; expand on scroll-up. */
const MSG_WINDOW_INITIAL = 80;
const MSG_WINDOW_STEP = 60;
// Optional writing tools (premium edge function). Off until product-ready.
const WRITING_TOOLS_ENABLED = false;
// Videos: first-class type='video' (migration 0031) + legacy type='file' with video extension.
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|#|$)/i;
const isVideoUrl = (url?: string | null) => !!url && VIDEO_RE.test(url);
const isVideoMsg = (m: { type: string; media_url?: string | null }) =>
  m.type === 'video' || (m.type === 'file' && isVideoUrl(m.media_url));
// WhatsApp-style clock time on bubbles + day-separator labels.
const clockTime = (d: string) => format(new Date(d), 'h:mm a');
const daySepLabel = (d: string) => {
  const x = new Date(d);
  return isToday(x) ? 'Today' : isYesterday(x) ? 'Yesterday' : format(x, 'EEEE, MMMM d');
};
// Consecutive messages from the same sender within this window stack as a group.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function ChatView({ conversation, isOtherPremium, onBack, onConversationGone }: Props) {
  const { profile } = useAuth();
  const { isPremium, preferences } = usePremium();
  const { onlineIds } = usePresence();
  const { open: openUpgrade } = useUpgrade();
  const { startCall, busy: callBusy } = useCall();
  const convId = conversation.conversation.id;
  const isGroup = conversation.conversation.type === 'group';
  const ghost = isPremium && preferences.ghost_mode;
  const otherUser = conversation.participants.find((p) => p.id !== profile?.id);
  const peerNick = profile?.id && otherUser?.id && !isGroup
    ? getNickname(profile.id, otherUser.id)
    : null;
  const chatTitle = isGroup
    ? (conversation.title || 'Group')
    : resolveDisplayName(otherUser, {
        nickname: peerNick,
        fallback: conversation.title,
      });

  const [messages, setMessages] = useState<Message[]>([]);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** messageId → outbound TickStatus (shared messageStatus engine). */
  const [tickMap, setTickMap] = useState<Map<string, TickStatus>>(() => new Map());
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [actionFor, setActionFor] = useState<string | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [groupTitle, setGroupTitle] = useState(conversation.title);
  const [myGroupRole, setMyGroupRole] = useState<ParticipantRole | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [groupSendBlocked, setGroupSendBlocked] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState<{
    ids: string[];
    allowForEveryone: boolean;
    everyoneLabel: string;
  } | null>(null);
  const [deleteAlsoEveryone, setDeleteAlsoEveryone] = useState(false);

  // compose modes
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [forwardTargets, setForwardTargets] = useState<ConversationSummary[]>([]);

  // premium UI state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduledCount, setScheduledCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  // voice recording
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordCancelRef = useRef(false);
  const recordStartRef = useRef(0);

  // in-conversation search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchKind, setSearchKind] = useState<SearchKind>('all');
  const [activeMatch, setActiveMatch] = useState(0);

  // contact profile (direct chats)
  const [showContact, setShowContact] = useState(false);

  // starred + per-user hidden ("delete for me") messages
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [hiddenMsgIds, setHiddenMsgIds] = useState<Set<string>>(new Set());
  // Disappearing messages (0022): a tick advanced to the next-soonest `expires_at`
  // so expired messages drop from the view live, with no polling.
  const [now, setNow] = useState<number>(() => Date.now());
  // Current disappearing timer for this chat (0 = off) — drives the header badge.
  // Seeded from the conversation summary, refreshed on the 'system' notice below.
  const [disappearSecs, setDisappearSecs] = useState<number>(conversation.conversation.disappear_seconds ?? 0);

  // polls
  const [polls, setPolls] = useState<Poll[]>([]);
  const [showPolls, setShowPolls] = useState(true);
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [pollAnonymous, setPollAnonymous] = useState(false);
  const [pinnedCycleId, setPinnedCycleId] = useState<string | null>(null);
  const [mentionMenu, setMentionMenu] = useState<{
    query: string;
    start: number;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const loadingOlderRef = useRef(false);
  // Touch long-press → open the message action menu (WhatsApp parity on touch
  // devices). Desktop keeps hover tools + right-click. ~300ms hold; a normal tap
  // (shorter) or a scroll (move) cancels it so image/link taps still work.
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLongPress = () => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; } };
  const bubbleHoldHandlers = (msgId: string, deleted: boolean) => (deleted ? {} : {
    onContextMenu: (e: ReactMouseEvent) => { e.preventDefault(); setPickerFor(null); setActionFor(msgId); },
    onTouchStart: () => {
      clearLongPress();
      longPressRef.current = setTimeout(() => { setPickerFor(null); setActionFor(msgId); }, 300);
    },
    onTouchEnd: clearLongPress,
    onTouchMove: clearLongPress,
    onTouchCancel: clearLongPress,
  });
  const [showJump, setShowJump] = useState(false);
  // Media composer (multi-file preview + caption + quality + View Once). Photos/
  // videos chosen via the attach button open this instead of uploading immediately.
  const [composerFiles, setComposerFiles] = useState<File[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  // Read ghost mode through a ref inside realtime callbacks so toggling it does
  // NOT tear down and re-subscribe the channels (which could drop inserts in the gap).
  const ghostRef = useRef(ghost);
  useEffect(() => { ghostRef.current = ghost; }, [ghost]);
  const notifyTypingRef = useRef<((p: { userId: string; name: string; typing: boolean }) => void) | null>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const upsertMessage = (m: Message) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev.map((x) => (x.id === m.id ? m : x)) : [...prev, m]));
    void upsertCachedMessage(convId, m);
  };

  // Composer drafts — restore instantly, debounce persist (offline-safe).
  useEffect(() => {
    setInput(getDraft(convId));
  }, [convId]);
  useEffect(() => {
    if (editing) return; // don't overwrite draft while editing a bubble
    const t = setTimeout(() => setDraft(convId, input), 250);
    return () => clearTimeout(t);
  }, [input, convId, editing]);

  useEffect(() => {
    let active = true;
    // Never flash the previous conversation's bubbles while this thread hydrates.
    setMessages([]);
    setTickMap(new Map()); setReactions([]); setTypingUsers({});
    setSuggestions([]); setSummary(null); setReplyTo(null); setEditing(null);
    setPolls([]); setPollComposerOpen(false);
    setSearchOpen(false); setSearchTerm('');

    const pendingOf = () =>
      getOutboxForConversation(convId)
        .filter((i) => i.kind === 'send')
        .map((i) => optimisticFromOutbox(i, profile?.id ?? ''));

    (async () => {
      // 1) INSTANT: IndexedDB thread + durable outbox (never wait on network).
      const cached = await getCachedMessages(convId);
      if (!active) return;
      let pending = pendingOf();
      if (cached.length || pending.length) {
        setMessages(mergeMessagesById(cached, pending));
      } else {
        setMessages([]);
      }

      // 2) BACKGROUND sync — delta when warm, full open-window when cold.
      try {
        const watermark = latestSyncedCreatedAt(cached);
        let thread: Message[];
        if (watermark && cached.length > 0) {
          const delta = await getMessages(supabase, convId, { after: watermark, limit: 200 });
          if (!active) return;
          if (delta.length) {
            thread = await mergeCachedDelta(convId, delta);
          } else {
            thread = cached;
          }
        } else {
          const network = await getMessages(supabase, convId, MSG_OPEN_LIMIT);
          if (!active) return;
          await cacheMessages(convId, network);
          thread = network;
        }
        pending = pendingOf();
        const merged = mergeNetworkMessages(mergeMessagesById(cached, pending), thread, 'delta');
        setMessages(mergeMessagesById(merged, pending));

        const ids = thread.map((m) => m.id);
        if (ids.length) {
          const [rc, rx] = await Promise.all([
            getReceipts(supabase, ids),
            getReactions(supabase, ids),
          ]);
          if (!active) return;
          const mineIds = thread.filter((m) => m.sender_id === profile?.id).map((m) => m.id);
          setTickMap(buildTickMap(rc, profile?.id, mineIds));
          setReactions(rx);
          const incomingIds = thread.filter((m) => m.sender_id !== profile?.id).map((m) => m.id);
          if (incomingIds.length) {
            void markMessagesAsDelivered(supabase, incomingIds).catch(() => {});
            if (!ghostRef.current) {
              incomingIds.forEach((id) => { void markMessageAsRead(supabase, id).catch(() => {}); });
            }
          }
        }
      } catch {
        /* offline — cached view already on screen */
      }
      void flushOutbox();
    })().catch(() => {});

    // Disappearing messages (0022): opportunistic physical cleanup of expired
    // messages in my conversations. Fire-and-forget; query + client filter hide
    // expired ones regardless.
    void purgeExpiredMessages(supabase).catch(() => {});

    getScheduledMessages(supabase, convId).then((s) => setScheduledCount(s.length)).catch(() => {});
    getPolls(supabase, convId).then((p) => { if (active) setPolls(p); }).catch(() => {});
    getStarredIds(supabase).then((ids) => { if (active) setStarredIds(new Set(ids)); }).catch(() => {});
    getHiddenMessageIds(supabase).then((ids) => { if (active) setHiddenMsgIds(new Set(ids)); }).catch(() => {});
    // Disappearing-messages timer for the header badge (kept live via the system notice below).
    getDisappearing(supabase, convId).then((s) => { if (active) setDisappearSecs(s); }).catch(() => {});
    if (isGroup) {
      getMyGroupRole(supabase, convId).then((role) => {
        if (!active) return;
        setMyGroupRole(role);
        const perms = permissionsFromConversation(conversation.conversation);
        setGroupSendBlocked(!canSendInGroup(role, perms));
      }).catch(() => {});
      getPinnedMessageIds(supabase, convId).then((ids) => {
        if (active) setPinnedIds(new Set(ids));
      }).catch(() => {});
    } else {
      setMyGroupRole(null);
      setGroupSendBlocked(false);
      setPinnedIds(new Set());
    }

    const msgChannel = subscribeToMessages(
      supabase, convId,
      (newMsg) => {
        setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]));
        void upsertCachedMessage(convId, newMsg);
        // A 'system' notice means the disappearing timer was just changed — refresh it.
        if (newMsg.type === 'system') getDisappearing(supabase, convId).then((s) => { if (active) setDisappearSecs(s); }).catch(() => {});
        if (newMsg.sender_id !== profile?.id) {
          void markMessageAsDelivered(supabase, newMsg.id).catch(() => {});
          if (!ghostRef.current) void markMessageAsRead(supabase, newMsg.id).catch(() => {});
        }
      },
      (updated) => {
        if (shouldOmitDeletedFromTimeline(updated)) {
          setMessages((prev) => prev.filter((m) => m.id !== updated.id));
          void removeCachedMessages(convId, [updated.id]);
          return;
        }
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        void upsertCachedMessage(convId, updated);
      },
      (deletedId) => {
        setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        void removeCachedMessages(convId, [deletedId]);
      },
    );
    const receiptChannel = subscribeToReceipts(supabase, convId, (r) => {
      setTickMap((prev) => applyReceiptToTickMap(prev, r, profile?.id));
    });
    const reactionChannel = subscribeToReactions(supabase, convId, () => {
      getReactions(supabase, messagesRef.current.map((m) => m.id)).then((rs) => { if (active) setReactions(rs); }).catch(() => {});
    });
    const typing = createTypingChannel(supabase, convId, ({ userId, name, typing: t }) => {
      setTypingUsers((prev) => { const n = { ...prev }; if (t) n[userId] = name; else delete n[userId]; return n; });
    });
    notifyTypingRef.current = typing.notify;

    void dispatchDueMessages(supabase).catch(() => {});
    const dueInterval = setInterval(() => { void dispatchDueMessages(supabase).catch(() => {}); }, 60000);

    return () => {
      active = false;
      msgChannel.unsubscribe(); receiptChannel.unsubscribe();
      reactionChannel.unsubscribe(); typing.channel.unsubscribe();
      notifyTypingRef.current = null;
      if (typingStopRef.current) clearTimeout(typingStopRef.current);
      isTypingRef.current = false;
      clearInterval(dueInterval);
      // tear down any in-flight voice recording
      if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        recordCancelRef.current = true;
        try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
      }
      setRecording(false);
    };
  }, [convId, profile?.id]);

  useEffect(() => {
    // Only auto-scroll to the newest message when the user is already near the
    // bottom — don't yank them down while they're scrolled up reading history.
    const c = messagesContainerRef.current;
    const nearBottom = !c || c.scrollHeight - c.scrollTop - c.clientHeight < 150;
    if (nearBottom) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  /** Outbound tick for a message I sent — shared with chat-list previews. */
  function outboundTick(msg: Message): TickStatus {
    return computeOutboundTick({
      messageId: msg.id,
      pending: msg.pending,
      failed: !!(msg as { failed?: boolean }).failed,
      senderId: profile?.id,
      tickMap,
    });
  }

  const reactionsByMessage = useMemo(() => {
    const map: Record<string, { emoji: string; count: number; mine: boolean }[]> = {};
    for (const r of reactions) {
      const list = (map[r.message_id] ||= []);
      const entry = list.find((e) => e.emoji === r.emoji);
      if (entry) { entry.count += 1; if (r.user_id === profile?.id) entry.mine = true; }
      else list.push({ emoji: r.emoji, count: 1, mine: r.user_id === profile?.id });
    }
    return map;
  }, [reactions, profile?.id]);

  // ── Typing ───────────────────────────────────────────────────────────────────
  function broadcastTyping(typing: boolean) {
    if (ghost || !profile || !notifyTypingRef.current) return;
    if (typing === isTypingRef.current) return;
    isTypingRef.current = typing;
    notifyTypingRef.current({ userId: profile.id, name: profile.display_name || 'Someone', typing });
  }
  function handleInputChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;
    setInput(val);
    if (isGroup) {
      const m = activeMentionQuery(val, cursor);
      setMentionMenu(m);
    } else {
      setMentionMenu(null);
    }
    broadcastTyping(true);
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    typingStopRef.current = setTimeout(() => broadcastTyping(false), TYPING_TIMEOUT);
  }

  const mentionHits = useMemo(() => {
    if (!isGroup || !mentionMenu) return [];
    const q = mentionMenu.query.toLowerCase();
    return conversation.participants
      .filter((p) => p.id !== profile?.id)
      .filter((p) => {
        if (!q) return true;
        const name = (p.display_name || '').toLowerCase();
        const user = (p.username || '').toLowerCase();
        return name.includes(q) || user.includes(q);
      })
      .slice(0, 8);
  }, [isGroup, mentionMenu, conversation.participants, profile?.id]);

  function pickWebMention(p: { id: string; display_name: string | null; username: string | null }) {
    if (!mentionMenu) return;
    const label = p.username || (p.display_name || 'member').replace(/\s+/g, '');
    const next = applyMention(input, mentionMenu.start, label);
    setInput(next.text);
    setMentionMenu(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.cursor, next.cursor);
    });
  }
  function stopTyping() { if (typingStopRef.current) clearTimeout(typingStopRef.current); broadcastTyping(false); }

  // Enter sends; Shift+Enter inserts a newline (WhatsApp/desktop convention).
  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e as unknown as FormEvent);
    }
  }

  // Auto-grow the composer textarea up to a max height, then scroll internally.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  async function togglePin(m: Message) {
    setActionFor(null);
    const was = pinnedIds.has(m.id);
    if (was) {
      const { error } = await unpinGroupMessage(supabase, convId, m.id);
      if (error) { setToast(error.message); return; }
      setPinnedIds((s) => { const n = new Set(s); n.delete(m.id); return n; });
      setToast('Message unpinned');
    } else {
      const { error } = await pinGroupMessage(supabase, convId, m.id);
      if (error) { setToast(error.message); return; }
      setPinnedIds((s) => new Set(s).add(m.id));
      setToast('Message pinned');
    }
  }

  function notifyPush(preview: string, messageType = 'text', messageId?: string) {
    void sendPush(supabase, {
      conversationId: convId,
      kind: isGroup ? 'group' : 'message',
      title: isGroup ? (groupTitle || conversation.title || 'Group') : (profile?.display_name || 'New message'),
      body: preview,
      data: {
        messageType,
        ...(messageId ? { messageId } : {}),
      },
    });
  }

  // Outbox sent / failed (offline durability).
  useEffect(() => {
    return onOutboxEvent((item, message, error) => {
      if (item.conversationId !== convId) return;
      if (error) {
        if (item.kind === 'send') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === item.id ? ({ ...m, pending: false, failed: true } as Message) : m,
            ),
          );
        }
        setToast(error === 'max_attempts' ? 'Message failed after retries' : 'Send failed — will retry');
        return;
      }
      if (message) {
        upsertMessage({ ...message, pending: false } as Message);
      } else if (item.kind === 'send') {
        // Dupe path — clear pending on optimistic row
        setMessages((prev) =>
          prev.map((m) => (m.id === item.id ? ({ ...m, pending: false } as Message) : m)),
        );
      }
    });
  }, [convId]);

  // ── Send / edit (durable outbox — works offline + survives refresh) ──────────
  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    if (groupSendBlocked) {
      setToast('Only admins can send messages in this group');
      return;
    }
    setSending(true);
    const content = input.trim();
    setInput(''); setSuggestions([]); stopTyping();

    if (editing) {
      const target = editing;
      setEditing(null);
      // Optimistic local content; durable queue if offline / fails.
      upsertMessage({ ...target, content, edited_at: new Date().toISOString() });
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          await enqueueEdit({ conversationId: convId, messageId: target.id, content });
          setToast('Edit queued — will sync when online');
        } else {
          const { message, error } = await editMessage(supabase, target.id, content);
          if (error || !message) {
            await enqueueEdit({ conversationId: convId, messageId: target.id, content });
            setToast(error?.message || 'Edit queued for retry');
          } else {
            upsertMessage(message);
          }
        }
      } catch {
        await enqueueEdit({ conversationId: convId, messageId: target.id, content });
      }
      setSending(false);
      return;
    }

    const reply = replyTo;
    setReplyTo(null);
    // Optimistic + durable outbox (same id as server insert for realtime dedupe).
    const item = await enqueueSend({
      conversationId: convId,
      content,
      type: 'text',
      replyTo: reply?.id,
      senderId: profile?.id,
    });
    upsertMessage(optimisticFromOutbox(item, profile?.id ?? ''));
    setDraft(convId, ''); // clear durable draft after successful queue
    // flushOutbox runs inside enqueue; if online, push is sent after insert.
    // Do NOT call notifyPush here — outbox flush owns push with messageId.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setToast('Queued — will send when online');
    }
    setSending(false);
  }

  async function handleReact(messageId: string, emoji: string) {
    setPickerFor(null);
    await toggleReaction(supabase, messageId, emoji);
    // Use the live ref, not the render-closure `messages`, so reactions on
    // messages that arrived since this render aren't dropped from the refetch.
    setReactions(await getReactions(supabase, messagesRef.current.map((m) => m.id)));
  }

  // ── Message actions ──────────────────────────────────────────────────────────
  function startReply(m: Message) { setActionFor(null); setEditing(null); setReplyTo(m); }
  function startEdit(m: Message) { setActionFor(null); setReplyTo(null); setEditing(m); setInput(m.content ?? ''); }

  /** Open Telegram-style delete dialog for one message. */
  function promptDelete(m: Message) {
    setActionFor(null);
    const allowForEveryone = canDeleteMessageForEveryone(m, profile?.id);
    const peerName = otherUser
      ? resolveDisplayName(otherUser, { fallback: 'recipient' })
      : 'recipient';
    const everyoneLabel = isGroup
      ? 'Also delete for everyone'
      : `Also delete for ${peerName}`;
    setDeleteAlsoEveryone(false);
    setDeletePrompt({
      ids: [m.id],
      allowForEveryone,
      everyoneLabel,
    });
  }

  async function confirmWebDelete() {
    if (!deletePrompt) return;
    const { ids, allowForEveryone } = deletePrompt;
    const alsoEveryone = deleteAlsoEveryone && allowForEveryone;
    setDeletePrompt(null);
    if (alsoEveryone) {
      const snapshot = messagesRef.current.filter((x) => ids.includes(x.id));
      setMessages((cur) => cur.filter((x) => !ids.includes(x.id)));
      const results = await Promise.all(
        ids.map(async (id) => {
          const { error } = await deleteMessageForEveryone(supabase, id);
          return { id, error };
        }),
      );
      const failed = results.filter((r) => r.error);
      if (failed.length) {
        setMessages((cur) => {
          const map = new Map(cur.map((m) => [m.id, m]));
          for (const s of snapshot) {
            if (failed.some((f) => f.id === s.id)) map.set(s.id, s);
          }
          return [...map.values()].sort((a, b) =>
            a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
          );
        });
        setToast(failed[0]?.error?.message || 'Could not delete for everyone');
      }
    } else {
      for (const id of ids) {
        const m = messagesRef.current.find((x) => x.id === id);
        if (m) await deleteForMe(m);
        else {
          await hideMessageForMe(supabase, id);
          setHiddenMsgIds((prev) => new Set(prev).add(id));
        }
      }
    }
  }
  async function copyText(m: Message) {
    setActionFor(null);
    try { await navigator.clipboard.writeText(m.content ?? ''); setToast('Copied'); } catch { setToast('Copy failed'); }
  }
  async function openForward(m: Message) {
    setActionFor(null);
    setForwarding(m);
    setForwardTargets(await getMyConversations(supabase));
  }
  async function doForward(target: ConversationSummary) {
    if (!forwarding) return;
    const src = forwarding;
    setForwarding(null);
    const { error } = await forwardMessage(supabase, target.conversation.id, { type: src.type, content: src.content, media_url: src.media_url });
    setToast(error ? error.message : `Forwarded to ${target.title}`);
  }

  // ── Media / stickers ─────────────────────────────────────────────────────────
  async function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list?.length || uploading) return;
    const files = Array.from(list);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Photos & videos open the composer (preview + caption + quality + View Once).
    // Other files (documents) keep the immediate single-file upload path.
    const media = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    const docs = files.filter((f) => !f.type.startsWith('image/') && !f.type.startsWith('video/'));

    if (media.length) { setComposerFiles(media); }

    if (docs.length) {
      const limit = isPremium ? PREMIUM_LIMITS.uploadBytes : FREE_LIMITS.uploadBytes;
      for (const file of docs) {
        if (file.size > limit) {
          if (!isPremium) {
            setToast(`Free sends up to ${Math.round(FREE_LIMITS.uploadBytes / (1024 * 1024))} MB · Lumixo+ up to ${Math.round(PREMIUM_LIMITS.uploadBytes / (1024 * 1024))} MB`);
            openUpgrade();
          } else {
            setToast(`File too large (max ${Math.round(PREMIUM_LIMITS.uploadBytes / (1024 * 1024))} MB)`);
          }
          continue;
        }
        setUploading(true);
        try {
          // Durable: blob in IndexedDB when offline; upload on flush when online.
          const item = await enqueueSend({
            conversationId: convId,
            content: file.name,
            type: 'file',
            file,
            fileName: file.name,
            senderId: profile?.id,
          });
          upsertMessage(optimisticFromOutbox(item, profile?.id ?? ''));
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            setToast('Document queued — will send when online');
          }
        } catch (err: any) {
          setToast(err.message || 'Failed to queue file');
        } finally {
          setUploading(false);
        }
      }
    }
  }

  async function sendSticker(sticker: Sticker) {
    setStickersOpen(false);
    // Offline emoji-card stickers — media_meta drives native-like render; no upload.
    const item = await enqueueSend({
      conversationId: convId,
      content: sticker.emoji,
      type: 'image',
      mediaUrl: sticker.url,
      mediaMeta: stickerMediaMeta(sticker),
      senderId: profile?.id,
    });
    upsertMessage(optimisticFromOutbox(item, profile?.id ?? ''));
  }

  // ── Optional writing tools ───────────────────────────────────────────────────
  function transcript(): string {
    return messages.slice(-20).filter((m) => !m.is_deleted).map((m) => {
      const who = m.sender_id === profile?.id
        ? 'Me'
        : resolveDisplayName(
            conversation.participants.find((p) => p.id === m.sender_id),
            { fallback: 'Contact' },
          );
      return `${who}: ${m.content ?? '[media]'}`;
    }).join('\n');
  }
  async function runWritingTool(fn: () => Promise<void>) {
    if (!isPremium) { setAiOpen(false); return openUpgrade(); }
    setAiBusy(true);
    try { await fn(); } catch (e: any) { setToast(e.message || 'Request failed'); } finally { setAiBusy(false); }
  }
  const doRewrite = () => runWritingTool(async () => { if (!input.trim()) { setToast('Type a draft to rewrite'); return; } setInput(await aiRewrite(supabase, input.trim())); setAiOpen(false); });
  const doTranslate = (lang: string) => runWritingTool(async () => { if (!input.trim()) { setToast('Type a draft to translate'); return; } setInput(await aiTranslate(supabase, input.trim(), lang)); setTranslateOpen(false); setAiOpen(false); });
  const doSmartReply = () => runWritingTool(async () => { setSuggestions(await aiSmartReply(supabase, transcript())); setAiOpen(false); });
  const doSummarize = () => runWritingTool(async () => { setSummary(await aiSummarize(supabase, transcript())); setAiOpen(false); });

  // ── Scheduling ────────────────────────────────────────────────────────────────
  async function handleSchedule() {
    if (!isPremium) { setScheduleOpen(false); return openUpgrade(); }
    if (!input.trim() || !scheduleAt) { setToast('Add a message and a time'); return; }
    const when = new Date(scheduleAt);
    if (when.getTime() <= Date.now()) { setToast('Pick a future time'); return; }
    const { error } = await scheduleMessage(supabase, convId, input.trim(), when);
    if (error) { setToast(error.message); return; }
    setInput(''); setScheduleAt(''); setScheduleOpen(false);
    setScheduledCount((c) => c + 1);
    setToast(`Scheduled for ${when.toLocaleString()}`);
  }

  // ── Voice notes ────────────────────────────────────────────────────────────────
  async function startRecording() {
    if (recording || sending || uploading) return;
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setToast('Microphone access denied'); return; }
    const mr = new MediaRecorder(stream);
    chunksRef.current = [];
    recordCancelRef.current = false;
    recordStartRef.current = Date.now();
    mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
      setRecording(false);
      const chunks = chunksRef.current; chunksRef.current = [];
      if (recordCancelRef.current) return;
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      if (blob.size < 800) return; // ignore accidental taps
      const secs = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
      await sendVoice(blob, secs);
    };
    mediaRecorderRef.current = mr;
    mr.start();
    setRecording(true); setRecordSecs(0);
    recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
  }
  function stopRecording(cancel: boolean) {
    recordCancelRef.current = cancel;
    try { mediaRecorderRef.current?.stop(); } catch { setRecording(false); }
  }
  async function sendVoice(blob: Blob, secs: number) {
    setUploading(true);
    try {
      const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type });
      const { url, error } = await uploadMedia(supabase, convId, file, file.name);
      if (error || !url) throw error || new Error('upload failed');
      const label = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const { message } = await sendMessage(supabase, convId, label, 'audio', url);
      if (message) {
        upsertMessage(message);
        notifyPush('🎤 Voice message', 'audio', message.id);
      }
    } catch (e: any) {
      setToast(e?.message || 'Could not send voice message');
    } finally { setUploading(false); }
  }
  const fmtRec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // ── Polls ──────────────────────────────────────────────────────────────────────
  function setPollOption(i: number, val: string) {
    setPollOptions((opts) => opts.map((o, idx) => (idx === i ? val : o)));
  }
  async function handleCreatePoll() {
    const question = pollQuestion.trim();
    const options = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!question) { setToast('Add a poll question'); return; }
    if (options.length < 2) { setToast('Add at least two options'); return; }
    const { poll, error } = await createPoll(
      supabase,
      convId,
      question,
      options,
      pollMultiple,
      pollAnonymous,
    );
    if (error || !poll) { setToast(error?.message || 'Could not create poll'); return; }
    setPolls((p) => [poll, ...p]);
    setPollQuestion(''); setPollOptions(['', '']); setPollMultiple(false); setPollAnonymous(false); setPollComposerOpen(false);
    setShowPolls(true);
    setToast('Poll created');
  }

  function jumpToPinned() {
    const ids = [...pinnedIds];
    if (!ids.length) return;
    const next = nextPinnedId(ids, pinnedCycleId);
    if (!next) return;
    setPinnedCycleId(next);
    const el = document.getElementById(`m-${next}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Brief highlight via search-match-active class if present
    el?.classList.add('search-match-active');
    setTimeout(() => el?.classList.remove('search-match-active'), 1200);
  }

  const pinnedPreview = useMemo(() => {
    if (!pinnedIds.size) return null;
    const id = pinnedCycleId && pinnedIds.has(pinnedCycleId)
      ? pinnedCycleId
      : [...pinnedIds][0];
    const m = messages.find((x) => x.id === id);
    if (!m) return { id, text: 'Pinned message' };
    const text =
      m.type === 'text'
        ? (m.content || '').slice(0, 80)
        : m.type === 'image'
          ? '📷 Photo'
          : m.type === 'video'
            ? '🎬 Video'
            : m.type === 'audio'
              ? '🎤 Voice'
              : m.content || 'Pinned message';
    return { id, text };
  }, [pinnedIds, pinnedCycleId, messages]);

  // ── Header subtitle (presence) ─────────────────────────────────────────────────
  const typingNames = Object.values(typingUsers);
  const otherOnline = otherUser ? onlineIds.has(otherUser.id) : false;
  let subtitle: ReactNode;
  if (typingNames.length > 0) {
    subtitle = <span className="typing-dots"><i /><i /><i />{isGroup ? ` ${typingNames.join(', ')}` : ''}</span>;
  } else if (isGroup) {
    subtitle = `${conversation.participants.length} members`;
  } else if (otherOnline) {
    subtitle = <span className="presence online">online</span>;
  } else if (otherUser?.last_seen) {
    subtitle = `last seen ${formatDistanceToNow(new Date(otherUser.last_seen), { addSuffix: true })}`;
  } else {
    subtitle = 'offline';
  }

  // Full reaction palette for everyone (WhatsApp parity — emoji isn't paywalled).
  const emojiSet = [...QUICK_EMOJIS, ...MORE_EMOJIS];
  const repliedOf = (m: Message) => (m.reply_to ? messages.find((x) => x.id === m.reply_to) : null);

  // In-conversation search: when active, only matching messages are shown.
  const search = searchTerm.trim().toLowerCase();
  // WhatsApp-style search: keep the whole thread visible and jump between
  // matches rather than filtering. A kind filter (media/links/docs/voice) can
  // narrow the set, with or without a text query.
  // delete-for-me + user hard/soft-unsend: fully hidden (Telegram, no ghost).
  // Moderation soft-deletes remain as tombstones. Expired disappearing hidden.
  const displayMessages = useMemo(
    () =>
      messages.filter(
        (m) =>
          !hiddenMsgIds.has(m.id) &&
          !messageExpired(m, now) &&
          !shouldOmitDeletedFromTimeline(m),
      ),
    [messages, hiddenMsgIds, now],
  );
  const searchActive = searchOpen && (!!search || searchKind !== 'all');
  // Windowed list: newest MSG_WINDOW_* messages only (except during search).
  const [msgWindow, setMsgWindow] = useState(MSG_WINDOW_INITIAL);
  useEffect(() => { setMsgWindow(MSG_WINDOW_INITIAL); }, [convId]);
  const windowedMessages = useMemo(() => {
    if (searchActive) return displayMessages;
    if (displayMessages.length <= msgWindow) return displayMessages;
    return displayMessages.slice(displayMessages.length - msgWindow);
  }, [displayMessages, msgWindow, searchActive]);
  const hasOlderInWindow = !searchActive && displayMessages.length > msgWindow;
  const [hasMoreOnServer, setHasMoreOnServer] = useState(true);
  useEffect(() => { setHasMoreOnServer(true); }, [convId]);
  const hasOlderMessages = hasOlderInWindow || (!searchActive && hasMoreOnServer && displayMessages.length > 0);

  /** Load older history from server (cursor pagination) and/or expand DOM window. */
  async function loadOlderMessages() {
    if (loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    const c = messagesContainerRef.current;
    const prevHeight = c?.scrollHeight ?? 0;
    const prevTop = c?.scrollTop ?? 0;
    try {
      // First expand local window if we still have cached rows off-screen.
      if (displayMessages.length > msgWindow) {
        setMsgWindow((w) => Math.min(displayMessages.length, w + MSG_WINDOW_STEP));
      } else {
        const before = oldestCreatedAt(messagesRef.current);
        if (before) {
          const older = await getMessages(supabase, convId, { before, limit: MSG_WINDOW_STEP });
          if (older.length === 0) {
            setHasMoreOnServer(false);
          } else {
            if (older.length < MSG_WINDOW_STEP) setHasMoreOnServer(false);
            setMessages((prev) => {
              const merged = mergeMessagesById(older, prev);
              void cacheMessages(convId, merged);
              return merged;
            });
            setMsgWindow((w) => w + older.length);
          }
        } else {
          setHasMoreOnServer(false);
        }
      }
    } catch {
      /* offline — keep windowed local history */
    }
    requestAnimationFrame(() => {
      const el = messagesContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight - prevHeight + prevTop;
      loadingOlderRef.current = false;
    });
  }

  const matchIds = useMemo(() => {
    if (!searchActive) return [] as string[];
    return displayMessages
      .filter((m) => !m.is_deleted && messageMatchesKind(m, searchKind) && (!search || (m.content ?? '').toLowerCase().includes(search)))
      .map((m) => m.id);
  }, [displayMessages, search, searchKind, searchActive]);
  const activeMatchId = matchIds[activeMatch];

  // Disappearing messages (0022): schedule ONE self-rescheduling timer to the
  // next-soonest expiry so expired messages drop live, with no polling.
  useEffect(() => {
    const next = nextMessageExpiry(messages, now);
    if (next === null) return;
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, next - now) + 250);
    return () => clearTimeout(id);
  }, [messages, now]);

  function scrollToMatch(idx: number) {
    const id = matchIds[idx];
    if (!id) return;
    document.getElementById(`m-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function jumpMatch(delta: number) {
    if (matchIds.length === 0) return;
    const next = (activeMatch + delta + matchIds.length) % matchIds.length;
    setActiveMatch(next);
    scrollToMatch(next);
  }
  // Reset to the newest match whenever the query/filter changes.
  useEffect(() => {
    if (!searchActive || matchIds.length === 0) { setActiveMatch(0); return; }
    setActiveMatch(0);
    const t = setTimeout(() => scrollToMatch(0), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searchKind, searchActive]);

  // Image/video messages in this conversation — backs the full-screen lightbox.
  // Must include type='video' (new sends) AND legacy type='file' video rows.
  const mediaItems = useMemo<MediaItem[]>(() => messages
    .filter((m) => !m.is_deleted && m.media_url && (m.type === 'image' || isVideoMsg(m)))
    .map((m) => ({
      id: m.id,
      url: m.media_url!,
      kind: m.type === 'image' ? ('image' as const) : ('video' as const),
      caption: m.content || undefined,
      sender: m.sender_id === profile?.id
        ? 'You'
        : resolveDisplayName(
            conversation.participants.find((p) => p.id === m.sender_id),
            { fallback: 'Contact' },
          ),
      time: clockTime(m.created_at),
    })), [messages, profile?.id, conversation.participants]);
  const lightboxIndex = lightboxId ? mediaItems.findIndex((x) => x.id === lightboxId) : -1;

  async function toggleStar(m: Message) {
    setActionFor(null);
    const was = starredIds.has(m.id);
    setStarredIds((s) => { const n = new Set(s); was ? n.delete(m.id) : n.add(m.id); return n; });
    await (was ? unstarMessage(supabase, m.id) : starMessage(supabase, m.id)).catch?.(() => {});
  }
  async function deleteForMe(m: Message) {
    setActionFor(null);
    setHiddenMsgIds((s) => { const n = new Set(s); n.add(m.id); return n; });
    await hideMessageForMe(supabase, m.id);
  }
  function highlight(text: string): ReactNode {
    if (!search) return text;
    const idx = text.toLowerCase().indexOf(search);
    if (idx === -1) return text;
    return (<>{text.slice(0, idx)}<mark className="search-hit">{text.slice(idx, idx + search.length)}</mark>{text.slice(idx + search.length)}</>);
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <button onClick={onBack} className="back-btn">←</button>
        <div className="avatar avatar-wrap">
          {conversation.title[0]}
          {!isGroup && otherOnline && <span className="online-dot" />}
        </div>
        <div
          className="chat-header-info"
          style={{ cursor: isGroup || otherUser ? 'pointer' : 'default' }}
          onClick={() => {
            if (isGroup) setShowGroupInfo(true);
            else if (otherUser) setShowContact(true);
          }}
        >
          <div className="chat-title">
            {isGroup ? groupTitle : chatTitle}{isOtherPremium && <PremiumBadge compact />}
            {disappearSecs > 0 && <span className="chat-disappear-mark" title="Disappearing messages on">⏳</span>}
          </div>
          <div className={`chat-subtitle ${typingNames.length ? 'typing' : ''}`}>{subtitle}</div>
        </div>
        {!isGroup && (
          <>
            <button className="header-icon-btn call" title="Voice call" aria-label="Start voice call" disabled={callBusy}
              onClick={() => startCall(convId, 'audio', chatTitle)}><PhoneIcon size={20} /></button>
            <button className="header-icon-btn call" title="Video call" aria-label="Start video call" disabled={callBusy}
              onClick={() => startCall(convId, 'video', chatTitle)}><VideoIcon size={20} /></button>
          </>
        )}
        {isGroup && (
          <button
            className="header-icon-btn"
            title="Group info"
            aria-label="Group info"
            onClick={() => setShowGroupInfo(true)}
          >
            ℹ
          </button>
        )}
        <button className="header-icon-btn" title="Search messages" aria-label="Search messages"
          onClick={() => { setSearchOpen((v) => !v); if (searchOpen) { setSearchTerm(''); setSearchKind('all'); } }}><SearchIcon size={18} /></button>
        {ghost && <span className="ghost-indicator" title="Ghost mode on">👻</span>}
      </div>

      <AnimatePresence>
        {searchOpen && (
          <motion.div className="chat-search-bar" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="chat-search-row">
              <SearchIcon size={16} className="chat-search-icon" />
              <input autoFocus type="text" placeholder="Search in this conversation…" value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') jumpMatch(e.shiftKey ? -1 : 1); }} />
              {searchActive && (
                <span className="chat-search-count">
                  {matchIds.length === 0 ? 'No results' : `${activeMatch + 1} / ${matchIds.length}`}
                </span>
              )}
              <button className="chat-search-nav" disabled={matchIds.length === 0} onClick={() => jumpMatch(-1)} aria-label="Previous match" title="Previous (Shift+Enter)">↑</button>
              <button className="chat-search-nav" disabled={matchIds.length === 0} onClick={() => jumpMatch(1)} aria-label="Next match" title="Next (Enter)">↓</button>
              <button className="chat-search-close" onClick={() => { setSearchOpen(false); setSearchTerm(''); setSearchKind('all'); }} aria-label="Close search">✕</button>
            </div>
            <div className="chat-search-filters">
              {(['all', 'media', 'links', 'docs', 'voice'] as SearchKind[]).map((k) => (
                <button key={k} className={`chat-search-chip ${searchKind === k ? 'active' : ''}`} onClick={() => setSearchKind(k)}>
                  {k === 'all' ? 'All' : k === 'media' ? 'Media' : k === 'links' ? 'Links' : k === 'docs' ? 'Docs' : 'Voice'}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {summary && (
          <motion.div className="ai-summary" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="ai-summary-head"><span>📋 Summary</span><button onClick={() => setSummary(null)} aria-label="Close summary">✕</button></div>
            <div className="ai-summary-body">{summary}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {polls.length > 0 && (
          <motion.div className="poll-panel" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="poll-panel-head">
              <button onClick={() => setShowPolls((v) => !v)}>📊 Polls ({polls.length}) {showPolls ? '▾' : '▸'}</button>
            </div>
            {showPolls && (
              <div className="poll-panel-body">
                {polls.map((p) => (
                  <PollCard
                    key={p.id}
                    poll={p}
                    myId={profile?.id}
                    onClosed={(next) =>
                      setPolls((list) => list.map((x) => (x.id === next.id ? next : x)))
                    }
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {isGroup && pinnedPreview && (
        <button
          type="button"
          className="pinned-banner"
          onClick={jumpToPinned}
          title="Jump to pinned message"
        >
          <span className="pinned-banner-icon">📌</span>
          <span className="pinned-banner-body">
            <strong>
              {pinnedIds.size} pinned{pinnedIds.size > 1 ? ' · tap to cycle' : ''}
            </strong>
            <span className="pinned-banner-text">{pinnedPreview.text}</span>
          </span>
        </button>
      )}

      <div
        ref={messagesContainerRef}
        className="messages-container"
        onScroll={(e) => {
          const c = e.currentTarget;
          setShowJump(c.scrollHeight - c.scrollTop - c.clientHeight > 240);
          // Expand window / fetch older page near top (preserve scroll position).
          if (hasOlderMessages && c.scrollTop < 100 && !loadingOlderRef.current) {
            void loadOlderMessages();
          }
        }}
        onClick={() => { setPickerFor(null); setActionFor(null); setAiOpen(false); setStickersOpen(false); }}
      >
        <div className="chat-enc-note" role="note">
          <LockIcon size={12} /> Encrypted in transit
        </div>
        {hasOlderMessages && (
          <button
            type="button"
            className="load-older-msgs"
            onClick={() => { void loadOlderMessages(); }}
          >
            {hasOlderInWindow
              ? `Load older messages (${displayMessages.length - msgWindow} more)`
              : 'Load older messages'}
          </button>
        )}
        {windowedMessages.map((msg, i) => {
          // System notices (0027): centered WhatsApp-style info pill.
          if (msg.type === 'system') {
            return (
              <div key={msg.id} className="system-notice">
                <span className="system-notice-pill">⏳ {msg.content}</span>
              </div>
            );
          }
          const isMine = msg.sender_id === profile?.id;
          const sender = conversation.participants.find((p) => p.id === msg.sender_id);
          const msgReactions = reactionsByMessage[msg.id] || [];
          const replied = repliedOf(msg);
          const prev = windowedMessages[i - 1];
          const showDaySep = !prev || !isSameDay(new Date(prev.created_at), new Date(msg.created_at));
          const grouped = !!prev && !showDaySep && prev.sender_id === msg.sender_id
            && new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS;
          const isActiveMatch = msg.id === activeMatchId;
          const isMatch = searchActive && matchIds.includes(msg.id);
          return (
            <div key={msg.id}>
              {showDaySep && (
                <div className="day-sep"><span>{daySepLabel(msg.created_at)}</span></div>
              )}
              <div
                id={`m-${msg.id}`}
                className={`message ${isMine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''} ${isMatch ? 'search-match' : ''} ${isActiveMatch ? 'search-match-active' : ''}`}
              >
                {!isMine && isGroup && !msg.is_deleted && !grouped && (
                  <div className="message-sender">
                    {resolveDisplayName(sender, { fallback: 'Contact' })}
                  </div>
                )}
                <div className="message-row">
                  <div
                    className={`message-bubble ${msg.is_deleted ? 'deleted' : ''} ${isModerationRemoved(msg) ? 'moderation-removed' : ''}`}
                    {...bubbleHoldHandlers(msg.id, !!msg.is_deleted)}
                  >
                    {msg.is_deleted ? (
                      <div className="message-text deleted-text">
                        <span className="deleted-icon" aria-hidden>
                          {isModerationRemoved(msg) ? '🛡️' : '🚫'}
                        </span>
                        {deletedMessageLabel(msg, { isGroup })}
                      </div>
                    ) : (
                      <>
                        {msg.is_forwarded && <div className="forwarded-tag"><ForwardIcon size={12} /> Forwarded</div>}
                        {replied && (
                          <div className="reply-quote">
                            <span className="reply-quote-name">
                              {replied.is_deleted
                                ? isModerationRemoved(replied)
                                  ? 'Removed by Lumixo'
                                  : 'Message'
                                : replied.sender_id === profile?.id
                                  ? 'You'
                                  : resolveDisplayName(
                                      conversation.participants.find((p) => p.id === replied.sender_id),
                                      { fallback: 'Contact' },
                                    )}
                            </span>
                            <span className="reply-quote-text">
                              {replied.is_deleted
                                ? deletedReplyLabel(replied)
                                : replied.content || '[media]'}
                            </span>
                          </div>
                        )}
                        {msg.type === 'image' && (msg.media_meta as { sticker?: boolean } | null)?.sticker && (
                          <div
                            className="message-sticker"
                            style={{
                              background: (msg.media_meta as { bg?: string })?.bg || '#2a3441',
                              width: 148,
                              height: 148,
                              borderRadius: 24,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 72,
                              lineHeight: 1,
                              margin: '2px 0',
                            }}
                            role="img"
                            aria-label="Sticker"
                          >
                            {(msg.media_meta as { emoji?: string })?.emoji || msg.content || '🎀'}
                          </div>
                        )}
                        {msg.type === 'image' && msg.media_url && !(msg.media_meta as { sticker?: boolean } | null)?.sticker && (
                          <button type="button" className="message-image-btn" onClick={() => setLightboxId(msg.id)} aria-label="View photo">
                            <SignedImage source={msg.media_url} alt="Attachment" className="message-image" />
                          </button>
                        )}
                        {msg.type === 'audio' && msg.media_url && <VoiceMessage url={msg.media_url} mine={isMine} />}
                        {msg.media_url && isVideoMsg(msg) && (
                          <button type="button" className="message-video-btn" onClick={() => setLightboxId(msg.id)} aria-label="Play video">
                            <SignedVideo source={msg.media_url} className="message-image" preload="metadata" muted />
                            <span className="message-video-play">▶</span>
                          </button>
                        )}
                        {msg.type === 'file' && msg.media_url && !isVideoUrl(msg.media_url) && safeHref(msg.media_url) && (
                          <SignedLink source={msg.media_url} className="message-file">📎 {msg.content || 'File'}</SignedLink>
                        )}
                        {(msg.type === 'text' ||
                          (msg.content &&
                            msg.type !== 'audio' &&
                            !(msg.type === 'file' && !isVideoUrl(msg.media_url)))) && (
                          <div className="message-text">{highlight(msg.content ?? '')}</div>
                        )}
                        <div className="message-time">
                          {starredIds.has(msg.id) && <StarIcon size={11} filled className="msg-star" />}
                          {msg.edited_at && <span className="edited-tag">edited</span>}
                          {clockTime(msg.created_at)}
                          {isMine && (() => {
                            const t = outboundTick(msg);
                            return (
                              <span className={`read-receipt${tickIsRead(t) ? ' read' : ''}`} aria-label={t}>
                                {tickGlyph(t)}
                              </span>
                            );
                          })()}
                        </div>
                        {msgReactions.length > 0 && (
                          <div className="reaction-pills">
                            {msgReactions.map((r) => (
                              <button
                                key={r.emoji}
                                type="button"
                                className={`reaction-pill ${r.mine ? 'mine' : ''}`}
                                onClick={(e) => { e.stopPropagation(); handleReact(msg.id, r.emoji); }}
                              >
                                {r.emoji} {r.count}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {!msg.is_deleted && (
                    <div className="msg-tools">
                      <button type="button" className="react-trigger" onClick={(e) => { e.stopPropagation(); setActionFor(null); setPickerFor((c) => (c === msg.id ? null : msg.id)); }} title="React">☺</button>
                      <button type="button" className="react-trigger" onClick={(e) => { e.stopPropagation(); setPickerFor(null); setActionFor((c) => (c === msg.id ? null : msg.id)); }} title="More">⋮</button>
                    </div>
                  )}

                  {pickerFor === msg.id && (
                    <div className="emoji-picker glass" onClick={(e) => e.stopPropagation()}>
                      {emojiSet.map((emoji) => (
                        <button type="button" key={emoji} onClick={() => handleReact(msg.id, emoji)}>{emoji}</button>
                      ))}
                    </div>
                  )}
                  {actionFor === msg.id && (
                    <div className="action-menu glass" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => startReply(msg)}><ReplyIcon size={16} /> Reply</button>
                      <button type="button" onClick={() => openForward(msg)}><ForwardIcon size={16} /> Forward</button>
                      <button type="button" onClick={() => toggleStar(msg)}><StarIcon size={16} filled={starredIds.has(msg.id)} /> {starredIds.has(msg.id) ? 'Unstar' : 'Star'}</button>
                      {isGroup && canPinMessages(myGroupRole, permissionsFromConversation(conversation.conversation)) && (
                        <button type="button" onClick={() => togglePin(msg)}>
                          📌 {pinnedIds.has(msg.id) ? 'Unpin' : 'Pin'}
                        </button>
                      )}
                      {msg.content && <button type="button" onClick={() => copyText(msg)}><CopyIcon size={16} /> Copy</button>}
                      {isMine && msg.type === 'text' && <button type="button" onClick={() => startEdit(msg)}><EditIcon size={16} /> Edit</button>}
                      <button type="button" className="danger" onClick={() => promptDelete(msg)}>
                        <TrashIcon size={16} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {search && displayMessages.length === 0 && <div className="empty-state">No messages match “{searchTerm.trim()}”.</div>}
        {uploading && <div className="message mine"><div className="message-bubble uploading">Uploading...</div></div>}
        <div ref={messagesEndRef} />
      </div>

      {deletePrompt && (
        <div className="modal-backdrop delete-dlg-backdrop" onClick={() => setDeletePrompt(null)}>
          <div className="delete-dlg glass" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="delete-dlg-title">
            <h3 id="delete-dlg-title">Delete message?</h3>
            <p>
              Are you sure you want to delete the selected message
              {deletePrompt.ids.length > 1 ? 's' : ''}?
            </p>
            {deletePrompt.allowForEveryone && (
              <label className="delete-dlg-check">
                <input
                  type="checkbox"
                  checked={deleteAlsoEveryone}
                  onChange={(e) => setDeleteAlsoEveryone(e.target.checked)}
                />
                <span>{deletePrompt.everyoneLabel}</span>
              </label>
            )}
            <div className="delete-dlg-actions">
              <button type="button" onClick={() => setDeletePrompt(null)}>Cancel</button>
              <button type="button" className="danger" onClick={() => void confirmWebDelete()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showJump && (
          <motion.button className="jump-bottom" title="Scroll to latest"
            initial={{ opacity: 0, scale: 0.7, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.7, y: 8 }}
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}>
            <MinimizeIcon size={22} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Suggested reply chips */}
      <AnimatePresence>
        {suggestions.length > 0 && (
          <motion.div className="suggestion-bar" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {suggestions.map((s, i) => (<button key={i} className="suggestion-chip" onClick={() => { setInput(s); setSuggestions([]); }}>{s}</button>))}
            <button className="suggestion-dismiss" onClick={() => setSuggestions([])} aria-label="Dismiss suggestions">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reply / edit compose banner */}
      <AnimatePresence>
        {(replyTo || editing) && (
          <motion.div className="compose-banner" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="compose-banner-body">
              <div className="compose-banner-title">{editing ? '✎ Editing message' : `↩︎ Replying to ${replyTo && replyTo.sender_id === profile?.id ? 'yourself' : (conversation.participants.find((p) => p.id === replyTo?.sender_id)?.display_name || '')}`}</div>
              <div className="compose-banner-text">{(editing ?? replyTo)?.content || '[media]'}</div>
            </div>
            <button onClick={() => { setReplyTo(null); setEditing(null); if (editing) setInput(''); }} aria-label={editing ? 'Cancel editing' : 'Cancel reply'}>✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sticker picker — packs + emoji cards (no blank SVG data-URIs) */}
      <AnimatePresence>
        {stickersOpen && (
          <motion.div className="sticker-pop glass" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="sticker-pop-title" style={{ fontWeight: 700, marginBottom: 8, opacity: 0.85 }}>
              Stickers · {STICKER_PACKS.length} packs
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
              {STICKERS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => void sendSticker(s)}
                  title={`${s.packName}: ${s.emoji}`}
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 14,
                    border: 'none',
                    background: s.bg,
                    fontSize: 32,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                  }}
                >
                  {s.emoji}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Poll composer */}
      <AnimatePresence>
        {pollComposerOpen && (
          <motion.div className="poll-pop glass" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="poll-pop-title">📊 Create poll</div>
            <input className="poll-pop-input" placeholder="Question" value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} maxLength={140} />
            {pollOptions.map((opt, i) => (
              <input key={i} className="poll-pop-input" placeholder={`Option ${i + 1}`} value={opt}
                onChange={(e) => setPollOption(i, e.target.value)} maxLength={80} />
            ))}
            <div className="poll-pop-row">
              {pollOptions.length < 6 && (
                <button type="button" className="poll-pop-add" onClick={() => setPollOptions((o) => [...o, ''])}>+ Option</button>
              )}
              <label className="poll-pop-multi">
                <input type="checkbox" checked={pollMultiple} onChange={(e) => setPollMultiple(e.target.checked)} /> Multiple
              </label>
              <label className="poll-pop-multi">
                <input type="checkbox" checked={pollAnonymous} onChange={(e) => setPollAnonymous(e.target.checked)} /> Anonymous
              </label>
            </div>
            <button type="button" className="poll-pop-submit" onClick={handleCreatePoll}>Create poll</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Schedule popover */}
      <AnimatePresence>
        {scheduleOpen && (
          <motion.div className="schedule-pop glass" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="schedule-title">⏰ Schedule message</div>
            <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
            <button onClick={handleSchedule}>Schedule</button>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={handleSend} className="message-input-form">
        <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} style={{ display: 'none' }} disabled={uploading} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="attach-btn" title="Attach file" aria-label="Attach file"><PaperclipIcon size={22} /></button>

        <button type="button" className={`tool-btn ${isPremium ? '' : 'locked'}`} title="Stickers" aria-label="Stickers"
          onClick={() => (isPremium ? (setStickersOpen((v) => !v), setAiOpen(false)) : openUpgrade())}><SmileIcon size={22} /></button>

        <div className="ai-wrap">
          {WRITING_TOOLS_ENABLED && (
          <button type="button" className={`tool-btn ${isPremium ? '' : 'locked'}`} title="Writing tools" onClick={() => (isPremium ? setAiOpen((v) => !v) : openUpgrade())}>✨</button>
          )}
          <AnimatePresence>
            {aiOpen && (
              <motion.div className="ai-menu glass" initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
                {aiBusy ? <div className="ai-loading"><span className="fh-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Thinking…</div> : (
                  <>
                    <button type="button" onClick={doRewrite}>✏️ Rewrite draft</button>
                    <button type="button" onClick={() => setTranslateOpen((v) => !v)}>🌐 Translate draft</button>
                    {translateOpen && (<div className="ai-langs">{LANGUAGES.map((l) => <button key={l} type="button" onClick={() => doTranslate(l)}>{l}</button>)}</div>)}
                    <button type="button" onClick={doSmartReply}>⚡ Smart replies</button>
                    <button type="button" onClick={doSummarize}>📋 Summarize chat</button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button type="button" className="tool-btn" title="Create poll" aria-label="Create poll" onClick={() => { setPollComposerOpen((v) => !v); setScheduleOpen(false); setStickersOpen(false); setAiOpen(false); }}><PollIcon size={20} /></button>

        <button type="button" className={`tool-btn ${isPremium ? '' : 'locked'}`} title="Schedule" aria-label="Schedule message" onClick={() => (isPremium ? setScheduleOpen((v) => !v) : openUpgrade())}>
          <ClockIcon size={20} />{scheduledCount > 0 && <span className="sched-badge">{scheduledCount}</span>}
        </button>

        {recording ? (
          <div className="voice-rec-bar">
            <span className="voice-rec-dot" />
            <span className="voice-rec-time">{fmtRec(recordSecs)}</span>
            <span className="voice-rec-hint">Recording…</span>
            <button type="button" className="voice-rec-cancel" onClick={() => stopRecording(true)} title="Cancel" aria-label="Cancel recording"><TrashIcon size={18} /></button>
            <button type="button" className="voice-rec-send" onClick={() => stopRecording(false)} title="Send voice message" aria-label="Send voice message"><SendIcon size={18} /></button>
          </div>
        ) : (
          <>
            {mentionHits.length > 0 && (
              <div className="mention-menu" role="listbox" aria-label="Mention member">
                {mentionHits.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="mention-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickWebMention(p);
                    }}
                  >
                    <span className="mention-av">{(p.display_name || p.username || '?')[0]}</span>
                    <span className="mention-name">{p.display_name || p.username || 'Member'}</span>
                    {p.username && <span className="mention-user">@{p.username}</span>}
                  </button>
                ))}
              </div>
            )}
            <textarea ref={textareaRef} rows={1} placeholder={editing ? 'Edit your message…' : isGroup ? 'Type a message · @ to mention' : 'Type a message'} value={input} onChange={handleInputChange} onKeyDown={handleComposerKeyDown} onBlur={stopTyping} disabled={sending || uploading} />
            {input.trim() || editing ? (
              <motion.button whileTap={{ scale: 0.9 }} type="submit" disabled={!input.trim() || sending || uploading} aria-label={editing ? 'Save' : 'Send'}>{editing ? '✓' : <SendIcon size={18} />}</motion.button>
            ) : (
              <button type="button" className="mic-btn tool-btn" onClick={startRecording} disabled={uploading} title="Record voice message" aria-label="Record voice message"><MicIcon size={20} /></button>
            )}
          </>
        )}
      </form>

      {/* Forward picker */}
      <AnimatePresence>
        {forwarding && (
          <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setForwarding(null)}>
            <motion.div className="forward-modal glass" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
              <h3>Forward to…</h3>
              <div className="forward-list">
                {forwardTargets.map((c) => (
                  <button key={c.conversation.id} onClick={() => doForward(c)}>
                    <span className="avatar small">{c.title[0]}</span>{c.title}
                  </button>
                ))}
                {forwardTargets.length === 0 && <div className="no-results">No conversations</div>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {lightboxIndex >= 0 && (
          <MediaLightbox
            items={mediaItems}
            index={lightboxIndex}
            onClose={() => setLightboxId(null)}
            onIndexChange={(idx) => setLightboxId(mediaItems[idx]?.id ?? null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {composerFiles && composerFiles.length > 0 && (
          <MediaComposer
            convId={convId}
            isPremium={isPremium}
            files={composerFiles}
            onClose={() => setComposerFiles(null)}
            onSent={() => { /* realtime + upsert already reflect sent messages */ }}
            onUpgrade={openUpgrade}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (<motion.div className="chat-toast glass" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{toast}</motion.div>)}
      </AnimatePresence>

      <AnimatePresence>
        {showContact && otherUser && (
          <ContactProfileModal
            profile={otherUser}
            online={otherOnline}
            isPremium={isOtherPremium}
            conversationId={convId}
            onClose={() => setShowContact(false)}
            onCall={() => { setShowContact(false); startCall(convId, 'audio', otherUser.display_name || conversation.title); }}
            onVideo={() => { setShowContact(false); startCall(convId, 'video', otherUser.display_name || conversation.title); }}
          />
        )}
      </AnimatePresence>

      {showGroupInfo && isGroup && (
        <GroupInfoModal
          conversationId={convId}
          onClose={() => setShowGroupInfo(false)}
          onLeft={() => {
            setShowGroupInfo(false);
            onConversationGone?.();
            onBack();
          }}
          onUpdated={(name) => setGroupTitle(name)}
        />
      )}

      {groupSendBlocked && (
        <div className="compose-banner" style={{ justifyContent: 'center' }}>
          <div className="compose-banner-body">
            <div className="compose-banner-title">Only admins can send messages</div>
          </div>
        </div>
      )}
    </div>
  );
}
