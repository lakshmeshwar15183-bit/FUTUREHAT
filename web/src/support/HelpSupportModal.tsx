// FUTUREHAT — Help & Support: FAQ, ticket submission (support/bug/feedback/
// appeal/grievance), my tickets, and trust & safety / legal info. Mirrors the
// Android HelpSupport screen so web reaches parity with mobile.

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { submitTicket, getMyTickets } from '@shared/supportApi';
import type { SupportTicket, TicketKind } from '@shared/supportApi';
import { modalBackdrop, modalPanel } from '../motion';
import { OWNER } from '../branding';
import './HelpSupportModal.css';

const FAQ: { q: string; a: string }[] = [
  { q: 'How do I start a new chat?', a: 'Tap ➕ in the sidebar, search a person by name or @username, and open the conversation.' },
  { q: 'What is FUTUREHAT+?', a: 'A premium membership unlocking themes, wallpapers, AI tools, message scheduling, app lock, ghost mode and more.' },
  { q: 'How do reactions and replies work?', a: 'Hover a message to react with an emoji, reply with a quote, forward, edit or delete your own messages.' },
  { q: 'Are my chats private?', a: 'Conversations are protected by row-level security — only participants can read them. See the privacy info below.' },
  { q: 'How do I block or report someone?', a: 'Open a direct chat header menu (•••) to block the user or report abuse. Reports go to our safety team.' },
  { q: 'How do I cancel my subscription?', a: 'Open Settings → Manage. Premium stays active until the end of your current billing period.' },
];

const KINDS: { id: TicketKind; label: string; hint: string }[] = [
  { id: 'support', label: '🆘 Support', hint: 'General help with your account or the app' },
  { id: 'bug', label: '🐞 Bug report', hint: 'Something is broken — device info is attached automatically' },
  { id: 'feedback', label: '💡 Feedback', hint: 'Ideas and feature requests' },
  { id: 'appeal', label: '⚖️ Ban appeal', hint: 'Appeal an account restriction' },
  { id: 'grievance', label: '📜 Grievance', hint: 'Formal complaint — 48h acknowledgement, 15-day resolution' },
];

export function HelpSupportModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'help' | 'tickets'>('help');
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const [kind, setKind] = useState<TicketKind>('support');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  const activeKind = useMemo(() => KINDS.find((k) => k.id === kind)!, [kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab !== 'tickets') return;
    setLoadingTickets(true);
    getMyTickets(supabase).then((t) => { setTickets(t); setLoadingTickets(false); });
  }, [tab]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  async function handleSubmit() {
    if (!subject.trim() || !body.trim()) return flash('Add a subject and a message.');
    setSending(true);
    const deviceInfo = kind === 'bug'
      ? `${navigator.userAgent} · ${window.screen.width}×${window.screen.height}`
      : undefined;
    const { error } = await submitTicket(supabase, kind, subject.trim(), body.trim(), { deviceInfo });
    setSending(false);
    if (error) return flash(error.message || 'Could not submit. Try again.');
    setSubject('');
    setBody('');
    flash('Submitted — we will get back to you.');
    setTab('tickets');
  }

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="help-modal glass" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="help-title">🛟 Help &amp; Support</h2>

        <div className="help-tabs">
          <button className={tab === 'help' ? 'active' : ''} onClick={() => setTab('help')}>Get help</button>
          <button className={tab === 'tickets' ? 'active' : ''} onClick={() => setTab('tickets')}>My tickets</button>
        </div>

        {tab === 'help' ? (
          <div className="help-body">
            <section className="help-section">
              <h3>Frequently asked</h3>
              <div className="faq-list">
                {FAQ.map((f, i) => (
                  <div key={i} className={`faq-item ${openFaq === i ? 'open' : ''}`}>
                    <button className="faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                      <span>{f.q}</span><span className="faq-caret">{openFaq === i ? '−' : '+'}</span>
                    </button>
                    {openFaq === i && <div className="faq-a">{f.a}</div>}
                  </div>
                ))}
              </div>
            </section>

            <section className="help-section">
              <h3>Contact us</h3>
              <div className="kind-row">
                {KINDS.map((k) => (
                  <button key={k.id} className={`kind-pill ${kind === k.id ? 'active' : ''}`} onClick={() => setKind(k.id)}>
                    {k.label}
                  </button>
                ))}
              </div>
              <p className="kind-hint">{activeKind.hint}</p>
              <input
                className="help-input"
                placeholder="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={120}
              />
              <textarea
                className="help-input help-textarea"
                placeholder="Describe it in detail…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
              />
              <button className="help-submit" onClick={handleSubmit} disabled={sending}>
                {sending ? 'Sending…' : 'Submit ticket'}
              </button>
            </section>

            <section className="help-section legal">
              <h3>Trust, safety &amp; privacy</h3>
              <ul className="legal-list">
                <li>🔐 Conversations are gated by row-level security — only participants can read them.</li>
                <li>🚫 Block &amp; report abusive users from any direct chat (•••).</li>
                <li>📜 Grievance officer: complaints acknowledged within 48 hours, resolved within 15 days.</li>
                <li>📄 Terms of Service · Privacy Policy · Community Guidelines apply to all members.</li>
              </ul>
              <div className="help-credit">FUTUREHAT — developed by {OWNER}</div>
            </section>
          </div>
        ) : (
          <div className="help-body">
            {loadingTickets ? (
              <div className="help-empty">Loading your tickets…</div>
            ) : tickets.length === 0 ? (
              <div className="help-empty">No tickets yet. Submit one from “Get help”.</div>
            ) : (
              <div className="ticket-list">
                {tickets.map((t) => (
                  <div key={t.id} className="ticket-card">
                    <div className="ticket-head">
                      <span className="ticket-kind">{KINDS.find((k) => k.id === t.kind)?.label || t.kind}</span>
                      <span className={`ticket-status ${t.status}`}>{t.status.replace('_', ' ')}</span>
                    </div>
                    <div className="ticket-subject">{t.subject}</div>
                    <div className="ticket-body">{t.body}</div>
                    <div className="ticket-date">{new Date(t.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {toast && <div className="help-toast">{toast}</div>}
      </motion.div>
    </motion.div>
  );
}
