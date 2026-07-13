/**
 * Safe-area hooks (require RN runtime). Prefer pure helpers from safeLayout.ts
 * when you already hold an EdgeInsets value from useSafeAreaInsets().
 *
 * All values re-render when the user switches gesture ↔ 3-button navigation
 * (or rotates / multi-window), so layouts update without an app restart.
 */
import { useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  bottomInset,
  topInset,
  scrollBottomPad,
  sheetBottomPad,
  footerBottomPad,
  dialogVerticalPad,
  mergeScrollBottomPad,
  DEFAULT_SCROLL_EXTRA,
  DEFAULT_SHEET_EXTRA,
  type InsetEdges,
} from './safeLayout';

/** Hook: bottom inset for padding under fixed footers / FABs / sheets. */
export function useBottomInset(min = 0): number {
  return bottomInset(useSafeAreaInsets(), min);
}

/** Hook: top inset for headers drawn under a translucent status bar. */
export function useTopInset(min = 0): number {
  return topInset(useSafeAreaInsets(), min);
}

/** Live insets object (re-renders on nav-mode / rotation changes). */
export function useInsets(): InsetEdges {
  return useSafeAreaInsets();
}

/**
 * Bottom padding for ScrollView / FlatList content so the last item clears
 * the system navigation bar. Use as contentContainerStyle.paddingBottom.
 */
export function useScrollBottomPad(extra: number = DEFAULT_SCROLL_EXTRA): number {
  const insets = useSafeAreaInsets();
  return scrollBottomPad(insets, extra);
}

/** Bottom padding for action sheets / bottom menus. */
export function useSheetBottomPad(extra: number = DEFAULT_SHEET_EXTRA): number {
  const insets = useSafeAreaInsets();
  return sheetBottomPad(insets, extra);
}

/** Bottom padding for sticky footers / bottom action bars. */
export function useFooterBottomPad(extra = 12): number {
  const insets = useSafeAreaInsets();
  return footerBottomPad(insets, extra);
}

/** Vertical padding for centered dialogs (status bar + nav bar). */
export function useDialogVerticalPad(min = 16): {
  paddingTop: number;
  paddingBottom: number;
} {
  const insets = useSafeAreaInsets();
  return dialogVerticalPad(insets, min);
}

/**
 * Merge system bottom inset into a FlatList / ScrollView contentContainerStyle.
 * Prefer SafeScrollView for ScrollViews; use this for FlatList / SectionList.
 *
 * @param existing existing contentContainerStyle
 * @param extra content breathing room above the system inset
 * @param includeBottom when false, skip system inset (tab screens already above tab bar)
 */
export function useSafeContentContainerStyle(
  existing?: unknown,
  extra: number = DEFAULT_SCROLL_EXTRA,
  includeBottom = true,
): unknown {
  const insets = useSafeAreaInsets();
  return useMemo(() => {
    if (!includeBottom) return existing;
    const pad = scrollBottomPad(insets, extra);
    return mergeScrollBottomPad(existing, pad);
  }, [existing, insets.bottom, extra, includeBottom]);
}
