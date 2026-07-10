// Lumixo — Account & Security: email/password change, phone number, two-step
// verification (Supabase TOTP MFA), login/security history, data export, and
// account deletion with a 30-day recovery window. Self-contained; persists via
// accountApi + Supabase auth. Wiring into Settings is deferred (recovery list).

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import {
  changeEmail, changePassword, requestAccountDeletion, cancelAccountDeletion,
  getDeletionRequest, getSecurityEvents, type DeletionRequest, type SecurityEvent,
} from '@shared/accountApi';
import { modalBackdrop, modalPanel } from '../motion';
import './settings-panels.css';

export function AccountSettingsModal({ onClose, onExport }: { onClose: () => void; onExport?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [twofa, setTwofa] = useState<{ secret?: string; uri?: string; factorId?: string; code: string; enabled: boolean }>({ code: '', enabled: false });
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [deletion, setDeletion] = useState<DeletionRequest | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 2600); }

  useEffect(() => {
    getSecurityEvents(supabase).then(setEvents).catch(() => {});
    getDeletionRequest(supabase).then(setDeletion).catch(() => {});
    (async () => {
      try {
        const { data } = await (supabase.auth as any).mfa.listFactors();
        const totp = data?.totp?.find((f: any) => f.status === 'verified');
        if (totp) setTwofa((t) => ({ ...t, enabled: true, factorId: totp.id }));
      } catch { /* MFA may be disabled on the project */ }
    })();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function saveEmail() {
    if (!email.trim()) return;
    const { error } = await changeEmail(supabase, email.trim());
    flash(error ? error.message : 'Confirmation sent to your new email.');
    if (!error) setEmail('');
  }
  async function savePassword() {
    if (password.length < 8) return flash('Use at least 8 characters.');
    const { error } = await changePassword(supabase, password);
    flash(error ? error.message : 'Password updated.');
    if (!error) setPassword('');
  }
  async function savePhone() {
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return;
    const { error } = await supabase.from('profiles').update({ phone: phone.trim() || null }).eq('id', u.user.id);
    flash(error ? 'Could not update phone.' : 'Phone updated.');
  }

  async function start2fa() {
    try {
      const { data, error } = await (supabase.auth as any).mfa.enroll({ factorType: 'totp' });
      if (error) return flash(error.message);
      setTwofa((t) => ({ ...t, secret: data.totp?.secret, uri: data.totp?.uri, factorId: data.id }));
    } catch { flash('Two-step verification is not available on this project.'); }
  }
  async function verify2fa() {
    if (!twofa.factorId || !twofa.code) return;
    try {
      const ch = await (supabase.auth as any).mfa.challenge({ factorId: twofa.factorId });
      if (ch.error) return flash(ch.error.message);
      const v = await (supabase.auth as any).mfa.verify({ factorId: twofa.factorId, challengeId: ch.data.id, code: twofa.code });
      if (v.error) return flash(v.error.message);
      setTwofa((t) => ({ ...t, enabled: true, secret: undefined, uri: undefined, code: '' }));
      flash('Two-step verification enabled.');
    } catch { flash('Could not verify code.'); }
  }
  async function disable2fa() {
    if (!twofa.factorId) return;
    try {
      await (supabase.auth as any).mfa.unenroll({ factorId: twofa.factorId });
      setTwofa({ code: '', enabled: false });
      flash('Two-step verification disabled.');
    } catch { flash('Could not disable.'); }
  }

  async function requestDeletion() {
    if (!confirm('Request account deletion? You will have 30 days to cancel before data is permanently removed.')) return;
    const { request, error } = await requestAccountDeletion(supabase);
    if (error) return flash(error.message);
    setDeletion(request);
    flash('Deletion scheduled. You can cancel within 30 days.');
  }
  async function undoDeletion() {
    const { error } = await cancelAccountDeletion(supabase);
    if (error) return flash(error.message);
    setDeletion(null);
    flash('Account deletion cancelled.');
  }

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="sp-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="sp-title">👤 Account &amp; security</h2>
        <p className="sp-sub">Manage your login, two-step verification and data.</p>

        <section className="sp-section">
          <h3>Email</h3>
          <div className="sp-row">
            <input className="sp-input" type="email" placeholder="New email address" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="sp-btn primary wide" onClick={saveEmail}>Update email</button>
        </section>

        <section className="sp-section">
          <h3>Password</h3>
          <div className="sp-row">
            <input className="sp-input" type="password" placeholder="New password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="sp-btn primary wide" onClick={savePassword}>Change password</button>
        </section>

        <section className="sp-section">
          <h3>Phone number</h3>
          <div className="sp-row">
            <input className="sp-input" type="tel" placeholder="+countrycode number" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <button className="sp-btn wide" onClick={savePhone}>Save phone</button>
        </section>

        <section className="sp-section">
          <h3>Two-step verification</h3>
          {twofa.enabled ? (
            <>
              <div className="sp-note">✅ Two-step verification is on.</div>
              <button className="sp-btn danger wide" onClick={disable2fa}>Disable</button>
            </>
          ) : twofa.uri ? (
            <>
              <div className="sp-note">Add this secret to your authenticator app, then enter the 6-digit code:</div>
              <div className="sp-row"><code style={{ fontSize: 12, wordBreak: 'break-all' }}>{twofa.secret}</code></div>
              <div className="sp-row"><input className="sp-input" inputMode="numeric" placeholder="123456" value={twofa.code} onChange={(e) => setTwofa((t) => ({ ...t, code: e.target.value }))} /></div>
              <button className="sp-btn primary wide" onClick={verify2fa}>Verify &amp; enable</button>
            </>
          ) : (
            <button className="sp-btn wide" onClick={start2fa}>Set up two-step verification</button>
          )}
        </section>

        <section className="sp-section">
          <h3>Your data</h3>
          {onExport && <button className="sp-btn wide" onClick={onExport}>Export / request my data</button>}
        </section>

        <section className="sp-section">
          <h3>Login &amp; security history</h3>
          {events.length === 0 ? <div className="sp-note">No recent security events.</div> : events.slice(0, 10).map((e) => (
            <div className="sp-row" key={e.id}>
              <div className="sp-row-main">
                <div className="sp-row-name">{e.kind.replace('_', ' ')}</div>
                <div className="sp-row-desc">{e.user_agent || 'Unknown device'} · {new Date(e.created_at).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </section>

        <section className="sp-section">
          <h3>Danger zone</h3>
          {deletion ? (
            <>
              <div className="sp-note">⚠️ Deletion scheduled for {new Date(deletion.purge_after).toLocaleDateString()}.</div>
              <button className="sp-btn primary wide" onClick={undoDeletion}>Cancel deletion</button>
            </>
          ) : (
            <button className="sp-btn danger wide" onClick={requestDeletion}>Delete my account</button>
          )}
        </section>

        {toast && <div className="sp-toast">{toast}</div>}
      </motion.div>
    </motion.div>
  );
}
