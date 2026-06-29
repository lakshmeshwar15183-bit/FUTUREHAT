// FUTUREHAT web — Chat view: messages, realtime, media, reactions, typing,
// presence, reply/forward/edit/delete, premium ghost mode, scheduling, AI, stickers.

import { useState, useEffect, useRef, useMemo, type FormEvent, type ChangeEvent, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from './AuthContext';
import { usePremium } from './PremiumContext';
import { usePresence } from './PresenceContext';
import { useUpgrade } from './premium/UpgradeProvider';
import { PremiumBadge } from './premium/PremiumBadge';
import { supabase } from './supabase';
import {
  getMessages, sendMessage, subscribeToMessages, markMessageAsRead, uploadMedia,
  getReceipts, subscribeToReceipts, getReactions, toggleReaction, subscribeToReactions,
  createTypingChannel, editMessage, deleteMessage, forwardMessage, getMyConversations,
} from '@shared/api';
import { scheduleMessage, getScheduledMessages, dispatchDueMessages } from '@shared/premiumApi';
import { createPoll, getPolls } from '@shared/communitiesApi';
import type { Poll } from '@shared/communitiesApi';
import { aiRewrite, aiTranslate, aiSummarize, aiSmartReply } from '@shared/aiClient';
import { PollCard } from './communities/PollCard';
import { FREE_LIMITS, PREMIUM_LIMITS } from '@shared/premium/features';
import type { ConversationSummary, Message, MessageReceipt, MessageReaction } from '@shared/types';
import { formatDistanceToNow } from 'date-fns';
import { bubbleMine, bubbleTheirs, spring } from './motion';
import { STICKERS } from './premium/stickers';
import './ChatView.css';

interface Props {
  conversation: ConversationSummary;
  isOtherPremium?: boolean;
  onBack: () => void;
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const PREMIUM_EMOJIS = ['🔥', '🎉', '🥳', '💯', '👀', '🤝', '✨', '🫶'];
const LANGUAGES = ['English', 'Hindi', 'Spanish', 'French', 'Japanese', 'German'];
const TYPING_TIMEOUT = 2500;

export function ChatView({ conversation, isOtherPremium, onBack }: Props) {
  const { profile } = useAuth();
  const { isPremium, preferences } = usePremium();
  const { onlineIds } = usePresence();
  const { open: openUpgrade } = useUpgrade();
  const convId = conversation.conversation.id;
  const isGroup = conversation.conversation.type === 'group';
  const ghost = isPremium && preferences.ghost_mode;
  const otherUser = conversation.participants.find((p) => p.id !== profile?.id);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [receipts, setReceipts] = useState<MessageReceipt[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [actionFor, setActionFor] = useState<string | null>(null);

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

  // in-conversation search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // polls
  const [polls, setPolls] = useState<Poll[]>([]);
  const [showPolls, setShowPolls] = useState(true);
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollMultiple, setPollMultiple] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  // Read ghost mode through a ref inside realtime callbacks so toggling it does
  // NOT tear down and re-subscribe the channels (which could drop inserts in the gap).
  const ghostRef = useRef(ghost);
  useEffect(() => { ghostRef.current = ghost; }, [ghost]);
  const notifyTypingRef = useRef<((p: { userId: string; name: string; typing: boolean }) => void) | null>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const upsertMessage = (m: Message) =>
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev.map((x) => (x.id === m.id ? m : x)) : [...prev, m]));

  useEffect(() => {
    let active = true;
    setMessages([]); setReceipts([]); setReactions([]); setTypingUsers({});
    setSuggestions([]); setSummary(null); setReplyTo(null); setEditing(null);
    setPolls([]); setPollComposerOpen(false);
    setSearchOpen(false); setSearchTerm('');

    (async () => {
      const msgs = await getMessages(supabase, convId);
      if (!active) return;
      setMessages(msgs);
      const ids = msgs.map((m) => m.id);
      setReceipts(await getReceipts(supabase, ids));
      setReactions(await getReactions(supabase, ids));
      if (!ghostRef.current) msgs.forEach((m) => { if (m.sender_id !== profile?.id) void markMessageAsRead(supabase, m.id).catch(() => {}); });
    })().catch(() => {});

    getScheduledMessages(supabase, convId).then((s) => setScheduledCount(s.length)).catch(() => {});
    getPolls(supabase, convId).then((p) => { if (active) setPolls(p); }).catch(() => {});

    const msgChannel = subscribeToMessages(
      supabase, convId,
      (newMsg) => {
        setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]));
        if (!ghostRef.current && newMsg.sender_id !== profile?.id) void markMessageAsRead(supabase, newMsg.id).catch(() => {});
      },
      (updated) => setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m))),
    );
    const receiptChannel = subscribeToReceipts(supabase, convId, (r) => {
      setReceipts((prev) => {
        const rest = prev.filter((p) => !(p.message_id === r.message_id && p.user_id === r.user_id));
        return [...rest, r];
      });
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

  const readMessageIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of receipts) if (r.status === 'read' && r.user_id !== profile?.id) set.add(r.message_id);
    return set;
  }, [receipts, profile?.id]);

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
  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    setInput(e.target.value);
    broadcastTyping(true);
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    typingStopRef.current = setTimeout(() => broadcastTyping(false), TYPING_TIMEOUT);
  }
  function stopTyping() { if (typingStopRef.current) clearTimeout(typingStopRef.current); broadcastTyping(false); }

  // ── Send / edit ──────────────────────────────────────────────────────────────
  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    const content = input.trim();
    setInput(''); setSuggestions([]); stopTyping();

    if (editing) {
      const target = editing;
      setEditing(null);
      const { message, error } = await editMessage(supabase, target.id, content);
      if (error) { setToast(error.message); setInput(content); setEditing(target); }
      else if (message) upsertMessage(message);
      setSending(false);
      return;
    }

    const reply = replyTo;
    setReplyTo(null);
    const { message, error } = await sendMessage(supabase, convId, content, 'text', undefined, reply?.id);
    if (error || !message) { setInput(content); setReplyTo(reply); setToast(error?.message || 'Message failed to send'); }
    else upsertMessage(message);
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
  async function doDelete(m: Message) {
    setActionFor(null);
    const prev = messages;
    setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, is_deleted: true, content: null, media_url: null } : x)));
    const { error } = await deleteMessage(supabase, m.id);
    if (error) { setMessages(prev); setToast(error.message); }
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
    const file = e.target.files?.[0];
    if (!file || uploading) return;
    const limit = isPremium ? PREMIUM_LIMITS.uploadBytes : FREE_LIMITS.uploadBytes;
    if (file.size > limit) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!isPremium) { openUpgrade(); return; }
      setToast('File too large.'); return;
    }
    setUploading(true);
    try {
      const { url, error } = await uploadMedia(supabase, convId, file, file.name);
      if (error) throw error;
      if (!url) throw new Error('No URL returned');
      const type = file.type.startsWith('image/') ? 'image' : 'file';
      const { message } = await sendMessage(supabase, convId, type === 'image' ? '' : file.name, type, url);
      if (message) upsertMessage(message);
    } catch (err: any) {
      setToast(err.message || 'Failed to upload file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function sendSticker(url: string) {
    setStickersOpen(false);
    const { message, error } = await sendMessage(supabase, convId, '', 'image', url);
    if (error) setToast(error.message); else if (message) upsertMessage(message);
  }

  // ── AI ───────────────────────────────────────────────────────────────────────
  function transcript(): string {
    return messages.slice(-20).filter((m) => !m.is_deleted).map((m) => {
      const who = m.sender_id === profile?.id ? 'Me' : (conversation.participants.find((p) => p.id === m.sender_id)?.display_name || 'Them');
      return `${who}: ${m.content ?? '[media]'}`;
    }).join('\n');
  }
  async function runAi(fn: () => Promise<void>) {
    if (!isPremium) { setAiOpen(false); return openUpgrade(); }
    setAiBusy(true);
    try { await fn(); } catch (e: any) { setToast(e.message || 'AI request failed'); } finally { setAiBusy(false); }
  }
  const doRewrite = () => runAi(async () => { if (!input.trim()) { setToast('Type a draft to rewrite'); return; } setInput(await aiRewrite(supabase, input.trim())); setAiOpen(false); });
  const doTranslate = (lang: string) => runAi(async () => { if (!input.trim()) { setToast('Type a draft to translate'); return; } setInput(await aiTranslate(supabase, input.trim(), lang)); setTranslateOpen(false); setAiOpen(false); });
  const doSmartReply = () => runAi(async () => { setSuggestions(await aiSmartReply(supabase, transcript())); setAiOpen(false); });
  const doSummarize = () => runAi(async () => { setSummary(await aiSummarize(supabase, transcript())); setAiOpen(false); });

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

  // ── Polls ──────────────────────────────────────────────────────────────────────
  function setPollOption(i: number, val: string) {
    setPollOptions((opts) => opts.map((o, idx) => (idx === i ? val : o)));
  }
  async function handleCreatePoll() {
    const question = pollQuestion.trim();
    const options = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!question) { setToast('Add a poll question'); return; }
    if (options.length < 2) { setToast('Add at least two options'); return; }
    const { poll, error } = await createPoll(supabase, convId, question, options, pollMultiple);
    if (error || !poll) { setToast(error?.message || 'Could not create poll'); return; }
    setPolls((p) => [poll, ...p]);
    setPollQuestion(''); setPollOptions(['', '']); setPollMultiple(false); setPollComposerOpen(false);
    setShowPolls(true);
    setToast('Poll created');
  }

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

  const emojiSet = isPremium ? [...QUICK_EMOJIS, ...PREMIUM_EMOJIS] : QUICK_EMOJIS;
  const repliedOf = (m: Message) => (m.reply_to ? messages.find((x) => x.id === m.reply_to) : null);

  // In-conversation search: when active, only matching messages are shown.
  const search = searchTerm.trim().toLowerCase();
  const displayMessages = useMemo(
    () => (search ? messages.filter((m) => !m.is_deleted && (m.content ?? '').toLowerCase().includes(search)) : messages),
    [messages, search],
  );
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
        <div className="chat-header-info">
          <div className="chat-title">{conversation.title}{isOtherPremium && <PremiumBadge compact />}</div>
          <div className={`chat-subtitle ${typingNames.length ? 'typing' : ''}`}>{subtitle}</div>
        </div>
        <button className="header-icon-btn" title="Search messages"
          onClick={() => { setSearchOpen((v) => !v); if (searchOpen) setSearchTerm(''); }}>🔍</button>
        {ghost && <span className="ghost-indicator" title="Ghost mode on">👻</span>}
      </div>

      <AnimatePresence>
        {searchOpen && (
          <motion.div className="chat-search-bar" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <input autoFocus type="text" placeholder="Search in this conversation…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            {search && <span className="chat-search-count">{displayMessages.length} match{displayMessages.length === 1 ? '' : 'es'}</span>}
            <button onClick={() => { setSearchOpen(false); setSearchTerm(''); }}>✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {summary && (
          <motion.div className="ai-summary" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="ai-summary-head"><span>📋 Summary</span><button onClick={() => setSummary(null)}>✕</button></div>
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
                {polls.map((p) => <PollCard key={p.id} poll={p} myId={profile?.id} />)}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={messagesContainerRef} className="messages-container" onClick={() => { setPickerFor(null); setActionFor(null); setAiOpen(false); setStickersOpen(false); }}>
        <AnimatePresence initial={false}>
          {displayMessages.map((msg) => {
            const isMine = msg.sender_id === profile?.id;
            const sender = conversation.participants.find((p) => p.id === msg.sender_id);
            const msgReactions = reactionsByMessage[msg.id] || [];
            const replied = repliedOf(msg);
            return (
              <motion.div key={msg.id} layout variants={isMine ? bubbleMine : bubbleTheirs} initial="initial" animate="animate"
                className={`message ${isMine ? 'mine' : 'theirs'}`}>
                {!isMine && isGroup && !msg.is_deleted && <div className="message-sender">{sender?.display_name || 'Unknown'}</div>}
                <div className="message-row">
                  <div className={`message-bubble ${msg.is_deleted ? 'deleted' : ''}`}>
                    {msg.is_deleted ? (
                      <div className="message-text deleted-text">🚫 This message was deleted</div>
                    ) : (
                      <>
                        {replied && (
                          <div className="reply-quote">
                            <span className="reply-quote-name">
                              {replied.sender_id === profile?.id ? 'You' : (conversation.participants.find((p) => p.id === replied.sender_id)?.display_name || 'Unknown')}
                            </span>
                            <span className="reply-quote-text">{replied.content || '[media]'}</span>
                          </div>
                        )}
                        {msg.type === 'image' && msg.media_url && <img src={msg.media_url} alt="Attachment" className="message-image" />}
                        {msg.type === 'file' && msg.media_url && (
                          <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="message-file">📎 {msg.content || 'File'}</a>
                        )}
                        {(msg.type === 'text' || msg.content) && <div className="message-text">{highlight(msg.content ?? '')}</div>}
                        <div className="message-time">
                          {msg.edited_at && <span className="edited-tag">edited</span>}
                          {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                          {isMine && (
                            <motion.span key={readMessageIds.has(msg.id) ? 'read' : 'sent'} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring}
                              className={`read-receipt ${readMessageIds.has(msg.id) ? 'read' : ''}`}>
                              {readMessageIds.has(msg.id) ? '✓✓' : '✓'}
                            </motion.span>
                          )}
                        </div>
                        {msgReactions.length > 0 && (
                          <div className="reaction-pills">
                            {msgReactions.map((r) => (
                              <motion.button key={r.emoji} layout initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring}
                                className={`reaction-pill ${r.mine ? 'mine' : ''}`} onClick={(e) => { e.stopPropagation(); handleReact(msg.id, r.emoji); }}>
                                {r.emoji} {r.count}
                              </motion.button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {!msg.is_deleted && (
                    <div className="msg-tools">
                      <button className="react-trigger" onClick={(e) => { e.stopPropagation(); setActionFor(null); setPickerFor((c) => (c === msg.id ? null : msg.id)); }} title="React">☺</button>
                      <button className="react-trigger" onClick={(e) => { e.stopPropagation(); setPickerFor(null); setActionFor((c) => (c === msg.id ? null : msg.id)); }} title="More">⋮</button>
                    </div>
                  )}

                  <AnimatePresence>
                    {pickerFor === msg.id && (
                      <motion.div className="emoji-picker glass" initial={{ opacity: 0, y: 6, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} onClick={(e) => e.stopPropagation()}>
                        {emojiSet.map((emoji) => (<motion.button key={emoji} whileHover={{ scale: 1.3 }} onClick={() => handleReact(msg.id, emoji)}>{emoji}</motion.button>))}
                      </motion.div>
                    )}
                    {actionFor === msg.id && (
                      <motion.div className="action-menu glass" initial={{ opacity: 0, y: 6, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => startReply(msg)}>↩︎ Reply</button>
                        <button onClick={() => openForward(msg)}>↪︎ Forward</button>
                        {msg.content && <button onClick={() => copyText(msg)}>⧉ Copy</button>}
                        {isMine && msg.type === 'text' && <button onClick={() => startEdit(msg)}>✎ Edit</button>}
                        {isMine && <button className="danger" onClick={() => doDelete(msg)}>🗑 Delete</button>}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {search && displayMessages.length === 0 && <div className="empty-state">No messages match “{searchTerm.trim()}”.</div>}
        {uploading && <div className="message mine"><div className="message-bubble uploading">Uploading...</div></div>}
        <div ref={messagesEndRef} />
      </div>

      {/* Smart reply suggestions */}
      <AnimatePresence>
        {suggestions.length > 0 && (
          <motion.div className="suggestion-bar" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {suggestions.map((s, i) => (<button key={i} className="suggestion-chip" onClick={() => { setInput(s); setSuggestions([]); }}>{s}</button>))}
            <button className="suggestion-dismiss" onClick={() => setSuggestions([])}>✕</button>
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
            <button onClick={() => { setReplyTo(null); setEditing(null); if (editing) setInput(''); }}>✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sticker picker */}
      <AnimatePresence>
        {stickersOpen && (
          <motion.div className="sticker-pop glass" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {STICKERS.map((s) => (<button key={s.id} onClick={() => sendSticker(s.url)} title={s.id}><img src={s.url} alt={s.id} /></button>))}
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
        <input ref={fileInputRef} type="file" onChange={handleFileUpload} style={{ display: 'none' }} disabled={uploading} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="attach-btn" title="Attach file">📎</button>

        <button type="button" className={`tool-btn ${isPremium ? '' : 'locked'}`} title="Stickers"
          onClick={() => (isPremium ? (setStickersOpen((v) => !v), setAiOpen(false)) : openUpgrade())}>🧩</button>

        <div className="ai-wrap">
          <button type="button" className={`tool-btn ${isPremium ? '' : 'locked'}`} title="AI tools" onClick={() => (isPremium ? setAiOpen((v) => !v) : openUpgrade())}>✨</button>
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

        <button type="button" className="tool-btn" title="Create poll" onClick={() => { setPollComposerOpen((v) => !v); setScheduleOpen(false); setStickersOpen(false); setAiOpen(false); }}>📊</button>

        <button type="button" className={`tool-btn ${isPremium ? '' : 'locked'}`} title="Schedule" onClick={() => (isPremium ? setScheduleOpen((v) => !v) : openUpgrade())}>
          ⏰{scheduledCount > 0 && <span className="sched-badge">{scheduledCount}</span>}
        </button>

        <input type="text" placeholder={editing ? 'Edit your message…' : 'Type a message'} value={input} onChange={handleInputChange} onBlur={stopTyping} disabled={sending || uploading} />
        <motion.button whileTap={{ scale: 0.9 }} type="submit" disabled={!input.trim() || sending || uploading}>{editing ? '✓' : '➤'}</motion.button>
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
        {toast && (<motion.div className="chat-toast glass" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{toast}</motion.div>)}
      </AnimatePresence>
    </div>
  );
}
