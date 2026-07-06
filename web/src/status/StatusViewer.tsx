// FUTUREHAT web — full-screen Status viewer (WhatsApp-grade).
// Auto-advancing progress bars, tap/keyboard nav, hold-to-pause, image/text/
// video/audio, captions, mute toggle, next-image preload, reply-as-DM, delete
// (own), and a live "seen by" list driven by realtime views.
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabase';
import {
  deleteStatus,
  markStatusViewed,
  getStatusViewers,
  getStatusViewCount,
  subscribeStatusViews,
  startDirectConversation,
  sendMessage,
} from '@shared/api';
import type { StatusViewer as ViewerRow } from '@shared/types';
import { type StatusGroup, isVideo, isAudio, timeAgo } from './statusData';
import './status.css';

const IMAGE_DURATION = 5000;
const AUDIO_FALLBACK = 15000;

export function StatusViewer({
  group,
  isMine,
  onClose,
  onExhausted,
  onChanged,
}: {
  group: StatusGroup;
  isMine: boolean;
  onClose: () => void;
  onExhausted: () => void;
  onChanged: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [viewers, setViewers] = useState<ViewerRow[] | null>(null);
  const [viewCount, setViewCount] = useState(0);
  const [showViewers, setShowViewers] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number>();
  const startRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);

  const current = group.statuses[idx];
  const video = current && isVideo(current);
  const audio = current && isAudio(current);
  const hasSound = video || audio;

  const goNext = useCallback(() => {
    if (idx < group.statuses.length - 1) setIdx((i) => i + 1);
    else onExhausted();
  }, [idx, group.statuses.length, onExhausted]);

  const goPrev = useCallback(() => { if (idx > 0) setIdx((i) => i - 1); }, [idx]);

  // Reset per-slide state + mark viewed + seed view count.
  useEffect(() => {
    setProgress(0);
    setShowViewers(false);
    setViewers(null);
    elapsedRef.current = 0;
    markStatusViewed(supabase, current.id, group.userId).then(onChanged).catch(() => {});
    if (isMine) getStatusViewCount(supabase, current.id).then(setViewCount).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Preload the NEXT image so it paints instantly on advance.
  useEffect(() => {
    const nxt = group.statuses[idx + 1];
    if (nxt && nxt.type === 'image' && nxt.media_url) {
      const img = new Image();
      img.src = nxt.media_url;
    }
  }, [idx, group.statuses]);

  // Live "seen by" for own statuses.
  useEffect(() => {
    if (!isMine || !current) return;
    const ch = subscribeStatusViews(supabase, current.id, () => {
      getStatusViewCount(supabase, current.id).then(setViewCount).catch(() => {});
      setShowViewers((open) => {
        if (open) getStatusViewers(supabase, current.id).then(setViewers).catch(() => {});
        return open;
      });
    });
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, isMine]);

  // Progress / auto-advance loop for image + text. Video/audio drive their own timing.
  useEffect(() => {
    if (video || audio) return;
    if (paused) return;
    startRef.current = performance.now() - elapsedRef.current;
    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      elapsedRef.current = elapsed;
      const p = Math.min(1, elapsed / IMAGE_DURATION);
      setProgress(p);
      if (p >= 1) goNext();
      else rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [video, audio, paused, idx, goNext]);

  // Pause/resume + mute for video.
  useEffect(() => {
    if (!video || !videoRef.current) return;
    videoRef.current.muted = muted;
    if (paused) videoRef.current.pause();
    else videoRef.current.play().catch(() => {});
  }, [paused, muted, video, idx]);

  // Pause/resume + mute for audio.
  useEffect(() => {
    if (!audio || !audioRef.current) return;
    audioRef.current.muted = muted;
    if (paused) audioRef.current.pause();
    else audioRef.current.play().catch(() => {});
  }, [paused, muted, audio, idx]);

  // Keyboard nav.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key.toLowerCase() === 'm' && hasSound) setMuted((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goNext, goPrev, hasSound]);

  async function loadViewers() {
    if (viewers) { setShowViewers((s) => !s); return; }
    const v = await getStatusViewers(supabase, current.id);
    setViewers(v);
    setViewCount(v.length);
    setShowViewers(true);
  }

  async function onDelete() {
    if (!confirm('Delete this status update?')) return;
    await deleteStatus(supabase, current.id);
    onChanged();
    if (group.statuses.length <= 1) onClose();
    else {
      group.statuses.splice(idx, 1);
      setIdx((i) => Math.max(0, Math.min(i, group.statuses.length - 1)));
    }
  }

  async function sendReply() {
    const t = replyText.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const { conversationId } = await startDirectConversation(supabase, group.userId);
      if (conversationId) {
        await sendMessage(supabase, conversationId, `↩️ Re: status\n${t}`);
        setReplyText('');
      }
    } finally {
      setSending(false);
    }
  }

  const captionShown = !!current.caption && (video || audio || current.type === 'image');

  return (
    <div className="story-player" onClick={(e) => e.stopPropagation()}>
      <div className="story-progress">
        {group.statuses.map((s, i) => (
          <div key={s.id} className="story-progress-track">
            <div
              className="story-progress-fill"
              style={{ width: i < idx ? '100%' : i === idx ? `${progress * 100}%` : '0%' }}
            />
          </div>
        ))}
      </div>

      <div className="story-header">
        <div className="story-author">
          {group.avatar ? (
            <img src={group.avatar} alt="" className="story-author-avatar" />
          ) : (
            <div className="story-author-avatar fallback">{group.name[0]}</div>
          )}
          <div>
            <div className="story-author-name">{group.name}</div>
            <div className="story-author-time">{timeAgo(current.created_at)}</div>
          </div>
        </div>
        <div className="story-header-actions">
          {hasSound && (
            <button className="story-icon-btn" onClick={() => setMuted((m) => !m)} title={muted ? 'Unmute' : 'Mute'} aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted ? '🔇' : '🔊'}
            </button>
          )}
          {isMine && (
            <button className="story-icon-btn" onClick={onDelete} title="Delete" aria-label="Delete">🗑</button>
          )}
          <button className="story-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      <div
        className="story-stage"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
      >
        <div className="story-tap left" onClick={goPrev} />
        <div className="story-tap right" onClick={goNext} />

        {video && current.media_url ? (
          <video
            ref={videoRef}
            className="story-media"
            src={current.media_url}
            autoPlay
            playsInline
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgress(v.currentTime / v.duration);
            }}
            onEnded={goNext}
          />
        ) : audio && current.media_url ? (
          <div className="story-audio" style={{ background: current.background || '#5B6EF5' }}>
            <div className="story-audio-bubble">🎵</div>
            <div className="story-audio-label">Audio status</div>
            <audio
              ref={audioRef}
              src={current.media_url}
              autoPlay
              onTimeUpdate={(e) => {
                const a = e.currentTarget;
                if (a.duration) setProgress(a.currentTime / a.duration);
                else setProgress((p) => Math.min(1, p + 16 / AUDIO_FALLBACK));
              }}
              onEnded={goNext}
            />
          </div>
        ) : current.type === 'image' && current.media_url ? (
          <img src={current.media_url} alt="Status" className="story-media" />
        ) : (
          <div className="story-text" style={{ background: current.background || '#667eea', color: current.text_color || '#fff' }}>
            {current.content}
          </div>
        )}

        {captionShown && <div className="story-caption">{current.caption}</div>}
      </div>

      {isMine ? (
        <div className="story-footer mine">
          <button className="story-seen-btn" onClick={loadViewers}>
            👁 {viewCount > 0 ? `Seen by ${viewCount}` : 'Seen by'}
          </button>
          {showViewers && viewers && (
            <div className="story-viewers">
              {viewers.length === 0 && <div className="story-viewer-empty">No views yet</div>}
              {viewers.map((v) => (
                <div key={v.viewer_id} className="story-viewer">
                  {v.profile?.avatar_url ? (
                    <img src={v.profile.avatar_url} alt="" className="story-viewer-avatar" />
                  ) : (
                    <div className="story-viewer-avatar fallback">{(v.profile?.display_name || '?')[0]}</div>
                  )}
                  <span className="story-viewer-name">{v.profile?.display_name || 'FUTUREHAT user'}</span>
                  <span className="story-viewer-time">{timeAgo(v.viewed_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <form
          className="story-footer reply"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); sendReply(); }}
        >
          <input
            className="story-reply-input"
            placeholder={`Reply to ${group.name}…`}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          />
          <button className="story-reply-send" type="submit" disabled={!replyText.trim() || sending}>➤</button>
        </form>
      )}
    </div>
  );
}
