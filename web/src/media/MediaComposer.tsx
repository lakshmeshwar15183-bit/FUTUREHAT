// FUTUREHAT web — media composer (graceful subset of the mobile editor). The web
// platform can't run Skia/native crop/video-trim, so web ships what browsers do well:
// multi-file selection, a grid preview, per-file caption, quality (Standard/HD/
// Original via a <canvas> re-encode for images), and View Once. Videos upload as-is.
// Sends through the SAME shared uploadMedia + sendMessage(mediaMeta) pipeline used
// everywhere, so web/mobile stay consistent. Native-only tools are simply absent.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { uploadMedia, sendMessage } from '@shared/api';
import type { MediaMeta } from '@shared/types';
import { FREE_LIMITS, PREMIUM_LIMITS } from '@shared/premium/features';
import { modalBackdrop, modalPanel } from '../motion';
import './MediaComposer.css';

type Quality = 'standard' | 'hd' | 'original';
const IMG_LONG_EDGE: Record<Quality, number> = { standard: 1600, hd: 2560, original: Infinity };

interface Item {
  file: File;
  url: string;            // object URL for preview
  isImage: boolean;
  caption: string;
  quality: Quality;
  viewOnce: boolean;
  width?: number;
  height?: number;
}

// Re-encode an image File to the target long-edge as JPEG via canvas. Returns the
// original File for 'original' or on any failure (never throws).
async function reencode(file: File, quality: Quality): Promise<{ blob: Blob; width: number; height: number }> {
  const longEdge = IMG_LONG_EDGE[quality];
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { blob: file, width: 0, height: 0 };
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  if (quality === 'original' || scale === 1) return { blob: file, width: bitmap.width, height: bitmap.height };
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blob: file, width: bitmap.width, height: bitmap.height };
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality === 'hd' ? 0.92 : 0.8));
  return blob ? { blob, width: w, height: h } : { blob: file, width: bitmap.width, height: bitmap.height };
}

