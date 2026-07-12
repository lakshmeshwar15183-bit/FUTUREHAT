// Lumixo web — main app (conversation list + chat) with premium wiring.
// Performance: cache-first chat list, deferred secondary network, lazy ChatView.

import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense, type MouseEvent } from 'react';
import { useAuth } from './AuthContext';
import { usePremium } from './PremiumContext';
import { usePresence } from './PresenceContext';
import { UpgradeProvider, useUpgrade } from './premium/UpgradeProvider';
import { PremiumBadge } from './premium/PremiumBadge';
import { supabase } from './supabase';
import { signOut, getMyConversations, searchProfiles, startDirectConversation, searchAllMessages, isVideoMessage, type MessageSearchHit } from '@shared/api';
import { listRecentContacts, removeRecentContact, type RecentContact } from '@shared/recentContactsApi';
import {
  getPinnedIds, pinConversation, unpinConversation,
  getFavoriteIds, favoriteConversation, unfavoriteConversation,
} from '@shared/premiumApi';
import { getLockedIds, lockConversation, unlockConversation, getChatLockSettings } from '@shared/chatLockApi';
import type { ChatLockSettings } from '@shared/types';
import { deviceAuth } from './lib/deviceAuth';
import {
  getMutedIds, muteConversation, unmuteConversation,
  getBlockedIds, blockUser, unblockUser, submitReport,
} from '@shared/supportApi';
import { FREE_LIMITS } from '@shared/premium/features';
import { getMyStreaks, processMyStreaks, subscribeStreakChanges, indexStreaksByConversation } from '@shared/streakApi';
import type { ConversationSummary, Profile, StreakSummary } from '@shared/types';
import { StatusStrip } from './status/StatusStrip';
import { WebNotifications } from './lib/WebNotificationsBridge';
import { CommunitiesIcon, NewGroupIcon, NewChatIcon, SettingsIcon, SignOutIcon, SearchIcon, MoreIcon, PhoneIcon, TrashIcon } from './Icons';
import { format, isToday, isYesterday } from 'date-fns';
import {
  afterFirstPaint,
  readCachedConversations,
  writeCachedConversations,
  mark,
} from './lib/startupCache';
import './App.css';

// ChatView is large — load only when a conversation is opened (or prefetch idle).
const ChatView = lazy(() => import('./ChatView').then((m) => ({ default: m.ChatView })));

