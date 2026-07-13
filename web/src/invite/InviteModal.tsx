// Lumixo — invite friends: shareable link, native share sheet ("invite
// through installed apps" via the Web Share API), and copy-to-clipboard. The
// link carries an optional ?ref=<username> so an invitee lands ready to find the
// inviter. QR generation is intentionally left to a follow-up (needs a small
// encoder lib; external QR image services are blocked by our CSP and would leak
// data). Self-contained; open from Settings / sidebar (wiring deferred).

import { useState } from 'react';
import { motion } from 'framer-motion';
import { modalBackdrop, modalPanel } from '../motion';
import { useEscapeToClose } from '../useEscapeToClose';
import './InviteModal.css';

export function InviteModal({ onClose, username }: { onClose: () => void; username?: string }) {
  useEscapeToClose(onClose);
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://futurehat-app.netlify.app';
  const link = username ? `${origin}/?ref=${encodeURIComponent(username)}` : origin;
  const message = `Join me on Lumixo — real-time messaging, reimagined. ${link}`;

  async function share() {
    if (navigator.share) {
      try { await navigator.share({ title: 'Join me on Lumixo', text: message, url: link }); } catch { /* cancelled */ }
    } else {
      await copy();
    }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  }

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="invite-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="invite-title">🎉 Invite friends</h2>
        <p className="invite-desc">Share Lumixo with the people you want to chat with.</p>

        <div className="invite-link-row">
          <input className="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button className="invite-copy" onClick={copy}>{copied ? '✓' : 'Copy'}</button>
        </div>

        <button className="invite-share" onClick={share}>📤 Invite through apps</button>

        <p className="invite-note">Anyone with this link can create an account and start chatting with you.</p>
      </motion.div>
    </motion.div>
  );
}
