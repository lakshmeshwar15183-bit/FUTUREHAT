// FUTUREHAT — "Export / request my data": gathers the signed-in user's own data
// via existing shared APIs (all RLS-scoped to them) and downloads it as a single
// JSON file. Covers the spec's Export Account Data + Chat History export. Adding
// messages is optional and capped to avoid an enormous file. Self-contained;
// open from Settings → Account (wiring deferred to checkpoint recovery).

import { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { getMyProfile, getMyConversations, getMessages } from '@shared/api';
import { getPreferences, getSubscription } from '@shared/premiumApi';
import { getMyTickets, getBlockedIds, getMutedIds } from '@shared/supportApi';
import { getMyCommunities } from '@shared/communitiesApi';
import { modalBackdrop, modalPanel } from '../motion';
import { APP_VERSION, OWNER } from '../branding';
import { useEscapeToClose } from '../useEscapeToClose';
import './DataExportModal.css';

export function DataExportModal({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);
  const [busy, setBusy] = useState(false);
  const [includeMessages, setIncludeMessages] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  async function exportData() {
    setBusy(true);
    setStatus('Gathering your data…');
    try {
      const [profile, conversations, preferences, subscription, tickets, blocked, muted, communities] = await Promise.all([
        getMyProfile(supabase).catch(() => null),
        getMyConversations(supabase).catch(() => []),
        getPreferences(supabase).catch(() => null),
        getSubscription(supabase).catch(() => null),
        getMyTickets(supabase).catch(() => []),
        getBlockedIds(supabase).catch(() => []),
        getMutedIds(supabase).catch(() => []),
        getMyCommunities(supabase).catch(() => []),
      ]);

      let messages: Record<string, unknown[]> | undefined;
      if (includeMessages) {
        setStatus('Collecting messages…');
        messages = {};
        // Cap per-conversation to keep the export reasonable.
        for (const c of conversations.slice(0, 50)) {
          const id = c.conversation.id;
          messages[id] = await getMessages(supabase, id, 500).catch(() => []);
        }
      }

      const payload = {
        export: {
          app: 'FUTUREHAT',
          version: APP_VERSION,
          generated_at: new Date().toISOString(),
          developer: OWNER,
        },
        profile,
        preferences,
        subscription,
        conversations,
        messages,
        communities,
        support_tickets: tickets,
        blocked_user_ids: blocked,
        muted_conversation_ids: muted,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `futurehat-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus('Done — your data has been downloaded.');
    } catch {
      setStatus('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="export-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="export-title">📦 Export my data</h2>
        <p className="export-desc">
          Download a copy of your FUTUREHAT data — your profile, preferences, subscription,
          conversations, communities, and support history — as a single JSON file.
        </p>
        <label className="export-check">
          <input type="checkbox" checked={includeMessages} onChange={(e) => setIncludeMessages(e.target.checked)} disabled={busy} />
          Include message history (up to 500 per chat, first 50 chats)
        </label>
        <button className="export-btn" onClick={exportData} disabled={busy}>
          {busy ? 'Working…' : 'Download my data'}
        </button>
        {status && <div className="export-status">{status}</div>}
        <p className="export-note">Your data is gathered directly in your browser and never sent anywhere else.</p>
      </motion.div>
    </motion.div>
  );
}
