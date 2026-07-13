/**
 * Pure layout math for the chat thread (inverted FlatList + composer).
 * Kept free of React Native runtime so Jest can lock WhatsApp-class invariants.
 *
 * Coordinate model (inverted FlatList):
 *  - data is newest-first; inverted flips so newest hugs the visual bottom
 *  - contentContainerStyle.paddingTop  → visual gap ABOVE the composer (near last msg)
 *  - contentContainerStyle.paddingBottom → visual gap at the TOP of the thread
 *  - Outer paddingBottom lifts list+composer for IME / home indicator together
 *
 * CRITICAL — Android dual modes:
 *  1) Classic adjustResize: OS shrinks the window by ~IME height. Extra pad =
 *     huge empty band between last message and composer (the old gap bug).
 *  2) Edge-to-edge / OEM (Realme, Android 15 targetSdk 35, etc.): OS reports
 *     IME insets but does NOT shrink the RN window. Pad 0 → composer sits
 *     UNDER the keyboard (the phone screenshot bug).
 *
 * Fix: android-resize pads only the residual (IME height − measured window
 * shrink). Full resize → residual 0 (no gap). No resize → residual = IME
 * (composer rides above the keyboard).
 */

/** Max residual IME height treated as “keyboard closed” (OEM noise). */
export const KEYBOARD_CLOSED_EPSILON_PX = 2;

/**
 * If measured window shrink is within this many px of IME height, treat resize
 * as complete (avoid 1–8px noise gaps on OEMs).
 */
export const ANDROID_RESIZE_COMPLETE_SLACK_PX = 8;

/**
 * How the host window interacts with the IME.
 * - `manual` — iOS / adjustPan: pad by keyboard height when open.
 * - `android-resize` — prefer OS resize; only pad residual IME not already
 *   excluded by a measured window height drop.
 */
export type KeyboardPadMode = 'manual' | 'android-resize';

/**
 * Bottom padding for the thread column (list + composer).
 * - Keyboard closed: safe-area inset only.
 * - Keyboard open (manual): IME height only (covers home indicator).
 * - Keyboard open (android-resize): max(0, ime − windowShrink) with small slack.
 * Never Math.max(ime, inset) while IME is open — double-counts on OEMs.
 *
 * @param windowShrinkPx how many px the window height dropped when IME opened
 *   (closedWindowHeight − openWindowHeight). Pass 0 when unknown / iOS.
 */
export function threadColumnBottomPad(
  keyboardHeight: number,
  safeAreaBottom: number,
  mode: KeyboardPadMode = 'manual',
  windowShrinkPx = 0,
): number {
  // Callable from Reanimated UI worklets (ChatScreen keyboard pad). Pure math only.
  'worklet';
  const kb = Number.isFinite(keyboardHeight) ? Math.max(0, keyboardHeight) : 0;
  const inset = Number.isFinite(safeAreaBottom) ? Math.max(0, safeAreaBottom) : 0;
  const open = kb > KEYBOARD_CLOSED_EPSILON_PX;

  if (mode === 'android-resize') {
    if (!open) return inset;
    const shrink = Number.isFinite(windowShrinkPx) ? Math.max(0, windowShrinkPx) : 0;
    const residual = Math.max(0, kb - shrink);
    // Full (or near-full) OS resize → no extra pad (prevents the huge gap bug).
    if (residual <= ANDROID_RESIZE_COMPLETE_SLACK_PX) return 0;
    // Edge-to-edge / OEM: window barely shrank — lift by remaining IME.
    return residual;
  }

  // iOS / pan: lift the whole column by the keyboard height.
  if (open) return kb;
  return inset;
}

/**
 * Inverted list content padding.
 * Keep near-composer padding tiny so the last bubble hugs the input (WhatsApp).
 */
export function invertedListContentPadding(opts?: {
  nearComposerPx?: number;
  nearTopPx?: number;
}): { paddingTop: number; paddingBottom: number } {
  return {
    // inverted: paddingTop lands next to the composer
    paddingTop: opts?.nearComposerPx ?? 2,
    // inverted: paddingBottom lands at the oldest-message end
    paddingBottom: opts?.nearTopPx ?? 8,
  };
}

/** Internal composer chrome padding (not safe-area). */
export const COMPOSER_INNER_PAD_BOTTOM = 6;

/**
 * Composer bottom padding when the column already applied safe-area / keyboard.
 * Only inner chrome — never add insets.bottom again here.
 */
export function composerInnerBottomPad(): number {
  return COMPOSER_INNER_PAD_BOTTOM;
}

/**
 * Whether the inverted list is scrolled to the latest messages.
 * Offset 0 = pinned to newest. Tolerate a few px of OEM jitter, not hundreds.
 */
export function isInvertedAtLatest(contentOffsetY: number, slackPx = 16): boolean {
  return contentOffsetY <= slackPx;
}

/**
 * When composer height changes, should we re-pin to latest?
 * Only if user was already following the latest messages.
 */
export function shouldRepinToLatestOnComposerResize(atLatest: boolean): boolean {
  return atLatest;
}

/**
 * Detect a meaningful composer height change (ignore sub-pixel noise).
 */
export function composerHeightChanged(
  prev: number,
  next: number,
  thresholdPx = 1,
): boolean {
  return Math.abs(prev - next) > thresholdPx;
}

/**
 * Height for emoji/sticker tray so it matches the last keyboard height
 * (WhatsApp: switching emoji ↔ keyboard does not jump).
 */
export function composerTrayHeight(
  lastKeyboardHeight: number,
  windowHeight: number,
  fallbackFraction = 0.38,
): number {
  const fallback = Math.round(windowHeight * fallbackFraction);
  const kb = Number.isFinite(lastKeyboardHeight) ? lastKeyboardHeight : 0;
  if (kb < 180) return Math.max(240, fallback);
  // Cap so small phones still show a few messages above the tray.
  const max = Math.round(windowHeight * 0.5);
  return Math.min(Math.max(kb, 240), max);
}
