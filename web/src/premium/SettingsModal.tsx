// FUTUREHAT — Settings: appearance, privacy, subscription, and app info.
// Premium-only options are gated inline; selecting one while free opens upgrade.

import { motion } from 'framer-motion';
import { usePremium } from '../PremiumContext';
import { useUpgrade } from './UpgradeProvider';
import { PremiumBadge } from './PremiumBadge';
import { THEMES, FONTS, BUBBLES, WALLPAPERS, APP_ICONS } from '../theme/themes';
import { modalBackdrop, modalPanel } from '../motion';
import { APP_VERSION, OWNER } from '../branding';
import './SettingsModal.css';

export function SettingsModal({ onClose, onEditProfile, onHelp, onAdmin }: {
  onClose: () => void;
  onEditProfile: () => void;
  onHelp: () => void;
  onAdmin?: () => void;
}) {
  const { isPremium, isAdmin, preferences, setPreference } = usePremium();
  const { open: openUpgrade } = useUpgrade();

  function choose(field: keyof typeof preferences, id: string, premium: boolean) {
    if (premium && !isPremium) return openUpgrade();
    setPreference({ [field]: id } as any);
  }

  function toggle(field: 'ghost_mode' | 'app_lock', premium = true) {
    if (premium && !isPremium) return openUpgrade();
    setPreference({ [field]: !preferences[field] } as any);
  }

  const themeList = Object.values(THEMES);
  const fontList = Object.values(FONTS);

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="settings-modal glass" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="settings-title">⚙️ Settings</h2>

        {/* Membership */}
        <section className="settings-section">
          <div className="membership-row">
            <div>
              <div className="membership-label">
                Membership {isPremium && <PremiumBadge compact />}
                {isAdmin && <span className="dev-badge">DEV</span>}
              </div>
              <div className="membership-sub">
                {isAdmin ? 'Developer · lifetime FUTUREHAT+ + Admin' : isPremium ? 'FUTUREHAT+ active' : 'Free plan'}
              </div>
            </div>
            <button className="settings-cta" onClick={openUpgrade}>
              {isPremium ? 'Manage' : 'Upgrade to +'}
            </button>
          </div>
          <button className="settings-link" onClick={() => { onClose(); onEditProfile(); }}>
            Edit profile →
          </button>
        </section>

        {/* Appearance */}
        <section className="settings-section">
          <h3>🎨 Appearance {!isPremium && <span className="lock-hint">premium</span>}</h3>

          <label className="setting-label">Theme</label>
          <div className="chip-row">
            {themeList.map((t) => (
              <button key={t.id}
                className={`swatch ${preferences.theme === t.id ? 'active' : ''} ${t.premium && !isPremium ? 'locked' : ''}`}
                style={{ background: t.swatch }}
                onClick={() => choose('theme', t.id, t.premium)}
                title={t.label}
              >
                {t.premium && !isPremium && <span className="swatch-lock">🔒</span>}
                <span className="swatch-name">{t.label}</span>
              </button>
            ))}
          </div>

          <label className="setting-label">Font</label>
          <div className="chip-row">
            {fontList.map((f) => (
              <button key={f.id}
                className={`pill ${preferences.font === f.id ? 'active' : ''} ${f.premium && !isPremium ? 'locked' : ''}`}
                style={{ fontFamily: f.stack }}
                onClick={() => choose('font', f.id, f.premium)}>
                {f.label}{f.premium && !isPremium ? ' 🔒' : ''}
              </button>
            ))}
          </div>

          <label className="setting-label">Chat bubbles</label>
          <div className="chip-row">
            {BUBBLES.map((b) => (
              <button key={b.id}
                className={`pill ${preferences.bubble_style === b.id ? 'active' : ''} ${b.premium && !isPremium ? 'locked' : ''}`}
                onClick={() => choose('bubble_style', b.id, b.premium)}>
                {b.label}{b.premium && !isPremium ? ' 🔒' : ''}
              </button>
            ))}
          </div>

          <label className="setting-label">Wallpaper</label>
          <div className="chip-row">
            {WALLPAPERS.map((w) => (
              <button key={w.id}
                className={`swatch small ${preferences.wallpaper === w.id ? 'active' : ''} ${w.premium && !isPremium ? 'locked' : ''}`}
                style={{ background: w.preview.replace('background:', '') }}
                onClick={() => choose('wallpaper', w.id, w.premium)}
                title={w.label}>
                {w.premium && !isPremium && <span className="swatch-lock">🔒</span>}
                <span className="swatch-name">{w.label}</span>
              </button>
            ))}
          </div>

          <label className="setting-label">App icon</label>
          <div className="chip-row">
            {APP_ICONS.map((a) => (
              <button key={a.id}
                className={`icon-swatch ${preferences.app_icon === a.id ? 'active' : ''} ${a.premium && !isPremium ? 'locked' : ''}`}
                onClick={() => choose('app_icon', a.id, a.premium)}
                title={a.label}>
                <span className="icon-glyph">{a.glyph}</span>
                {a.premium && !isPremium && <span className="swatch-lock">🔒</span>}
              </button>
            ))}
          </div>
        </section>

        {/* Privacy */}
        <section className="settings-section">
          <h3>🔒 Privacy {!isPremium && <span className="lock-hint">premium</span>}</h3>
          <div className="toggle-row" onClick={() => toggle('ghost_mode')}>
            <div>
              <div className="toggle-name">👻 Ghost mode</div>
              <div className="toggle-sub">Read & type without sending receipts or typing status</div>
            </div>
            <span className={`switch ${isPremium && preferences.ghost_mode ? 'on' : ''}`}><i /></span>
          </div>
          <div className="toggle-row" onClick={() => toggle('app_lock')}>
            <div>
              <div className="toggle-name">🔐 App lock</div>
              <div className="toggle-sub">Require a PIN / Face ID when opening FUTUREHAT</div>
            </div>
            <span className={`switch ${isPremium && preferences.app_lock ? 'on' : ''}`}><i /></span>
          </div>
          <p className="hint">Hide a chat from its conversation menu (•••).</p>
        </section>

        {/* Support & safety */}
        <section className="settings-section">
          <h3>🛟 Support &amp; safety</h3>
          <button className="settings-link" onClick={() => { onClose(); onHelp(); }}>
            Help &amp; Support · tickets · grievance →
          </button>
          {isAdmin && onAdmin && (
            <button className="settings-link" onClick={() => { onClose(); onAdmin(); }}>
              🛡️ Admin dashboard →
            </button>
          )}
        </section>

        {/* About */}
        <section className="settings-section about">
          <h3>ℹ️ About</h3>
          <div className="about-row"><span>App</span><span>FUTUREHAT</span></div>
          <div className="about-row"><span>Version</span><span>{APP_VERSION}</span></div>
          <div className="about-row"><span>Developer</span><span>{OWNER}</span></div>
          <div className="about-credit">Developed by {OWNER}</div>
        </section>
      </motion.div>
    </motion.div>
  );
}
