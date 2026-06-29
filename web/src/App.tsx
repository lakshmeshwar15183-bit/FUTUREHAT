// FUTUREHAT web — main app (conversation list + chat) with premium wiring.

import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from './AuthContext';
import { usePremium } from './PremiumContext';
import { usePresence } from './PresenceContext';
import { UpgradeProvider, useUpgrade } from './premium/UpgradeProvider';
import { PremiumBadge } from './premium/PremiumBadge';
import { supabase } from './supabase';
import { signOut, getMyConversations, searchProfiles, startDirectConversation } from '@shared/api';
import {
  getPinnedIds, pinConversation, unpinConversation,
  getHiddenIds, hideConversation, unhideConversation,
} from '@shared/premiumApi';
import {
  getMutedIds, muteConversation, unmuteConversation,
  getBlockedIds, blockUser, unblockUser, submitReport,
} from '@shared/supportApi';
import { FREE_LIMITS } from '@shared/premium/features';
import type { ConversationSummary, Profile } from '@shared/types';
import { ChatView } from './ChatView';
import { listItem, spring } from './motion';
import './App.css';

// Modals are lazy — they're off the critical path and keep the initial bundle small.
const ProfileModal = lazy(() => import('./ProfileModal').then((m) => ({ default: m.ProfileModal })));
const GroupModal = lazy(() => import('./GroupModal').then((m) => ({ default: m.GroupModal })));
const StatusView = lazy(() => import('./StatusView').then((m) => ({ default: m.StatusView })));
const SettingsModal = lazy(() => import('./premium/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const HelpSupportModal = lazy(() => import('./support/HelpSupportModal').then((m) => ({ default: m.HelpSupportModal })));

function AppInner() {
  const { profile } = useAuth();
  const { isPremium, premiumUserIds } = usePremium();
  const { onlineIds } = usePresence();
  const { open: openUpgrade } = useUpgrade();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    loadConversations();
    getPinnedIds(supabase).then((ids) => { if (mountedRef.current) setPinnedIds(new Set(ids)); }).catch(() => {});
    getHiddenIds(supabase).then((ids) => { if (mountedRef.current) setHiddenIds(new Set(ids)); }).catch(() => {});
    getMutedIds(supabase).then((ids) => { if (mountedRef.current) setMutedIds(new Set(ids)); }).catch(() => {});
    getBlockedIds(supabase).then((ids) => { if (mountedRef.current) setBlockedIds(new Set(ids)); }).catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  async function loadConversations() {
    try {
      const convs = await getMyConversations(supabase);
      if (mountedRef.current) setConversations(convs);
    } catch { /* transient network error — keep prior list */ }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setLoading(true);
    const results = await searchProfiles(supabase, searchQuery);
    setSearchResults(results.filter((p) => p.id !== profile?.id));
    setLoading(false);
  }

  async function handleStartChat(user: Profile) {
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
    if (!wasPinned && !isPremium && pinnedIds.size >= FREE_LIMITS.pinnedChats) return openUpgrade();
    // optimistic
    setPinnedIds((s) => { const n = new Set(s); wasPinned ? n.delete(id) : n.add(id); return n; });
    const { error } = wasPinned ? await unpinConversation(supabase, id) : await pinConversation(supabase, id);
    if (error) { // roll back
      setPinnedIds((s) => { const n = new Set(s); wasPinned ? n.add(id) : n.delete(id); return n; });
    }
  }

  async function toggleHide(id: string) {
    setMenuFor(null);
    const wasHidden = hiddenIds.has(id);
    if (!wasHidden && !isPremium) return openUpgrade();
    setHiddenIds((s) => { const n = new Set(s); wasHidden ? n.delete(id) : n.add(id); return n; });
    if (!wasHidden && selectedConvId === id) setSelectedConvId(null);
    const { error } = wasHidden ? await unhideConversation(supabase, id) : await hideConversation(supabase, id);
    if (error) { // roll back
      setHiddenIds((s) => { const n = new Set(s); wasHidden ? n.add(id) : n.delete(id); return n; });
    }
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

  // Sort: pinned first, then recent. Hidden filtered unless revealing.
  const visibleConvs = useMemo(() => {
    const list = conversations.filter((c) => showHidden || !hiddenIds.has(c.conversation.id));
    return [...list].sort((a, b) => {
      const ap = pinnedIds.has(a.conversation.id) ? 1 : 0;
      const bp = pinnedIds.has(b.conversation.id) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const at = a.lastMessage?.created_at || a.conversation.created_at;
      const bt = b.lastMessage?.created_at || b.conversation.created_at;
      return new Date(bt).getTime() - new Date(at).getTime();
    });
  }, [conversations, pinnedIds, hiddenIds, showHidden]);

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

  return (
    <div className={`app ${selectedConvId ? 'chat-open' : ''}`} onClick={() => setMenuFor(null)}>
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>🎩 FUTUREHAT{isPremium && <PremiumBadge compact />}</h2>
          <div className="sidebar-actions">
            {!isPremium && (
              <button onClick={openUpgrade} className="icon-btn upgrade-pill" title="Upgrade to FUTUREHAT+">✦</button>
            )}
            <button onClick={() => setShowStatus(true)} className="icon-btn" title="Status">📸</button>
            <button onClick={() => setShowGroup(true)} className="icon-btn" title="New group">👥</button>
            <button onClick={() => setShowSearch(!showSearch)} className="icon-btn" title="New chat">➕</button>
            <button onClick={() => setShowSettings(true)} className="icon-btn" title="Settings">⚙️</button>
            <button onClick={() => signOut(supabase)} className="icon-btn" title="Sign out">🚪</button>
          </div>
        </div>

        <AnimatePresence>
          {showSearch && (
            <motion.div className="search-panel" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              <input
                type="text"
                placeholder="Search by username or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                autoFocus
              />
              <button onClick={handleSearch} disabled={loading}>{loading ? '...' : 'Search'}</button>
              <div className="search-results">
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
                {searchResults.length === 0 && searchQuery && !loading && <div className="no-results">No users found</div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {hiddenIds.size > 0 && (
          <button className="hidden-toggle" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? 'Hide private chats' : `Show hidden chats (${hiddenIds.size})`}
          </button>
        )}

        <div className="conversation-list">
          <AnimatePresence initial={false}>
            {visibleConvs.map((conv) => {
              const id = conv.conversation.id;
              return (
                <motion.div
                  key={id}
                  layout
                  variants={listItem}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className={`conversation-item ${selectedConvId === id ? 'active' : ''} ${hiddenIds.has(id) ? 'is-hidden' : ''}`}
                  onClick={() => setSelectedConvId(id)}
                >
                  <div className="avatar avatar-wrap">
                    {conv.title[0]}
                    {otherOnline(conv) && <span className="online-dot" />}
                  </div>
                  <div className="conversation-info">
                    <div className="conversation-title">
                      {pinnedIds.has(id) && <span className="pin-mark">📌</span>}
                      {conv.title}
                      {otherIsPremium(conv) && <PremiumBadge compact />}
                      {mutedIds.has(id) && <span className="mute-mark" title="Muted">🔕</span>}
                    </div>
                    <div className="conversation-preview">{conv.lastMessage?.content || 'No messages yet'}</div>
                  </div>
                  <button
                    className="conv-menu-btn"
                    onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === id ? null : id); }}
                  >⋯</button>
                  <AnimatePresence>
                    {menuFor === id && (
                      <motion.div className="conv-menu glass" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                        onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => togglePin(id)}>{pinnedIds.has(id) ? 'Unpin' : '📌 Pin'}</button>
                        <button onClick={() => toggleHide(id)}>{hiddenIds.has(id) ? 'Unhide' : '🙈 Hide'}</button>
                        <button onClick={() => toggleMute(id)}>{mutedIds.has(id) ? '🔔 Unmute' : '🔕 Mute'}</button>
                        {otherId(conv) && (
                          <button onClick={() => reportConv(conv)}>🚩 Report</button>
                        )}
                        {otherId(conv) && (
                          <button className="danger" onClick={() => toggleBlock(conv)}>
                            {blockedIds.has(otherId(conv)!) ? 'Unblock' : '🚫 Block'}
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {visibleConvs.length === 0 && <div className="empty-state">No conversations yet. Start a new chat!</div>}
        </div>
      </div>

      <div className="main-content">
        <AnimatePresence mode="wait">
          {selectedConv ? (
            <motion.div key={selectedConv.conversation.id} style={{ height: '100%' }}
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={spring}>
              <ChatView
                conversation={selectedConv}
                isOtherPremium={otherIsPremium(selectedConv)}
                onBack={() => setSelectedConvId(null)}
              />
            </motion.div>
          ) : (
            <motion.div key="empty" className="empty-chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <motion.div className="empty-chat-icon" animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>💬</motion.div>
              <h3>Welcome to FUTUREHAT</h3>
              <p>Select a conversation or start a new chat</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Suspense fallback={null}>
        <AnimatePresence>
          {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
          {showSettings && <SettingsModal onClose={() => setShowSettings(false)} onEditProfile={() => setShowProfile(true)} onHelp={() => setShowHelp(true)} />}
          {showHelp && <HelpSupportModal onClose={() => setShowHelp(false)} />}
        </AnimatePresence>
        {showGroup && <GroupModal onClose={() => setShowGroup(false)} onCreated={() => { loadConversations(); setShowGroup(false); }} />}
        {showStatus && <StatusView onClose={() => setShowStatus(false)} />}
      </Suspense>

      <div className="app-credit">Developed by LAKSHMESHWAR PANDEY</div>
    </div>
  );
}

export function App() {
  return (
    <UpgradeProvider>
      <AppInner />
    </UpgradeProvider>
  );
}
