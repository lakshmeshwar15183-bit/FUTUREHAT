// FUTUREHAT — Notification settings: per-category toggles, message preview,
// in-app sound, and quiet hours. Self-contained: reads/writes the
// `user_preferences.extra.notifications` bag directly via premiumApi, so it
// doesn't touch any frozen file. (Actual push delivery needs FCM — see report;
// these preferences are stored and applied to in-app notification behaviour.)

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { getPreferences, updatePreferences } from '@shared/premiumApi';
import { modalBackdrop, modalPanel } from '../motion';
import './settings-panels.css';

interface NotifSettings {
  messages: boolean; groups: boolean; calls: boolean; reactions: boolean;
  preview: boolean; sound: boolean;
  quietHours: boolean; quietFrom: string; quietTo: string;
}
const DEFAULTS: NotifSettings = {
  messages: true, groups: true, calls: true, reactions: true,
  preview: true, sound: true, quietHours: false, quietFrom: '22:00', quietTo: '07:00',
};

export function NotificationSettingsModal({ onClose }: { onClose: () => void }) {
  const [n, setN] = useState<NotifSettings | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 1500); }

  useEffect(() => {
    getPreferences(supabase).then((p: any) => {
      setN({ ...DEFAULTS, ...((p?.extra && p.extra.notifications) ?? {}) });
    }).catch(() => setN(DEFAULTS));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function update(patch: Partial<NotifSettings>) {
    const next = { ...(n ?? DEFAULTS), ...patch };
    setN(next);
    const prefs: any = await getPreferences(supabase).catch(() => ({}));
    const extra = (prefs && typeof prefs.extra === 'object' && prefs.extra) ? prefs.extra : {};
    const { error } = await updatePreferences(supabase, { extra: { ...extra, notifications: next } } as any);
    flash(error ? 'Could not save' : 'Saved');
  }

  const Toggle = ({ k, name, desc }: { k: keyof NotifSettings; name: string; desc: string }) => (
    <div className="sp-row">
      <div className="sp-row-main"><div className="sp-row-name">{name}</div><div className="sp-row-desc">{desc}</div></div>
      <button className={`sp-switch ${n && n[k] ? 'on' : ''}`} onClick={() => update({ [k]: !(n && n[k]) } as Partial<NotifSettings>)} aria-label={`Toggle ${name}`}><i /></button>
    </div>
  );

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="sp-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="sp-title">🔔 Notifications</h2>
        <p className="sp-sub">Choose what you’re notified about and when.</p>

        {!n ? <div className="sp-note">Loading…</div> : (
          <>
            <section className="sp-section">
              <h3>Notify me about</h3>
              <Toggle k="messages" name="Direct messages" desc="New 1:1 messages" />
              <Toggle k="groups" name="Group messages" desc="New messages in groups & channels" />
              <Toggle k="calls" name="Calls" desc="Incoming voice & video calls" />
              <Toggle k="reactions" name="Reactions" desc="When someone reacts to your message" />
            </section>
            <section className="sp-section">
              <h3>Style</h3>
              <Toggle k="preview" name="Message preview" desc="Show message text in notifications" />
              <Toggle k="sound" name="In-app sound" desc="Play a sound for new activity" />
            </section>
            <section className="sp-section">
              <h3>Quiet hours</h3>
              <Toggle k="quietHours" name="Enable quiet hours" desc="Mute notifications during a time window" />
              {n.quietHours && (
                <div className="sp-row">
                  <div className="sp-row-main"><div className="sp-row-name">From / to</div></div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="sp-select" type="time" value={n.quietFrom} onChange={(e) => update({ quietFrom: e.target.value })} />
                    <input className="sp-select" type="time" value={n.quietTo} onChange={(e) => update({ quietTo: e.target.value })} />
                  </div>
                </div>
              )}
            </section>
          </>
        )}
        {toast && <div className="sp-toast">{toast}</div>}
      </motion.div>
    </motion.div>
  );
}
