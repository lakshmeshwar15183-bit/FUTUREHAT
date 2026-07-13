/**
 * Pure layout math for the chat thread (inverted FlatList + composer).
 * Kept free of React Native runtime so Jest can lock WhatsApp-class invariants.
 *
 * Coordinate model (inverted FlatList):
 *  - data is newest-first; inverted flips so newest hugs the visual bottom
 *  - contentContainerStyle.paddingTop  → visual gap ABOVE the composer (near last msg)
 *  - contentContainerStyle.paddingBottom → visual gap at the TOP of the thread
 *  - Outer paddingBottom lifts list+composer for IME / home indicator together
 */

/** Max residual IME height treated as “keyboard closed” (OEM noise). */
export const KEYBOARD_CLOSED_EPSILON_PX = 2;

/**
 * Bottom padding for the thread column (list + composer).
 * - Keyboard open: pad by IME height only (covers home indicator).
 * - Keyboard closed: pad by safe-area inset only.
 * Never Math.max(ime, inset) while IME is open — that double-counts on some OEMs.
 */
export function threadColumnBottomPad(
  keyboardHeight: number,
  safeAreaBottom: number,
): number {
  const kb = Number.isFinite(keyboardHeight) ? Math.max(0, keyboardHeight) : 0;
  const inset = Number.isFinite(safeAreaBottom) ? Math.max(0, safeAreaBottom) : 0;
  if (kb > KEYBOARD_CLOSED_EPSILON_PX) return kb;
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
