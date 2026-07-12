// Lumixo — "Hatsy", the login mascot. Eyes track typing; hands cover password focus.
// CSS-only animation (no framer-motion — keeps auth shell off the motion chunk).

interface Props {
  /** 0..1 — how far along the email field the user has typed (drives eye gaze). */
  gaze: number;
  /** Cover eyes (password focused). */
  coverEyes: boolean;
  /** Celebrate (successful submit). */
  happy: boolean;
}

export function Mascot({ gaze, coverEyes, happy }: Props) {
  const pupilX = (gaze - 0.5) * 10; // -5..5
  const pupilY = coverEyes ? 0 : 2.5;

  return (
    <svg
      width="132"
      height="132"
      viewBox="0 0 132 132"
      className="fh-mascot"
      style={{ filter: 'drop-shadow(0 10px 24px rgba(0,0,0,0.35))' }}
    >
      <circle cx="66" cy="74" r="42" fill="url(#faceGrad)" style={{ transformOrigin: '66px 74px', transform: happy ? 'scale(1.05)' : 'scale(1)', transition: 'transform 0.25s ease' }} />
      <circle cx="44" cy="86" r="7" fill="#ff7a9c" opacity="0.45" />
      <circle cx="88" cy="86" r="7" fill="#ff7a9c" opacity="0.45" />

      <ellipse cx="52" cy="72" rx="10" ry={happy ? 4 : 11} fill="#fff" />
      <ellipse cx="80" cy="72" rx="10" ry={happy ? 4 : 11} fill="#fff" />
      {!happy && (
        <>
          <circle cx={52 + pupilX} cy={72 + pupilY} r="5" fill="#1c1c2b" style={{ transition: 'cx 0.15s, cy 0.15s' }} />
          <circle cx={80 + pupilX} cy={72 + pupilY} r="5" fill="#1c1c2b" />
        </>
      )}

      <path
        d={happy ? 'M52 92 Q66 106 80 92' : 'M56 94 Q66 100 76 94'}
        stroke="#1c1c2b"
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
      />

      <g>
        <rect x="34" y="34" width="64" height="8" rx="4" fill="#15151f" />
        <rect x="44" y="8" width="44" height="30" rx="5" fill="#15151f" />
        <rect x="44" y="24" width="44" height="6" fill="var(--fh-accent)" />
      </g>

      <g
        style={{
          transform: coverEyes ? 'translateY(0)' : 'translateY(46px)',
          opacity: coverEyes ? 1 : 0,
          transition: 'transform 0.28s cubic-bezier(0.22,1,0.36,1), opacity 0.2s',
        }}
      >
        <circle cx="50" cy="72" r="13" fill="url(#handGrad)" />
        <circle cx="82" cy="72" r="13" fill="url(#handGrad)" />
        <rect x="60" y="66" width="12" height="3" rx="1.5" fill="rgba(0,0,0,0.15)" />
      </g>

      <defs>
        <linearGradient id="faceGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe0b8" />
          <stop offset="100%" stopColor="#f5c48a" />
        </linearGradient>
        <linearGradient id="handGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd9a8" />
          <stop offset="100%" stopColor="#f0b87a" />
        </linearGradient>
      </defs>
    </svg>
  );
}
