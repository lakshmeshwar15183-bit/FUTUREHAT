// Lumixo — Chat settings: Enter-to-send, font size, media visibility, upload
// quality, auto-download, voice-message transcripts. Self-contained; persists
// via privacyApi chat-settings (user_preferences.extra). Font size also applies
// live to the document root so the change is visible immediately.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { getChatSettings, setChatSettings, type ChatSettings, type FontSize, type MediaQuality } from '@shared/privacyApi';
import { modalBackdrop, modalPanel } from '../motion';
import './settings-panels.css';

const FONT_PX: Record<FontSize, string> = { small: '14px', medium: '16px', large: '18px' };

export function applyFontSize(size: FontSize) {
  document.documentElement.style.setProperty('--fh-font-size', FONT_PX[size]);
}

export function ChatSettingsModal({ onClose }: { onClose: () => void }) {
  const [c, setC] = useState<ChatSettings | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 1600); }

  useEffect(() => {
    getChatSettings(supabase).then((s) => { setC(s); applyFontSize(s.fontSize); }).catch(() => setC(null));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function update(patch: Partial<ChatSettings>) {
    setC((cur) => (cur ? { ...cur, ...patch } : cur));
    if (patch.fontSize) applyFontSize(patch.fontSize);
    const { error } = await setChatSettings(supabase, patch);
    flash(error ? 'Could not save' : 'Saved');
  }

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="sp-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="sp-title">💬 Chats</h2>
        <p className="sp-sub">Composition, text size and media behaviour.</p>

        {!c ? <div className="sp-note">Loading…</div> : (
          <section className="sp-section">
            <div className="sp-row">
              <div className="sp-row-main">
                <div className="sp-row-name">Enter to send</div>
                <div className="sp-row-desc">Press Enter to send; Shift+Enter for a new line</div>
              </div>
              <button className={`sp-switch ${c.enterToSend ? 'on' : ''}`} onClick={() => update({ enterToSend: !c.enterToSend })} aria-label="Toggle enter to send"><i /></button>
            </div>

            <div className="sp-row">
              <div className="sp-row-main"><div className="sp-row-name">Font size</div><div className="sp-row-desc">Message text size</div></div>
              <select className="sp-select" value={c.fontSize} onChange={(e) => update({ fontSize: e.target.value as FontSize })}>
                <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
              </select>
            </div>

            <div className="sp-row">
              <div className="sp-row-main"><div className="sp-row-name">Media visibility</div><div className="sp-row-desc">Show downloaded media in your device gallery</div></div>
              <button className={`sp-switch ${c.mediaVisibility ? 'on' : ''}`} onClick={() => update({ mediaVisibility: !c.mediaVisibility })} aria-label="Toggle media visibility"><i /></button>
            </div>

            <div className="sp-row">
              <div className="sp-row-main"><div className="sp-row-name">Upload quality</div><div className="sp-row-desc">Quality of photos & video you send</div></div>
              <select className="sp-select" value={c.mediaUploadQuality} onChange={(e) => update({ mediaUploadQuality: e.target.value as MediaQuality })}>
                <option value="auto">Auto</option><option value="high">High</option><option value="data_saver">Data saver</option>
              </select>
            </div>

            <div className="sp-row">
              <div className="sp-row-main"><div className="sp-row-name">Auto-download media</div><div className="sp-row-desc">Download incoming media automatically</div></div>
              <button className={`sp-switch ${c.autoDownload ? 'on' : ''}`} onClick={() => update({ autoDownload: !c.autoDownload })} aria-label="Toggle auto-download"><i /></button>
            </div>

            <div className="sp-row">
              <div className="sp-row-main"><div className="sp-row-name">Voice message transcripts</div><div className="sp-row-desc">Show a text transcript under voice notes (premium / where available)</div></div>
              <button className={`sp-switch ${c.voiceTranscripts ? 'on' : ''}`} onClick={() => update({ voiceTranscripts: !c.voiceTranscripts })} aria-label="Toggle voice transcripts"><i /></button>
            </div>
          </section>
        )}
        {toast && <div className="sp-toast">{toast}</div>}
      </motion.div>
    </motion.div>
  );
}
