// FUTUREHAT — Moderator Dashboard (Phase 1). A focused console for moderators
// (role='moderator', or admins who are also moderators) over the reports surface
// (0017) + moderator RPCs (0023). Two sections — Reported Messages and Reported
// Profiles — each row carrying Report ID, Reason, Date/Time, Status, Reported
// User and (for messages) the reported content. Exactly five per-report actions:
//   👁 Review · ⚠ Issue Warning · ✅ Close – No Violation ·
//   🚩 Close – Violation Confirmed · ⬆ Escalate to Admin
// Every action calls a SECURITY DEFINER RPC that re-checks moderator privilege
// server-side and writes an immutable audit row. Moderators are structurally
// unable to reach admin-only powers (ban/suspend/delete/premium) — none are here.

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import {
  getServerModerator, adminListReports, adminReportsPendingCount,
  adminSetReportStatus, issueWarning, escalateReport,
} from '@shared/adminApi';
import { REPORT_REASONS } from '@shared/supportApi';
import { WARNING_REASONS } from '@shared/types';
import type { AdminReport, ReportStatus, WarningReason } from '@shared/types';
import { modalBackdrop, modalPanel } from '../motion';
import '../admin/AdminDashboard.css';
import './ModeratorDashboard.css';

const REASON_LABEL: Record<string, string> =
  Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]));
const STATUS_LABEL: Record<string, string> = {
  open: 'Pending', reviewing: 'Reviewed', resolved: 'Resolved', dismissed: 'Dismissed',
};
const FILTERS: { id: ReportStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Pending' },
  { id: 'reviewing', label: 'Reviewed' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'dismissed', label: 'Dismissed' },
];

function personLabel(name: string | null, username: string | null, id: string | null): string {
  return name || (username ? `@${username}` : id ? id.slice(0, 8) : 'unknown');
}

