// Lumixo — Admin ▸ Reports (production moderation workflow).
// Admins NEVER type a message UUID for normal moderation: every report card
// carries full context + one-click Delete / View / Conversation / Warn /
// Suspend / Ban / Ignore. UUID is shown with a copy button for audit trails.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import {
  adminListReports,
  adminReportsPendingCount,
  adminSetReportStatus,
  adminWarnUser,
  adminGetConversation,
  adminSetAccountStatus,
  adminDeleteMessage,
  adminSuspendUser,
} from '@shared/adminApi';
import { REPORT_REASONS } from '@shared/supportApi';
import type { AdminReport, AdminConversationView, ReportStatus } from '@shared/types';

const REASON_LABEL: Record<string, string> =
  Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]));
const STATUS_LABEL: Record<string, string> = {
  open: 'Pending', reviewing: 'In review', resolved: 'Resolved', dismissed: 'Ignored',
};
const FILTERS: { id: ReportStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Queue' },
  { id: 'open', label: 'Pending' },
  { id: 'reviewing', label: 'In review' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'dismissed', label: 'Ignored' },
];

function personLabel(name: string | null, username: string | null, id: string | null): string {
  if (name?.trim()) return name.trim();
  if (username?.trim()) return `@${username.trim()}`;
  if (id) return id.slice(0, 8) + '…';
  return '—';
}

function copyText(label: string, value: string) {
  void navigator.clipboard?.writeText(value).then(
    () => { /* silent success */ },
    () => { window.prompt(`Copy ${label}:`, value); },
  );
}

function IdChip({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="admin-id-chip">
      <span className="admin-id-label">{label}</span>
      <code className="admin-id-value" title={value}>{value}</code>
      <button type="button" className="admin-copy-btn" onClick={() => copyText(label, value)} title="Copy">
        Copy
      </button>
    </div>
  );
}

