// Lumixo — Diagnostics & app information. Shows app/build/environment info and
// lets the user download a diagnostic report (env + recent captured logs) to
// attach to a support ticket. Self-contained.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getDiagnostics } from './logBuffer';
import { modalBackdrop, modalPanel } from '../motion';
import { APP_VERSION, OWNER } from '../branding';
import './../settings/settings-panels.css';

export function DiagnosticsModal({ onClose }: { onClose: () => void }) {
  const [storage, setStorage] = useState<string>('—');

  useEffect(() => {
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((e) => {
        const mb = (n = 0) => `${(n / 1048576).toFixed(1)} MB`;
        setStorage(`${mb(e.usage)} / ${mb(e.quota)}`);
      }).catch(() => {});
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const info: Record<string, string> = {
    App: 'Lumixo',
    Version: APP_VERSION,
    Developer: OWNER,
    Platform: navigator.platform || 'unknown',
    'User agent': navigator.userAgent,
    Language: navigator.language,
    Online: navigator.onLine ? 'yes' : 'no',
    Connection: (navigator as any).connection?.effectiveType || 'unknown',
    Screen: `${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x`,
    Storage: storage,
  };

  function download() {
    const lines = [
      '=== Lumixo diagnostic report ===',
      `Generated: ${new Date().toISOString()}`,
      '',
      ...Object.entries(info).map(([k, v]) => `${k}: ${v}`),
      '',
      '=== Recent logs ===',
      ...getDiagnostics(),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lumixo-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="sp-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="sp-title">🩺 Diagnostics &amp; app info</h2>
        <p className="sp-sub">Useful when contacting support.</p>

        <section className="sp-section">
          {Object.entries(info).map(([k, v]) => (
            <div className="sp-row" key={k}>
              <div className="sp-row-main">
                <div className="sp-row-name">{k}</div>
                <div className="sp-row-desc" style={{ wordBreak: 'break-all' }}>{v}</div>
              </div>
            </div>
          ))}
        </section>

        <button className="sp-btn primary wide" onClick={download}>Download diagnostic report</button>
        <p className="sp-note">The report is generated locally and only shared if you choose to send it.</p>
      </motion.div>
    </motion.div>
  );
}
