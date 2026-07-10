// Lumixo web — Calls module (WhatsApp parity with mobile CallsScreen).
// A modal reached from the sidebar phone icon. Grouped call history, instant
// search, multi-select with an action bar, per-row + bulk delete (delete-for-me),
// overflow menu (Clear Call Log / Scheduled Calls / Call Settings), empty state,
// a FAB contact picker, keyset pagination and realtime. Sub-panels (Call detail,
// Scheduled calls, Call settings) live here to keep wiring to a single import.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { getCurrentUser, getMyConversations } from '@shared/api';
import {
  getCallHistoryV2, groupCalls, deleteCallLogs, clearCallLog, subscribeCallChanges,
  getScheduledCalls, scheduleCall, cancelScheduledCall, subscribeScheduledCalls,
} from '@shared/callsApi';
import { getCallSettings, setCallSettings, DEFAULT_CALL_SETTINGS } from '@shared/callSettingsApi';
import { blockUser, submitReport } from '@shared/supportApi';
import type {
  CallGroup, CallHistoryItem, ConversationSummary, ScheduledCall, CallSettings, CallType,
} from '@shared/types';
import { useCall } from './CallContext';
import { modalBackdrop, modalPanel } from '../motion';
import { PhoneIcon, VideoIcon, TrashIcon, SearchIcon, PlusIcon } from '../Icons';
import './Calls.css';

const PAGE = 60;

