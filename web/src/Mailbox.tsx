// Lumixo — user Mailbox. The official inbox that surfaces the notifications
// written into user_warnings (0017/0023): moderator appointment / removal and
// official warnings. Every user has one. Opening the mailbox marks everything
// seen (clears the Settings badge). Read-only for the user; the records are
// permanent server-side.

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from './supabase';
import { getMyMailbox, markAllMailboxSeen } from '@shared/adminApi';
import { WARNING_REASONS } from '@shared/types';
import type { MailboxItem } from '@shared/types';
import { modalBackdrop, modalPanel } from './motion';
import { LumixoCat } from './mascot/LumixoCat';
import './admin/AdminDashboard.css';
import './moderator/ModeratorDashboard.css';

const REASON_LABEL: Record<string, string> =
  Object.fromEntries(WARNING_REASONS.map((r) => [r.value, r.label]));

const KIND_ICON: Record<string, string> = {
  warning: '⚠️', mod_appointed: '🛡️', mod_removed: '↩️', info: 'ℹ️',
};

export function Mailbox({ onClose, onSeen }: { onClose: () => void; onSeen?: () => void }) {
  const [items, setItems] = useState<MailboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getMyMailbox(supabase, 200));
      setError(null);
      // Mark everything seen once the inbox is open, then tell the parent to
      // refresh its unseen badge.
      await markAllMailboxSeen(supabase).catch(() => {});
      onSeen?.();
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your mailbox.');
    } finally {
      setLoading(false);
    }
  }, [onSeen]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="admin-modal mailbox-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="admin-title">📬 Mailbox</h2>

        {loading ? (
          <div className="admin-empty">Loading…</div>
        ) : error ? (
          <div className="admin-warn">{error}</div>
        ) : items.length === 0 ? (
          <div className="admin-empty">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }} aria-hidden>
              <LumixoCat mood="sleeping" size="sm" decorative />
            </div>
            No messages yet. Official Lumixo notices appear here.
          </div>
        ) : (
          <div className="mailbox-list">
            {items.map((m) => (
              <div key={m.id} className={`mailbox-item ${m.seen_at ? '' : 'unseen'} ${m.kind === 'warning' ? 'mailbox-warning' : ''}`}>
                <div className="mailbox-item-head">
                  <span className="mailbox-icon">{KIND_ICON[m.kind] ?? 'ℹ️'}</span>
                  <span className="mailbox-item-title">{m.title || defaultTitle(m.kind)}</span>
                  {!m.seen_at && <span className="mailbox-unseen-dot" />}
                </div>
                {m.reason && <span className="mailbox-reason">{REASON_LABEL[m.reason] ?? m.reason}</span>}
                {m.message && <div className="mailbox-body">{m.message}</div>}
                <div className="mailbox-meta">{new Date(m.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function defaultTitle(kind: string): string {
  switch (kind) {
    case 'warning': return 'Official Lumixo Warning';
    case 'mod_appointed': return 'You are now a Lumixo Moderator';
    case 'mod_removed': return 'Moderator role removed';
    default: return 'Lumixo notice';
  }
}