export function AdminReports({ onPending }: { onPending?: (n: number) => void }) {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [filter, setFilter] = useState<ReportStatus | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [convo, setConvo] = useState<AdminConversationView | null>(null);
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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
      setError(e?.message ?? 'Failed to load reports. Apply migration 0053.');
    }
    try {
      onPending?.(await adminReportsPendingCount(supabase));
    } catch { /* badge best-effort */ }
  }, [filter, onPending]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('admin-reports')
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'reports' }, () => { load(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [load]);

  async function act(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try { await fn(); await load(); }
    catch (e: any) { setError(e?.message ?? 'Action failed'); }
    finally { setBusy(null); }
  }

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
        try { onPending?.(await adminReportsPendingCount(supabase)); } catch { /* */ }
      } catch (e: any) {
        setReports(snapshot);
        setError(e?.message ?? 'Action failed');
      } finally {
        setBusy(null);
      }
    },
    [reports, showsStatus, onPending],
  );

  const setStatus = (r: AdminReport, status: ReportStatus) =>
    applyStatus(r, status, () => adminSetReportStatus(supabase, r.report_id, status));

  const ignoreReport = (r: AdminReport) => {
    if (!window.confirm('Ignore this report? It leaves the active queue.')) return;
    setStatus(r, 'dismissed');
  };

  const banUser = (r: AdminReport) => {
    if (!r.reported_user_id) return;
    if (!window.confirm(`Ban ${personLabel(r.reported_name, r.reported_username, r.reported_user_id)}?`)) return;
    applyStatus(r, 'resolved', async () => {
      await adminSetAccountStatus(supabase, r.reported_user_id!, 'banned', `report ${r.report_id}`);
      await adminSetReportStatus(supabase, r.report_id, 'resolved');
    });
  };

  const suspendUser = (r: AdminReport) => {
    if (!r.reported_user_id) return;
    const days = window.prompt('Suspend for how many days?', '7');
    if (!days) return;
    const n = Math.max(1, parseInt(days, 10) || 7);
    const until = new Date(Date.now() + n * 86400000).toISOString();
    if (!window.confirm(`Suspend ${personLabel(r.reported_name, r.reported_username, r.reported_user_id)} for ${n} day(s)?`)) return;
    act(r.report_id, async () => {
      await adminSuspendUser(supabase, r.reported_user_id!, until, `report ${r.report_id}`);
      await adminSetReportStatus(supabase, r.report_id, 'resolved');
    });
  };

  const delMessage = (r: AdminReport) => {
    if (!r.message_id) {
      setError('This report has no message id (profile-only report).');
      return;
    }
    if (!window.confirm('Delete this message for everyone? Uses the report’s message UUID automatically.')) return;
    act(r.report_id, async () => {
      await adminDeleteMessage(supabase, r.message_id!, {
        reason: `report:${r.reason}`,
        reportId: r.report_id,
      });
      await adminSetReportStatus(supabase, r.report_id, 'resolved');
    });
  };

  const warnUser = (r: AdminReport) => {
    if (!r.reported_user_id) return;
    const msg = window.prompt(
      'Warning message to send to the user:',
      'Your message was reported for violating our community guidelines.',
    );
    if (!msg) return;
    act(r.report_id, () => adminWarnUser(supabase, r.reported_user_id!, msg, r.report_id));
  };

  const openConversation = (r: AdminReport, jump: boolean) => {
    if (!r.conversation_id) {
      setError('No conversation linked to this report.');
      return;
    }
    act(r.report_id, async () => {
      const view = await adminGetConversation(supabase, r.conversation_id!);
      setConvo(view);
      setJumpTo(jump ? r.message_id : null);
    });
  };

  return (
    <div className="admin-list">
      <p className="admin-hint">
        Normal moderation is report-driven: open a report and use the action buttons.
        You never need to paste a message UUID. Manual UUID tools live under Messages → Advanced.
      </p>

      <div className="admin-report-filters">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="admin-warn">{error}</div>}
      {reports.length === 0 && !error && <div className="admin-empty">No reports in this queue.</div>}

      {reports.map((r) => {
        const open = expanded === r.report_id;
        const chatLabel = r.conversation_label
          || r.conversation_name
          || (r.conversation_type === 'group' ? 'Group' : 'Direct chat');
        return (
          <div key={r.report_id} className={`admin-row admin-report-card${open ? ' open' : ''}`}>
            <div className="admin-row-head">
              <span className="admin-tag">{REASON_LABEL[r.reason] ?? r.reason}</span>
              <span className="admin-tag muted">{r.message_type || 'message'}</span>
              <span className={`admin-status ${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
              <button
                type="button"
                className="admin-linkish"
                onClick={() => setExpanded(open ? null : r.report_id)}
              >
                {open ? 'Hide details' : 'Details'}
              </button>
            </div>

            <div className="admin-report-parties">
              <span><strong>Reporter:</strong> {personLabel(r.reporter_name, r.reporter_username, r.reporter_id)}</span>
              <span><strong>Sender:</strong> {personLabel(r.reported_name, r.reported_username, r.reported_user_id)}</span>
              <span><strong>Chat:</strong> {chatLabel}</span>
            </div>

            <div className="admin-report-quote">
              {r.message_content != null && r.message_content !== ''
                ? `“${r.message_content}”`
                : <em>({r.message_type && r.message_type !== 'text' ? r.message_type : 'no text'}{!r.message_exists ? ' · deleted' : ''})</em>}
              {!r.message_exists && r.message_content != null && (
                <span className="admin-report-deleted"> · message deleted</span>
              )}
            </div>

            {r.description && <div className="admin-row-body">Note: {r.description}</div>}

            <div className="admin-row-meta">
              Reported {new Date(r.created_at).toLocaleString()}
              {r.message_created_at && <> · message {new Date(r.message_created_at).toLocaleString()}</>}
            </div>

            {open && (
              <div className="admin-report-detail">
                <IdChip label="Message UUID" value={r.message_id} />
                <IdChip label="Sender user ID" value={r.reported_user_id} />
                <IdChip label="Reporter user ID" value={r.reporter_id} />
                <IdChip label="Conversation / Chat ID" value={r.conversation_id || r.chat_id} />
                <IdChip label="Report ID" value={r.report_id} />
                <div className="admin-report-kv">
                  <span><strong>Type:</strong> {r.message_type || '—'}</span>
                  <span><strong>Reason:</strong> {REASON_LABEL[r.reason] ?? r.reason}</span>
                  <span><strong>Exists:</strong> {r.message_exists ? 'yes' : 'deleted / missing'}</span>
                </div>
              </div>
            )}

            {/* Primary actions — always use report-bound UUIDs, never a free-text field. */}
            <div className="admin-actions admin-report-actions">
              <button type="button" disabled={busy === r.report_id || !r.message_id || !r.message_exists} onClick={() => delMessage(r)}>
                Delete message
              </button>
              <button type="button" disabled={busy === r.report_id || !r.message_id || !r.conversation_id} onClick={() => openConversation(r, true)}>
                View message
              </button>
              <button type="button" disabled={busy === r.report_id || !r.conversation_id} onClick={() => openConversation(r, false)}>
                View full conversation
              </button>
              <button type="button" disabled={busy === r.report_id || !r.reported_user_id} onClick={() => warnUser(r)}>
                Warn user
              </button>
              <button type="button" disabled={busy === r.report_id || !r.reported_user_id} onClick={() => suspendUser(r)}>
                Suspend user
              </button>
              <button type="button" className="admin-fail" disabled={busy === r.report_id || !r.reported_user_id} onClick={() => banUser(r)}>
                Ban user
              </button>
              <button type="button" disabled={busy === r.report_id} onClick={() => ignoreReport(r)}>
                Ignore report
              </button>
              {r.status === 'open' && (
                <button type="button" disabled={busy === r.report_id} onClick={() => setStatus(r, 'reviewing')}>
                  Mark in review
                </button>
              )}
              {r.status !== 'resolved' && (
                <button type="button" disabled={busy === r.report_id} onClick={() => setStatus(r, 'resolved')}>
                  Resolve
                </button>
              )}
            </div>
          </div>
        );
      })}

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
  const nameById = new Map(
    view.participants.map((p) => [
      p.id,
      p.display_name || (p.username ? `@${p.username}` : p.id.slice(0, 8)),
    ]),
  );

  useEffect(() => {
    if (jumpTo && targetRef.current) {
      targetRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [jumpTo, view]);

  const title = view.conversation?.name
    || (view.conversation?.type === 'group' ? 'Group chat' : 'Direct chat');

  return (
    <div className="admin-convo-backdrop" onClick={onClose}>
      <div className="admin-convo-panel" onClick={(e) => e.stopPropagation()}>
        <div className="admin-convo-head">
          <strong>{title}</strong>
          {view.conversation?.id && (
            <button
              type="button"
              className="admin-copy-btn"
              onClick={() => copyText('Chat ID', view.conversation!.id)}
            >
              Copy chat ID
            </button>
          )}
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
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
                  {nameById.get(m.sender_id) ?? m.sender_id.slice(0, 8)}
                  {' · '}{m.type}
                  {' · '}{new Date(m.created_at).toLocaleString()}
                  {' · '}
                  <button type="button" className="admin-linkish" onClick={() => copyText('Message UUID', m.id)}>
                    {m.id.slice(0, 8)}… copy
                  </button>
                </div>
                <div className="admin-convo-msg-body">
                  {m.is_deleted ? <em>(deleted)</em>
                    : m.type !== 'text' ? <em>[{m.type}] {m.content || ''}</em>
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
