/**
 * Lumixo — safe-area / window-insets helpers (pure).
 *
 * Never hardcode bottom padding for the system navigation bar, gesture
 * indicator, home indicator, or display cutouts. Derive from live insets
 * (react-native-safe-area-context → Android WindowInsets / iOS safe area)
 * so OEM 3-button bars, gesture nav, 2-button nav, notches, and foldables all work.
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

/** Default extra content padding below the last item (above the system inset). */
export const DEFAULT_SCROLL_EXTRA = 24;

/** Default sheet chrome pad on top of the system bottom inset. */
export const DEFAULT_SHEET_EXTRA = 12;

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

/**
 * ScrollView / FlatList contentContainerStyle.paddingBottom.
 * Always includes the live system navigation-bar inset so the last item
 * scrolls fully above 3-button / gesture / 2-button bars.
 *
 * @param extra additional content breathing room above the inset (not the nav bar itself)
 */
export function scrollBottomPad(
  insets: Pick<InsetEdges, 'bottom'>,
  extra: number = DEFAULT_SCROLL_EXTRA,
): number {
  return bottomInset(insets) + Math.max(0, extra);
}

/**
 * Bottom-sheet padding (action sheets, menus, pickers).
 * System inset + chrome so Cancel / last action never sits under the nav bar.
 */
export function sheetBottomPad(
  insets: Pick<InsetEdges, 'bottom'>,
  extra: number = DEFAULT_SHEET_EXTRA,
): number {
  // Floor at MIN_BOTTOM_PAD so a zero-inset OEM still gets a touch of pad.
  return Math.max(bottomInset(insets), MIN_BOTTOM_PAD) + Math.max(0, extra);
}

/**
 * Fixed footer / sticky bottom action bar padding.
 */
export function footerBottomPad(
  insets: Pick<InsetEdges, 'bottom'>,
  extra: number = 12,
): number {
  return bottomInset(insets) + Math.max(0, extra);
}

/**
 * Centered dialog vertical margins so the card never collides with
 * status bar / cutout or the system navigation bar.
 */
export function dialogVerticalPad(
  insets: Pick<InsetEdges, 'top' | 'bottom'>,
  min = 16,
): { paddingTop: number; paddingBottom: number } {
  return {
    paddingTop: Math.max(topInset(insets), min),
    paddingBottom: Math.max(bottomInset(insets), min),
  };
}

/**
 * Merge a computed bottom pad into an existing contentContainerStyle value
 * (object, array, or undefined). Preserves caller paddingBottom when larger.
 */
export function mergeScrollBottomPad(
  contentContainerStyle: unknown,
  bottomPad: number,
): unknown {
  const base = contentContainerStyle;
  if (base == null) {
    return { paddingBottom: bottomPad };
  }
  if (Array.isArray(base)) {
    return [...base, { paddingBottom: bottomPad }];
  }
  if (typeof base === 'object') {
    const prev = (base as { paddingBottom?: number }).paddingBottom;
    const merged =
      typeof prev === 'number' && Number.isFinite(prev)
        ? Math.max(prev, bottomPad)
        : bottomPad;
    return { ...(base as object), paddingBottom: merged };
  }
  // Style number / falsy — wrap as array so RN StyleSheet can flatten.
  return [base, { paddingBottom: bottomPad }];
}
