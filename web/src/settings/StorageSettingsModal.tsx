// FUTUREHAT — Storage & data: storage usage estimate, data-saver for calls,
// upload quality reminder, and clear-cached-media. Self-contained; the data-saver
// flag lives in user_preferences.extra.storage (read by the call layer to lower
// video constraints). Some native items (per-network download rules, OS-level
// network usage, proxy) are not available on the web platform — see report.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { getPreferences, updatePreferences } from '@shared/premiumApi';
import { modalBackdrop, modalPanel } from '../motion';
import './settings-panels.css';

interface StorageSettings { dataSaverCalls: boolean; lowDataMode: boolean }
const DEFAULTS: StorageSettings = { dataSaverCalls: false, lowDataMode: false };

function fmtBytes(b: number): string {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

export function StorageSettingsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<StorageSettings | null>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 1800); }

  useEffect(() => {
    getPreferences(supabase).then((p: any) => setS({ ...DEFAULTS, ...((p?.extra && p.extra.storage) ?? {}) })).catch(() => setS(DEFAULTS));
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => {});
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function update(patch: Partial<StorageSettings>) {
    const next = { ...(s ?? DEFAULTS), ...patch };
    setS(next);
    const prefs: any = await getPreferences(supabase).catch(() => ({}));
    const extra = (prefs && typeof prefs.extra === 'object' && prefs.extra) ? prefs.extra : {};
    const { error } = await updatePreferences(supabase, { extra: { ...extra, storage: next } } as any);
    flash(error ? 'Could not save' : 'Saved');
  }

  async function clearCache() {
    try {
      if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
      flash('Cached media cleared.');
      if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }); }
    } catch { flash('Could not clear cache.'); }
  }

  const pct = usage && usage.quota ? Math.min(100, Math.round((usage.used / usage.quota) * 100)) : 0;

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="sp-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="sp-title">💾 Storage &amp; data</h2>
        <p className="sp-sub">Manage local storage and data usage.</p>

        <section className="sp-section">
          <h3>Storage used</h3>
          {usage ? (
            <>
              <div className="sp-row">
                <div className="sp-row-main">
                  <div className="sp-row-name">{fmtBytes(usage.used)} used</div>
                  <div className="sp-row-desc">of {fmtBytes(usage.quota)} available ({pct}%)</div>
                </div>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: 'rgba(127,127,127,.25)', overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--fh-accent)' }} />
              </div>
              <button className="sp-btn wide" onClick={clearCache}>Clear cached media</button>
            </>
          ) : <div className="sp-note">Storage estimate not available in this browser.</div>}
        </section>

        {s && (
          <section className="sp-section">
            <h3>Data usage</h3>
            <div className="sp-row">
              <div className="sp-row-main"><div className="sp-row-name">Data saver for calls</div><div className="sp-row-desc">Lower video quality to use less data</div></div>
              <button className={`sp-switch ${s.dataSaverCalls ? 'on' : ''}`} onClick={() => update({ dataSaverCalls: !s.dataSaverCalls })} aria-label="Toggle data saver for calls"><i /></button>
            </div>
            <div className="sp-row">
              <div className="sp-row-main"><div className="sp-row-name">Low-data mode</div><div className="sp-row-desc">Reduce background data and media autoplay</div></div>
              <button className={`sp-switch ${s.lowDataMode ? 'on' : ''}`} onClick={() => update({ lowDataMode: !s.lowDataMode })} aria-label="Toggle low data mode"><i /></button>
            </div>
            <p className="sp-note">Per-network rules, OS network-usage stats and proxy settings aren’t available to web apps.</p>
          </section>
        )}
        {toast && <div className="sp-toast">{toast}</div>}
      </motion.div>
    </motion.div>
  );
}