function ts(iso: string): string {
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

type Panel = 'list' | 'scheduled' | 'settings';

export function CallsView({ onClose }: { onClose: () => void }) {
  const { startCall } = useCall();
  const [items, setItems] = useState<CallHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [search, setSearch] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('list');
  const [detail, setDetail] = useState<CallGroup | null>(null);
  const [picker, setPicker] = useState(false);
  const meRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await getCallHistoryV2(supabase, { limit: PAGE });
      setItems(rows);
      setReachedEnd(rows.length < PAGE);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { getCurrentUser(supabase).then((u) => { meRef.current = u?.id ?? null; }); load(); }, [load]);
  useEffect(() => { const s = subscribeCallChanges(supabase, load); return () => s.unsubscribe(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (detail) setDetail(null); else if (panel !== 'list') setPanel('list'); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, panel, detail]);

  async function loadMore() {
    if (reachedEnd || !items.length) return;
    const before = items[items.length - 1].started_at;
    const older = await getCallHistoryV2(supabase, { limit: PAGE, before }).catch(() => [] as CallHistoryItem[]);
    if (older.length) setItems((cur) => {
      const seen = new Set(cur.map((c) => c.id));
      return [...cur, ...older.filter((o) => !seen.has(o.id))];
    });
    if (older.length < PAGE) setReachedEnd(true);
  }

  const groups = useMemo(() => {
    const g = groupCalls(items);
    const q = search.trim().toLowerCase();
    return q ? g.filter((x) => x.title.toLowerCase().includes(q) || (x.peer_username ?? '').toLowerCase().includes(q)) : g;
  }, [items, search]);

  const cancelSelect = () => { setSelecting(false); setSelected(new Set()); };
  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  async function removeIds(ids: string[]) {
    setItems((cur) => cur.filter((it) => !ids.includes(it.id)));
    await deleteCallLogs(supabase, ids).catch(() => {});
    load();
  }
  function deleteSelected() {
    const ids = groups.filter((g) => selected.has(g.key)).flatMap((g) => g.callIds);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${selected.size} selected call log(s)? Removed only from your history.`)) return;
    cancelSelect(); removeIds(ids);
  }
  function clearAll() {
    setMenuOpen(false);
    if (!window.confirm('Clear your entire call history? Only affects you — contacts and chats are not deleted.')) return;
    setItems([]); clearCallLog(supabase).catch(() => {}).then(load);
  }

  async function place(conv: ConversationSummary, type: CallType) {
    setPicker(false);
    const peer = conv.participants.find((p) => p.id !== meRef.current) ?? conv.participants[0];
    startCall(conv.conversation.id, type, conv.title || peer?.display_name || 'Lumixo user');
  }

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="calls-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        {detail ? (
          <CallDetail group={detail} onBack={() => setDetail(null)}
            onCall={(t) => startCall(detail.conversation_id, t, detail.title)}
            onDeleteLog={() => { removeIds(detail.callIds); setDetail(null); }} />
        ) : panel === 'scheduled' ? (
          <ScheduledCalls onBack={() => setPanel('list')} />
        ) : panel === 'settings' ? (
          <CallSettingsPanel onBack={() => setPanel('list')} />
        ) : (
          <>
            {selecting ? (
              <div className="calls-head selecting">
                <button className="calls-icon-btn" onClick={cancelSelect} aria-label="Cancel">✕</button>
                <strong>{selected.size} selected</strong>
                <div className="calls-head-actions">
                  <button className="calls-icon-btn" title="Select all" onClick={() => setSelected(new Set(groups.map((g) => g.key)))}>☑</button>
                  <button className="calls-icon-btn" title="Delete" onClick={deleteSelected}><TrashIcon size={18} /></button>
                </div>
              </div>
            ) : (
              <div className="calls-head">
                <h2>Calls</h2>
                <div className="calls-head-actions">
                  <div className="header-menu-wrap">
                    <button className="calls-icon-btn" title="Menu" onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }} aria-haspopup="menu">⋮</button>
                    {menuOpen && (
                      <div className="conv-menu header-menu glass" role="menu" onClick={(e) => e.stopPropagation()}>
                        <button role="menuitem" className="danger" onClick={clearAll}>Clear call log</button>
                        <button role="menuitem" onClick={() => { setMenuOpen(false); setPanel('scheduled'); }}>Scheduled calls</button>
                        <button role="menuitem" onClick={() => { setMenuOpen(false); setPanel('settings'); }}>Call settings</button>
                      </div>
                    )}
                  </div>
                  <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
                </div>
              </div>
            )}

            <div className="calls-search">
              <SearchIcon size={16} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search calls" />
            </div>

            <div className="calls-list" onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadMore();
            }}>
              {loading && <div className="calls-empty">Loading…</div>}
              {!loading && groups.length === 0 && (
                <div className="calls-empty">
                  <div className="calls-empty-illus"><PhoneIcon size={40} /></div>
                  <div className="calls-empty-title">No recent calls</div>
                  <div className="calls-empty-sub">Start a voice or video call from any chat, or use the button below.</div>
                </div>
              )}
              {groups.map((g) => {
                const sel = selected.has(g.key);
                const out = g.latest.direction === 'outgoing';
                return (
                  <div
                    key={g.key}
                    className={`calls-row ${sel ? 'sel' : ''} ${g.anyMissed ? 'missed' : ''}`}
                    onClick={() => (selecting ? toggle(g.key) : setDetail(g))}
                    onContextMenu={(e) => { e.preventDefault(); setSelecting(true); toggle(g.key); }}
                  >
                    {selecting && <span className={`calls-check ${sel ? 'on' : ''}`}>{sel ? '✓' : ''}</span>}
                    <div className="calls-avatar" style={g.peer_avatar ? { backgroundImage: `url(${g.peer_avatar})` } : undefined}>
                      {!g.peer_avatar && (g.title[0]?.toUpperCase() || '?')}
                    </div>
                    <div className="calls-row-main">
                      <div className="calls-name">{g.title}{g.count > 1 ? ` (${g.count})` : ''}</div>
                      <div className="calls-meta">
                        <span className={`calls-dir ${out ? 'out' : g.anyMissed ? 'miss' : 'in'}`}>{out ? '↗' : '↙'}</span>
                        {ts(g.latest.started_at)}
                      </div>
                    </div>
                    <button className="calls-type-btn" title={g.latest.type === 'video' ? 'Video call' : 'Voice call'}
                      onClick={(e) => { e.stopPropagation(); startCall(g.conversation_id, g.latest.type, g.title); }}>
                      {g.latest.type === 'video' ? <VideoIcon size={18} /> : <PhoneIcon size={18} />}
                    </button>
                  </div>
                );
              })}
            </div>

            <button className="calls-fab" title="New call" onClick={() => setPicker(true)}><PhoneIcon size={20} /><span className="calls-fab-plus">+</span></button>

            {picker && <ContactPicker onClose={() => setPicker(false)} onCall={place} />}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── Call detail ────────────────────────────────────────────────────────────
function CallDetail({ group, onBack, onCall, onDeleteLog }: {
  group: CallGroup; onBack: () => void; onCall: (t: CallType) => void; onDeleteLog: () => void;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };
  async function block() {
    if (!group.peer_id) return;
    if (!window.confirm(`Block ${group.title}?`)) return;
    const { error } = await blockUser(supabase, group.peer_id);
    flash(error ? 'Could not block' : 'Blocked');
  }
  async function report() {
    if (!group.peer_id) return;
    const reason = window.prompt('Report this contact — what is the issue?');
    if (!reason?.trim()) return;
    const { error } = await submitReport(supabase, 'user', group.peer_id, reason.trim());
    flash(error ? 'Could not report' : 'Report submitted');
  }
  return (
    <>
      <div className="calls-head">
        <button className="calls-icon-btn" onClick={onBack} aria-label="Back">←</button>
        <h2>Call info</h2>
      </div>
      <div className="calls-detail">
        <div className="calls-avatar lg" style={group.peer_avatar ? { backgroundImage: `url(${group.peer_avatar})` } : undefined}>
          {!group.peer_avatar && (group.title[0]?.toUpperCase() || '?')}
        </div>
        <div className="calls-detail-name">{group.title}</div>
        {group.peer_username && <div className="calls-detail-sub">@{group.peer_username}</div>}
        <div className="calls-detail-quick">
          <button onClick={() => onCall('audio')}><PhoneIcon size={20} /> Voice call</button>
          <button onClick={() => onCall('video')}><VideoIcon size={20} /> Video call</button>
        </div>
        <div className="calls-detail-actions">
          <button className="danger" onClick={onDeleteLog}><TrashIcon size={16} /> Delete this call log</button>
          {group.peer_id && <button className="danger" onClick={block}>🚫 Block contact</button>}
          {group.peer_id && <button onClick={report}>🚩 Report contact</button>}
        </div>
        {toast && <div className="calls-toast">{toast}</div>}
      </div>
    </>
  );
}

// ── Scheduled calls ─────────────────────────────────────────────────────────
function ScheduledCalls({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<ScheduledCall[]>([]);
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [compose, setCompose] = useState(false);
  const load = useCallback(() => { getScheduledCalls(supabase).then(setRows).catch(() => {}); }, []);
  useEffect(() => { load(); getMyConversations(supabase).then(setConvs).catch(() => {}); }, [load]);
  useEffect(() => { const s = subscribeScheduledCalls(supabase, load); return () => s.unsubscribe(); }, [load]);
  const titleFor = (r: ScheduledCall) => convs.find((c) => c.conversation.id === r.conversation_id)?.title ?? r.title ?? 'Scheduled call';
  return (
    <>
      <div className="calls-head">
        <button className="calls-icon-btn" onClick={onBack} aria-label="Back">←</button>
        <h2>Scheduled calls</h2>
      </div>
      <div className="calls-list">
        {rows.length === 0 && <div className="calls-empty"><div className="calls-empty-title">No scheduled calls</div><div className="calls-empty-sub">Plan a call and it appears here.</div></div>}
        {rows.map((r) => (
          <div key={r.id} className="calls-row">
            <span className="calls-sched-icon">{r.type === 'video' ? <VideoIcon size={18} /> : <PhoneIcon size={18} />}</span>
            <div className="calls-row-main">
              <div className="calls-name">{titleFor(r)}</div>
              <div className="calls-meta">{new Date(r.scheduled_at).toLocaleString()}</div>
            </div>
            <button className="calls-cancel" onClick={() => cancelScheduledCall(supabase, r.id).then(load)}>Cancel</button>
          </div>
        ))}
      </div>
      <button className="calls-fab" onClick={() => setCompose(true)} title="Schedule"><PlusIcon size={20} /></button>
      {compose && <ScheduleCompose convs={convs} onClose={() => setCompose(false)} onDone={() => { setCompose(false); load(); }} />}
    </>
  );
}

function ScheduleCompose({ convs, onClose, onDone }: { convs: ConversationSummary[]; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<ConversationSummary | null>(null);
  const [type, setType] = useState<CallType>('audio');
  const [when, setWhen] = useState('');
  const directs = convs.filter((c) => c.conversation.type !== 'group').filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase()));
  async function submit() {
    if (!picked || !when) return;
    const me = (await getCurrentUser(supabase))?.id;
    const callee = picked.participants.find((p) => p.id !== me)?.id ?? null;
    await scheduleCall(supabase, picked.conversation.id, callee, type, new Date(when).toISOString(), picked.title);
    onDone();
  }
  return (
    <div className="calls-sub-backdrop" onClick={onClose}>
      <div className="calls-sub-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Schedule a call</h3>
        {!picked ? (
          <>
            <input className="calls-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Choose a contact" autoFocus />
            <div className="calls-pick-list">
              {directs.length === 0 && <div className="calls-empty-sub">No contacts.</div>}
              {directs.map((c) => (
                <button key={c.conversation.id} className="calls-pick-row" onClick={() => setPicked(c)}>
                  <span className="calls-avatar sm" style={c.avatarUrl ? { backgroundImage: `url(${c.avatarUrl})` } : undefined}>{!c.avatarUrl && (c.title[0]?.toUpperCase() || '?')}</span>
                  <span className="calls-pick-name">{c.title}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="calls-picked">{picked.title}</div>
            <div className="calls-type-chips">
              {(['audio', 'video'] as CallType[]).map((t) => (
                <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{t === 'video' ? 'Video' : 'Voice'}</button>
              ))}
            </div>
            <input className="calls-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <div className="calls-sub-actions">
              <button onClick={() => setPicked(null)}>Back</button>
              <button className="primary" disabled={!when} onClick={submit}>Schedule</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Call settings ───────────────────────────────────────────────────────────
function CallSettingsPanel({ onBack }: { onBack: () => void }) {
  const [s, setS] = useState<CallSettings>(DEFAULT_CALL_SETTINGS);
  useEffect(() => { getCallSettings(supabase).then(setS).catch(() => {}); }, []);
  const update = (patch: Partial<CallSettings>) => { setS((c) => ({ ...c, ...patch })); setCallSettings(supabase, patch).catch(() => {}); };
  const Toggle = ({ k, label, sub }: { k: keyof CallSettings; label: string; sub: string }) => (
    <div className="calls-toggle-row" onClick={() => update({ [k]: !s[k] } as Partial<CallSettings>)}>
      <div><div className="calls-toggle-name">{label}</div><div className="calls-toggle-sub">{sub}</div></div>
      <span className={`calls-switch ${s[k] ? 'on' : ''}`}><i /></span>
    </div>
  );
  return (
    <>
      <div className="calls-head">
        <button className="calls-icon-btn" onClick={onBack} aria-label="Back">←</button>
        <h2>Call settings</h2>
      </div>
      <div className="calls-settings">
        <Toggle k="silence_unknown" label="Silence unknown callers" sub="Silence calls from people you don't share a chat with" />
        <Toggle k="ringtone" label="Ringtone" sub="Play a ringtone on incoming calls" />
        <Toggle k="vibrate" label="Vibrate" sub="Vibrate on incoming calls" />
        <p className="calls-note">Saved to your account and applied on your devices.</p>
      </div>
    </>
  );
}

// ── FAB contact picker ──────────────────────────────────────────────────────
function ContactPicker({ onClose, onCall }: { onClose: () => void; onCall: (c: ConversationSummary, t: CallType) => void }) {
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => { getMyConversations(supabase).then((cs) => setConvs(cs.filter((c) => c.conversation.type !== 'group'))).catch(() => {}); }, []);
  const filtered = convs.filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="calls-sub-backdrop" onClick={onClose}>
      <div className="calls-sub-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Call a contact</h3>
        <input className="calls-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts" autoFocus />
        <div className="calls-pick-list">
          {filtered.length === 0 && <div className="calls-empty-sub">No contacts to call yet.</div>}
          {filtered.map((c) => (
            <div key={c.conversation.id} className="calls-pick-row">
              <span className="calls-avatar sm" style={c.avatarUrl ? { backgroundImage: `url(${c.avatarUrl})` } : undefined}>{!c.avatarUrl && (c.title[0]?.toUpperCase() || '?')}</span>
              <span className="calls-pick-name">{c.title}</span>
              <button className="calls-type-btn" onClick={() => onCall(c, 'audio')} title="Voice"><PhoneIcon size={18} /></button>
              <button className="calls-type-btn" onClick={() => onCall(c, 'video')} title="Video"><VideoIcon size={18} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
