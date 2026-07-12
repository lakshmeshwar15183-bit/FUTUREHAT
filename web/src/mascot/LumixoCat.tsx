/**
 * Lumixo official mascot — "Lumi" (web).
 * Original SVG cat; CSS transform animations only (GPU). No framer-motion.
 * Auth-agnostic: parent passes mood + gaze.
 */
import { useEffect, useId, useState } from 'react';
import {
  type CatMood,
  type CatSize,
  CAT_SIZE_PX,
  catAriaLabel,
} from '@shared/lumixoCat';
import './LumixoCat.css';

export interface LumixoCatProps {
  mood?: CatMood;
  /** 0..1 horizontal pupil bias (email typing). */
  gaze?: number;
  size?: CatSize;
  /** Decorative for screen readers when true (default). */
  decorative?: boolean;
  className?: string;
  /** Force reduced motion (tests); otherwise respects prefers-reduced-motion. */
  reduceMotion?: boolean;
}

export function LumixoCat({
  mood = 'idle',
  gaze = 0.5,
  size = 'lg',
  decorative = true,
  className = '',
  reduceMotion,
}: LumixoCatProps) {
  const uid = useId().replace(/:/g, '');
  const px = CAT_SIZE_PX[size];
  const [blink, setBlink] = useState(false);
  const [earTwitch, setEarTwitch] = useState(false);

  // Random blink + ear twitch — paused when reduced motion / hiding / celebrating.
  useEffect(() => {
    if (reduceMotion || mood === 'hiding' || mood === 'celebrating' || mood === 'sleeping') {
      return;
    }
    let blinkTimer: ReturnType<typeof setTimeout>;
    let earTimer: ReturnType<typeof setTimeout>;
    let alive = true;

    const scheduleBlink = () => {
      blinkTimer = setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        setTimeout(() => alive && setBlink(false), 140);
        scheduleBlink();
      }, 2800 + Math.random() * 3200);
    };
    const scheduleEar = () => {
      earTimer = setTimeout(() => {
        if (!alive) return;
        setEarTwitch(true);
        setTimeout(() => alive && setEarTwitch(false), 320);
        scheduleEar();
      }, 5000 + Math.random() * 6000);
    };
    scheduleBlink();
    scheduleEar();
    return () => {
      alive = false;
      clearTimeout(blinkTimer);
      clearTimeout(earTimer);
    };
  }, [mood, reduceMotion]);

  // Auto-clear confused after ~2s is parent responsibility; we just render mood.
  const pupilX = (gaze - 0.5) * 7; // -3.5..3.5 in viewBox units
  const gFace = `lc-face-${uid}`;
  const gBody = `lc-body-${uid}`;
  const gEar = `lc-ear-${uid}`;
  const gAccent = `lc-accent-${uid}`;

  const rootClass = [
    'lc-root',
    `lc-size-${size}`,
    `lc-mood-${mood}`,
    blink ? 'lc-blink' : '',
    earTwitch ? 'lc-ear-twitch' : '',
    reduceMotion ? 'lc-reduce' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={rootClass}
      style={{ width: px, height: px }}
      role={decorative ? 'img' : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : catAriaLabel(mood)}
    >
      <svg
        className="lc-svg"
        viewBox="0 0 200 180"
        width={px}
        height={px}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={gFace} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFEFB" />
            <stop offset="100%" stopColor="#F0EBE3" />
          </linearGradient>
          <linearGradient id={gBody} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFEFB" />
            <stop offset="100%" stopColor="#E8E2D8" />
          </linearGradient>
          <linearGradient id={gEar} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFB8C9" />
            <stop offset="100%" stopColor="#F48BA0" />
          </linearGradient>
          <linearGradient id={gAccent} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--fh-accent, #00a884)" />
            <stop offset="100%" stopColor="var(--fh-accent-2, #06cf9c)" />
          </linearGradient>
          <filter id={`lc-soft-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="8" floodOpacity="0.22" />
          </filter>
        </defs>

        {/* Shadow */}
        <ellipse className="lc-shadow" cx="100" cy="168" rx="48" ry="7" fill="rgba(0,0,0,0.12)" />

        <g className="lc-figure" filter={`url(#lc-soft-${uid})`}>
          {/* Tail */}
          <g className="lc-tail">
            <path
              d="M138 120 C168 110, 178 80, 162 58"
              fill="none"
              stroke={`url(#${gBody})`}
              strokeWidth="14"
              strokeLinecap="round"
            />
            <path
              d="M138 120 C168 110, 178 80, 162 58"
              fill="none"
              stroke="#E8E2D8"
              strokeWidth="10"
              strokeLinecap="round"
              opacity="0.5"
            />
            {/* Lumixo accent tip */}
            <circle cx="162" cy="58" r="7" fill={`url(#${gAccent})`} className="lc-tail-tip" />
          </g>

          {/* Body — sitting loaf */}
          <ellipse className="lc-body" cx="100" cy="128" rx="46" ry="36" fill={`url(#${gBody})`} />
          {/* Collar / brand band */}
          <path
            d="M64 118 Q100 132 136 118"
            fill="none"
            stroke={`url(#${gAccent})`}
            strokeWidth="4"
            strokeLinecap="round"
            className="lc-collar"
          />
          <circle cx="100" cy="124" r="4.5" fill={`url(#${gAccent})`} className="lc-bell" />

          {/* Back paws */}
          <ellipse cx="72" cy="152" rx="14" ry="9" fill={`url(#${gFace})`} />
          <ellipse cx="128" cy="152" rx="14" ry="9" fill={`url(#${gFace})`} />

          {/* Head group */}
          <g className="lc-head">
            {/* Ears */}
            <g className="lc-ear lc-ear-l">
              <path d="M58 58 L48 22 L78 48 Z" fill={`url(#${gFace})`} />
              <path d="M58 52 L52 32 L72 46 Z" fill={`url(#${gEar})`} opacity="0.9" />
            </g>
            <g className="lc-ear lc-ear-r">
              <path d="M142 58 L152 22 L122 48 Z" fill={`url(#${gFace})`} />
              <path d="M142 52 L148 32 L128 46 Z" fill={`url(#${gEar})`} opacity="0.9" />
            </g>

            {/* Face */}
            <circle className="lc-face" cx="100" cy="72" r="42" fill={`url(#${gFace})`} />

            {/* Cheeks */}
            <circle cx="72" cy="84" r="8" fill="#FFB8C9" opacity="0.35" className="lc-cheek" />
            <circle cx="128" cy="84" r="8" fill="#FFB8C9" opacity="0.35" className="lc-cheek" />

            {/* Eyes */}
            <g className="lc-eyes">
              <g className="lc-eye lc-eye-l">
                <ellipse className="lc-eye-white" cx="84" cy="70" rx="11" ry="13" fill="#1A2330" />
                <ellipse
                  className="lc-pupil"
                  cx={84 + pupilX}
                  cy={mood === 'hiding' ? 70 : 71}
                  rx="5.5"
                  ry="6.5"
                  fill="#F7C948"
                  style={{ transform: `translate(${pupilX * 0.15}px, 0)` }}
                />
                <circle className="lc-glint" cx={81 + pupilX} cy="66" r="2.2" fill="#fff" opacity="0.95" />
              </g>
              <g className="lc-eye lc-eye-r">
                <ellipse className="lc-eye-white" cx="116" cy="70" rx="11" ry="13" fill="#1A2330" />
                <ellipse
                  className="lc-pupil"
                  cx={116 + pupilX}
                  cy={mood === 'hiding' ? 70 : 71}
                  rx="5.5"
                  ry="6.5"
                  fill="#F7C948"
                />
                <circle className="lc-glint" cx={113 + pupilX} cy="66" r="2.2" fill="#fff" opacity="0.95" />
              </g>
              {/* Closed lids for blink / hide smile */}
              <g className="lc-lids">
                <path className="lc-lid-l" d="M73 70 Q84 58 95 70" fill="none" stroke={`url(#${gFace})`} strokeWidth="6" strokeLinecap="round" />
                <path className="lc-lid-r" d="M105 70 Q116 58 127 70" fill="none" stroke={`url(#${gFace})`} strokeWidth="6" strokeLinecap="round" />
              </g>
            </g>

            {/* Nose */}
            <path d="M100 80 L96 86 L104 86 Z" fill="#F48BA0" className="lc-nose" />

            {/* Mouth */}
            <path
              className="lc-mouth"
              d="M92 90 Q100 96 108 90"
              fill="none"
              stroke="#1A2330"
              strokeWidth="2.2"
              strokeLinecap="round"
              opacity="0.55"
            />
            <path
              className="lc-mouth-happy"
              d="M88 88 Q100 102 112 88"
              fill="none"
              stroke="#1A2330"
              strokeWidth="2.4"
              strokeLinecap="round"
              opacity="0"
            />
            <path
              className="lc-mouth-sad"
              d="M90 96 Q100 90 110 96"
              fill="none"
              stroke="#1A2330"
              strokeWidth="2.2"
              strokeLinecap="round"
              opacity="0"
            />

            {/* Whiskers */}
            <g className="lc-whiskers" stroke="#1A2330" strokeWidth="1.2" opacity="0.25" strokeLinecap="round">
              <line x1="48" y1="80" x2="72" y2="82" />
              <line x1="48" y1="88" x2="72" y2="88" />
              <line x1="128" y1="82" x2="152" y2="80" />
              <line x1="128" y1="88" x2="152" y2="88" />
            </g>

            {/* Covering paws — never peek when hiding */}
            <g className="lc-paws-cover">
              <ellipse className="lc-paw-l" cx="78" cy="74" rx="22" ry="18" fill={`url(#${gFace})`} />
              <ellipse className="lc-paw-r" cx="122" cy="74" rx="22" ry="18" fill={`url(#${gFace})`} />
              {/* toe beans */}
              <circle cx="72" cy="78" r="3" fill="#FFB8C9" opacity="0.55" />
              <circle cx="80" cy="80" r="3" fill="#FFB8C9" opacity="0.55" />
              <circle cx="88" cy="78" r="3" fill="#FFB8C9" opacity="0.55" />
              <circle cx="112" cy="78" r="3" fill="#FFB8C9" opacity="0.55" />
              <circle cx="120" cy="80" r="3" fill="#FFB8C9" opacity="0.55" />
              <circle cx="128" cy="78" r="3" fill="#FFB8C9" opacity="0.55" />
            </g>
          </g>

          {/* Front sitting paws */}
          <g className="lc-front-paws">
            <ellipse cx="82" cy="148" rx="12" ry="10" fill={`url(#${gFace})`} />
            <ellipse cx="118" cy="148" rx="12" ry="10" fill={`url(#${gFace})`} />
          </g>
        </g>

        {/* Zzz for sleep */}
        <g className="lc-zzz" opacity="0">
          <text x="148" y="40" fill="var(--fh-muted, #8696a0)" fontSize="14" fontWeight="700">z</text>
          <text x="158" y="28" fill="var(--fh-muted, #8696a0)" fontSize="11" fontWeight="700">z</text>
        </g>
      </svg>
    </div>
  );
}

export default LumixoCat;
