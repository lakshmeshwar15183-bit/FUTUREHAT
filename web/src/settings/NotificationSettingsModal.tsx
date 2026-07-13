// Lumixo — Notification settings (WhatsApp layout, web parity with mobile).
// Grouped MESSAGE / CALLS / STATUS / GROUPS sections stored in
// user_preferences.extra.notifications (synced to the profile → restore on any
// device). Includes a browser-notification permission button. Sounds use the
// browser/OS default — nothing is bundled and there is no in-app picker.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { getNotificationSettings, setNotificationSettings, toneLabel } from '@shared/notificationsApi';
import type { NotificationSettings } from '@shared/types';
import { ensurePermission, notificationPermission, notificationsSupported } from '../lib/webNotifications';
import { modalBackdrop, modalPanel } from '../motion';
import './settings-panels.css';

export function NotificationSettingsModal({ onClose }: { onClose: () => void }) {
  const [n, setN] = useState<NotificationSettings | null>(null);
  const [perm, setPerm] = useState<NotificationPermission>('default');
  const [toast, setToast] = useState<string | null>(null);
  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 1500); }

  useEffect(() => {
    getNotificationSettings(supabase).then(setN).catch(() => setN(null));
    setPerm(notificationPermission());
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function update(patch: Partial<NotificationSettings>) {
    const next = { ...(n as NotificationSettings), ...patch };
    setN(next);
    const { error } = await setNotificationSettings(supabase, patch);
    flash(error ? 'Could not save' : 'Saved');
  }

  async function requestPerm() {
    const ok = await ensurePermission();
    setPerm(notificationPermission());
    flash(ok ? 'Browser notifications enabled' : 'Permission not granted');
  }

  const Toggle = ({ k, name, desc }: { k: keyof NotificationSettings; name: string; desc?: string }) => (
    <div className="sp-row">
      <div className="sp-row-main"><div className="sp-row-name">{name}</div>{desc && <div className="sp-row-desc">{desc}</div>}</div>
      <button className={`sp-switch ${n && n[k] ? 'on' : ''}`} onClick={() => update({ [k]: !(n && n[k]) } as Partial<NotificationSettings>)} aria-label={`Toggle ${name}`}><i /></button>
    </div>
  );

  const ToneRow = ({ name, value }: { name: string; value: string }) => (
    <div className="sp-row">
      <div className="sp-row-main"><div className="sp-row-name">{name}</div><div className="sp-row-desc">{toneLabel(value)}</div></div>
    </div>
  );

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="sp-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="sp-title">🔔 Notifications</h2>
        <p className="sp-sub">Behaves like WhatsApp. Sounds use your device default.</p>

        {notificationsSupported() && (
          <section className="sp-section">
            <div className="sp-row">
              <div className="sp-row-main">
                <div className="sp-row-name">Browser notifications</div>
                <div className="sp-row-desc">{perm === 'granted' ? 'Enabled' : perm === 'denied' ? 'Blocked in browser settings' : 'Allow Lumixo to notify you'}</div>
              </div>
              {perm !== 'granted' && <button className="sp-select" onClick={requestPerm} disabled={perm === 'denied'}>Enable</button>}
            </div>
          </section>
        )}

        {!n ? <div className="sp-note">Loading…</div> : (
          <>
            <section className="sp-section">
              <h3>Message</h3>
              <Toggle k="messageMute" name="Mute" desc="Silence direct-message notifications" />
              <ToneRow name="Notification tone" value={n.messageTone} />
              <Toggle k="messageVibrate" name="Vibrate" />
              <Toggle k="messagePopup" name="Popup" desc="Show a heads-up banner" />
              <Toggle k="messageHighPriority" name="High priority" desc="Show previews at the top of the screen" />
              <Toggle k="messagePreview" name="Notification preview" desc="Show message text in the notification" />
            </section>

            <section className="sp-section">
              <h3>Calls</h3>
              <ToneRow name="Ringtone" value={n.callRingtone} />
              <Toggle k="callVibrate" name="Vibrate" />
              <Toggle k="callFullScreen" name="Full screen incoming calls" />
              <Toggle k="callFlash" name="Flash screen" desc="Optional" />
            </section>

            <section className="sp-section">
              <h3>Status</h3>
              <Toggle k="statusMute" name="Mute status notifications" />
            </section>

            <section className="sp-section">
              <h3>Groups</h3>
              <Toggle k="groupMute" name="Mute" desc="Silence group-message notifications" />
              <ToneRow name="Notification tone" value={n.groupTone} />
              <Toggle k="groupVibrate" name="Vibrate" />
            </section>
          </>
        )}
        {toast && <div className="sp-toast">{toast}</div>}
      </motion.div>
    </motion.div>
  );
}
