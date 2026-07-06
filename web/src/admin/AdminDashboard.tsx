// FUTUREHAT — Owner/Admin dashboard. A responsive tabbed console over the admin
// RPCs in 0013_owner_admin.sql. Gated behind getServerAdmin; owner-only tabs are
// additionally hidden unless isOwner AND re-checked server-side by each RPC. The
// original Overview / Reports / Tickets behavior is preserved intact.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { getServerAdmin } from '@shared/premiumApi';
import { getServerOwner, adminReportsPendingCount, moderatorAuditLog } from '@shared/adminApi';
import type { ModeratorAuditEntry } from '@shared/types';
import { modalBackdrop, modalPanel } from '../motion';
import { AdminUsers } from './AdminUsers';
import { AdminReports } from './AdminReports';
import {
  AdminCalls, AdminMessages, AdminFeatureFlags, AdminAppMgmt,
  AdminHealth, AdminAudit, AdminSearch,
} from './AdminOps';
import './AdminDashboard.css';

type Tab =
  | 'overview' | 'users' | 'reports' | 'tickets' | 'calls' | 'messages'
  | 'search' | 'flags' | 'app' | 'health' | 'audit' | 'modaudit';

interface Stats {
  users: number; messages: number; conversations: number; communities: number;
  statuses: number; premium_users: number; open_reports: number; open_tickets: number;
  online_users?: number; dau?: number; mau?: number; new_today?: number;
  banned_users?: number; total_calls?: number; failed_calls?: number; channels?: number;
}
interface TicketRow {
  id: string; user_id: string; kind: string; subject: string; body: string;
  status: string; created_at: string; device_info: string | null;
}

const STAT_CARDS: { key: keyof Stats; label: string; icon: string }[] = [
  { key: 'users', label: 'Total users', icon: '👤' },
  { key: 'online_users', label: 'Online now', icon: '🟢' },
  { key: 'dau', label: 'DAU', icon: '📅' },
  { key: 'mau', label: 'MAU', icon: '🗓️' },
  { key: 'new_today', label: 'New today', icon: '✨' },
  { key: 'premium_users', label: 'Premium', icon: '✦' },
  { key: 'banned_users', label: 'Banned', icon: '⛔' },
  { key: 'messages', label: 'Messages', icon: '💬' },
  { key: 'conversations', label: 'Chats', icon: '🗨️' },
  { key: 'communities', label: 'Communities', icon: '🌐' },
  { key: 'channels', label: 'Channels', icon: '📢' },
  { key: 'statuses', label: 'Live statuses', icon: '📸' },
  { key: 'total_calls', label: 'Total calls', icon: '📞' },
  { key: 'failed_calls', label: 'Failed calls', icon: '📵' },
  { key: 'open_reports', label: 'Open reports', icon: '🚩' },
  { key: 'open_tickets', label: 'Open tickets', icon: '🎫' },
];

