// Lumixo — Settings: appearance, privacy, subscription, and app info.
// Premium-only options are gated inline; selecting one while free opens upgrade.

import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../AuthContext';
import { usePremium } from '../PremiumContext';
import { useUpgrade } from './UpgradeProvider';
import { PremiumBadge } from './PremiumBadge';
import { supabase } from '../supabase';
import { getServerModerator, getMailboxUnseenCount } from '@shared/adminApi';
import '../moderator/ModeratorDashboard.css';
import { THEMES, FONTS, BUBBLES, WALLPAPERS, APP_ICONS, applyPreferences } from '../theme/themes';
import {
  APPEARANCE_OPTIONS,
  getStoredAppearanceMode,
  setStoredAppearanceMode,
  type AppearanceMode,
} from '../theme/appearanceMode';
import { modalBackdrop, modalPanel } from '../motion';
import { APP_VERSION, CREDIT, SUPPORT_EMAIL } from '../branding';
import { LumixoCat } from '../mascot/LumixoCat';
import { useEscapeToClose } from '../useEscapeToClose';
import { safeCssUrl } from '../util/safeUrl';
import './SettingsModal.css';

// Settings sub-panels are lazy-loaded and rendered from within Settings itself.
const PrivacySettingsModal = lazy(() => import('../settings/PrivacySettingsModal').then((m) => ({ default: m.PrivacySettingsModal })));
const ChatSettingsModal = lazy(() => import('../settings/ChatSettingsModal').then((m) => ({ default: m.ChatSettingsModal })));
const AccountSettingsModal = lazy(() => import('../settings/AccountSettingsModal').then((m) => ({ default: m.AccountSettingsModal })));
const NotificationSettingsModal = lazy(() => import('../settings/NotificationSettingsModal').then((m) => ({ default: m.NotificationSettingsModal })));
const StorageSettingsModal = lazy(() => import('../settings/StorageSettingsModal').then((m) => ({ default: m.StorageSettingsModal })));
const ArchivedChatsModal = lazy(() => import('../settings/ArchivedChatsModal').then((m) => ({ default: m.ArchivedChatsModal })));
const LegalModal = lazy(() => import('../legal/LegalModal').then((m) => ({ default: m.LegalModal })));
const DiagnosticsModal = lazy(() => import('../diagnostics/DiagnosticsModal').then((m) => ({ default: m.DiagnosticsModal })));
const DataExportModal = lazy(() => import('../account/DataExportModal').then((m) => ({ default: m.DataExportModal })));
const InviteModal = lazy(() => import('../invite/InviteModal').then((m) => ({ default: m.InviteModal })));
const StreaksPanel = lazy(() => import('../settings/StreaksPanel').then((m) => ({ default: m.StreaksPanel })));

type SubPanel = 'privacy' | 'chats' | 'account' | 'notifications' | 'storage' | 'archived' | 'legal' | 'diagnostics' | 'export' | 'invite' | 'streaks';

