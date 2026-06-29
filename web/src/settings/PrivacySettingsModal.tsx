// FUTUREHAT — Privacy settings: last seen / photo / about / links / status /
// groups / calls / avatar visibility, read receipts, and a blocked-contacts
// manager. Self-contained: persists via privacyApi (user_preferences.extra) and
// supportApi. Wiring into the main Settings screen is deferred (recovery list).

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { getPrivacy, setPrivacy, type PrivacySettings, type Visibility } from '@shared/privacyApi';
import { getBlockedIds, unblockUser } from '@shared/supportApi';
import { getProfile } from '@shared/api';
import type { Profile } from '@shared/types';
import { modalBackdrop, modalPanel } from '../motion';
import './settings-panels.css';

const VIS_ROWS: { key: keyof PrivacySettings; name: string; desc: string }[] = [
  { key: 'lastSeen', name: 'Last seen & online', desc: 'Who can see when you were last active' },
  { key: 'profilePhoto', name: 'Profile photo', desc: 'Who can see your photo' },
  { key: 'about', name: 'About', desc: 'Who can see your bio' },
  { key: 'links', name: 'Links', desc: 'Who can see your social links' },
  { key: 'status', name: 'Status', desc: 'Who can see your status updates' },
  { key: 'groups', name: 'Groups', desc: 'Who can add you to groups' },
  { key: 'calls', name: 'Calls', desc: 'Who can call you' },
  { key: 'avatar', name: 'Avatar', desc: 'Who can see your avatar in chats' },
];

export function PrivacySettingsModal({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState<PrivacySettings | null>(null);
  const [blocked, setBlocked] = useState<Profile[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 1800); }

  useEffect(() => {
    getPrivacy(supabase).then(setP).catch(() => setP(null));
    (async () => {
      const ids = await getBlockedIds(supabase).catch(() => []);
      const profiles = await Promise.all(ids.map((id) => getProfile(supabase, id).catch(() => null)));
      setBlocked(profiles.filter(Boolean) as Profile[]);
    })();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function update(patch: Partial<PrivacySettings>) {
    setP((cur) => (cur ? { ...cur, ...patch } : cur));
    const { error } = await setPrivacy(supabase, patch);
    flash(error ? 'Could not save' : 'Saved');
  }

  async function unblock(id: string) {
    setBlocked((b) => b.filter((x) => x.id !== id));
    await unblockUser(supabase, id);
  }

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="sp-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="sp-title">🔒 Privacy</h2>
        <p className="sp-sub">Control who can see your activity and reach you.</p>

        {!p ? <div className="sp-note">Loading…</div> : (
          <>
            <section className="sp-section">
              <h3>Who can see</h3>
              {VIS_ROWS.map((row) => (
                <div className="sp-row" key={row.key}>
                  <div className="sp-row-main">
                    <div className="sp-row-name">{row.name}</div>
                    <div className="sp-row-desc">{row.desc}</div>
                  </div>
                  <select className="sp-select" value={p[row.key] as Visibility}
                    onChange={(e) => update({ [row.key]: e.target.value as Visibility } as Partial<PrivacySettings>)}>
                    <option value="everyone">Everyone</option>
                    <option value="contacts">My contacts</option>
                    <option value="nobody">Nobody</option>
                  </select>
                </div>
              ))}
            </section>

            <section className="sp-section">
              <h3>Receipts</h3>
              <div className="sp-row">
                <div className="sp-row-main">
                  <div className="sp-row-name">Read receipts</div>
                  <div className="sp-row-desc">If off, you won’t send or see blue ticks</div>
                </div>
                <button className={`sp-switch ${p.readReceipts ? 'on' : ''}`} onClick={() => update({ readReceipts: !p.readReceipts })} aria-label="Toggle read receipts"><i /></button>
              </div>
            </section>

            <section className="sp-section">
              <h3>Blocked contacts ({blocked.length})</h3>
              {blocked.length === 0 ? <div className="sp-note">You haven’t blocked anyone.</div> : blocked.map((u) => (
                <div className="sp-blocked" key={u.id}>
                  <div className="av">{u.display_name?.[0]?.toUpperCase() || '?'}</div>
                  <div className="nm">{u.display_name || 'User'} {u.username ? `· @${u.username}` : ''}</div>
                  <button onClick={() => unblock(u.id)}>Unblock</button>
                </div>
              ))}
            </section>
          </>
        )}
        {toast && <div className="sp-toast">{toast}</div>}
      </motion.div>
    </motion.div>
  );
}
