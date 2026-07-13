// Lumixo mobile — pure transform math for MediaViewer's pinch/pan/double-tap.
//
// This is the crash-prevention core for the P0 pinch-to-zoom bug: feeding NaN or
// Infinity into a native (Skia) transform crashes the renderer, so every scale and
// translation value is validated/clamped here before it ever reaches a shared value.
//
// Each function carries the 'worklet' directive so react-native-reanimated can run
// it on the UI thread when called from a gesture/useAnimatedStyle worklet. Outside
// reanimated (e.g. Jest, plain JS) the directive is just an inert string literal, so
// these stay ordinary, fully unit-testable pure functions.

export const MIN_SCALE = 1;
export const MAX_SCALE = 6;
// Guard rail for translations: a finite offset this large is already nonsensical
// for any real screen, so treat it as corrupt and fall back to identity.
export const MAX_TRANSFORM = 10000;

/** A scale is usable only if finite and within [MIN_SCALE, MAX_SCALE]. */
export function isValidScale(s: number): boolean {
  'worklet';
  return Number.isFinite(s) && s >= MIN_SCALE && s <= MAX_SCALE;
}

/** A translation is usable only if finite and within the guard rail. */
export function isValidTransform(v: number): boolean {
  'worklet';
  return Number.isFinite(v) && Math.abs(v) < MAX_TRANSFORM;
}

/** Clamp a scale into [MIN_SCALE, MAX_SCALE]; non-finite input collapses to 1. */
export function safeClampScale(val: number): number {
  'worklet';
  if (!Number.isFinite(val)) return MIN_SCALE;
  return Math.max(MIN_SCALE, Math.min(val, MAX_SCALE));
}

/** Clamp a translation into [-max, max]; non-finite/invalid bounds collapse to 0. */
export function clampOffset(v: number, max: number): number {
  'worklet';
  if (!Number.isFinite(v) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(-max, Math.min(max, v));
}

/**
 * Maximum pan offset along an axis for a zoomed image: half the overflow of a
 * `dimension`-wide viewport scaled to `scale`. Returns 0 when not zoomed or when
 * inputs are non-finite (so a corrupt scale can never produce a NaN bound).
 */
export function maxOffset(dimension: number, scale: number): number {
  'worklet';
  if (!Number.isFinite(dimension) || !Number.isFinite(scale) || scale <= 1) return 0;
  return (dimension * (scale - 1)) / 2;
}
