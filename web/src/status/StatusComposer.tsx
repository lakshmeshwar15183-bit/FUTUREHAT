// FUTUREHAT web — Status composer (WhatsApp-style).
// One overlay that handles all three post types via an initial `mode`:
//   text  — typed status with background + text colour
//   media — pick photo/video, preview, add a caption
//   audio — record a voice status (MediaRecorder) or pick an audio file, preview
// Uploads go through the shared uploadStatusMedia helper; shows an upload state
// with retry, supports discard-before-post, and carries a per-post audience that
// persists as the new default. Media privacy is enforced server-side (0021).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { createStatus, uploadStatusMedia } from '@shared/api';
import { setStatusAudiencePref } from '@shared/privacyApi';
import type { StatusType, StatusAudience } from '@shared/types';
import { AudiencePicker } from './AudiencePicker';
import './status.css';

export type ComposerMode = 'text' | 'media' | 'audio';

const BG_COLORS = ['#00A884', '#5B6EF5', '#E8638A', '#F7A948', '#9B6EF5', '#0B141A', '#D9544F'];
const TEXT_COLORS = ['#FFFFFF', '#0B141A', '#F7E017', '#FF6B6B', '#4FC3F7'];
const MAX_STATUS_BYTES = 16 * 1024 * 1024;

const AUDIENCE_LABEL: Record<StatusAudience, string> = {
  everyone: 'Everyone',
  contacts: 'My contacts',
  except: 'Contacts except…',
  only: 'Only selected',
};

interface PickedMedia {
  url: string;      // object URL for preview
  blob: Blob;
  kind: 'image' | 'video' | 'audio';
  ext: string;
  mime: string;
  durationMs?: number;
}

