// Lumixo — Legal center: Terms of Service, Privacy Policy and Community
// Guidelines. Original content for Lumixo (not copied from any other app).
// Self-contained; open from Settings / Help. `tab` selects the initial section.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { modalBackdrop, modalPanel } from '../motion';
import { APP_VERSION, OWNER } from '../branding';
import './LegalModal.css';

type Tab = 'terms' | 'privacy' | 'guidelines';

export function LegalModal({ onClose, initial = 'terms' }: { onClose: () => void; initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="legal-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="legal-title">📄 Legal & policies</h2>
        <div className="legal-tabs">
          <button className={tab === 'terms' ? 'active' : ''} onClick={() => setTab('terms')}>Terms</button>
          <button className={tab === 'privacy' ? 'active' : ''} onClick={() => setTab('privacy')}>Privacy</button>
          <button className={tab === 'guidelines' ? 'active' : ''} onClick={() => setTab('guidelines')}>Guidelines</button>
        </div>

        <div className="legal-body">
          {tab === 'terms' && (
            <>
              <h3>Terms of Service</h3>
              <p>Welcome to Lumixo. By creating an account you agree to use the service lawfully and respectfully. You are responsible for the content you send and for keeping your account secure.</p>
              <h4>Your account</h4>
              <p>You must provide accurate information and are responsible for activity under your account. Do not share credentials or impersonate others.</p>
              <h4>Acceptable use</h4>
              <p>Do not use Lumixo to harass, defraud, distribute malware, infringe rights, or share illegal content. We may suspend accounts that violate these terms.</p>
              <h4>Premium (Lumixo+)</h4>
              <p>Paid features are billed per the plan you choose. Cancelling stops future renewals; access continues until the end of the current period.</p>
              <h4>Liability</h4>
              <p>Lumixo is provided “as is”. To the extent permitted by law, we are not liable for indirect or consequential damages.</p>
            </>
          )}
          {tab === 'privacy' && (
            <>
              <h3>Privacy Policy</h3>
              <p>We collect only what is needed to run the service: your profile, messages, and basic usage required for delivery and safety.</p>
              <h4>How your data is protected</h4>
              <p>Conversations are protected by row-level security — only participants can read them. Data is encrypted in transit (TLS) and at rest by our infrastructure provider.</p>
              <h4>What we store</h4>
              <p>Profile details you provide, your messages and media, preferences, and subscription status. Media is stored in access-controlled buckets.</p>
              <h4>Your controls</h4>
              <p>You can edit your profile, manage privacy visibility, block users, mute chats, export your data, and request account deletion at any time.</p>
              <h4>Sharing</h4>
              <p>We do not sell your data. Limited processors (hosting, payments) handle data solely to provide the service.</p>
            </>
          )}
          {tab === 'guidelines' && (
            <>
              <h3>Community Guidelines</h3>
              <p>Lumixo is for everyone. Keep it safe and welcoming.</p>
              <ul>
                <li>Be respectful — no harassment, hate speech, or threats.</li>
                <li>No spam, scams, or deceptive behaviour.</li>
                <li>No illegal content, CSAM, or promotion of violence.</li>
                <li>Respect privacy — don’t share others’ private information.</li>
                <li>Report abuse from any chat or profile; our safety team reviews every report.</li>
              </ul>
              <p>Violations may lead to content removal, suspension, or a permanent ban. You can appeal via Help &amp; Support.</p>
            </>
          )}
        </div>

        <div className="legal-foot">Lumixo v{APP_VERSION} · Developed by {OWNER}</div>
      </motion.div>
    </motion.div>
  );
}