export function MediaComposer({ convId, isPremium, files, onClose, onSent, onUpgrade }: {
  convId: string;
  isPremium: boolean;
  files: File[];
  onClose: () => void;
  onSent: () => void;
  onUpgrade: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voAck, setVoAck] = useState<boolean>(() => localStorage.getItem('fh:viewonce:ack') === '1');
  const [showVO, setShowVO] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const next = files.map((f) => ({
      file: f, url: URL.createObjectURL(f), isImage: f.type.startsWith('image/'),
      caption: '', quality: 'standard' as Quality, viewOnce: false,
    }));
    setItems(next);
    return () => next.forEach((i) => URL.revokeObjectURL(i.url));
  }, [files]);

  const limit = isPremium ? PREMIUM_LIMITS.uploadBytes : FREE_LIMITS.uploadBytes;
  const cur = items[active];

  function patch(p: Partial<Item>) {
    setItems((prev) => prev.map((it, i) => (i === active ? { ...it, ...p } : it)));
  }

  function addMore(list: FileList | null) {
    if (!list?.length) return;
    const next = Array.from(list).map((f) => ({
      file: f, url: URL.createObjectURL(f), isImage: f.type.startsWith('image/'),
      caption: '', quality: 'standard' as Quality, viewOnce: false,
    }));
    setItems((prev) => [...prev, ...next]);
  }

  function toggleViewOnce() {
    if (!cur.viewOnce && !voAck) { setShowVO(true); return; }
    patch({ viewOnce: !cur.viewOnce });
  }
  function ackVO() {
    localStorage.setItem('fh:viewonce:ack', '1'); setVoAck(true); setShowVO(false); patch({ viewOnce: true });
  }

  async function send() {
    if (sending || !items.length) return;
    // enforce upload limit (free vs premium) before doing work
    const tooBig = items.find((i) => i.file.size > limit);
    if (tooBig) { if (!isPremium) { onUpgrade(); return; } setError('A file is too large.'); return; }
    setSending(true);
    setError(null);
    try {
      for (const it of items) {
        let blob: Blob = it.file;
        let w = it.width, h = it.height;
        if (it.isImage) {
          const enc = await reencode(it.file, it.quality);
          blob = enc.blob; w = enc.width || undefined; h = enc.height || undefined;
        }
        const type = it.isImage ? 'image' : 'file';
        const { url, error: upErr } = await uploadMedia(supabase, convId, blob, it.file.name, it.isImage ? 'image/jpeg' : it.file.type);
        if (upErr || !url) throw upErr || new Error('Upload failed');
        const meta: MediaMeta = {
          quality: it.quality, hd: it.quality !== 'standard',
          viewOnce: it.viewOnce || undefined, width: w, height: h,
        };
        await sendMessage(supabase, convId, it.caption || (type === 'image' ? '' : it.file.name), type, url, undefined, undefined, meta);
      }
      onSent();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  const sizeEstimate = useMemo(() => {
    if (!cur) return '';
    if (cur.quality === 'original' || !cur.isImage) return `${(cur.file.size / (1024 * 1024)).toFixed(1)} MB`;
    const factor = cur.quality === 'hd' ? 0.6 : 0.3;
    return `~${((cur.file.size * factor) / (1024 * 1024)).toFixed(1)} MB`;
  }, [cur]);

  if (!cur) return null;

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="mc-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="mc-stage">
          {cur.isImage
            ? <img src={cur.url} alt="" className="mc-preview" />
            : <video src={cur.url} className="mc-preview" controls />}
          {cur.viewOnce && <span className="mc-vo-badge">👁️ View once</span>}
        </div>

        {/* quality (images only) + size */}
        {cur.isImage && (
          <div className="mc-quality">
            {(['standard', 'hd', 'original'] as Quality[]).map((q) => (
              <button key={q} className={`mc-qchip ${cur.quality === q ? 'on' : ''}`} onClick={() => patch({ quality: q })}>
                {q === 'hd' ? 'HD' : q[0].toUpperCase() + q.slice(1)}
              </button>
            ))}
            <span className="mc-size">{sizeEstimate}</span>
          </div>
        )}

        {/* thumbnail strip */}
        <div className="mc-strip">
          {items.map((it, i) => (
            <button key={i} className={`mc-thumb ${i === active ? 'on' : ''}`} onClick={() => setActive(i)}>
              {it.isImage ? <img src={it.url} alt="" /> : <div className="mc-thumb-vid">▶</div>}
              {it.viewOnce && <span className="mc-thumb-vo">👁️</span>}
            </button>
          ))}
          <button className="mc-add" onClick={() => addRef.current?.click()} title="Add more">＋</button>
          <input ref={addRef} type="file" multiple accept="image/*,video/*" style={{ display: 'none' }} onChange={(e) => addMore(e.target.files)} />
        </div>

        {error && <div className="mc-error">{error}</div>}

        {/* caption + view once + send */}
        <div className="mc-bottom">
          <input
            className="mc-caption"
            placeholder="Add a caption…"
            value={cur.caption}
            maxLength={1024}
            onChange={(e) => patch({ caption: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className={`mc-vo ${cur.viewOnce ? 'on' : ''}`} onClick={toggleViewOnce} title="View once">👁️</button>
          <button className="mc-send" onClick={send} disabled={sending}>{sending ? '…' : 'Send'}</button>
        </div>

        {showVO && (
          <div className="mc-vo-overlay" onClick={() => setShowVO(false)}>
            <div className="mc-vo-card" onClick={(e) => e.stopPropagation()}>
              <div className="mc-vo-emoji">👁️</div>
              <h3>View Once</h3>
              <ul>
                <li>Can be opened only once</li>
                <li>Cannot be forwarded</li>
                <li>Cannot be saved or exported</li>
                <li>Screenshot protection where supported</li>
              </ul>
              <div className="mc-vo-actions">
                <button className="mc-vo-cancel" onClick={() => setShowVO(false)}>Not now</button>
                <button className="mc-vo-ok" onClick={ackVO}>Enable View Once</button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