// Modals are lazy — they're off the critical path and keep the initial bundle small.
const ProfileModal = lazy(() => import('./ProfileModal').then((m) => ({ default: m.ProfileModal })));
const GroupModal = lazy(() => import('./GroupModal').then((m) => ({ default: m.GroupModal })));
const JoinGroupInvite = lazy(() => import('./JoinGroupInvite').then((m) => ({ default: m.JoinGroupInvite })));
const SettingsModal = lazy(() => import('./premium/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const HelpSupportModal = lazy(() => import('./support/HelpSupportModal').then((m) => ({ default: m.HelpSupportModal })));
const CommunitiesModal = lazy(() => import('./communities/CommunitiesModal').then((m) => ({ default: m.CommunitiesModal })));
const StarredMessagesModal = lazy(() => import('./StarredMessagesModal').then((m) => ({ default: m.StarredMessagesModal })));
const AdminDashboard = lazy(() => import('./admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const AdminGate = lazy(() => import('./admin/AdminGate').then((m) => ({ default: m.AdminGate })));
const ModeratorDashboard = lazy(() => import('./moderator/ModeratorDashboard').then((m) => ({ default: m.ModeratorDashboard })));
const Mailbox = lazy(() => import('./Mailbox').then((m) => ({ default: m.Mailbox })));
const CallsView = lazy(() => import('./calls/CallsView').then((m) => ({ default: m.CallsView })));

function ChatSkeleton() {
  return (
    <div className="chat-skeleton" aria-busy="true" aria-label="Loading chat">
      <div className="chat-skeleton-head" />
      <div className="chat-skeleton-body">
        <div className="chat-skeleton-bubble theirs" />
        <div className="chat-skeleton-bubble mine" />
        <div className="chat-skeleton-bubble theirs short" />
      </div>
    </div>
  );
}

function ConvListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="conv-list-skeleton" aria-busy="true" aria-label="Loading chats">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="boot-row conv-skel-row">
          <div className="boot-av" />
          <div className="boot-lines">
            <div className="skel" style={{ width: `${45 + (i % 3) * 12}%` }} />
            <div className="skel" style={{ width: `${60 + (i % 4) * 8}%`, height: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Offline-first cache for recent contacts (web parity with mobile's AsyncStorage
// layer): render the last-known list instantly on open, then reconcile from the
// server. Best-effort — a corrupt/missing entry degrades to "no cache".
const recentCacheKey = (uid: string) => `fh:web:recent:${uid}`;
function readCachedRecent(uid: string): RecentContact[] {
  try {
    const raw = localStorage.getItem(recentCacheKey(uid));
    return raw ? (JSON.parse(raw) as RecentContact[]) : [];
  } catch { return []; }
}
function writeCachedRecent(uid: string, list: RecentContact[]): void {
  try { localStorage.setItem(recentCacheKey(uid), JSON.stringify(list)); } catch { /* noop */ }
}

function AppInner() {
  const { user, profile } = useAuth();
  const { isPremium, premiumUserIds } = usePremium();
  const { onlineIds } = usePresence();
  const { open: openUpgrade } = useUpgrade();
  const uid = user?.id ?? profile?.id ?? null;

  // Cache-first: paint last-known chats instantly (sync localStorage read).
  const [conversations, setConversations] = useState<ConversationSummary[]>(() =>
    uid ? readCachedConversations(uid) : [],
  );
  const [listHydrating, setListHydrating] = useState(() =>
    uid ? readCachedConversations(uid).length === 0 : true,
  );
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  // Persistent "previously chatted users" for New Chat — INDEPENDENT of the
  // conversation list, so deleting a chat never removes the person here (parity
  // with mobile; backed by public.recent_contacts). Rendered when no query.
  const [recentContacts, setRecentContacts] = useState<RecentContact[]>(() =>
    uid ? readCachedRecent(uid).filter((r) => r.contact && r.contact.id !== uid) : [],
  );
  const [loading, setLoading] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const [groupInviteToken, setGroupInviteToken] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCommunities, setShowCommunities] = useState(false);
  const [showStarred, setShowStarred] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showModerator, setShowModerator] = useState(false);
  const [showMailbox, setShowMailbox] = useState(false);
  const [showCalls, setShowCalls] = useState(false);

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [pinnedOrder, setPinnedOrder] = useState<string[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  // Chat Lock (0027): per-chat locks secured by the device's own auth (fingerprint /
  // face / PIN via WebAuthn). Locked chats stay hidden from the list until revealed
  // with device auth this session; they re-lock when the tab is hidden.
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());
  const [locksRevealed, setLocksRevealed] = useState(false);
  const [lockSettings, setLockSettings] = useState<ChatLockSettings>({ enabled: false, autoLockMs: 0 });
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false); // sidebar "⋮ More" overflow menu
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  // Server-authoritative streak summary per conversation → chat-row emoji.
  const [streaks, setStreaks] = useState<Record<string, StreakSummary>>({});

  const mountedRef = useRef(true);

  const loadConversations = useCallback(async () => {
    mark('convs-fetch-start');
    try {
      const convs = await getMyConversations(supabase);
      if (!mountedRef.current) return;
      setConversations(convs);
      setListHydrating(false);
      mark('convs-fetch-done');
      if (uid) writeCachedConversations(uid, convs);
    } catch {
      /* transient network — keep cache */
      if (mountedRef.current) setListHydrating(false);
    }
  }, [uid]);

  useEffect(() => {
    // Deep link: /invite/g/<token> opens the group join flow.
    try {
      const path = window.location.pathname || '';
      const m = path.match(/\/invite\/g\/([a-zA-Z0-9_-]+)/);
      if (m?.[1]) setGroupInviteToken(m[1]);
    } catch { /* ignore */ }
  }, []);

  // Re-seed cache when uid becomes available (profile load after session).
  useEffect(() => {
    if (!uid) return;
    const cached = readCachedConversations(uid);
    if (cached.length) {
      setConversations((prev) => (prev.length ? prev : cached));
      setListHydrating(false);
    }
  }, [uid]);

  // Critical path: conversation list only. Everything else after first paint.
  useEffect(() => {
    mountedRef.current = true;
    void loadConversations();
    // Prefetch ChatView chunk while user scans the list.
    afterFirstPaint(() => {
      void import('./ChatView');
    });
    afterFirstPaint(() => {
      getPinnedIds(supabase).then((ids) => {
        if (!mountedRef.current) return;
        setPinnedOrder(ids);
        setPinnedIds(new Set(ids));
      }).catch(() => {});
      getFavoriteIds(supabase).then((ids) => {
        if (mountedRef.current) setFavIds(new Set(ids));
      }).catch(() => {});
      getLockedIds(supabase).then((ids) => {
        if (mountedRef.current) setLockedIds(new Set(ids));
      }).catch(() => {});
      getChatLockSettings(supabase).then((s) => {
        if (mountedRef.current) setLockSettings(s);
      }).catch(() => {});
      getMutedIds(supabase).then((ids) => {
        if (mountedRef.current) setMutedIds(new Set(ids));
      }).catch(() => {});
      getBlockedIds(supabase).then((ids) => {
        if (mountedRef.current) setBlockedIds(new Set(ids));
      }).catch(() => {});
      // Streaks never block UI — process then load (idle).
      void (async () => {
        await processMyStreaks(supabase).catch(() => 0);
        const list = await getMyStreaks(supabase).catch(() => [] as StreakSummary[]);
        if (mountedRef.current) setStreaks(indexStreaksByConversation(list));
      })();
    });
    return () => { mountedRef.current = false; };
  }, [loadConversations]);

  // Realtime streaks — subscribe after paint.
  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null;
    afterFirstPaint(() => {
      sub = subscribeStreakChanges(supabase, () => {
        getMyStreaks(supabase)
          .then((list) => {
            if (mountedRef.current) setStreaks(indexStreaksByConversation(list));
          })
          .catch(() => {});
      });
    });
    return () => { sub?.unsubscribe(); };
  }, []);

  // Auto-lock: when the tab is hidden, re-lock the revealed Locked chats area after
  // the configured delay (0 = immediately). Returning within the window cancels it.
  useEffect(() => {
    if (!locksRevealed) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        const ms = lockSettings.autoLockMs ?? 0;
        if (ms <= 0) { setLocksRevealed(false); }
        else { timer = setTimeout(() => setLocksRevealed(false), ms); }
      } else if (timer) { clearTimeout(timer); timer = null; }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); if (timer) clearTimeout(timer); };
  }, [locksRevealed, lockSettings.autoLockMs]);

  // If the currently open chat becomes hidden (locked & not revealed), close it.
  useEffect(() => {
    if (selectedConvId && lockedIds.has(selectedConvId) && !locksRevealed) setSelectedConvId(null);
  }, [selectedConvId, lockedIds, locksRevealed]);

  // Offline-first recent-contacts load: paint the cache immediately, then refresh
  // from the server and reconcile. Runs when we know the user and each time the
  // New Chat panel opens (so it reflects chats started elsewhere). Never the
  // current user; deleted conversations do NOT affect this list.
  useEffect(() => {
    const uid = profile?.id;
    if (!uid) return;
    const cached = readCachedRecent(uid).filter((r) => r.contact && r.contact.id !== uid);
    if (cached.length) setRecentContacts(cached);
    let active = true;
    listRecentContacts(supabase).then((server) => {
      if (!active) return;
      const clean = server.filter((r) => r.contact && r.contact.id !== uid);
      setRecentContacts(clean);
      writeCachedRecent(uid, clean);
    }).catch(() => { /* keep cached list on transient error */ });
    return () => { active = false; };
  }, [profile?.id, showSearch]);

  // Optimistically fold a just-contacted person to the top of recent contacts +
  // cache before the server round-trips (the server also records it inside the
  // start_direct_conversation RPC). Moves an existing entry to the top.
  function addRecentOptimistic(user: Profile) {
    const uid = profile?.id;
    if (!uid || user.id === uid) return;
    const now = new Date().toISOString();
    setRecentContacts((cur) => {
      const existing = cur.find((r) => r.contact?.id === user.id);
      const entry: RecentContact = existing
        ? { ...existing, contact: user, last_interaction_at: now }
        : { contact: user, first_interaction_at: now, last_interaction_at: now };
      const next = [entry, ...cur.filter((r) => r.contact?.id !== user.id)];
      writeCachedRecent(uid, next);
      return next;
    });
  }

  // Remove-only: forget the New Chat history entry. Updates UI + cache instantly,
  // then syncs the delete. Does NOT delete messages, delete the conversation, or
  // block the user. RLS scopes the delete to the caller's own row.
  async function handleRemoveRecent(user: Profile, e: MouseEvent) {
    e.stopPropagation();
    const name = user.display_name || (user.username ? `@${user.username}` : 'this contact');
    if (!window.confirm(`Remove ${name} from recent contacts?\n\nThis only removes them from New Chat — your messages and the conversation are kept, and the user is not blocked.`)) return;
    const uid = profile?.id;
    setRecentContacts((cur) => {
      const next = cur.filter((r) => r.contact?.id !== user.id);
      if (uid) writeCachedRecent(uid, next);
      return next;
    });
    const { error } = await removeRecentContact(supabase, user.id);
    if (error) { // resync from server on failure so the UI reflects the truth
      listRecentContacts(supabase).then((server) => {
        const clean = server.filter((r) => r.contact && r.contact.id !== uid);
        setRecentContacts(clean);
        if (uid) writeCachedRecent(uid, clean);
      }).catch(() => {});
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setLoading(true);
    const results = await searchProfiles(supabase, searchQuery);
    setSearchResults(results.filter((p) => p.id !== profile?.id));
    setLoading(false);
  }

  async function handleStartChat(user: Profile) {
    addRecentOptimistic(user); // instant + offline-first; server persists it too
    const { conversationId, error } = await startDirectConversation(supabase, user.id);
    if (error || !conversationId) {
      alert(error?.message || 'Could not start the chat. Please try again.');
      return;
    }
    await loadConversations();
    setSelectedConvId(conversationId);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  }

  async function togglePin(id: string) {
    setMenuFor(null);
    const wasPinned = pinnedIds.has(id);
    if (!wasPinned && !isPremium && pinnedOrder.length >= FREE_LIMITS.pinnedChats) return openUpgrade();
    // optimistic — preserve pin order (new pins append)
    setPinnedOrder((prev) => {
      const next = wasPinned ? prev.filter((x) => x !== id) : [...prev.filter((x) => x !== id), id];
      setPinnedIds(new Set(next));
      return next;
    });
    const { error } = wasPinned ? await unpinConversation(supabase, id) : await pinConversation(supabase, id);
    if (error) {
      setPinnedOrder((prev) => {
        const next = wasPinned ? [...prev.filter((x) => x !== id), id] : prev.filter((x) => x !== id);
        setPinnedIds(new Set(next));
        return next;
      });
    }
  }

  async function toggleFavorite(id: string) {
    setMenuFor(null);
    const was = favIds.has(id);
    setFavIds((s) => {
      const n = new Set(s);
      was ? n.delete(id) : n.add(id);
      return n;
    });
    const { error } = was
      ? await unfavoriteConversation(supabase, id)
      : await favoriteConversation(supabase, id);
    if (error) {
      setFavIds((s) => {
        const n = new Set(s);
        was ? n.add(id) : n.delete(id);
        return n;
      });
    }
  }

  // Lock / unlock a specific chat. Both directions require the device auth gesture
  // (fingerprint / face / PIN) so only the device owner can change a chat's lock.
  async function toggleLock(id: string) {
    setMenuFor(null);
    const wasLocked = lockedIds.has(id);
    const ok = await deviceAuth.authenticate(wasLocked ? 'Unlock chat' : 'Lock chat');
    if (!ok) return;
    setLockedIds((s) => { const n = new Set(s); wasLocked ? n.delete(id) : n.add(id); return n; });
    if (!wasLocked && selectedConvId === id) setSelectedConvId(null);
    const { error } = wasLocked ? await unlockConversation(supabase, id) : await lockConversation(supabase, id);
    if (error) { // roll back
      setLockedIds((s) => { const n = new Set(s); wasLocked ? n.add(id) : n.delete(id); return n; });
    }
  }

  // Reveal / hide the Locked chats area. Revealing requires device auth once per
  // session; hiding is instant.
  async function toggleLockReveal() {
    if (locksRevealed) { setLocksRevealed(false); return; }
    const ok = await deviceAuth.authenticate('Unlock chats');
    if (ok) setLocksRevealed(true);
  }

  async function toggleMute(id: string) {
    setMenuFor(null);
    const wasMuted = mutedIds.has(id);
    setMutedIds((s) => { const n = new Set(s); wasMuted ? n.delete(id) : n.add(id); return n; });
    const { error } = wasMuted ? await unmuteConversation(supabase, id) : await muteConversation(supabase, id);
    if (error) {
      setMutedIds((s) => { const n = new Set(s); wasMuted ? n.add(id) : n.delete(id); return n; });
    }
  }

  function otherId(conv: ConversationSummary): string | null {
    if (conv.conversation.type !== 'direct') return null;
    return conv.participants.find((p) => p.id !== profile?.id)?.id ?? null;
  }

  async function toggleBlock(conv: ConversationSummary) {
    setMenuFor(null);
    const uid = otherId(conv);
    if (!uid) return;
    const wasBlocked = blockedIds.has(uid);
    if (!wasBlocked && !confirm('Block this user? They will no longer be able to reach you.')) return;
    setBlockedIds((s) => { const n = new Set(s); wasBlocked ? n.delete(uid) : n.add(uid); return n; });
    const { error } = wasBlocked ? await unblockUser(supabase, uid) : await blockUser(supabase, uid);
    if (error) {
      setBlockedIds((s) => { const n = new Set(s); wasBlocked ? n.add(uid) : n.delete(uid); return n; });
    }
  }

  async function reportConv(conv: ConversationSummary) {
    setMenuFor(null);
    const uid = otherId(conv);
    if (!uid) return;
    const reason = prompt('Report this user — what is the issue? (spam, abuse, harassment, other)');
    if (!reason || !reason.trim()) return;
    const { error } = await submitReport(supabase, 'user', uid, reason.trim());
    alert(error ? (error.message || 'Could not submit report.') : 'Report submitted. Our safety team will review it.');
  }

  // Sort: pinned first, then recent. Locked chats filtered out unless revealed.
  // Global chat-list search: filters conversations by title and runs a debounced
  // message search across all chats.
  const [chatFilter, setChatFilter] = useState('');
  const [msgHits, setMsgHits] = useState<MessageSearchHit[]>([]);
  // WhatsApp-class facet chips (mobile parity) — keep the primary strip short.
  type ListFilter = 'all' | 'unread' | 'groups' | 'favorites' | 'pinned' | 'streaks' | 'locked';
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [moreFilters, setMoreFilters] = useState(false);
  const filterQ = chatFilter.trim().toLowerCase();
  const convById = useMemo(() => {
    const m = new Map<string, ConversationSummary>();
    conversations.forEach((c) => m.set(c.conversation.id, c));
    return m;
  }, [conversations]);
  useEffect(() => {
    const q = chatFilter.trim();
    if (q.length < 2) { setMsgHits([]); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const hits = await searchAllMessages(supabase, q);
      if (alive) setMsgHits(hits.filter((h) => convById.has(h.conversationId)));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [chatFilter, convById]);

  const lockedCount = useMemo(
    () => conversations.filter((c) => lockedIds.has(c.conversation.id)).length,
    [conversations, lockedIds],
  );

  const visibleConvs = useMemo(() => {
    const list = conversations.filter((c) => {
      const id = c.conversation.id;
      // Locked chats stay hidden until unlocked this session (except Locked chip).
      if (!locksRevealed && listFilter !== 'locked' && lockedIds.has(id)) return false;
      if (filterQ && !c.title.toLowerCase().includes(filterQ)) return false;
      switch (listFilter) {
        case 'unread': return c.unreadCount > 0;
        case 'groups': return c.conversation.type === 'group';
        case 'favorites': return favIds.has(id);
        case 'pinned': return pinnedIds.has(id);
        case 'streaks': return (streaks[id]?.score ?? 0) > 0;
        case 'locked': return lockedIds.has(id);
        default: return true;
      }
    });
    const pinIndex = new Map(pinnedOrder.map((id, i) => [id, i]));
    return [...list].sort((a, b) => {
      const ai = pinIndex.has(a.conversation.id) ? pinIndex.get(a.conversation.id)! : 1e9;
      const bi = pinIndex.has(b.conversation.id) ? pinIndex.get(b.conversation.id)! : 1e9;
      if (ai !== bi) return ai - bi;
      const at = a.lastMessage?.created_at || a.conversation.created_at;
      const bt = b.lastMessage?.created_at || b.conversation.created_at;
      return new Date(bt).getTime() - new Date(at).getTime();
    });
  }, [conversations, pinnedOrder, lockedIds, locksRevealed, filterQ, listFilter, favIds, pinnedIds, streaks]);

  const selectedConv = conversations.find((c) => c.conversation.id === selectedConvId);

  function otherIsPremium(conv: ConversationSummary): boolean {
    if (conv.conversation.type !== 'direct') return false;
    const other = conv.participants.find((p) => p.id !== profile?.id);
    return other ? premiumUserIds.has(other.id) : false;
  }

  function otherOnline(conv: ConversationSummary): boolean {
    if (conv.conversation.type !== 'direct') return false;
    const other = conv.participants.find((p) => p.id !== profile?.id);
    return other ? onlineIds.has(other.id) : false;
  }

  // WhatsApp-style list timestamp + media-aware last-message preview.
  function lastMsgTime(conv: ConversationSummary): string {
    const t = conv.lastMessage?.created_at;
    if (!t) return '';
    const d = new Date(t);
    return isToday(d) ? format(d, 'h:mm a') : isYesterday(d) ? 'Yesterday' : format(d, 'MM/dd/yy');
  }
  function previewBody(conv: ConversationSummary): string {
    const m = conv.lastMessage;
    if (!m) return 'Tap to start chatting';
    if (m.is_deleted) return 'This message was deleted';
    // System notices (disappearing-messages on/off) show verbatim, no "You:" prefix.
    if (m.type === 'system') return m.content ?? '';
    if (m.type === 'image') return /\.gif(\?|#|$)/i.test(m.media_url ?? '') ? '🎞️ GIF' : '📷 Photo';
    if (m.type === 'audio') return '🎤 Voice message';
    if (m.type === 'video' || isVideoMessage(m)) return '🎥 Video';
    if (m.type === 'file') return m.content?.trim() ? `📄 ${m.content}` : '📄 Document';
    return m.content || '';
  }
  function previewMine(conv: ConversationSummary): boolean {
    const m = conv.lastMessage;
    return !!m && !m.is_deleted && m.type !== 'system' && m.sender_id === profile?.id;
  }
  function previewText(conv: ConversationSummary): string {
    const m = conv.lastMessage;
    const body = previewBody(conv);
    if (!m || m.is_deleted || m.type === 'system' || previewMine(conv)) return body;
    if (conv.conversation.type === 'group') {
      const s = conv.participants.find((p) => p.id === m.sender_id)?.display_name;
      return s ? `${s.split(' ')[0]}: ${body}` : body;
    }
    return body;
  }

  return (
    <div className={`app ${selectedConvId ? 'chat-open' : ''}`} onClick={() => { setMenuFor(null); setShowMenu(false); }}>
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>🎩 Lumixo{isPremium && <PremiumBadge compact />}</h2>
          <div className="sidebar-actions">
            {!isPremium && (
              <button onClick={openUpgrade} className="icon-btn upgrade-pill" title="Upgrade to Lumixo+" aria-label="Upgrade to Lumixo+">✦</button>
            )}
            <button onClick={() => setShowCommunities(true)} className="icon-btn" title="Communities" aria-label="Communities"><CommunitiesIcon /></button>
            <button onClick={() => setShowCalls(true)} className="icon-btn" title="Calls" aria-label="Calls"><PhoneIcon /></button>
            <button onClick={() => setShowSearch(!showSearch)} className="icon-btn" title="New chat" aria-label="New chat"><NewChatIcon /></button>
            <button onClick={() => setShowSettings(true)} className="icon-btn" title="Settings" aria-label="Settings"><SettingsIcon /></button>
            <div className="header-menu-wrap">
              <button
                className="icon-btn"
                onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }}
                title="Menu"
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={showMenu}
              ><MoreIcon /></button>
              {showMenu && (
                <div
                  className="conv-menu header-menu glass"
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button type="button" role="menuitem" onClick={() => { setShowMenu(false); setShowGroup(true); }}>New group</button>
                  <button type="button" role="menuitem" onClick={() => { setShowMenu(false); setShowStarred(true); }}>Starred messages</button>
                  <button type="button" role="menuitem" onClick={() => { setShowMenu(false); setShowSettings(true); }}>Settings</button>
                  <button type="button" role="menuitem" className="danger" onClick={() => { setShowMenu(false); signOut(supabase); }}>Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status strip (WhatsApp home parity) — under the Lumixo header. */}
        <StatusStrip />

        {showSearch && (
          <div className="search-panel">
            <input
              type="text"
              placeholder="Search by username or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              autoFocus
            />
            <button type="button" onClick={handleSearch} disabled={loading}>{loading ? '...' : 'Search'}</button>
            <div className="search-results">
              {searchQuery.trim() ? (
                <>
                  {searchResults.map((u) => (
                    <div key={u.id} className="search-result" onClick={() => handleStartChat(u)}>
                      <div className="avatar">{u.display_name?.[0] || '?'}</div>
                      <div className="result-info">
                        <div className="result-name">
                          {u.display_name || 'Unknown'}
                          {premiumUserIds.has(u.id) && <PremiumBadge compact />}
                        </div>
                        <div className="result-username">@{u.username || u.id.slice(0, 8)}</div>
                      </div>
                    </div>
                  ))}
                  {searchResults.length === 0 && !loading && <div className="no-results">No users found</div>}
                </>
              ) : (
                <>
                  {recentContacts.length > 0 && <div className="recent-label">RECENT CONTACTS</div>}
                  {recentContacts.map((r) => r.contact && (
                    <div key={r.contact.id} className="search-result" onClick={() => handleStartChat(r.contact)}>
                      <div className="avatar">{r.contact.display_name?.[0] || '?'}</div>
                      <div className="result-info">
                        <div className="result-name">
                          {r.contact.display_name || 'Lumixo user'}
                          {premiumUserIds.has(r.contact.id) && <PremiumBadge compact />}
                        </div>
                        <div className="result-username">@{r.contact.username || r.contact.id.slice(0, 8)}</div>
                      </div>
                      <button
                        type="button"
                        className="recent-remove"
                        title="Remove from recent contacts"
                        aria-label="Remove from recent contacts"
                        onClick={(e) => handleRemoveRecent(r.contact, e)}
                      >
                        <TrashIcon size={16} />
                      </button>
                    </div>
                  ))}
                  {recentContacts.length === 0 && (
                    <div className="no-results">No recent contacts yet. Search above to start your first chat.</div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Global search: filter chats by name + search all messages */}
        <div className="chatlist-search">
          <SearchIcon size={16} />
          <input
            type="text"
            placeholder="Search chats and messages"
            value={chatFilter}
            onChange={(e) => setChatFilter(e.target.value)}
          />
          {chatFilter && <button className="chatlist-search-clear" onClick={() => setChatFilter('')} aria-label="Clear search">✕</button>}
        </div>

        {/* Primary filter chips (mobile parity) — All / Unread / Groups / Favourites + More */}
        {!filterQ && (
          <div className="filter-chips" role="tablist" aria-label="Chat filters">
            {([
              { key: 'all' as const, label: 'All' },
              { key: 'unread' as const, label: 'Unread' },
              { key: 'groups' as const, label: 'Groups' },
              { key: 'favorites' as const, label: 'Favourites' },
            ]).map((chip) => (
              <button
                key={chip.key}
                type="button"
                role="tab"
                aria-selected={listFilter === chip.key}
                className={`filter-chip ${listFilter === chip.key ? 'active' : ''}`}
                onClick={() => { setListFilter(chip.key); setMoreFilters(false); }}
              >
                {chip.label}
              </button>
            ))}
            <button
              type="button"
              className={`filter-chip ${moreFilters || ['pinned', 'streaks', 'locked'].includes(listFilter) ? 'active' : ''}`}
              onClick={() => setMoreFilters((v) => !v)}
            >
              {(['pinned', 'streaks', 'locked'] as ListFilter[]).includes(listFilter) && !moreFilters
                ? ({ pinned: 'Pinned', streaks: 'Streaks', locked: 'Locked' } as Record<string, string>)[listFilter]
                : 'More'}
            </button>
          </div>
        )}
        {!filterQ && moreFilters && (
          <div className="filter-chips filter-chips-more" role="tablist" aria-label="More filters">
            {([
              { key: 'pinned' as const, label: 'Pinned' },
              { key: 'streaks' as const, label: 'Streaks' },
              { key: 'locked' as const, label: 'Locked' },
            ]).map((chip) => (
              <button
                key={chip.key}
                type="button"
                role="tab"
                aria-selected={listFilter === chip.key}
                className={`filter-chip ${listFilter === chip.key ? 'active' : ''}`}
                onClick={() => { setListFilter(chip.key); setMoreFilters(false); }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {lockedCount > 0 && (listFilter === 'locked' || !locksRevealed) && (
          <button className="locked-toggle" onClick={toggleLockReveal}>
            {locksRevealed ? '🔓 Hide locked chats' : `🔒 Locked chats (${lockedCount})`}
          </button>
        )}

        {msgHits.length > 0 && (
          <div className="msg-hits">
            <div className="msg-hits-head">Messages</div>
            {msgHits.slice(0, 12).map((h) => {
              const conv = convById.get(h.conversationId)!;
              return (
                <button key={h.message.id} className="msg-hit" onClick={() => { setSelectedConvId(h.conversationId); setChatFilter(''); }}>
                  <div className="avatar small">{conv.title[0]}</div>
                  <div className="msg-hit-info">
                    <div className="msg-hit-title">{conv.title}</div>
                    <div className="msg-hit-snippet">{h.message.content}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="conversation-list">
          {listHydrating && conversations.length === 0 ? (
            <ConvListSkeleton />
          ) : (
            visibleConvs.map((conv) => {
              const id = conv.conversation.id;
              return (
                <div
                  key={id}
                  className={`conversation-item ${selectedConvId === id ? 'active' : ''} ${lockedIds.has(id) ? 'is-locked' : ''} ${conv.unreadCount > 0 ? 'unread' : ''}`}
                  onClick={() => setSelectedConvId(id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedConvId(id);
                    }
                  }}
                >
                  <div className="avatar avatar-wrap">
                    {conv.title[0]}
                    {otherOnline(conv) && <span className="online-dot" />}
                    {(conv.conversation.disappear_seconds ?? 0) > 0 && (
                      <span className="disappear-badge" title="Disappearing messages on">⏳</span>
                    )}
                  </div>
                  <div className="conversation-info">
                    <div className="conversation-title">
                      {pinnedIds.has(id) && <span className="pin-mark">📌</span>}
                      {favIds.has(id) && <span className="pin-mark" title="Favourite">⭐</span>}
                      {conv.conversation.type === 'group' && <CommunitiesIcon size={14} className="group-mark" />}
                      <span className="conv-name">{conv.title}</span>
                      {otherIsPremium(conv) && <PremiumBadge compact />}
                      {mutedIds.has(id) && <span className="mute-mark" title="Muted">🔕</span>}
                      <span className="conversation-time">{lastMsgTime(conv)}</span>
                    </div>
                    <div className="conversation-bottom">
                      <div className="conversation-preview">
                        {previewMine(conv) && <span className="preview-ticks" aria-hidden>✓</span>}
                        {previewText(conv)}
                      </div>
                      {conv.conversation.type !== 'group' && streaks[id]?.tier && (
                        <span className="streak-mark" title={`Streak ${streaks[id].score}`}>{streaks[id].tier}</span>
                      )}
                      {conv.unreadCount > 0 && <span className="unread-badge">{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="conv-menu-btn"
                    onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === id ? null : id); }}
                  >⋯</button>
                  {menuFor === id && (
                    <div className="conv-menu glass" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => togglePin(id)}>{pinnedIds.has(id) ? 'Unpin chat' : '📌 Pin chat'}</button>
                      <button type="button" onClick={() => toggleFavorite(id)}>{favIds.has(id) ? '★ Remove from favourites' : '⭐ Add to favourites'}</button>
                      <button type="button" onClick={() => toggleLock(id)}>{lockedIds.has(id) ? '🔓 Unlock' : '🔒 Lock'}</button>
                      <button type="button" onClick={() => toggleMute(id)}>{mutedIds.has(id) ? '🔔 Unmute' : '🔕 Mute'}</button>
                      {otherId(conv) && (
                        <button type="button" onClick={() => reportConv(conv)}>🚩 Report</button>
                      )}
                      {otherId(conv) && (
                        <button type="button" className="danger" onClick={() => toggleBlock(conv)}>
                          {blockedIds.has(otherId(conv)!) ? 'Unblock' : '🚫 Block'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
          {!listHydrating && visibleConvs.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-title">
                {filterQ
                  ? 'No matching chats'
                  : listFilter !== 'all'
                  ? `No ${listFilter} chats`
                  : 'No conversations yet'}
              </div>
              <p className="empty-state-sub">
                {filterQ
                  ? 'Try a different search.'
                  : listFilter !== 'all'
                  ? 'Try another filter, or start a new chat.'
                  : 'Find someone you know and say hello.'}
              </p>
              <div className="empty-state-actions">
                <button type="button" className="empty-cta-primary" onClick={() => setShowSearch(true)}>
                  Start a chat
                </button>
                {listFilter === 'all' && !filterQ && (
                  <button type="button" className="empty-cta-secondary" onClick={() => setShowGroup(true)}>
                    Create a group
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="main-content">
        {selectedConv ? (
          <div key={selectedConv.conversation.id} style={{ height: '100%' }} className="chat-pane-enter">
            <Suspense fallback={<ChatSkeleton />}>
              <ChatView
                conversation={selectedConv}
                isOtherPremium={otherIsPremium(selectedConv)}
                onBack={() => setSelectedConvId(null)}
                onConversationGone={() => {
                  setSelectedConvId(null);
                  void loadConversations();
                }}
              />
            </Suspense>
          </div>
        ) : (
          <div key="empty" className="empty-chat">
            <div className="empty-chat-icon">💬</div>
            <h3>Welcome to Lumixo</h3>
            <p>Select a conversation or start a new chat</p>
            <button type="button" className="empty-cta-primary" onClick={() => setShowSearch(true)}>
              Start a chat
            </button>
          </div>
        )}
      </div>

      <Suspense fallback={null}>
          {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
          {showSettings && <SettingsModal onClose={() => setShowSettings(false)} onEditProfile={() => setShowProfile(true)} onHelp={() => setShowHelp(true)} onAdmin={() => setShowAdmin(true)} onModerator={() => setShowModerator(true)} onMailbox={() => setShowMailbox(true)} />}
          {showHelp && <HelpSupportModal onClose={() => setShowHelp(false)} />}
          {showAdmin && <AdminDashboard onClose={() => setShowAdmin(false)} />}
          {showModerator && <ModeratorDashboard onClose={() => setShowModerator(false)} />}
          {showMailbox && <Mailbox onClose={() => setShowMailbox(false)} />}
          {showCalls && <CallsView onClose={() => setShowCalls(false)} />}

          {showStarred && <StarredMessagesModal onClose={() => setShowStarred(false)} onOpenChat={(cid) => setSelectedConvId(cid)} />}
          {showCommunities && (
            <CommunitiesModal
              onClose={() => setShowCommunities(false)}
              onOpenChannel={async (cid) => { await loadConversations(); setSelectedConvId(cid); }}
            />
          )}
        {showGroup && (
          <GroupModal
            onClose={() => setShowGroup(false)}
            onCreated={(cid) => {
              loadConversations();
              setShowGroup(false);
              if (cid) setSelectedConvId(cid);
            }}
          />
        )}
        {groupInviteToken && (
          <JoinGroupInvite
            token={groupInviteToken}
            onClose={() => {
              setGroupInviteToken(null);
              try {
                window.history.replaceState({}, '', '/');
              } catch { /* ignore */ }
            }}
            onNeedAuth={() => {
              /* user must sign in; keep token in URL */
            }}
            onJoined={(cid) => {
              setGroupInviteToken(null);
              try {
                window.history.replaceState({}, '', '/');
              } catch { /* ignore */ }
              loadConversations();
              setSelectedConvId(cid);
            }}
          />
        )}
      </Suspense>

      <WebNotifications conversations={conversations} selectedConvId={selectedConvId} onOpenChat={(id) => setSelectedConvId(id)} />

      {/* Credit lives in Settings / About — not over the chat UI. */}
    </div>
  );
}

export function App() {
  return (
    <UpgradeProvider>
      <Suspense fallback={null}><AdminGate /></Suspense>
      <AppInner />
    </UpgradeProvider>
  );
}
