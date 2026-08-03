/**
 * Pure layout math for the chat thread (inverted FlatList + composer).
 * Kept free of React Native runtime so Jest can lock WhatsApp-class invariants.
 *
 * Coordinate model (inverted FlatList):
 *  - data is newest-first; inverted flips so newest hugs the visual bottom
 *  - contentContainerStyle.paddingTop  → visual gap ABOVE the composer (near last msg)
 *  - contentContainerStyle.paddingBottom → visual gap at the TOP of the thread
 *  - Bottom IME/nav spacer lifts list+composer together (WhatsApp)
 *
 * Production host (ChatScreen):
 *  - Uses react-native-keyboard-controller (Android WindowInsets IME animation)
 *  - Spacer height = chatBottomSpacer(imeHeight, safeAreaBottom, trayHeight)
 *  - Never hardcodes nav / keyboard dp values
 */

/** Max residual IME height treated as “keyboard closed” (OEM noise). */
export const KEYBOARD_CLOSED_EPSILON_PX = 2;

/**
 * If measured window shrink is within this many px of IME height, treat resize
 * as complete (legacy residual path only).
 */
export const ANDROID_RESIZE_COMPLETE_SLACK_PX = 8;

/**
 * How the host window interacts with the IME (legacy helpers).
 * Production chat uses `chatBottomSpacer` + keyboard-controller IME height.
 */
export type KeyboardPadMode = 'manual' | 'android-resize';

/**
 * WhatsApp-class bottom spacer under the composer.
 *
 * Priority:
 *  1) System IME open → full IME height (covers nav bar under keyboard)
 *  2) Emoji/sticker tray open → tray height
 *  3) Otherwise → system navigation bar / home indicator inset
 *
 * Never Math.max(ime, inset) while IME open (double-count / huge gap).
 * Never hardcode dp for 3-button vs gesture — pass live inset / IME height.
 */
export function chatBottomSpacer(
  imeHeight: number,
  safeAreaBottom: number,
  trayHeight = 0,
): number {
  'worklet';
  const ime = Number.isFinite(imeHeight) ? Math.max(0, imeHeight) : 0;
  const inset = Number.isFinite(safeAreaBottom) ? Math.max(0, safeAreaBottom) : 0;
  const tray = Number.isFinite(trayHeight) ? Math.max(0, trayHeight) : 0;

  if (ime > KEYBOARD_CLOSED_EPSILON_PX) return ime;
  if (tray > KEYBOARD_CLOSED_EPSILON_PX) return tray;
  return inset;
}

/**
 * Derive IME height from a Keyboard event under edge-to-edge Android.
 * Prefer screenY-based distance to bottom of screen (reliable when
 * endCoordinates.height is wrong on OEM Gboard / Realme / ColorOS).
 */
export function imeHeightFromEvent(
  end: { height?: number; screenY?: number } | null | undefined,
  screenHeight: number,
): number {
  if (!end) return 0;
  const screenH = Number.isFinite(screenHeight) ? Math.max(0, screenHeight) : 0;

  if (typeof end.screenY === 'number' && Number.isFinite(end.screenY) && screenH > 0) {
    const fromScreen = screenH - end.screenY;
    if (fromScreen > KEYBOARD_CLOSED_EPSILON_PX) return Math.max(0, fromScreen);
  }

  const h = typeof end.height === 'number' && Number.isFinite(end.height) ? end.height : 0;
  return h > KEYBOARD_CLOSED_EPSILON_PX ? Math.max(0, h) : 0;
}

/**
 * Bottom padding for the thread column (legacy name used by older tests).
 * Prefer chatBottomSpacer in new code.
 */
export function threadColumnBottomPad(
  keyboardHeight: number,
  safeAreaBottom: number,
  mode: KeyboardPadMode = 'manual',
  windowShrinkPx = 0,
): number {
  'worklet';
  const kb = Number.isFinite(keyboardHeight) ? Math.max(0, keyboardHeight) : 0;
  const inset = Number.isFinite(safeAreaBottom) ? Math.max(0, safeAreaBottom) : 0;
  const open = kb > KEYBOARD_CLOSED_EPSILON_PX;

  if (mode === 'android-resize') {
    if (!open) return inset;
    const shrink = Number.isFinite(windowShrinkPx) ? Math.max(0, windowShrinkPx) : 0;
    const residual = Math.max(0, kb - shrink);
    if (residual <= ANDROID_RESIZE_COMPLETE_SLACK_PX) return 0;
    return residual;
  }

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
    paddingTop: opts?.nearComposerPx ?? 2,
    paddingBottom: opts?.nearTopPx ?? 8,
  };
}

/** Internal composer chrome padding (not safe-area / not IME). */
export const COMPOSER_INNER_PAD_BOTTOM = 6;

/**
 * Composer bottom padding when the column/spacer already applied safe-area / IME.
 * Only inner chrome — never add insets.bottom or IME again here.
 */
export function composerInnerBottomPad(): number {
  return COMPOSER_INNER_PAD_BOTTOM;
}

export function isInvertedAtLatest(contentOffsetY: number, slackPx = 16): boolean {
  return contentOffsetY <= slackPx;
}

export function shouldRepinToLatestOnComposerResize(atLatest: boolean): boolean {
  return atLatest;
}

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
  const max = Math.round(windowHeight * 0.5);
  return Math.min(Math.max(kb, 240), max);
}
