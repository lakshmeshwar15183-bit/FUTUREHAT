/**
 * Lumixo official mascot — "Lumi" the kitten.
 * Shared mood / size / timing contract for web + mobile.
 * UI-only; zero coupling to authentication logic.
 */

export type CatMood =
  | 'idle' // soft breath, blink, slow tail
  | 'watching' // email focus — eyes track, alert ears
  | 'hiding' // password focus — paws cover eyes completely
  | 'confused' // wrong password — tilt + shake, sad eyes
  | 'celebrating' // success — happy bounce, tail wag, sparkles
  | 'sleeping' // offline / empty calm
  | 'wave' // onboarding / welcome
  | 'sad'; // generic error

export type CatSize = 'xs' | 'sm' | 'md' | 'lg' | 'hero';

/** Pixel size for each token (square bounding box). */
export const CAT_SIZE_PX: Record<CatSize, number> = {
  xs: 56,
  sm: 88,
  md: 120,
  lg: 160,
  hero: 200,
};

/**
 * Animation timing tokens — keep web CSS & mobile Reanimated in sync.
 * All durations in milliseconds. Designed for 60 FPS transform/opacity only.
 */
export const CAT_MOTION = {
  breathMs: 2800,
  breathScale: 1.018,
  tailSlowMs: 3200,
  tailWatchMs: 1600,
  tailCelebrateMs: 420,
  blinkMinMs: 2600,
  blinkMaxMs: 5200,
  blinkHoldMs: 120,
  earTwitchMinMs: 4500,
  earTwitchMaxMs: 9000,
  earTwitchHoldMs: 280,
  headWatchMs: 2400,
  hideMs: 340,
  confuseShakeMs: 520,
  confuseHoldMs: 1000,
  celebrateBounceMs: 640,
  gazeSmoothMs: 140,
  reduceMotion: false,
} as const;

/** Soft brand palette for Lumi (cream kitten + Lumixo teal). */
export const CAT_PALETTE = {
  furTop: '#FFFCF7',
  furMid: '#F7F0E6',
  furShadow: '#E8DFD2',
  furDeep: '#D9CFC0',
  earInner: '#FFC4D4',
  earInnerDeep: '#F5A0B4',
  cheek: 'rgba(255, 180, 198, 0.42)',
  nose: '#F4A0B4',
  noseShadow: '#E8889E',
  mouth: 'rgba(74, 52, 48, 0.55)',
  brow: 'rgba(74, 52, 48, 0.35)',
  sclera: '#FFFFFF',
  iris: '#C9954A',
  irisDeep: '#A67635',
  pupil: '#3A2A1C',
  glint: '#FFFFFF',
  accent: '#00A884',
  accentSoft: '#06CF9C',
  accentDeep: '#008F6F',
  whisker: 'rgba(74, 52, 48, 0.18)',
  shadow: 'rgba(26, 35, 48, 0.14)',
  sparkle: '#06CF9C',
} as const;

/** Map auth UI state → mood (pure helper — keep auth free of animation detail). */
export function catMoodFromAuth(opts: {
  passwordFocused: boolean;
  emailFocused: boolean;
  error?: string | null;
  success?: boolean;
}): CatMood {
  if (opts.success) return 'celebrating';
  if (opts.error) return 'confused';
  if (opts.passwordFocused) return 'hiding';
  if (opts.emailFocused) return 'watching';
  return 'idle';
}

/** Gaze 0..1 for pupil tracking from typed email length. */
export function catGazeFromEmail(email: string, maxLen = 28): number {
  return Math.min(1, Math.max(0, email.length / maxLen));
}

/** Accessible label for the mascot (decorative when empty string). */
export function catAriaLabel(mood: CatMood): string {
  switch (mood) {
    case 'hiding':
      return 'Lumi the cat covering eyes while you type your password';
    case 'watching':
      return 'Lumi the cat watching you type';
    case 'confused':
      return 'Lumi the cat looking confused';
    case 'celebrating':
      return 'Lumi the cat celebrating';
    case 'sleeping':
      return 'Lumi the cat resting';
    case 'wave':
      return 'Lumi the cat waving hello';
    case 'sad':
      return 'Lumi the cat looking sad';
    default:
      return 'Lumi, the Lumixo cat mascot';
  }
}
