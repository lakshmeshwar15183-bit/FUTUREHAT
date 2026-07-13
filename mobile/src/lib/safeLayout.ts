/**
 * Lumixo — safe-area / window-insets helpers (pure).
 *
 * Never hardcode bottom padding for the system navigation bar, gesture
 * indicator, home indicator, or display cutouts. Derive from live insets
 * (react-native-safe-area-context → Android WindowInsets / iOS safe area)
 * so OEM 3-button bars, gesture nav, notches, and foldables all work.
 *
 * Pure functions only in this module (Jest-friendly). Hooks live in safeLayoutHooks.ts.
 */

/** Minimal inset shape — matches SafeAreaInsets without importing RN. */
export type InsetEdges = {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
};

/** Content height of the bottom tab bar (icons + labels + top pad), excluding system inset. */
export const TAB_BAR_CONTENT_HEIGHT = 52;

/** Minimum breathing room when system inset is 0 (rare, e.g. some emulators). */
export const MIN_BOTTOM_PAD = 8;

/** Bottom system inset, never less than `min`. */
export function bottomInset(insets: Pick<InsetEdges, 'bottom'>, min = 0): number {
  return Math.max(insets.bottom ?? 0, min);
}

/** Top system inset (status bar / cutout), never less than `min`. */
export function topInset(insets: Pick<InsetEdges, 'top'>, min = 0): number {
  return Math.max(insets.top ?? 0, min);
}

/**
 * Absolute FAB position: sits above the system nav bar (and optionally above
 * an in-app bottom chrome such as a tab bar that already owns the inset).
 */
export function fabBottom(
  insets: Pick<InsetEdges, 'bottom'>,
  opts: { extra?: number; includeSystem?: boolean } = {},
): number {
  const extra = opts.extra ?? 16;
  const includeSystem = opts.includeSystem !== false;
  return extra + (includeSystem ? bottomInset(insets) : 0);
}

/**
 * Bottom tab bar style that always sits above the system navigation bar.
 * Pass as `tabBarStyle`. Pair with `safeAreaInsets: { bottom: 0 }` on the
 * navigator so React Navigation does not double-apply the inset.
 */
export function tabBarSafeStyle(
  insets: Pick<InsetEdges, 'bottom'>,
  base: Record<string, unknown> = {},
): Record<string, unknown> {
  const bottom = bottomInset(insets);
  // When inset is 0 (gesture nav with thin bar on some OEMs, or landscape),
  // keep a small pad so labels never clip the screen edge.
  const pad = bottom > 0 ? bottom : MIN_BOTTOM_PAD;
  return {
    ...base,
    height: TAB_BAR_CONTENT_HEIGHT + pad,
    paddingTop: 6,
    paddingBottom: pad,
  };
}
