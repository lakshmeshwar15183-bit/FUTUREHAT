// Lumixo — Admin ▸ Reports. Lists message reports (via admin_list_reports,
// 0017) with reporter, reported user, message content, conversation and status,
// and the full moderation toolbar: Review / Dismiss / Resolve / Ban / Delete
// message / Warn / View conversation / Jump to message. Subscribes to the
// `reports` table so new reports and the badge update live. Every action calls a
// SECURITY DEFINER RPC that re-checks admin privilege server-side.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import {
  adminListReports, adminReportsPendingCount, adminSetReportStatus,
  adminWarnUser, adminGetConversation, adminSetAccountStatus, adminDeleteMessage,
} from '@shared/adminApi';
import { REPORT_REASONS } from '@shared/supportApi';
import type { AdminReport, AdminConversationView, ReportStatus } from '@shared/types';

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

export function AdminReports({ onPending }: { onPending?: (n: number) => void }) {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [filter, setFilter] = useState<ReportStatus | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [convo, setConvo] = useState<AdminConversationView | null>(null);
  const [jumpTo, setJumpTo] = useState<string | null>(null);

  // The "All" tab is the admin's ACTIVE work queue (open + reviewing), NOT a dump
  // of every historical report — otherwise a report just Resolved/Dismissed stays
  // mixed in with the ones still needing action (the reported bug). Completed
  // reports are seen only under their own dedicated Resolved / Dismissed tabs.
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
      setError(e?.message ?? 'Failed to load reports. Apply migration 0017.');
    }
    try {
      const n = await adminReportsPendingCount(supabase);
      onPending?.(n);
    } catch { /* badge best-effort */ }
  }, [filter, onPending]);

  useEffect(() => { load(); }, [load]);

  // Live updates: any insert/update on reports refreshes the list + badge.
  useEffect(() => {
    const ch = supabase
      .channel('admin-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  // Non-status operations (delete message, warn, open conversation) — these don't
  // move the report through its lifecycle, so a plain run + refetch is fine.
  async function act(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try { await fn(); await load(); }
    catch (e: any) { setError(e?.message ?? 'Action failed'); }
    finally { setBusy(null); }
  }

  // Optimistically move a report to `newStatus`: update it in place, or drop it
  // from the active queue immediately if it no longer belongs under the current
  // filter (Dismiss → dismissed, Resolve/Ban → resolved both leave the queue).
  // Persist via the audited RPC; roll back + surface the error on failure. The UI
  // updates instantly — no refetch round-trip, and the report never lingers.
  const applyStatus = useCallback(
    async (r: AdminReport, newStatus: ReportStatus, run: () => Promise<void>) => {
      const snapshot = reports;
      setBusy(r.report_id); setError(null);
      setReports((list) =>
        showsStatus(newStatus)
          ? list.map((x) => (x.report_id === r.report_id ? { ...x, status: newStatus } : x))
          : list.filter((x) => x.report_id !== r.report_id),
      );
      try {
        await run();
        try { onPending?.(await adminReportsPendingCount(supabase)); } catch { /* badge best-effort */ }
      } catch (e: any) {
        setReports(snapshot);           // rollback the optimistic change
        setError(e?.message ?? 'Action failed');
      } finally {
        setBusy(null);
      }
    },
    [reports, showsStatus, onPending],
  );

  const setStatus = (r: AdminReport, status: ReportStatus) =>
    applyStatus(r, status, () => adminSetReportStatus(supabase, r.report_id, status));

  const banUser = (r: AdminReport) => {
    if (!r.reported_user_id) return;
    if (!window.confirm(`Ban ${personLabel(r.reported_name, r.reported_username, r.reported_user_id)}?`)) return;
    // Banning resolves the report → it leaves the active queue immediately.
    applyStatus(r, 'resolved', async () => {
      await adminSetAccountStatus(supabase, r.reported_user_id!, 'banned', `report ${r.report_id}`);
      await adminSetReportStatus(supabase, r.report_id, 'resolved');
    });
  };

  const delMessage = (r: AdminReport) => {
    if (!r.message_id) return;
    if (!window.confirm('Delete this message for everyone?')) return;
    act(r.report_id, () => adminDeleteMessage(supabase, r.message_id!));
  };

  const warnUser = (r: AdminReport) => {
    if (!r.reported_user_id) return;
    const msg = window.prompt('Warning message to send to the user:', 'Your message was reported for violating our community guidelines.');
    if (!msg) return;
    act(r.report_id, () => adminWarnUser(supabase, r.reported_user_id!, msg, r.report_id));
  };

  const openConversation = (r: AdminReport, jump: boolean) => {
    if (!r.conversation_id) return;
    act(r.report_id, async () => {
      const view = await adminGetConversation(supabase, r.conversation_id!);
      setConvo(view);
      setJumpTo(jump ? r.message_id : null);
    });
  };

  return (
    <div className="admin-list">
      <div className="admin-report-filters">
        {FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="admin-warn">{error}</div>}
      {reports.length === 0 && !error && <div className="admin-empty">No reports.</div>}

      {reports.map((r) => (
        <div key={r.report_id} className="admin-row">
          <div className="admin-row-head">
            <span className="admin-tag">{REASON_LABEL[r.reason] ?? r.reason}</span>
            <span className={`admin-status ${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
          </div>

          <div className="admin-report-parties">
            <span><strong>Reporter:</strong> {personLabel(r.reporter_name, r.reporter_username, r.reporter_id)}</span>
            <span><strong>Reported:</strong> {personLabel(r.reported_name, r.reported_username, r.reported_user_id)}</span>
          </div>

          <div className="admin-report-quote">
            {r.message_content != null && r.message_content !== ''
              ? `“${r.message_content}”`
              : <em>(no text / message deleted)</em>}
            {!r.message_exists && r.message_content != null && <span className="admin-report-deleted"> · message deleted</span>}
          </div>

          {r.description && <div className="admin-row-body">Note: {r.description}</div>}

          <div className="admin-row-meta">
            {r.conversation_name || r.conversation_type || 'conversation'}
            {r.message_id && <> · msg {r.message_id.slice(0, 8)}</>}
            {' · '}{new Date(r.created_at).toLocaleString()}
            {r.reviewed_at && <> · reviewed {new Date(r.reviewed_at).toLocaleString()}</>}
          </div>

          <div className="admin-actions admin-report-actions">
            <button disabled={busy === r.report_id} onClick={() => setStatus(r, 'reviewing')}>Review</button>
            <button disabled={busy === r.report_id} onClick={() => setStatus(r, 'dismissed')}>Dismiss</button>
            <button disabled={busy === r.report_id} onClick={() => setStatus(r, 'resolved')}>Resolve</button>
            <button disabled={busy === r.report_id || !r.conversation_id} onClick={() => openConversation(r, false)}>View conversation</button>
            <button disabled={busy === r.report_id || !r.message_id} onClick={() => openConversation(r, true)}>Jump to message</button>
            <button disabled={busy === r.report_id || !r.reported_user_id} onClick={() => warnUser(r)}>Warn user</button>
            <button className="admin-fail" disabled={busy === r.report_id || !r.message_id} onClick={() => delMessage(r)}>Delete message</button>
            <button className="admin-fail" disabled={busy === r.report_id || !r.reported_user_id} onClick={() => banUser(r)}>Ban user</button>
          </div>
        </div>
      ))}

      {convo && (
        <ConversationViewer view={convo} jumpTo={jumpTo} onClose={() => { setConvo(null); setJumpTo(null); }} />
      )}
    </div>
  );
}

function ConversationViewer({
  view, jumpTo, onClose,
}: { view: AdminConversationView; jumpTo: string | null; onClose: () => void }) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const nameById = new Map(view.participants.map((p) => [p.id, p.display_name || (p.username ? `@${p.username}` : p.id.slice(0, 8))]));

  useEffect(() => {
    if (jumpTo && targetRef.current) {
      targetRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [jumpTo, view]);

  const title = view.conversation?.name || (view.conversation?.type === 'group' ? 'Group chat' : 'Direct chat');

  return (
    <div className="admin-convo-backdrop" onClick={onClose}>
      <div className="admin-convo-panel" onClick={(e) => e.stopPropagation()}>
        <div className="admin-convo-head">
          <strong>{title}</strong>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="admin-convo-body">
          {view.messages.length === 0 && <div className="admin-empty">No messages.</div>}
          {view.messages.map((m) => {
            const isTarget = m.id === jumpTo;
            return (
              <div
                key={m.id}
                ref={isTarget ? targetRef : undefined}
                className={`admin-convo-msg${isTarget ? ' target' : ''}`}
              >
                <div className="admin-convo-msg-meta">
                  {nameById.get(m.sender_id) ?? m.sender_id.slice(0, 8)} · {new Date(m.created_at).toLocaleString()}
                </div>
                <div className="admin-convo-msg-body">
                  {m.is_deleted ? <em>(deleted)</em>
                    : m.type !== 'text' ? <em>[{m.type}]</em>
                    : (m.content || <em>(empty)</em>)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
