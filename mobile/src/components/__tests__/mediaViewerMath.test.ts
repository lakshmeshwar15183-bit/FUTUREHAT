// Real unit tests for the MediaViewer crash-prevention math (the P0 pinch-to-zoom fix).
// These exercise the exact functions the component imports — the whole point is that
// no NaN/Infinity/out-of-range value can ever reach a native transform.
import {
  MIN_SCALE,
  MAX_SCALE,
  MAX_TRANSFORM,
  isValidScale,
  isValidTransform,
  safeClampScale,
  clampOffset,
  maxOffset,
} from '../mediaViewerMath';

describe('isValidScale', () => {
  it('accepts the boundaries and interior', () => {
    expect(isValidScale(MIN_SCALE)).toBe(true);
    expect(isValidScale(MAX_SCALE)).toBe(true);
    expect(isValidScale(3.5)).toBe(true);
  });

  it('rejects out-of-range scales', () => {
    expect(isValidScale(0.99)).toBe(false);
    expect(isValidScale(6.01)).toBe(false);
    expect(isValidScale(0)).toBe(false);
    expect(isValidScale(-2)).toBe(false);
  });

  it('rejects non-finite values (the crash inputs)', () => {
    expect(isValidScale(NaN)).toBe(false);
    expect(isValidScale(Infinity)).toBe(false);
    expect(isValidScale(-Infinity)).toBe(false);
  });
});

describe('isValidTransform', () => {
  it('accepts finite offsets within the guard rail', () => {
    expect(isValidTransform(0)).toBe(true);
    expect(isValidTransform(-500)).toBe(true);
    expect(isValidTransform(MAX_TRANSFORM - 1)).toBe(true);
  });

  it('rejects offsets at/over the guard rail and non-finite values', () => {
    expect(isValidTransform(MAX_TRANSFORM)).toBe(false);
    expect(isValidTransform(MAX_TRANSFORM + 1)).toBe(false);
    expect(isValidTransform(NaN)).toBe(false);
    expect(isValidTransform(Infinity)).toBe(false);
    expect(isValidTransform(-Infinity)).toBe(false);
  });
});

describe('safeClampScale', () => {
  it('clamps into [MIN_SCALE, MAX_SCALE]', () => {
    expect(safeClampScale(0)).toBe(MIN_SCALE);
    expect(safeClampScale(0.5)).toBe(MIN_SCALE);
    expect(safeClampScale(100)).toBe(MAX_SCALE);
    expect(safeClampScale(3)).toBe(3);
  });

  it('collapses non-finite input to MIN_SCALE (never propagates NaN)', () => {
    expect(safeClampScale(NaN)).toBe(MIN_SCALE);
    expect(safeClampScale(Infinity)).toBe(MIN_SCALE);
    expect(safeClampScale(-Infinity)).toBe(MIN_SCALE);
  });

  it('always returns a value that passes isValidScale', () => {
    for (const v of [NaN, Infinity, -Infinity, -10, 0, 0.3, 1, 3, 6, 9999]) {
      expect(isValidScale(safeClampScale(v))).toBe(true);
    }
  });
});

describe('clampOffset', () => {
  it('clamps within symmetric bounds', () => {
    expect(clampOffset(50, 100)).toBe(50);
    expect(clampOffset(150, 100)).toBe(100);
    expect(clampOffset(-150, 100)).toBe(-100);
  });

  it('returns 0 for non-finite value or invalid bound', () => {
    expect(clampOffset(NaN, 100)).toBe(0);
    expect(clampOffset(Infinity, 100)).toBe(0);
    expect(clampOffset(50, 0)).toBe(0);
    expect(clampOffset(50, -100)).toBe(0);
    expect(clampOffset(50, NaN)).toBe(0);
  });

  it('output is always within the valid transform guard rail for finite bounds', () => {
    for (const [v, max] of [[99999, 5000], [-99999, 5000], [1, 200]] as const) {
      const out = clampOffset(v, max);
      expect(Number.isFinite(out)).toBe(true);
      expect(Math.abs(out)).toBeLessThanOrEqual(max);
    }
  });
});

describe('maxOffset', () => {
  it('is 0 when not zoomed', () => {
    expect(maxOffset(400, 1)).toBe(0);
    expect(maxOffset(400, 0.5)).toBe(0);
  });

  it('computes half the overflow when zoomed', () => {
    // 400px wide at 2x overflows by 400px → half is 200.
    expect(maxOffset(400, 2)).toBe(200);
    expect(maxOffset(400, 3)).toBe(400);
  });

  it('never returns NaN for corrupt inputs', () => {
    expect(maxOffset(NaN, 2)).toBe(0);
    expect(maxOffset(400, Infinity)).toBe(0);
    expect(maxOffset(400, NaN)).toBe(0);
  });

  it('feeds clampOffset a finite bound even from a corrupt scale', () => {
    // The real crash path: a bad scale must not produce a NaN clamp bound.
    const bound = maxOffset(400, NaN);
    expect(clampOffset(123, bound)).toBe(0);
  });
});
