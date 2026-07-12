/**
 * Lumixo official mascot — "Lumi" the cat.
 * Shared mood / size contract for web + mobile. UI-only; no auth coupling.
 */

export type CatMood =
  | 'idle' // soft breath, blink, slow tail
  | 'watching' // email focus — eyes track, alert ears
  | 'hiding' // password focus — paws over eyes, never peeks
  | 'confused' // wrong password — tilt + shake
  | 'celebrating' // success — happy wag
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

/** Map auth UI state → mood (pure helper — keep auth logic free of animation detail). */
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
