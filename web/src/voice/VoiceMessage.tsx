// Lumixo — voice message playback bubble: play/pause, a lightweight progress
// waveform, and elapsed/total time. Pure <audio>; no external deps. Used for
// messages of type 'audio'.

import { useEffect, useRef, useState } from 'react';
import { useSignedUrl } from '../lib/useSignedUrl';
import { safeMediaSrc } from '../util/safeUrl';
import './VoiceMessage.css';

// Deterministic pseudo-waveform bars from the URL so each clip looks distinct
// without decoding audio (cheap, and stable across renders).
function bars(seed: string, n = 32): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  const out: number[] = [];
  for (let i = 0; i < n; i++) { h = (h * 1103515245 + 12345) & 0x7fffffff; out.push(0.25 + ((h >> 8) % 100) / 130); }
  return out;
}

export function VoiceMessage({ url, mine }: { url: string; mine?: boolean }) {
  // The `media` bucket is private, so `url` here is a stored public link that
  // would 403. Resolve to a signed url before feeding it to <audio>; the raw
  // url is still fine for the waveform seed since it's just used for hashing.
  const { url: playableUrl } = useSignedUrl(url);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [time, setTime] = useState('0:00');
  const wave = useRef(bars(url));

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      if (a.duration && isFinite(a.duration)) setProgress(a.currentTime / a.duration);
      setTime(fmt(a.currentTime));
    };
    const onEnd = () => { setPlaying(false); setProgress(0); setTime(fmt(a.duration || 0)); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    return () => { a.removeEventListener('timeupdate', onTime); a.removeEventListener('ended', onEnd); };
  }, []);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { void a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !a.duration || !isFinite(a.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * a.duration;
    setProgress(ratio);
  }

  return (
    <div className={`voice-msg ${mine ? 'mine' : ''}`}>
      <audio ref={audioRef} src={safeMediaSrc(playableUrl) ?? undefined} preload="metadata" />
      <button className="voice-play" onClick={toggle} aria-label={playing ? 'Pause voice message' : 'Play voice message'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="voice-wave" onClick={seek}>
        {wave.current.map((h, i) => (
          <span key={i} className={`voice-bar ${i / wave.current.length <= progress ? 'on' : ''}`} style={{ height: `${Math.round(h * 100)}%` }} />
        ))}
      </div>
      <span className="voice-time">{time}</span>
    </div>
  );
}

function fmt(s: number): string {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
