// Lumixo — "Starred messages" browser. Read-only list of every message the
// user has starred, across all chats (WhatsApp-style), backed by the additive
// get_starred_messages() RPC (0014). Purely additive: the in-chat star toggle is
// unchanged; this just gives the stars a home you can browse and jump from.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from './supabase';
import { getStarredMessages } from '@shared/messageExtras';
import type { StarredMessage } from '@shared/types';
import { modalBackdrop, modalPanel } from './motion';
import { StarIcon } from './Icons';
import { LumixoCat } from './mascot/LumixoCat';
import './StarredMessagesModal.css';

function preview(m: StarredMessage): string {
  if (m.type === 'image') return '📷 Photo';
  if (m.type === 'audio') return '🎤 Voice message';
  if (m.type === 'file') return '📎 Attachment';
  return m.content ?? '';
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function StarredMessagesModal({
  onClose,
  onOpenChat,
}: {
  onClose: () => void;
  onOpenChat: (conversationId: string) => void;
}) {
  const [items, setItems] = useState<StarredMessage[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    getStarredMessages(supabase).then(setItems).catch(() => setItems([]));
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="starred-modal glass" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="starred-title"><StarIcon size={20} filled /> Starred messages</h2>

        {items === null ? (
          <div className="starred-empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="starred-empty">
            <LumixoCat mood="sleeping" size="md" decorative />
            <p>No starred messages yet</p>
            <span>Tap ⭐ on any message to save it here for quick access.</span>
          </div>
        ) : (
          <div className="starred-list">
            {items.map((m) => (
              <button
                key={m.message_id}
                className="starred-row"
                onClick={() => { onOpenChat(m.conversation_id); onClose(); }}
                title="Open in chat"
              >
                <div className="starred-row-head">
                  <span className="starred-chat">{m.conversation_title ?? 'Conversation'}</span>
                  <span className="starred-when">{whenLabel(m.starred_at)}</span>
                </div>
                <div className="starred-sender">{m.sender_name ?? 'Unknown'}</div>
                <div className="starred-body">{preview(m)}</div>
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