export function ModeratorDashboard({ onClose }: { onClose: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [filter, setFilter] = useState<ReportStatus | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [warnFor, setWarnFor] = useState<AdminReport | null>(null);

  useEffect(() => {
    getServerModerator(supabase).then(setAllowed).catch(() => setAllowed(false));
  }, []);

  // The "All" tab is the moderator's ACTIVE work queue (open + reviewing), not a
  // dump of every historical report — completed reports live under their own tabs.
  const showsStatus = useCallback(
    (status: ReportStatus): boolean =>
      filter === 'all' ? status === 'open' || status === 'reviewing' : status === filter,
    [filter],
  );

  const load = useCallback(async () => {
    try {
      const rows = await adminListReports(supabase, filter === 'all' ? undefined : filter, 300);
      const visible = filter === 'all'
        ? rows.filter((r) => r.status === 'open' || r.status === 'reviewing')
        : rows;
      setReports(visible);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load reports. Apply migration 0017 + 0023.');
    }
    try { setPending(await adminReportsPendingCount(supabase)); } catch { /* badge best-effort */ }
  }, [filter]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  // Live updates: any insert/update on reports refreshes the list.
  useEffect(() => {
    if (!allowed) return;
    const ch = supabase
      .channel('mod-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [allowed, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (warnFor) setWarnFor(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, warnFor]);

  async function act(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try { await fn(); await load(); }
    catch (e: any) { setError(e?.message ?? 'Action failed'); }
    finally { setBusy(null); }
  }

  // Optimistically move a report to `newStatus`: update it in place, or drop it
  // from the active queue immediately if it no longer belongs under the current
  // filter (No Violation → dismissed, Violation → resolved). Persist via the
  // audited RPC; roll back + surface the error on failure. Instant, no refetch.
  const applyStatus = useCallback(
    async (r: AdminReport, newStatus: ReportStatus, patch: Partial<AdminReport>, run: () => Promise<void>) => {
      const snapshot = reports;
      setBusy(r.report_id); setError(null);
      setReports((list) =>
        showsStatus(newStatus)
          ? list.map((x) => (x.report_id === r.report_id ? { ...x, status: newStatus, ...patch } : x))
          : list.filter((x) => x.report_id !== r.report_id),
      );
      try { await run(); }
      catch (e: any) { setReports(snapshot); setError(e?.message ?? 'Action failed'); }
      finally { setBusy(null); }
    },
    [reports, showsStatus],
  );

  const review = (r: AdminReport) =>
    applyStatus(r, 'reviewing', {}, () => adminSetReportStatus(supabase, r.report_id, 'reviewing'));
  const closeNoViolation = (r: AdminReport) =>
    applyStatus(r, 'dismissed', {}, () => adminSetReportStatus(supabase, r.report_id, 'dismissed'));
  const closeViolation = (r: AdminReport) =>
    applyStatus(r, 'resolved', {}, () => adminSetReportStatus(supabase, r.report_id, 'resolved'));
  const escalate = (r: AdminReport) => {
    const note = window.prompt('Add a note for the admins (optional):') ?? undefined;
    applyStatus(
      r, 'reviewing', { escalated: true, escalated_note: note ?? null },
      () => escalateReport(supabase, r.report_id, note || undefined),
    );
  };

  const messages = reports.filter((r) => r.target_type === 'message');
  const profiles = reports.filter((r) => r.target_type === 'user');

  const renderRow = (r: AdminReport, kind: 'message' | 'profile') => (
    <div key={r.report_id} className="admin-row">
      <div className="admin-row-head">
        <span className="admin-tag">{REASON_LABEL[r.reason] ?? r.reason}</span>
        {r.escalated && <span className="mod-escalated-tag">⬆ escalated</span>}
        <span className={`admin-status ${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
      </div>

      <div className="admin-report-parties">
        <span><strong>Report ID:</strong> {r.report_id.slice(0, 8)}</span>
        <span><strong>Reported:</strong> {personLabel(r.reported_name, r.reported_username, r.reported_user_id)}</span>
      </div>

      {kind === 'message' && (
        <div className="admin-report-quote">
          {r.message_content != null && r.message_content !== ''
            ? `“${r.message_content}”`
            : <em>(no text / message deleted)</em>}
          {!r.message_exists && r.message_content != null && <span className="admin-report-deleted"> · message deleted</span>}
        </div>
      )}

      {r.description && <div className="admin-row-body">Note: {r.description}</div>}
      {r.escalated && r.escalated_note && <div className="admin-row-body">Escalation note: {r.escalated_note}</div>}

      <div className="admin-row-meta">
        {new Date(r.created_at).toLocaleString()}
        {r.reviewed_at && <> · reviewed {new Date(r.reviewed_at).toLocaleString()}</>}
      </div>

      <div className="admin-actions admin-report-actions">
        <button disabled={busy === r.report_id} onClick={() => review(r)}>👁 Review</button>
        <button disabled={busy === r.report_id || !r.reported_user_id} onClick={() => setWarnFor(r)}>⚠ Issue Warning</button>
        <button disabled={busy === r.report_id} onClick={() => closeNoViolation(r)}>✅ Close – No Violation</button>
        <button className="admin-fail" disabled={busy === r.report_id} onClick={() => closeViolation(r)}>🚩 Close – Violation Confirmed</button>
        <button disabled={busy === r.report_id} onClick={() => escalate(r)}>⬆ Escalate to Admin</button>
      </div>
    </div>
  );

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="admin-modal wide" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="admin-title">🛡️ Moderator dashboard</h2>

        {allowed === null ? (
          <div className="admin-empty">Checking access…</div>
        ) : !allowed ? (
          <div className="admin-empty">You don’t have moderator access.</div>
        ) : (
          <>
            <div className="admin-report-filters">
              {FILTERS.map((f) => (
                <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>
              ))}
              {pending != null && <span className="mod-pending-pill">{pending} pending</span>}
            </div>

            {error && <div className="admin-warn">{error}</div>}

            <div className="admin-body">
              <h3 className="admin-subhead">Reported messages ({messages.length})</h3>
              <div className="admin-list">
                {messages.length === 0 && <div className="admin-empty sm">No reported messages.</div>}
                {messages.map((r) => renderRow(r, 'message'))}
              </div>

              <h3 className="admin-subhead">Reported profiles ({profiles.length})</h3>
              <div className="admin-list">
                {profiles.length === 0 && <div className="admin-empty sm">No reported profiles.</div>}
                {profiles.map((r) => renderRow(r, 'profile'))}
              </div>
            </div>
          </>
        )}
      </motion.div>

      {warnFor && (
        <WarningModal
          report={warnFor}
          busy={busy === warnFor.report_id}
          onCancel={() => setWarnFor(null)}
          onSubmit={async (reason, note) => {
            const r = warnFor;
            setWarnFor(null);
            if (!r.reported_user_id) return;
            await act(r.report_id, () => issueWarning(supabase, r.reported_user_id!, reason, note, r.report_id));
          }}
        />
      )}
    </motion.div>
  );
}

function WarningModal({
  report, busy, onCancel, onSubmit,
}: {
  report: AdminReport;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (reason: WarningReason, note?: string) => void;
}) {
  const [reason, setReason] = useState<WarningReason>('spam');
  const [note, setNote] = useState('');
  const who = personLabel(report.reported_name, report.reported_username, report.reported_user_id);

  return (
    <div className="admin-convo-backdrop" onClick={onCancel}>
      <div className="admin-convo-panel mod-warn-panel" onClick={(e) => e.stopPropagation()}>
        <div className="admin-convo-head">
          <strong>⚠ Issue official warning</strong>
          <button className="modal-close" onClick={onCancel} aria-label="Close">✕</button>
        </div>
        <div className="mod-warn-body">
          <p className="admin-hint">An official FUTUREHAT warning will be delivered to <strong>{who}</strong>’s mailbox and permanently recorded.</p>
          <label className="mod-warn-label">Reason</label>
          <select className="mod-warn-select" value={reason} onChange={(e) => setReason(e.target.value as WarningReason)}>
            {WARNING_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <label className="mod-warn-label">Note to user (optional)</label>
          <textarea
            className="mod-warn-textarea" rows={3} value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add context for the user…"
          />
          <div className="mod-warn-actions">
            <button onClick={onCancel} disabled={busy}>Cancel</button>
            <button className="mod-warn-submit" disabled={busy} onClick={() => onSubmit(reason, note.trim() || undefined)}>
              {busy ? 'Sending…' : 'Send warning'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