export function SettingsModal({ onClose, onEditProfile, onHelp, onAdmin, onModerator, onMailbox }: {
  onClose: () => void;
  onEditProfile: () => void;
  onHelp: () => void;
  onAdmin?: () => void;
  onModerator?: () => void;
  onMailbox?: () => void;
}) {
  const { profile } = useAuth();
  const { isPremium, isAdmin, isOwner, preferences, setPreference } = usePremium();
  const { open: openUpgrade } = useUpgrade();
  const [sub, setSub] = useState<SubPanel | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [unseenMail, setUnseenMail] = useState(0);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => getStoredAppearanceMode());
  const [settingsQuery, setSettingsQuery] = useState('');

  useEffect(() => {
    getServerModerator(supabase).then(setIsModerator).catch(() => {});
    getMailboxUnseenCount(supabase).then(setUnseenMail).catch(() => {});
  }, []);

  function chooseAppearance(mode: AppearanceMode) {
    setAppearanceMode(mode);
    setStoredAppearanceMode(mode);
    // Re-apply prefs so Classic chrome picks up light/dark immediately.
    applyPreferences(
      {
        theme: preferences.theme,
        font: preferences.font,
        bubble_style: preferences.bubble_style,
        wallpaper: preferences.wallpaper,
        app_icon: preferences.app_icon,
      },
      isPremium,
    );
  }
  // Escape closes the open sub-panel first, then the Settings modal itself.
  useEscapeToClose(useCallback(() => (sub ? setSub(null) : onClose()), [sub, onClose]));

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

  const q = settingsQuery.trim().toLowerCase();
  const match = useCallback(
    (...terms: string[]) => {
      if (!q) return true;
      return terms.some((t) => t.toLowerCase().includes(q));
    },
    [q],
  );

  const showAppearance = match(
    'appearance', 'theme', 'light', 'dark', 'system', 'wallpaper', 'font', 'bubble', 'icon', 'display',
  );
  const showPrivacyQuick = match('privacy', 'ghost', 'app lock', 'lock', 'hide');
  const showAccount = match(
    'account', 'security', '2fa', 'password', 'privacy', 'blocked', 'notifications', 'visibility',
  );
  const showChats = match(
    'chat', 'streak', 'archived', 'storage', 'export', 'invite', 'data', 'backup', 'cache',
  );
  const showSupport = match(
    'help', 'support', 'legal', 'terms', 'diagnostics', 'mailbox', 'moderator', 'admin', 'grievance', 'faq',
  );
  const showAbout = match('about', 'version', 'build', 'license', 'support', 'lumi', 'mascot');
  const showMembership = match('premium', 'membership', 'plus', 'plan', 'razorpay', 'subscribe');
  const showProfile = !q || match('profile', 'name', 'photo', 'username', 'account');

  const anyVisible =
    showProfile || showMembership || showAppearance || showPrivacyQuick ||
    showAccount || showChats || showSupport || showAbout;

  return (
    <>
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="settings-modal glass" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="settings-title">Settings</h2>

        <div className="settings-search" role="search">
          <span className="settings-search-icon" aria-hidden>⌕</span>
          <input
            type="search"
            className="settings-search-input"
            placeholder="Search settings"
            value={settingsQuery}
            onChange={(e) => setSettingsQuery(e.target.value)}
            aria-label="Search settings"
            autoComplete="off"
          />
          {settingsQuery && (
            <button
              type="button"
              className="settings-search-clear"
              onClick={() => setSettingsQuery('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {!anyVisible && (
          <div className="settings-search-empty">
            No settings match “{settingsQuery.trim()}”
          </div>
        )}

        {/* Profile header */}
        {showProfile && (
        <section className="settings-section">
          <div className="settings-profile">
            <div
              className="avatar avatar-wrap settings-avatar"
              style={safeCssUrl(profile?.avatar_url) ? { backgroundImage: safeCssUrl(profile?.avatar_url), backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            >
              {!profile?.avatar_url && (profile?.display_name?.[0]?.toUpperCase() || '?')}
            </div>
            <div className="settings-profile-meta">
              <div className="settings-profile-name">
                {profile?.display_name || 'Lumixo user'}
                {isPremium && <PremiumBadge compact />}
                {isModerator && !isAdmin && <span className="mod-badge" title="Lumixo Moderator">🛡 MOD</span>}
                {isAdmin && <span className="dev-badge">DEV</span>}
              </div>
              {profile?.username && <div className="settings-profile-handle">@{profile.username}</div>}
              <div className="membership-sub">
                {isAdmin ? 'Lumixo+ · Lifetime membership' : isPremium ? 'Lumixo+ member' : 'Free plan'}
              </div>
            </div>
          </div>
        </section>
        )}

        {/* Membership */}
        {showMembership && (
        <section className="settings-section">
          <div className="membership-row">
            <div>
              <div className="membership-label">
                Membership {isPremium && <PremiumBadge compact />}
                {isAdmin && <span className="dev-badge">DEV</span>}
                {!isPremium && !isAdmin && <span className="soon-tag">Lumixo+ · Available soon</span>}
              </div>
              <div className="membership-sub">
                {isAdmin ? 'Developer · lifetime Lumixo+ + Admin' : isPremium ? 'Lumixo+ active' : 'Free plan · premium launching soon'}
              </div>
            </div>
            <button className="settings-cta" onClick={openUpgrade}>
              {isPremium ? 'Manage' : 'Preview +'}
            </button>
          </div>
          <button className="settings-link" onClick={() => { onClose(); onEditProfile(); }}>
            Edit profile →
          </button>
        </section>
        )}

        {/* Appearance */}
        {showAppearance && (
        <section className="settings-section">
          <h3>Appearance</h3>

          <label className="setting-label">Display mode</label>
          <div className="chip-row">
            {APPEARANCE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`pill ${appearanceMode === opt.id ? 'active' : ''}`}
                onClick={() => chooseAppearance(opt.id)}
                title={opt.sub}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="setting-hint" style={{ marginTop: 6, opacity: 0.75, fontSize: 12 }}>
            Default is Follow System (like WhatsApp). Light and Dark are optional overrides you choose here.
          </p>

          <label className="setting-label">Color theme {!isPremium && <span className="lock-hint">premium</span>}</label>
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
          <p className="hint" style={{ marginTop: 0 }}>Current: {APP_ICONS.find((x) => x.id === preferences.app_icon)?.label ?? 'Icon 1'}. App name stays Lumixo.</p>
          <div className="chip-row">
            {APP_ICONS.map((a) => (
              <button key={a.id}
                className={`icon-swatch ${preferences.app_icon === a.id ? 'active' : ''}`}
                onClick={() => choose('app_icon', a.id, false)}
                title={a.label}
                style={{ background: a.color, color: '#fff', minWidth: 64 }}>
                <span className="icon-glyph">{a.glyph}</span>
                <span style={{ fontSize: 10, display: 'block' }}>{a.label}</span>
              </button>
            ))}
          </div>
        </section>
        )}

        {/* Privacy */}
        {showPrivacyQuick && (
        <section className="settings-section">
          <h3>Privacy {!isPremium && <span className="lock-hint">premium</span>}</h3>
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
              <div className="toggle-sub">Require a PIN / Face ID when opening Lumixo</div>
            </div>
            <span className={`switch ${isPremium && preferences.app_lock ? 'on' : ''}`}><i /></span>
          </div>
          <p className="hint">Hide a chat from its conversation menu (•••).</p>
        </section>
        )}

        {/* Account & privacy */}
        {showAccount && (
        <section className="settings-section">
          <h3>Account &amp; privacy</h3>
          <button className="settings-link" onClick={() => setSub('account')}>Account &amp; security · 2FA →</button>
          <button className="settings-link" onClick={() => setSub('privacy')}>Privacy · visibility · blocked →</button>
          <button className="settings-link" onClick={() => setSub('notifications')}>Notifications →</button>
        </section>
        )}

        {/* Chats & data */}
        {showChats && (
        <section className="settings-section">
          <h3>Chats &amp; data</h3>
          <button className="settings-link" onClick={() => setSub('chats')}>Chat settings →</button>
          <button className="settings-link" onClick={() => setSub('streaks')}>Streaks →</button>
          <button className="settings-link" onClick={() => setSub('archived')}>Archived chats →</button>
          <button className="settings-link" onClick={() => setSub('storage')}>Storage &amp; data →</button>
          <button className="settings-link" onClick={() => setSub('export')}>Export my data · backup →</button>
          <button className="settings-link" onClick={() => setSub('invite')}>Invite friends →</button>
        </section>
        )}

        {/* Support & safety */}
        {showSupport && (
        <section className="settings-section">
          <h3>Support &amp; safety</h3>
          <button className="settings-link" onClick={() => { onClose(); onHelp(); }}>
            Help &amp; Support · FAQ · grievance →
          </button>
          <button className="settings-link" onClick={() => setSub('legal')}>Terms · Privacy · Licenses →</button>
          <button className="settings-link" onClick={() => setSub('diagnostics')}>Diagnostics · version · what&apos;s new →</button>
          {onMailbox && (
            <button className="settings-link" onClick={() => { onClose(); onMailbox(); }}>
              Mailbox
              {unseenMail > 0 && <span className="mailbox-count">{unseenMail}</span>} →
            </button>
          )}
          {isModerator && onModerator && (
            <button className="settings-link" onClick={() => { onClose(); onModerator(); }}>
              Moderator dashboard →
            </button>
          )}
          {isOwner && onAdmin && (
            <button className="settings-link" onClick={() => { onClose(); onAdmin(); }}>
              Admin dashboard →
            </button>
          )}
        </section>
        )}

        {/* About */}
        {showAbout && (
        <section className="settings-section about">
          <h3>About</h3>
          <div className="about-mascot" aria-hidden>
            <LumixoCat mood="wave" size="sm" decorative />
          </div>
          <div className="about-row"><span>App</span><span>Lumixo</span></div>
          <div className="about-row"><span>Mascot</span><span>Lumi</span></div>
          <div className="about-row"><span>Version</span><span>{APP_VERSION}</span></div>
          <div className="about-row"><span>Build</span><span>{String(APP_VERSION).replace(/\./g, '')}</span></div>
          <div className="about-row"><span>Support</span><span><a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Lumixo Support Request')}`}>{SUPPORT_EMAIL}</a></span></div>
          <div className="about-credit">{CREDIT}</div>
        </section>
        )}
      </motion.div>
    </motion.div>

    <Suspense fallback={null}>
      <AnimatePresence>
        {sub === 'privacy' && <PrivacySettingsModal onClose={() => setSub(null)} />}
        {sub === 'chats' && <ChatSettingsModal onClose={() => setSub(null)} />}
        {sub === 'account' && <AccountSettingsModal onClose={() => setSub(null)} onExport={() => setSub('export')} />}
        {sub === 'notifications' && <NotificationSettingsModal onClose={() => setSub(null)} />}
        {sub === 'storage' && <StorageSettingsModal onClose={() => setSub(null)} />}
        {sub === 'archived' && <ArchivedChatsModal onClose={() => setSub(null)} />}
        {sub === 'streaks' && <StreaksPanel onClose={() => setSub(null)} />}
        {sub === 'legal' && <LegalModal onClose={() => setSub(null)} />}
        {sub === 'diagnostics' && <DiagnosticsModal onClose={() => setSub(null)} />}
        {sub === 'export' && <DataExportModal onClose={() => setSub(null)} />}
        {sub === 'invite' && <InviteModal onClose={() => setSub(null)} />}
      </AnimatePresence>
    </Suspense>
    </>
  );
}
