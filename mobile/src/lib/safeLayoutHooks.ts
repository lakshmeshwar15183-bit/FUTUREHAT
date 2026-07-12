/**
 * Safe-area hooks (require RN runtime). Prefer pure helpers from safeLayout.ts
 * when you already hold an EdgeInsets value from useSafeAreaInsets().
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomInset, topInset } from './safeLayout';

/** Hook: bottom inset for padding under fixed footers / FABs / sheets. */
export function useBottomInset(min = 0): number {
  return bottomInset(useSafeAreaInsets(), min);
}

/** Hook: top inset for headers drawn under a translucent status bar. */
export function useTopInset(min = 0): number {
  return topInset(useSafeAreaInsets(), min);
}
