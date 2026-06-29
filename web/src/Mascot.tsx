// FUTUREHAT — "Hatsy", the login mascot. A top-hat character whose eyes track
// what you type and who covers its eyes while you enter your password.

import { motion } from 'framer-motion';
import { spring } from './motion';

interface Props {
  /** 0..1 — how far along the email field the user has typed (drives eye gaze). */
  gaze: number;
  /** Cover eyes (password focused). */
  coverEyes: boolean;
  /** Celebrate (successful submit). */
  happy: boolean;
}

export function Mascot({ gaze, coverEyes, happy }: Props) {
  // Pupils slide horizontally with gaze, and down a touch as you type.
  const pupilX = (gaze - 0.5) * 10; // -5..5
  const pupilY = coverEyes ? 0 : 2.5;

  return (
    <motion.svg
      width="132" height="132" viewBox="0 0 132 132"
      initial={{ scale: 0.7, opacity: 0, y: 10 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={spring}
      style={{ filter: 'drop-shadow(0 10px 24px rgba(0,0,0,0.35))' }}
    >
      {/* face */}
      <motion.circle
        cx="66" cy="74" r="42"
        fill="url(#faceGrad)"
        animate={{ scale: happy ? 1.05 : 1 }}
        transition={spring}
        style={{ transformOrigin: '66px 74px' }}
      />
      {/* cheeks */}
      <circle cx="44" cy="86" r="7" fill="#ff7a9c" opacity="0.45" />
      <circle cx="88" cy="86" r="7" fill="#ff7a9c" opacity="0.45" />

      {/* eyes (whites) */}
      <ellipse cx="52" cy="72" rx="10" ry={happy ? 4 : 11} fill="#fff" />
      <ellipse cx="80" cy="72" rx="10" ry={happy ? 4 : 11} fill="#fff" />
      {/* pupils */}
      {!happy && (
        <>
          <motion.circle cx="52" cy="72" r="5" fill="#1c1c2b"
            animate={{ x: pupilX, y: pupilY }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
          <motion.circle cx="80" cy="72" r="5" fill="#1c1c2b"
            animate={{ x: pupilX, y: pupilY }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
        </>
      )}

      {/* mouth */}
      <motion.path
        d={happy ? 'M52 92 Q66 106 80 92' : 'M56 94 Q66 100 76 94'}
        stroke="#1c1c2b" strokeWidth="3.5" fill="none" strokeLinecap="round"
        animate={{ d: happy ? 'M52 92 Q66 106 80 92' : 'M56 94 Q66 100 76 94' }}
      />

      {/* top hat */}
      <g>
        <rect x="34" y="34" width="64" height="8" rx="4" fill="#15151f" />
        <rect x="44" y="8" width="44" height="30" rx="5" fill="#15151f" />
        <rect x="44" y="24" width="44" height="6" fill="var(--fh-accent)" />
      </g>

      {/* hands that cover the eyes while typing a password */}
      <motion.g
        initial={false}
        animate={{ y: coverEyes ? 0 : 46, opacity: coverEyes ? 1 : 0 }}
        transition={spring}
      >
        <circle cx="50" cy="72" r="13" fill="url(#handGrad)" />
        <circle cx="82" cy="72" r="13" fill="url(#handGrad)" />
        {/* peek gap */}
        <rect x="60" y="66" width="12" height="3" rx="1.5" fill="rgba(0,0,0,0.15)" />
      </motion.g>

      <defs>
        <linearGradient id="faceGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe0a3" />
          <stop offset="100%" stopColor="#ffc26b" />
        </linearGradient>
        <linearGradient id="handGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd190" />
          <stop offset="100%" stopColor="#f5b562" />
        </linearGradient>
      </defs>
    </motion.svg>
  );
}