export function StatusComposer({
  mode,
  myId,
  initialAudience,
  initialMembers,
  onClose,
  onPosted,
}: {
  mode: ComposerMode;
  myId: string;
  initialAudience: StatusAudience;
  initialMembers: string[];
  onClose: () => void;
  onPosted: () => void;
}) {
  const [text, setText] = useState('');
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [textColor, setTextColor] = useState(TEXT_COLORS[0]);
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<StatusAudience>(initialAudience);
  const [members, setMembers] = useState<string[]>(initialMembers);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);

  // Kick off the file picker immediately for media mode.
  useEffect(() => {
    if (mode === 'media') fileRef.current?.click();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recording timer + teardown on unmount.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => () => { streamRef.current?.getTracks().forEach((tr) => tr.stop()); }, []);

  function acceptFile(file: File, forcedKind?: 'audio') {
    const isVid = file.type.startsWith('video/');
    const isImg = file.type.startsWith('image/');
    const isAud = forcedKind === 'audio' || file.type.startsWith('audio/');
    if (!isVid && !isImg && !isAud) { setError('Please choose an image, video or audio file.'); return; }
    if (file.size > MAX_STATUS_BYTES) { setError('File is too large — choose one under 16 MB.'); return; }
    const kind: PickedMedia['kind'] = isVid ? 'video' : isAud ? 'audio' : 'image';
    const ext = file.name.split('.').pop()?.toLowerCase() || (isVid ? 'mp4' : isAud ? 'm4a' : 'jpg');
    setMedia({ url: URL.createObjectURL(file), blob: file, kind, ext, mime: file.type || 'application/octet-stream' });
    setError(null);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        setMedia({ url: URL.createObjectURL(blob), blob, kind: 'audio', ext: 'webm', mime: blob.type, durationMs: recSecs * 1000 });
        setError(null);
      };
      recorderRef.current = rec;
      setRecSecs(0);
      rec.start();
      setRecording(true);
    } catch {
      setError('Microphone permission denied.');
    }
  }

  function stopRecording(keep: boolean) {
    const rec = recorderRef.current;
    setRecording(false);
    if (!rec) return;
    if (!keep) rec.onstop = () => { streamRef.current?.getTracks().forEach((tr) => tr.stop()); streamRef.current = null; };
    rec.stop();
    recorderRef.current = null;
  }

  function discardMedia() {
    if (media) URL.revokeObjectURL(media.url);
    setMedia(null);
    setCaption('');
    setError(null);
    if (mode !== 'text') onClose();
  }

  function commonOpts() {
    return {
      audience,
      memberIds: audience === 'except' || audience === 'only' ? members : undefined,
    };
  }

  function persistDefault() {
    setStatusAudiencePref(supabase, { audience, memberIds: members }).catch(() => {});
  }

  async function postText() {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null);
    const { error: err } = await createStatus(supabase, 'text', text.trim(), undefined, bg, { textColor, ...commonOpts() });
    setBusy(false);
    if (err) { setError(err.message); return; }
    persistDefault(); onPosted(); onClose();
  }

  async function postMedia() {
    if (!media || busy) return;
    setBusy(true); setError(null);
    const { url, error: upErr } = await uploadStatusMedia(supabase, myId, media.blob, media.ext, media.mime);
    if (upErr || !url) { setBusy(false); setError(upErr?.message ?? 'Upload failed. Click retry.'); return; }
    const type: StatusType = media.kind;
    const { error: err } = await createStatus(supabase, type, undefined, url, bg, {
      caption: caption.trim() || undefined,
      durationMs: media.durationMs,
      ...commonOpts(),
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    persistDefault(); onPosted(); onClose();
  }

  const audienceChip = (
    <button className="composer-audience" onClick={() => setPickerOpen(true)}>
      👁 {AUDIENCE_LABEL[audience]} ›
    </button>
  );

  // ── Preview (media/audio picked) ─────────────────────────────────────────
  if (media) {
    return (
      <div className="composer-overlay">
        <button className="compose-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="composer-preview">
          {media.kind === 'image' && <img src={media.url} alt="Preview" className="composer-preview-media" />}
          {media.kind === 'video' && <video src={media.url} className="composer-preview-media" controls />}
          {media.kind === 'audio' && (
            <div className="composer-audio-preview">
              <div className="story-audio-bubble">🎵</div>
              <audio src={media.url} controls />
            </div>
          )}
          <button className="composer-discard" onClick={discardMedia} title="Discard" aria-label="Discard">🗑</button>
        </div>
        <div className="composer-bottom">
          <input
            className="composer-caption"
            placeholder="Add a caption…"
            value={caption}
            maxLength={300}
            onChange={(e) => setCaption(e.target.value)}
          />
          <div className="composer-actions">
            {audienceChip}
            <button className="compose-send" onClick={postMedia} disabled={busy}>
              {busy ? '…' : error ? '↻' : '➤'}
            </button>
          </div>
          {error && <div className="composer-error">{error} — click the button to retry.</div>}
        </div>
        {pickerOpen && (
          <AudiencePicker
            audience={audience} memberIds={members} myId={myId}
            onClose={() => setPickerOpen(false)}
            onSave={(a, m) => { setAudience(a); setMembers(m); }}
          />
        )}
      </div>
    );
  }

  // ── Audio mode, before a clip exists ─────────────────────────────────────
  if (mode === 'audio') {
    return (
      <div className="composer-overlay">
        <button className="compose-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="composer-center">
          <h3 className="composer-title">Voice status</h3>
          {recording ? (
            <>
              <div className="composer-rec-timer">{fmt(recSecs)}</div>
              <div className="composer-rec-row">
                <button className="composer-rec-cancel" onClick={() => stopRecording(false)}>✕</button>
                <button className="composer-rec-stop" onClick={() => stopRecording(true)}>✓</button>
              </div>
              <div className="composer-hint">Recording… click ✓ to preview</div>
            </>
          ) : (
            <>
              <button className="composer-rec-btn" onClick={startRecording}>🎙</button>
              <div className="composer-hint">Click to record</div>
              <button className="composer-link" onClick={() => audioFileRef.current?.click()}>Upload an audio file</button>
            </>
          )}
          {error && <div className="composer-error">{error}</div>}
        </div>
        <input ref={audioFileRef} type="file" accept="audio/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) acceptFile(f, 'audio'); }} />
      </div>
    );
  }

  // ── Media mode without a pick yet (cancelled) ────────────────────────────
  if (mode === 'media') {
    return (
      <div className="composer-overlay">
        <button className="compose-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="composer-center">
          <button className="composer-rec-btn" onClick={() => fileRef.current?.click()}>🖼</button>
          <div className="composer-hint">Choose a photo or video</div>
          {error && <div className="composer-error">{error}</div>}
        </div>
        <input ref={fileRef} type="file" accept="image/*,video/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) acceptFile(f); }} />
      </div>
    );
  }

  // ── Text mode ────────────────────────────────────────────────────────────
  return (
    <div className="composer-overlay text" style={{ background: bg }}>
      <button className="compose-close" onClick={onClose} aria-label="Close">✕</button>
      <textarea
        className="compose-textarea"
        autoFocus
        placeholder="Type a status…"
        value={text}
        maxLength={700}
        style={{ color: textColor }}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="composer-swatches">
        <div className="compose-bg-row">
          {BG_COLORS.map((c) => (
            <button key={c} className={`compose-bg-dot ${bg === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setBg(c)} aria-label="Background colour" />
          ))}
        </div>
        <div className="compose-bg-row">
          <span className="composer-aa">Aa</span>
          {TEXT_COLORS.map((c) => (
            <button key={c} className={`compose-bg-dot small ${textColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setTextColor(c)} aria-label="Text colour" />
          ))}
        </div>
      </div>
      <div className="composer-actions text">
        {audienceChip}
        <button className="compose-send" onClick={postText} disabled={!text.trim() || busy}>{busy ? '…' : '➤'}</button>
      </div>
      {error && <div className="composer-error">{error}</div>}
      {pickerOpen && (
        <AudiencePicker
          audience={audience} memberIds={members} myId={myId}
          onClose={() => setPickerOpen(false)}
          onSave={(a, m) => { setAudience(a); setMembers(m); }}
        />
      )}
    </div>
  );
}

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