export function AdminDashboard({ onClose }: { onClose: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [pendingReports, setPendingReports] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getServerAdmin(supabase), getServerOwner(supabase)]).then(([admin, owner]) => {
      setAllowed(admin); setIsOwner(owner);
      if (admin) loadAll();
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Live badge: refresh the pending-report count whenever the reports table
  // changes, from any tab (so a new report bumps the "Reports (N)" badge).
  useEffect(() => {
    if (!allowed) return;
    const refresh = () => adminReportsPendingCount(supabase).then(setPendingReports).catch(() => {});
    refresh();
    const ch = supabase
      .channel('admin-reports-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [allowed]);

  async function loadAll() {
    const { data: statData, error: statErr } = await supabase.rpc('admin_stats');
    if (statErr) setError('Admin backend not provisioned yet (apply migrations 0009 + 0013).');
    else setStats(statData as Stats);
    const { data: tic } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false }).limit(100);
    setTickets((tic as TicketRow[]) ?? []);
  }

  async function setTicketStatus(id: string, status: string) {
    setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    await supabase.from('support_tickets').update({ status }).eq('id', id);
  }

  const TABS: { id: Tab; label: string; ownerOnly?: boolean }[] = [
    { id: 'overview', label: 'Analytics' },
    { id: 'users', label: 'Users' },
    { id: 'reports', label: `Reports${(pendingReports ?? stats?.open_reports) != null ? ` (${pendingReports ?? stats?.open_reports})` : ''}` },
    { id: 'tickets', label: `Tickets${stats ? ` (${stats.open_tickets})` : ''}` },
    { id: 'calls', label: 'Calls' },
    { id: 'messages', label: 'Messages' },
    { id: 'search', label: 'Search' },
    { id: 'health', label: 'Database' },
    { id: 'modaudit', label: 'Mod Audit' },
    { id: 'flags', label: 'Feature Flags', ownerOnly: true },
    { id: 'app', label: 'App', ownerOnly: true },
    { id: 'audit', label: 'Audit Log', ownerOnly: true },
  ];

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="admin-modal wide" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="admin-title">🛡️ {isOwner ? 'Owner' : 'Admin'} dashboard</h2>

        {allowed === null ? (
          <div className="admin-empty">Checking access…</div>
        ) : !allowed ? (
          <div className="admin-empty">You don’t have admin access.</div>
        ) : (
          <>
            <div className="admin-tabs">
              {TABS.filter((t) => !t.ownerOnly || isOwner).map((t) => (
                <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
            </div>

            {error && <div className="admin-warn">{error}</div>}

            <div className="admin-body">
              {tab === 'overview' && (
                <div className="admin-grid">
                  {STAT_CARDS.map((c) => (
                    <div key={String(c.key)} className="admin-stat">
                      <div className="admin-stat-icon">{c.icon}</div>
                      <div className="admin-stat-num">{stats && stats[c.key] != null ? stats[c.key] : '—'}</div>
                      <div className="admin-stat-label">{c.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'users' && <AdminUsers isOwner={isOwner} />}
              {tab === 'calls' && <AdminCalls />}
              {tab === 'messages' && <AdminMessages />}
              {tab === 'search' && <AdminSearch />}
              {tab === 'health' && <AdminHealth />}
              {tab === 'modaudit' && <ModeratorAudit />}
              {tab === 'flags' && isOwner && <AdminFeatureFlags />}
              {tab === 'app' && isOwner && <AdminAppMgmt />}
              {tab === 'audit' && isOwner && <AdminAudit />}

              {tab === 'reports' && <AdminReports onPending={setPendingReports} />}

              {tab === 'tickets' && (
                <div className="admin-list">
                  {tickets.length === 0 && <div className="admin-empty">No tickets.</div>}
                  {tickets.map((t) => (
                    <div key={t.id} className="admin-row">
                      <div className="admin-row-head">
                        <span className="admin-tag">{t.kind}</span>
                        <span className={`admin-status ${t.status}`}>{t.status.replace('_', ' ')}</span>
                      </div>
                      <div className="admin-row-title">{t.subject}</div>
                      <div className="admin-row-body">{t.body}</div>
                      {t.device_info && <div className="admin-row-meta">📱 {t.device_info}</div>}
                      <div className="admin-row-meta">{new Date(t.created_at).toLocaleString()}</div>
                      <div className="admin-actions">
                        <button onClick={() => setTicketStatus(t.id, 'in_progress')}>In progress</button>
                        <button onClick={() => setTicketStatus(t.id, 'resolved')}>Resolve</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// Admin-only view of the immutable moderator audit trail (0023). Read-only.
function ModeratorAudit() {
  const [rows, setRows] = useState<ModeratorAuditEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { moderatorAuditLog(supabase, 300).then(setRows).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="admin-warn">{err}</div>;
  return (
    <div className="admin-audit">
      <div className="admin-hint">Every moderator action is recorded here permanently. Records can never be edited or deleted.</div>
      {rows.length === 0 && <div className="admin-empty">No moderator actions yet.</div>}
      {rows.length > 0 && (
        <table className="admin-table">
          <thead><tr><th>When</th><th>Moderator</th><th>Action</th><th>User / Report</th><th>Details</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.actor_email || (r.actor_id ? r.actor_id.slice(0, 8) : '—')}</td>
                <td><span className="admin-tag">{r.action}</span></td>
                <td><code>{r.target ? String(r.target).slice(0, 12) : '—'}</code></td>
                <td className="admin-meta-cell">{r.meta ? JSON.stringify(r.meta) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
