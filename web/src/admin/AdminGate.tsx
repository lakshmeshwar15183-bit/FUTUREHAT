// FUTUREHAT — client enforcement of the owner/admin controls. Mounted high in the
// tree; it makes the admin surface REAL on the client side:
//   • registers this browser as a device (so the Owner can see/revoke it),
//   • signs out banned / disabled / locked accounts,
//   • honours a force-logout pulse (force_logout_at),
//   • shows a maintenance screen when the `app_enabled` flag is off (non-admins),
//   • shows the latest active announcement as a dismissible banner.
// It is fail-safe: any error path renders null and never blocks the app. All of
// this is advisory UX — the authoritative enforcement lives in the RLS + RPCs.

import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '../AuthContext';
import { usePremium } from '../PremiumContext';
import { supabase } from '../supabase';
import { signOut } from '@shared/api';
import { registerDevice, isFeatureEnabled, getActiveAnnouncements } from '@shared/adminApi';
import type { Announcement } from '@shared/types';

const BLOCKED = new Set(['banned', 'disabled', 'locked']);

export function AdminGate() {
  const { user } = useAuth();
  const { isAdmin } = usePremium();
  const [blocked, setBlocked] = useState<string | null>(null);
  const [maintenance, setMaintenance] = useState(false);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) { setBlocked(null); setMaintenance(false); setAnnouncement(null); return; }
    let active = true;

    (async () => {
      // 1) Register this device (best-effort).
      try {
        let devId = localStorage.getItem('fh:deviceId');
        if (!devId) { devId = crypto.randomUUID(); localStorage.setItem('fh:deviceId', devId); }
        void registerDevice(supabase, devId, navigator.platform || 'Web browser', 'web');
      } catch { /* ignore */ }

      // 2) Enforce account status + force-logout from the caller's own row.
      try {
        const { data } = await supabase
          .from('profiles')
          .select('account_status, force_logout_at')
          .eq('id', user.id)
          .maybeSingle();
        if (!active) return;
        const row = data as { account_status?: string; force_logout_at?: string } | null;
        if (row?.account_status && BLOCKED.has(row.account_status)) {
          setBlocked(row.account_status);
          void signOut(supabase);
          return;
        }
        if (row?.force_logout_at) {
          const ack = localStorage.getItem('fh:forceLogoutAck');
          if (ack !== row.force_logout_at) {
            localStorage.setItem('fh:forceLogoutAck', row.force_logout_at);
            void signOut(supabase);
            return;
          }
        }
      } catch { /* columns may predate the migration — ignore */ }

      // 3) App kill-switch (non-admins only).
      try {
        const enabled = await isFeatureEnabled(supabase, 'app_enabled', true);
        if (active && !enabled && !isAdmin) setMaintenance(true);
      } catch { /* ignore */ }

      // 4) Latest announcement banner.
      try {
        const anns = await getActiveAnnouncements(supabase);
        if (active && anns.length) setAnnouncement(anns[0]);
      } catch { /* ignore */ }
    })();

    return () => { active = false; };
  }, [user, isAdmin]);

  if (blocked) return <Overlay title="Account unavailable" body={`Your account has been ${blocked}. Contact support if you believe this is a mistake.`} />;
  if (maintenance) return <Overlay title="Under maintenance" body="FUTUREHAT is temporarily unavailable. Please check back soon." />;
  if (announcement && !dismissed) {
    return (
      <div style={bannerStyle} role="status">
        <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{announcement.kind.replace('_', ' ')}:</span>{' '}
        <span style={{ fontWeight: 600 }}>{announcement.title}</span>
        {announcement.body ? <span style={{ opacity: 0.85 }}> — {announcement.body}</span> : null}
        <button style={bannerCloseStyle} onClick={() => setDismissed(true)} aria-label="Dismiss">✕</button>
      </div>
    );
  }
  return null;
}

function Overlay({ title, body }: { title: string; body: string }) {
  return (
    <div style={overlayStyle} role="alertdialog" aria-label={title}>
      <div style={overlayCardStyle}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🛠️</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>{title}</h2>
        <p style={{ margin: 0, color: 'var(--fh-muted)', lineHeight: 1.5 }}>{body}</p>
      </div>
    </div>
  );
}

const bannerStyle: CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, zIndex: 900,
  background: 'linear-gradient(90deg,#7c5cff,#5b8cff)', color: '#fff',
  padding: '10px 44px 10px 16px', fontSize: 13.5, textAlign: 'center',
  boxShadow: '0 2px 12px rgba(0,0,0,.25)',
};
const bannerCloseStyle: CSSProperties = {
  position: 'absolute', top: 6, right: 10, width: 26, height: 26,
  border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,.22)',
  color: '#fff', cursor: 'pointer', fontSize: 12,
};
const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 2000, display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(4px)', padding: 20,
};
const overlayCardStyle: CSSProperties = {
  maxWidth: 420, textAlign: 'center', padding: 32,
  background: 'var(--fh-panel)', color: 'var(--fh-text)',
  border: '1px solid var(--fh-border)', borderRadius: 18,
};
