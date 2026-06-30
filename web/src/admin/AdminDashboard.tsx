// FUTUREHAT — Admin dashboard: moderation queue (reports + support tickets) and
// at-a-glance analytics. Gated behind getServerAdmin; all data access is further
// enforced server-side by the admin RLS policies + admin_stats() in 0009_admin.sql.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { getServerAdmin } from '@shared/premiumApi';
import { modalBackdrop, modalPanel } from '../motion';
import './AdminDashboard.css';

type Tab = 'overview' | 'reports' | 'tickets';

interface Stats {
  users: number; messages: number; conversations: number; communities: number;
  statuses: number; premium_users: number; open_reports: number; open_tickets: number;
}
interface ReportRow {
  id: string; reporter_id: string; target_type: string; target_id: string;
  reason: string; details: string | null; status: string; created_at: string;
}
interface TicketRow {
  id: string; user_id: string; kind: string; subject: string; body: string;
  status: string; created_at: string; device_info: string | null;
}

const STAT_CARDS: { key: keyof Stats; label: string; icon: string }[] = [
  { key: 'users', label: 'Users', icon: '👤' },
  { key: 'messages', label: 'Messages', icon: '💬' },
  { key: 'conversations', label: 'Chats', icon: '🗨️' },
  { key: 'communities', label: 'Communities', icon: '🌐' },
  { key: 'statuses', label: 'Live statuses', icon: '📸' },
  { key: 'premium_users', label: 'Premium', icon: '✦' },
  { key: 'open_reports', label: 'Open reports', icon: '🚩' },
  { key: 'open_tickets', label: 'Open tickets', icon: '🎫' },
];

export function AdminDashboard({ onClose }: { onClose: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getServerAdmin(supabase).then((isAdmin) => {
      setAllowed(isAdmin);
      if (isAdmin) loadAll();
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function loadAll() {
    const { data: statData, error: statErr } = await supabase.rpc('admin_stats');
    if (statErr) setError('Admin backend not provisioned yet (apply migration 0009).');
    else setStats(statData as Stats);
    const { data: rep } = await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(100);
    setReports((rep as ReportRow[]) ?? []);
    const { data: tic } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false }).limit(100);
    setTickets((tic as TicketRow[]) ?? []);
  }

  async function setReportStatus(id: string, status: string) {
    setReports((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    await supabase.from('reports').update({ status }).eq('id', id);
  }
  async function setTicketStatus(id: string, status: string) {
    setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    await supabase.from('support_tickets').update({ status }).eq('id', id);
  }

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="admin-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="admin-title">🛡️ Admin dashboard</h2>

        {allowed === null ? (
          <div className="admin-empty">Checking access…</div>
        ) : !allowed ? (
          <div className="admin-empty">You don’t have admin access.</div>
        ) : (
          <>
            <div className="admin-tabs">
              <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
              <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>Reports {stats ? `(${stats.open_reports})` : ''}</button>
              <button className={tab === 'tickets' ? 'active' : ''} onClick={() => setTab('tickets')}>Tickets {stats ? `(${stats.open_tickets})` : ''}</button>
            </div>

            {error && <div className="admin-warn">{error}</div>}

            {tab === 'overview' && (
              <div className="admin-grid">
                {STAT_CARDS.map((c) => (
                  <div key={c.key} className="admin-stat">
                    <div className="admin-stat-icon">{c.icon}</div>
                    <div className="admin-stat-num">{stats ? stats[c.key] : '—'}</div>
                    <div className="admin-stat-label">{c.label}</div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'reports' && (
              <div className="admin-list">
                {reports.length === 0 && <div className="admin-empty">No reports.</div>}
                {reports.map((r) => (
                  <div key={r.id} className="admin-row">
                    <div className="admin-row-head">
                      <span className="admin-tag">{r.target_type}</span>
                      <span className={`admin-status ${r.status}`}>{r.status}</span>
                    </div>
                    <div className="admin-row-title">{r.reason}</div>
                    {r.details && <div className="admin-row-body">{r.details}</div>}
                    <div className="admin-row-meta">target {r.target_id.slice(0, 8)} · {new Date(r.created_at).toLocaleString()}</div>
                    <div className="admin-actions">
                      <button onClick={() => setReportStatus(r.id, 'reviewing')}>Reviewing</button>
                      <button onClick={() => setReportStatus(r.id, 'resolved')}>Resolve</button>
                      <button onClick={() => setReportStatus(r.id, 'dismissed')}>Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

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
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
