// FUTUREHAT — Status/Stories. WhatsApp-grade tray + full-screen story player.
// Tray: "My status" (add/manage) + recent updates with seen/unseen rings.
// Player: auto-advancing progress bars, tap/keyboard nav, hold-to-pause,
// image/video/text statuses, reply-as-DM, and a "seen by" list on your own.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabase';
import {
  getActiveStatuses,
  createStatus,
  deleteStatus,
  markStatusViewed,
  getMyViewedStatusIds,
  getStatusViewers,
  startDirectConversation,
  sendMessage,
} from '@shared/api';
import type { Status, StatusViewer } from '@shared/types';
import { useEscapeToClose } from './useEscapeToClose';
import './StatusView.css';

interface Props {
  onClose: () => void;
}

interface Group {
  userId: string;
  name: string;
  avatar: string | null;
  statuses: Status[];
  allSeen: boolean;
}

const TEXT_BACKGROUNDS = ['#667eea', '#00A884', '#E8638A', '#F7A948', '#9B6EF5', '#0B141A', '#D9544F'];
const IMAGE_DURATION = 5000; // ms per image/text slide
const MAX_STATUS_BYTES = 16 * 1024 * 1024; // 16 MB

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function isVideo(s: Status): boolean {
  if (s.type === 'video') return true;
  return !!s.media_url && /\.(mp4|webm|mov|m4v|ogv)/i.test(s.media_url);
}

