/**
 * Lumixo official mascot — "Lumi" (web).
 * Original premium SVG kitten redesigned from scratch.
 * GPU-only: CSS transform/opacity. No framer-motion. Auth-agnostic.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import {
  type CatMood,
  type CatSize,
  CAT_SIZE_PX,
  CAT_PALETTE as P,
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
  reduceMotion: reduceMotionProp,
}: LumixoCatProps) {
  const uid = useId().replace(/:/g, '');
  const px = CAT_SIZE_PX[size];
  const [blink, setBlink] = useState(false);
  const [earTwitch, setEarTwitch] = useState(false);
  const [systemReduce, setSystemReduce] = useState(false);

  // Honor OS prefers-reduced-motion unless parent forces a value.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setSystemReduce(!!mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  const reduceMotion = reduceMotionProp ?? systemReduce;

  // Random blink + ear twitch — paused when reduced motion / hiding / sleeping.
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
        setTimeout(() => alive && setBlink(false), 120);
        scheduleBlink();
      }, 2600 + Math.random() * 2600);
    };
    const scheduleEar = () => {
      earTimer = setTimeout(() => {
        if (!alive) return;
        setEarTwitch(true);
        setTimeout(() => alive && setEarTwitch(false), 280);
        scheduleEar();
      }, 4500 + Math.random() * 4500);
    };
    scheduleBlink();
    scheduleEar();
    return () => {
      alive = false;
      clearTimeout(blinkTimer);
      clearTimeout(earTimer);
    };
  }, [mood, reduceMotion]);

  // Soft pupil travel — gentle, never extreme.
  const pupilX = useMemo(() => (gaze - 0.5) * 5.2, [gaze]);

  const gFur = `lc-fur-${uid}`;
  const gFurBody = `lc-fur-body-${uid}`;
  const gEar = `lc-ear-${uid}`;
  const gAccent = `lc-accent-${uid}`;
  const gIris = `lc-iris-${uid}`;
  const gBell = `lc-bell-${uid}`;
  const soft = `lc-soft-${uid}`;

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
      role="img"
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : catAriaLabel(mood)}
    >
      <svg
        className="lc-svg"
        viewBox="0 0 200 200"
        width={px}
        height={px}
        xmlns="http://www.w3.org/2000/svg"
        shapeRendering="geometricPrecision"
      >
        <defs>
          {/* Soft cream fur — face */}
          <linearGradient id={gFur} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor={P.furTop} />
            <stop offset="55%" stopColor={P.furMid} />
            <stop offset="100%" stopColor={P.furShadow} />
          </linearGradient>
          {/* Body — slightly deeper for volume */}
          <linearGradient id={gFurBody} x1="0.3" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor={P.furTop} />
            <stop offset="100%" stopColor={P.furDeep} />
          </linearGradient>
          {/* Pink ear interiors */}
          <linearGradient id={gEar} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={P.earInner} />
            <stop offset="100%" stopColor={P.earInnerDeep} />
          </linearGradient>
          {/* Lumixo teal collar */}
          <linearGradient id={gAccent} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={P.accent} />
            <stop offset="50%" stopColor={P.accentSoft} />
            <stop offset="100%" stopColor={P.accentDeep} />
          </linearGradient>
          {/* Warm amber iris */}
          <radialGradient id={gIris} cx="38%" cy="36%" r="68%">
            <stop offset="0%" stopColor="#F0C878" />
            <stop offset="45%" stopColor={P.iris} />
            <stop offset="100%" stopColor={P.irisDeep} />
          </radialGradient>
          {/* Bell */}
          <radialGradient id={gBell} cx="40%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#FFE08A" />
            <stop offset="100%" stopColor="#E0A820" />
          </radialGradient>
          <filter id={soft} x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor="#1A2330" floodOpacity="0.16" />
          </filter>
        </defs>

        {/* Ground shadow */}
        <ellipse className="lc-shadow" cx="100" cy="186" rx="46" ry="6.5" fill={P.shadow} />

        <g className="lc-figure" filter={`url(#${soft})`}>
          {/* ── Tail: S-curve rooted in body (natural attachment) ── */}
          <g className="lc-tail">
            <path
              d="M132 128 C152 124, 168 112, 170 92 C172 74, 160 62, 148 68 C140 72, 138 84, 146 90"
              fill="none"
              stroke={`url(#${gFurBody})`}
              strokeWidth="15"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M132 128 C152 124, 168 112, 170 92 C172 74, 160 62, 148 68"
              fill="none"
              stroke={P.furShadow}
              strokeWidth="9"
              strokeLinecap="round"
              opacity="0.45"
            />
            {/* Soft fluffy tip + subtle brand tint */}
            <circle className="lc-tail-tip" cx="148" cy="68" r="8.5" fill={`url(#${gFur})`} />
            <circle cx="148" cy="68" r="4" fill={`url(#${gAccent})`} opacity="0.85" />
          </g>

          {/* ── Body: soft sitting loaf ── */}
          <ellipse className="lc-body" cx="100" cy="142" rx="44" ry="34" fill={`url(#${gFurBody})`} />
          {/* Chest fluff highlight */}
          <ellipse cx="100" cy="136" rx="22" ry="16" fill={P.furTop} opacity="0.55" />

          {/* Teal scarf / collar — soft ribbon around neck */}
          <path
            className="lc-collar"
            d="M68 124 C78 136, 122 136, 132 124 C126 132, 74 132, 68 124 Z"
            fill={`url(#${gAccent})`}
          />
          <path
            d="M66 124 Q100 138 134 124"
            fill="none"
            stroke={`url(#${gAccent})`}
            strokeWidth="5.5"
            strokeLinecap="round"
          />
          {/* Golden bell */}
          <circle className="lc-bell" cx="100" cy="134" r="5.5" fill={`url(#${gBell})`} />
          <line x1="100" y1="134" x2="100" y2="138" stroke="#B8860B" strokeWidth="1" strokeLinecap="round" />

          {/* Side haunches */}
          <ellipse cx="66" cy="158" rx="16" ry="12" fill={`url(#${gFur})`} />
          <ellipse cx="134" cy="158" rx="16" ry="12" fill={`url(#${gFur})`} />

          {/* ── Head ── */}
          <g className="lc-head">
            {/* Ears — rounded, soft pink interiors */}
            <g className="lc-ear lc-ear-l">
              <path
                d="M62 70 C56 52, 48 38, 58 34 C70 30, 78 50, 76 64 Z"
                fill={`url(#${gFur})`}
              />
              <path
                d="M62 64 C58 50, 54 42, 60 40 C66 38, 72 52, 70 62 Z"
                fill={`url(#${gEar})`}
                opacity="0.92"
              />
            </g>
            <g className="lc-ear lc-ear-r">
              <path
                d="M138 70 C144 52, 152 38, 142 34 C130 30, 122 50, 124 64 Z"
                fill={`url(#${gFur})`}
              />
              <path
                d="M138 64 C142 50, 146 42, 140 40 C134 38, 128 52, 130 62 Z"
                fill={`url(#${gEar})`}
                opacity="0.92"
              />
            </g>

            {/* Face — soft rounded oval (slightly wide, not a perfect circle) */}
            <ellipse className="lc-face" cx="100" cy="86" rx="44" ry="40" fill={`url(#${gFur})`} />
            {/* Soft forehead highlight */}
            <ellipse cx="100" cy="72" rx="26" ry="16" fill={P.furTop} opacity="0.5" />

            {/* Rosy cheeks */}
            <ellipse className="lc-cheek" cx="70" cy="96" rx="9" ry="6.5" fill={P.cheek} />
            <ellipse className="lc-cheek" cx="130" cy="96" rx="9" ry="6.5" fill={P.cheek} />

            {/* Soft brows — appear on confused/sad */}
            <g className="lc-brows" stroke={P.brow} strokeWidth="2" strokeLinecap="round" fill="none">
              <path className="lc-brow-l" d="M78 64 Q86 60 94 64" />
              <path className="lc-brow-r" d="M106 64 Q114 60 122 64" />
            </g>

            {/* Eyes — warm amber irises on white sclera (never black voids).
                Slightly compact + rounded for cute Pixar-like charm. */}
            <g className="lc-eyes">
              <g className="lc-eye lc-eye-l">
                {/* Soft white sclera */}
                <ellipse className="lc-eye-white" cx="84" cy="81" rx="10" ry="11" fill={P.sclera} />
                {/* Gentle rim */}
                <ellipse
                  cx="84"
                  cy="81"
                  rx="10"
                  ry="11"
                  fill="none"
                  stroke="rgba(74,52,48,0.07)"
                  strokeWidth="0.9"
                />
                {/* Warm iris fills most of the eye (friendly, not staring) */}
                <ellipse
                  className="lc-iris"
                  cx={84 + pupilX * 0.5}
                  cy="81.8"
                  rx="6.6"
                  ry="7.2"
                  fill={`url(#${gIris})`}
                />
                {/* Soft pupil */}
                <ellipse
                  className="lc-pupil"
                  cx={84 + pupilX}
                  cy="82.2"
                  rx="2.8"
                  ry="3.2"
                  fill={P.pupil}
                />
                {/* Catchlights — large + small for wet-eye life */}
                <circle className="lc-glint" cx={81.8 + pupilX * 0.65} cy="78.6" r="2.2" fill={P.glint} />
                <circle className="lc-glint-sm" cx={86 + pupilX * 0.35} cy="84" r="1" fill={P.glint} opacity="0.65" />
              </g>
              <g className="lc-eye lc-eye-r">
                <ellipse className="lc-eye-white" cx="116" cy="81" rx="10" ry="11" fill={P.sclera} />
                <ellipse
                  cx="116"
                  cy="81"
                  rx="10"
                  ry="11"
                  fill="none"
                  stroke="rgba(74,52,48,0.07)"
                  strokeWidth="0.9"
                />
                <ellipse
                  className="lc-iris"
                  cx={116 + pupilX * 0.5}
                  cy="81.8"
                  rx="6.6"
                  ry="7.2"
                  fill={`url(#${gIris})`}
                />
                <ellipse
                  className="lc-pupil"
                  cx={116 + pupilX}
                  cy="82.2"
                  rx="2.8"
                  ry="3.2"
                  fill={P.pupil}
                />
                <circle className="lc-glint" cx={113.8 + pupilX * 0.65} cy="78.6" r="2.2" fill={P.glint} />
                <circle className="lc-glint-sm" cx={118 + pupilX * 0.35} cy="84" r="1" fill={P.glint} opacity="0.65" />
              </g>

              {/* Soft closed lids for blink / sleep */}
              <g className="lc-lids">
                <path
                  className="lc-lid-l"
                  d="M74 83 Q84 74 94 83"
                  fill="none"
                  stroke={`url(#${gFur})`}
                  strokeWidth="6.5"
                  strokeLinecap="round"
                />
                <path
                  className="lc-lid-r"
                  d="M106 83 Q116 74 126 83"
                  fill="none"
                  stroke={`url(#${gFur})`}
                  strokeWidth="6.5"
                  strokeLinecap="round"
                />
                {/* Gentle lash curve when closed */}
                <path d="M75 83 Q84 78 93 83" fill="none" stroke={P.mouth} strokeWidth="1.3" strokeLinecap="round" opacity="0.32" />
                <path d="M107 83 Q116 78 125 83" fill="none" stroke={P.mouth} strokeWidth="1.3" strokeLinecap="round" opacity="0.32" />
              </g>
            </g>

            {/* Tiny pink nose */}
            <path
              className="lc-nose"
              d="M100 94 C97.5 94, 96 96.5, 97.2 98.2 C98.2 99.5, 101.8 99.5, 102.8 98.2 C104 96.5, 102.5 94, 100 94 Z"
              fill={P.nose}
            />
            <ellipse cx="100" cy="96.2" rx="1.6" ry="0.9" fill="#FFD0DC" opacity="0.7" />

            {/* Gentle mouth — soft W / smile / sad variants */}
            <path
              className="lc-mouth"
              d="M94 102 Q97 105 100 102 Q103 105 106 102"
              fill="none"
              stroke={P.mouth}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              className="lc-mouth-happy"
              d="M90 100 Q100 112 110 100"
              fill="none"
              stroke={P.mouth}
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0"
            />
            <path
              className="lc-mouth-sad"
              d="M92 106 Q100 100 108 106"
              fill="none"
              stroke={P.mouth}
              strokeWidth="1.8"
              strokeLinecap="round"
              opacity="0"
            />

            {/* Soft whiskers */}
            <g className="lc-whiskers" stroke={P.whisker} strokeWidth="1.15" strokeLinecap="round">
              <line x1="48" y1="92" x2="70" y2="94" />
              <line x1="48" y1="100" x2="70" y2="100" />
              <line x1="46" y1="108" x2="70" y2="106" />
              <line x1="130" y1="94" x2="152" y2="92" />
              <line x1="130" y1="100" x2="152" y2="100" />
              <line x1="130" y1="106" x2="154" y2="108" />
            </g>

            {/* Covering paws — fully obscure eyes when hiding */}
            <g className="lc-paws-cover">
              <ellipse className="lc-paw-l" cx="78" cy="86" rx="20" ry="16" fill={`url(#${gFur})`} />
              <ellipse className="lc-paw-r" cx="122" cy="86" rx="20" ry="16" fill={`url(#${gFur})`} />
              {/* Toe beans */}
              <circle cx="72" cy="90" r="2.6" fill={P.earInner} opacity="0.55" />
              <circle cx="79" cy="92" r="2.8" fill={P.earInner} opacity="0.55" />
              <circle cx="86" cy="90" r="2.6" fill={P.earInner} opacity="0.55" />
              <circle cx="114" cy="90" r="2.6" fill={P.earInner} opacity="0.55" />
              <circle cx="121" cy="92" r="2.8" fill={P.earInner} opacity="0.55" />
              <circle cx="128" cy="90" r="2.6" fill={P.earInner} opacity="0.55" />
            </g>
          </g>

          {/* Tiny front paws */}
          <g className="lc-front-paws">
            <ellipse cx="84" cy="164" rx="11" ry="8.5" fill={`url(#${gFur})`} />
            <ellipse cx="116" cy="164" rx="11" ry="8.5" fill={`url(#${gFur})`} />
            <circle cx="80" cy="166" r="1.6" fill={P.earInner} opacity="0.4" />
            <circle cx="84" cy="167" r="1.6" fill={P.earInner} opacity="0.4" />
            <circle cx="88" cy="166" r="1.6" fill={P.earInner} opacity="0.4" />
            <circle cx="112" cy="166" r="1.6" fill={P.earInner} opacity="0.4" />
            <circle cx="116" cy="167" r="1.6" fill={P.earInner} opacity="0.4" />
            <circle cx="120" cy="166" r="1.6" fill={P.earInner} opacity="0.4" />
          </g>
        </g>

        {/* Celebrate sparkles */}
        <g className="lc-sparkles" opacity="0">
          <path d="M42 48 L44 54 L50 56 L44 58 L42 64 L40 58 L34 56 L40 54 Z" fill={P.sparkle} />
          <path d="M158 40 L159.5 45 L164 46.5 L159.5 48 L158 53 L156.5 48 L152 46.5 L156.5 45 Z" fill={P.accent} />
          <path d="M168 88 L169 91 L172 92 L169 93 L168 96 L167 93 L164 92 L167 91 Z" fill={P.sparkle} />
          <circle cx="52" cy="100" r="2" fill={P.accentSoft} />
          <circle cx="150" cy="110" r="1.6" fill="#FFE08A" />
        </g>

        {/* Sleep zzz */}
        <g className="lc-zzz" opacity="0">
          <text x="148" y="48" fill="var(--fh-muted, #8696a0)" fontSize="13" fontWeight="700" fontFamily="system-ui,sans-serif">
            z
          </text>
          <text x="158" y="36" fill="var(--fh-muted, #8696a0)" fontSize="10" fontWeight="700" fontFamily="system-ui,sans-serif">
            z
          </text>
        </g>
      </svg>
    </div>
  );
}

export default LumixoCat;
