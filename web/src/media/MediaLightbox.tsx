// Lumixo — full-screen media viewer (WhatsApp-grade). Swipe/arrow between
// images & videos, wheel/double-click/pinch zoom with pan, download, share,
// a media counter, and a hero scale-in entrance. Self-contained and reusable:
// pass a list of media items and the active index.
//
// Branding note: chrome is Lumixo's own; behaviour mirrors WhatsApp.

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DownloadIcon, ForwardIcon } from '../Icons';
import { useSignedUrl } from '../lib/useSignedUrl';
import { safeCssUrl, safeMediaSrc } from '../util/safeUrl';

export interface MediaItem {
  id: string;
  url: string;
  kind: 'image' | 'video';
  caption?: string;
  sender?: string;
  time?: string;
}

interface Props {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onIndexChange?: (i: number) => void;
}

const MAX_ZOOM = 5;
const MIN_ZOOM = 1;

export function MediaLightbox({ items, index, onClose, onIndexChange }: Props) {
  const [i, setI] = useState(index);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dir, setDir] = useState(0); // slide direction for transition
  const [toast, setToast] = useState<string | null>(null);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const draggingPan = useRef(false);

  const item = items[i];
  // Resolve the current item's stored (public, private-bucket) url into a
  // signed url that will actually load. Null while resolving or on failure —
  // we render an empty slot rather than the raw url so we don't briefly show
  // a broken 403 image on swipe.
  const { url: currentUrl, loading: currentLoading } = useSignedUrl(item?.url);

  const go = useCallback((delta: number) => {
    setI((cur) => {
      const next = Math.min(items.length - 1, Math.max(0, cur + delta));
      if (next !== cur) { setDir(delta); setZoom(1); setPan({ x: 0, y: 0 }); onIndexChange?.(next); }
      return next;
    });
  }, [items.length, onIndexChange]);

  const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Keyboard controls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(MAX_ZOOM, z + 0.5));
      else if (e.key === '-') setZoom((z) => { const n = Math.max(MIN_ZOOM, z - 0.5); if (n === 1) setPan({ x: 0, y: 0 }); return n; });
      else if (e.key === '0') resetZoom();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 2000); }

  function onWheel(e: React.WheelEvent) {
    if (item.kind !== 'image') return;
    e.preventDefault();
    setZoom((z) => {
      const n = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.002));
      if (n === 1) setPan({ x: 0, y: 0 });
      return n;
    });
  }

  function onDoubleClick() {
    if (item.kind !== 'image') return;
    if (zoom > 1) resetZoom();
    else setZoom(2.5);
  }

  // Pointer drag: pan when zoomed, otherwise swipe to change media.
  function onPointerDown(e: React.PointerEvent) {
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    draggingPan.current = zoom > 1;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (draggingPan.current) setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (!draggingPan.current && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
    } else if (!draggingPan.current && Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      // tap on backdrop closes (but not when the tap lands on media — handled by stopPropagation)
    }
    dragStart.current = null;
  }

  async function download() {
    // Wait for the signed url — the raw item.url returns 403 for private-bucket
    // media, so fetch()ing it would fall through to the popup fallback with a
    // broken URL. If signing failed there's nothing usable to hand the browser.
    if (!currentUrl) { flash(currentLoading ? 'Loading…' : 'Could not load media'); return; }
    try {
      const res = await fetch(currentUrl);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = item.caption || currentUrl.split('/').pop()?.split('?')[0] || `lumixo-media-${item.id}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      flash('Saved');
    } catch {
      window.open(currentUrl, '_blank', 'noopener');
    }
  }

  async function share() {
    if (!currentUrl) { flash(currentLoading ? 'Loading…' : 'Could not load media'); return; }
    const data = { title: 'Lumixo media', text: item.caption || 'Shared on Lumixo', url: currentUrl };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(currentUrl); flash('Link copied'); }
    } catch { /* user cancelled */ }
  }

  if (!item) return null;

  const slideVariants = {
    enter: (d: number) => ({ x: d > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -80 : 80, opacity: 0 }),
  };

  return (
    <motion.div
      className="mlb-backdrop"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      {/* Top bar */}
      <div className="mlb-topbar" onPointerDown={(e) => e.stopPropagation()}>
        <div className="mlb-meta">
          {item.sender && <span className="mlb-sender">{item.sender}</span>}
          {item.time && <span className="mlb-time">{item.time}</span>}
        </div>
        <div className="mlb-counter">{i + 1} / {items.length}</div>
        <div className="mlb-actions">
          {item.kind === 'image' && (
            <>
              <button onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.5))} aria-label="Zoom out" title="Zoom out">−</button>
              <button onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.5))} aria-label="Zoom in" title="Zoom in">+</button>
            </>
          )}
          <button onClick={share} aria-label="Share" title="Share"><ForwardIcon size={18} /></button>
          <button onClick={download} aria-label="Download" title="Download"><DownloadIcon size={18} /></button>
          <button onClick={onClose} aria-label="Close" title="Close (Esc)" className="mlb-close">✕</button>
        </div>
      </div>

      {/* Prev / next */}
      {i > 0 && <button className="mlb-nav mlb-prev" onClick={() => go(-1)} onPointerDown={(e) => e.stopPropagation()} aria-label="Previous">‹</button>}
      {i < items.length - 1 && <button className="mlb-nav mlb-next" onClick={() => go(1)} onPointerDown={(e) => e.stopPropagation()} aria-label="Next">›</button>}

      {/* Stage */}
      <div className="mlb-stage" onClick={(e) => { if (e.target === e.currentTarget && zoom === 1) onClose(); }}>
        <AnimatePresence custom={dir} mode="popLayout">
          <motion.div
            key={item.id}
            className="mlb-frame"
            custom={dir}
            variants={slideVariants}
            initial="enter" animate="center" exit="exit"
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            {item.kind === 'image' ? (
              <motion.img
                src={safeMediaSrc(currentUrl) ?? ''}
                alt={item.caption || 'Media'}
                className="mlb-media"
                draggable={false}
                onDoubleClick={onDoubleClick}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerMove={(e) => zoom > 1 && e.stopPropagation()}
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? 'grab' : 'zoom-in' }}
              />
            ) : (
              <video src={safeMediaSrc(currentUrl) ?? undefined} className="mlb-media" controls autoPlay playsInline onPointerDown={(e) => e.stopPropagation()} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {item.caption && item.kind === 'image' && <div className="mlb-caption">{item.caption}</div>}

      {/* Thumbnail strip */}
      {items.length > 1 && (
        <div className="mlb-strip" onPointerDown={(e) => e.stopPropagation()}>
          {items.map((m, idx) => (
            <Thumb
              key={m.id}
              item={m}
              active={idx === i}
              onClick={() => { setDir(idx > i ? 1 : -1); setI(idx); resetZoom(); onIndexChange?.(idx); }}
            />
          ))}
        </div>
      )}

      {toast && <div className="mlb-toast">{toast}</div>}
    </motion.div>
  );
}

// Per-thumbnail signed-URL wrapper. Extracted so we can call the hook per row
// (a hook inside items.map would violate the Rules of Hooks). The 60m cache in
// signedMediaUrl makes repeated sign requests for the same strip cheap.
function Thumb({ item, active, onClick }: { item: MediaItem; active: boolean; onClick: () => void }) {
  const { url: signed } = useSignedUrl(item.url);
  return (
    <button
      className={`mlb-thumb ${active ? 'active' : ''}`}
      onClick={onClick}
      style={item.kind === 'image' && safeCssUrl(signed) ? { backgroundImage: safeCssUrl(signed) } : undefined}
      aria-label={item.kind === 'video' ? 'Play video' : 'View image'}
    >
      {item.kind === 'video' && <span className="mlb-thumb-play">▶</span>}
    </button>
  );
}