export function StatusView({ onClose }: Props) {
  const { profile } = useAuth();
  const myId = profile?.id;

  const [groups, setGroups] = useState<Group[]>([]);
  const [mine, setMine] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);

  // Composer state
  const [composeText, setComposeText] = useState<string | null>(null); // null = closed
  const [composeBg, setComposeBg] = useState(TEXT_BACKGROUNDS[0]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Player state
  const [player, setPlayer] = useState<Group | null>(null);

  // Escape closes the tray — but only when no story player is open (the player
  // has its own Escape handler that returns to the tray first).
  useEscapeToClose(useCallback(() => { if (!player) onClose(); }, [player, onClose]));

  const load = useCallback(async () => {
    const [all, viewed] = await Promise.all([
      getActiveStatuses(supabase),
      getMyViewedStatusIds(supabase),
    ]);
    const byUser = new Map<string, Status[]>();
    for (const s of all) {
      const arr = byUser.get(s.user_id) ?? [];
      arr.push(s);
      byUser.set(s.user_id, arr);
    }
    // statuses come newest-first; chronological order is nicer for playback
    const buildGroup = (userId: string, list: Status[]): Group => {
      const chron = [...list].reverse();
      const p = chron[0].profile;
      return {
        userId,
        name: userId === myId ? 'My status' : p?.display_name || 'FUTUREHAT user',
        avatar: p?.avatar_url ?? null,
        statuses: chron,
        allSeen: userId === myId ? true : chron.every((s) => viewed.has(s.id)),
      };
    };

    const mineList = byUser.get(myId ?? '');
    setMine(mineList && mineList.length ? buildGroup(myId!, mineList) : null);
    byUser.delete(myId ?? '');

    const others: Group[] = [];
    for (const [userId, list] of byUser) others.push(buildGroup(userId, list));
    // unseen first, then most-recent update
    others.sort((a, b) => {
      if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1;
      const at = a.statuses[a.statuses.length - 1].created_at;
      const bt = b.statuses[b.statuses.length - 1].created_at;
      return bt.localeCompare(at);
    });
    setGroups(others);
    setLoading(false);
  }, [myId]);

  useEffect(() => {
    load();
  }, [load]);

  async function postText() {
    const t = composeText?.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await createStatus(supabase, 'text', t, undefined, composeBg);
      setComposeText(null);
      await load();
    } catch (err: any) {
      alert(err.message || 'Failed to post status');
    } finally {
      setBusy(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !myId || busy) return;
    const video = file.type.startsWith('video/');
    if (!file.type.startsWith('image/') && !video) {
      alert('Please choose an image or video file.');
      return;
    }
    if (file.size > MAX_STATUS_BYTES) {
      alert('File is too large. Please choose one under 16 MB.');
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split('.').pop() || (video ? 'mp4' : 'jpg');
      const path = `${myId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('status').upload(path, file);
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('status').getPublicUrl(path);
      await createStatus(supabase, video ? 'video' : 'image', '', data.publicUrl);
      await load();
    } catch (err: any) {
      alert(err.message || 'Failed to upload status');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="status-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Status</h2>
          <button onClick={onClose} className="close-btn" aria-label="Close">✕</button>
        </div>

        <div className="status-scroll">
          {/* My status */}
          <button
            className="status-row my-status"
            onClick={() => (mine ? setPlayer(mine) : setComposeText(''))}
          >
            <div className="status-avatar-wrap">
              <div className={`status-ring ${mine ? 'ring-mine' : 'ring-empty'}`}>
                {mine?.avatar ? (
                  <img src={mine.avatar} alt="" className="status-avatar-img" />
                ) : (
                  <div className="status-avatar-fallback">{(profile?.display_name || 'M')[0]}</div>
                )}
              </div>
              {!mine && <span className="status-add-badge">＋</span>}
            </div>
            <div className="status-row-body">
              <div className="status-row-name">My status</div>
              <div className="status-row-sub">
                {mine ? `${mine.statuses.length} update${mine.statuses.length > 1 ? 's' : ''} · ${timeAgo(mine.statuses[mine.statuses.length - 1].created_at)}` : 'Tap to add status update'}
              </div>
            </div>
            {mine && <span className="status-row-chevron" onClick={(e) => { e.stopPropagation(); setComposeText(''); }} title="Add update">＋</span>}
          </button>

          {/* Recent updates */}
          {groups.length > 0 && <div className="status-section-label">Recent updates</div>}
          {groups.map((g) => (
            <button key={g.userId} className="status-row" onClick={() => setPlayer(g)}>
              <div className="status-avatar-wrap">
                <div className={`status-ring ${g.allSeen ? 'ring-seen' : 'ring-unseen'}`} data-count={g.statuses.length}>
                  {g.avatar ? (
                    <img src={g.avatar} alt="" className="status-avatar-img" />
                  ) : (
                    <div className="status-avatar-fallback">{g.name[0]}</div>
                  )}
                </div>
              </div>
              <div className="status-row-body">
                <div className="status-row-name">{g.name}</div>
                <div className="status-row-sub">{timeAgo(g.statuses[g.statuses.length - 1].created_at)}</div>
              </div>
            </button>
          ))}

          {!loading && !mine && groups.length === 0 && (
            <div className="no-statuses">No status updates yet. Share one to get started!</div>
          )}
        </div>

        {/* Composer entry buttons */}
        <div className="status-compose-bar">
          <button className="compose-pill" onClick={() => fileRef.current?.click()} disabled={busy}>
            📷 Photo / Video
          </button>
          <button className="compose-pill" onClick={() => setComposeText('')} disabled={busy}>
            ✏️ Text
          </button>
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onPickFile} />
        </div>
      </div>

      {/* Text composer overlay */}
      {composeText !== null && (
        <div className="status-compose-overlay" style={{ background: composeBg }} onClick={(e) => e.stopPropagation()}>
          <button className="compose-close" onClick={() => setComposeText(null)} aria-label="Cancel">✕</button>
          <textarea
            className="compose-textarea"
            autoFocus
            placeholder="Type a status…"
            value={composeText}
            maxLength={700}
            onChange={(e) => setComposeText(e.target.value)}
          />
          <div className="compose-bg-row">
            {TEXT_BACKGROUNDS.map((c) => (
              <button
                key={c}
                className={`compose-bg-dot ${composeBg === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => setComposeBg(c)}
                aria-label="Background colour"
              />
            ))}
          </div>
          <button className="compose-send" onClick={postText} disabled={!composeText.trim() || busy}>
            {busy ? '…' : '➤'}
          </button>
        </div>
      )}

      {/* Story player */}
      {player && (
        <StoryPlayer
          group={player}
          isMine={player.userId === myId}
          onClose={() => setPlayer(null)}
          onExhausted={() => {
            // advance to the next unseen group, else close
            const idx = groups.findIndex((g) => g.userId === player.userId);
            const next = groups.slice(idx + 1).find(() => true);
            setPlayer(next ?? null);
          }}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ── Full-screen story player ────────────────────────────────────────────────

function StoryPlayer({
  group,
  isMine,
  onClose,
  onExhausted,
  onChanged,
}: {
  group: Group;
  isMine: boolean;
  onClose: () => void;
  onExhausted: () => void;
  onChanged: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1 of current slide
  const [paused, setPaused] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [viewers, setViewers] = useState<StatusViewer[] | null>(null);
  const [showViewers, setShowViewers] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>();
  const startRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);

  const current = group.statuses[idx];
  const video = current && isVideo(current);

  const goNext = useCallback(() => {
    if (idx < group.statuses.length - 1) {
      setIdx((i) => i + 1);
    } else {
      onExhausted();
    }
  }, [idx, group.statuses.length, onExhausted]);

  const goPrev = useCallback(() => {
    if (idx > 0) setIdx((i) => i - 1);
  }, [idx]);

  // Reset per-slide state + mark viewed
  useEffect(() => {
    setProgress(0);
    setShowViewers(false);
    setViewers(null);
    elapsedRef.current = 0;
    markStatusViewed(supabase, current.id, group.userId).then(onChanged).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Progress / auto-advance loop (image + text). Video drives its own timing.
  useEffect(() => {
    if (video) return; // handled by <video> events
    if (paused) return;
    startRef.current = performance.now() - elapsedRef.current;
    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      elapsedRef.current = elapsed;
      const p = Math.min(1, elapsed / IMAGE_DURATION);
      setProgress(p);
      if (p >= 1) {
        goNext();
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [video, paused, idx, goNext]);

  // Pause/resume video with the hold gesture
  useEffect(() => {
    if (!video || !videoRef.current) return;
    if (paused) videoRef.current.pause();
    else videoRef.current.play().catch(() => {});
  }, [paused, video, idx]);

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goNext, goPrev]);

  async function loadViewers() {
    if (viewers) {
      setShowViewers((s) => !s);
      return;
    }
    const v = await getStatusViewers(supabase, current.id);
    setViewers(v);
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

  return (
    <div className="story-player" onClick={(e) => e.stopPropagation()}>
      {/* progress bars */}
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

      {/* header */}
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
          {isMine && (
            <button className="story-icon-btn" onClick={onDelete} title="Delete" aria-label="Delete">🗑</button>
          )}
          <button className="story-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      {/* slide content */}
      <div
        className="story-stage"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
      >
        {/* tap zones */}
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
        ) : current.type === 'image' && current.media_url ? (
          <img src={current.media_url} alt="Status" className="story-media" />
        ) : (
          <div className="story-text" style={{ background: current.background || '#667eea' }}>
            {current.content}
          </div>
        )}
      </div>

      {/* footer: reply (others) or seen-by (mine) */}
      {isMine ? (
        <div className="story-footer mine">
          <button className="story-seen-btn" onClick={loadViewers}>
            👁 {viewers ? viewers.length : ''} Seen by{viewers && viewers.length === 0 ? ' no one yet' : ''}
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
