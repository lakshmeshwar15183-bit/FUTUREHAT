/**
 * Lumi mascot helpers — pure unit tests (no DOM / RN).
 */
import {
  CAT_MOTION,
  CAT_PALETTE,
  CAT_SIZE_PX,
  catAriaLabel,
  catGazeFromEmail,
  catMoodFromAuth,
  type CatMood,
} from '../../../../shared/lumixoCat';

describe('catMoodFromAuth', () => {
  it('prioritizes success over error and focus', () => {
    expect(
      catMoodFromAuth({
        passwordFocused: true,
        emailFocused: true,
        error: 'bad',
        success: true,
      }),
    ).toBe('celebrating');
  });

  it('maps wrong password / error to confused', () => {
    expect(
      catMoodFromAuth({
        passwordFocused: false,
        emailFocused: false,
        error: 'Invalid login',
      }),
    ).toBe('confused');
  });

  it('maps password focus to hiding', () => {
    expect(
      catMoodFromAuth({
        passwordFocused: true,
        emailFocused: false,
      }),
    ).toBe('hiding');
  });

  it('maps email focus to watching', () => {
    expect(
      catMoodFromAuth({
        passwordFocused: false,
        emailFocused: true,
      }),
    ).toBe('watching');
  });

  it('defaults to idle', () => {
    expect(
      catMoodFromAuth({
        passwordFocused: false,
        emailFocused: false,
      }),
    ).toBe('idle');
  });

  it('prefers password hiding over email watching', () => {
    expect(
      catMoodFromAuth({
        passwordFocused: true,
        emailFocused: true,
      }),
    ).toBe('hiding');
  });
});

describe('catGazeFromEmail', () => {
  it('returns 0 for empty email', () => {
    expect(catGazeFromEmail('')).toBe(0);
  });

  it('scales with length up to maxLen', () => {
    expect(catGazeFromEmail('a'.repeat(14), 28)).toBeCloseTo(0.5);
    expect(catGazeFromEmail('a'.repeat(28), 28)).toBe(1);
    expect(catGazeFromEmail('a'.repeat(100), 28)).toBe(1);
  });

  it('clamps below 0', () => {
    expect(catGazeFromEmail('', 10)).toBe(0);
  });
});

describe('catAriaLabel', () => {
  const moods: CatMood[] = [
    'idle',
    'watching',
    'hiding',
    'confused',
    'celebrating',
    'sleeping',
    'wave',
    'sad',
  ];

  it('returns a non-empty string for every mood', () => {
    for (const mood of moods) {
      const label = catAriaLabel(mood);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(4);
    }
  });
});

describe('tokens', () => {
  it('exposes all size tokens', () => {
    expect(CAT_SIZE_PX.xs).toBe(56);
    expect(CAT_SIZE_PX.hero).toBe(200);
  });

  it('uses ~1s sad hold for confused', () => {
    expect(CAT_MOTION.confuseHoldMs).toBe(1000);
  });

  it('uses Lumixo teal accents', () => {
    expect(CAT_PALETTE.accent.toLowerCase()).toBe('#00a884');
    expect(CAT_PALETTE.sclera).toBe('#FFFFFF');
    expect(CAT_PALETTE.pupil).not.toMatch(/#000|#1a2330/i);
  });
});
