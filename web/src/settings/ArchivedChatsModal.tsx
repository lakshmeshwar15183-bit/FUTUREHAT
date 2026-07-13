// Lumixo — Archived chats: lists conversations the user has archived, with
// unarchive and open actions. Self-contained (getMyConversations + archived ids
// from accountApi). Opening hands the conversation id to the parent via onOpen
// (wired during recovery). Backed by 0010_account_privacy.archived_conversations.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { getMyConversations } from '@shared/api';
import { getArchivedIds, unarchiveConversation } from '@shared/accountApi';
import type { ConversationSummary } from '@shared/types';
import { modalBackdrop, modalPanel } from '../motion';
import { LumixoCat } from '../mascot/LumixoCat';
import './settings-panels.css';

export function ArchivedChatsModal({ onClose, onOpen }: { onClose: () => void; onOpen?: (conversationId: string) => void }) {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [convs, ids] = await Promise.all([
        getMyConversations(supabase).catch(() => [] as ConversationSummary[]),
        getArchivedIds(supabase).catch(() => [] as string[]),
      ]);
      const set = new Set(ids);
      setItems(convs.filter((c) => set.has(c.conversation.id)));
      setLoading(false);
    })();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function unarchive(id: string) {
    setItems((cur) => cur.filter((c) => c.conversation.id !== id));
    await unarchiveConversation(supabase, id);
  }

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="sp-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="sp-title">🗄️ Archived chats</h2>
        <p className="sp-sub">Conversations you’ve tucked away. They stay archived until you unarchive them.</p>

        {loading ? <div className="sp-note">Loading…</div> : items.length === 0 ? (
          <div className="sp-note" style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }} aria-hidden>
              <LumixoCat mood="sleeping" size="sm" decorative />
            </div>
            No archived chats.
          </div>
        ) : (
          <section className="sp-section">
            {items.map((c) => (
              <div className="sp-row" key={c.conversation.id}>
                <div className="sp-row-main" style={{ cursor: onOpen ? 'pointer' : 'default' }} onClick={() => onOpen?.(c.conversation.id)}>
                  <div className="sp-row-name">{c.title}</div>
                  <div className="sp-row-desc">{c.lastMessage?.content || 'No messages yet'}</div>
                </div>
                <button className="sp-btn" onClick={() => unarchive(c.conversation.id)}>Unarchive</button>
              </div>
            ))}
          </section>
        )}
      </motion.div>
    </motion.div>
  );
}
