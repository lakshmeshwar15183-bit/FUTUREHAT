// Lumixo — unified motion design tokens.
// Premium messenger motion: snappy open, soft close, never springy/game-like.
// Use these durations/easings everywhere (dialogs, sheets, chrome, lists).
import { Easing, type WithTimingConfig } from 'react-native-reanimated';
import { LayoutAnimation, Platform, UIManager } from 'react-native';

/** Enable LayoutAnimation on Android once (idempotent). */
export function enableLayoutAnimations(): void {
  if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

export const motion = {
  /** Instant feedback (press scale) */
  instantMs: 80,
  /** Micro chrome fades (tab, badge) */
  microMs: 120,
  /** Standard fade / opacity */
  fastMs: 160,
  /** Sheets, dialogs open */
  openMs: 170,
  /** Sheets, dialogs close */
  closeMs: 140,
  /** Sheet slide (bottom sheet) */
  sheetOpenMs: 180,
  sheetCloseMs: 150,
  /** Screen-level transitions */
  screenMs: 220,
  /** Media viewer open */
  mediaMs: 200,
} as const;

export const ease = {
  /** Standard decelerate — opens, fades-in */
  out: Easing.out(Easing.cubic),
  /** Accelerate — closes, fades-out */
  in: Easing.in(Easing.cubic),
  /** Smooth both ends */
  inOut: Easing.inOut(Easing.cubic),
  /** WhatsApp-ish sheet curve */
  sheet: Easing.bezier(0.25, 0.1, 0.25, 1),
} as const;

export function timingOpen(ms = motion.openMs): WithTimingConfig {
  return { duration: ms, easing: ease.out };
}

export function timingClose(ms = motion.closeMs): WithTimingConfig {
  return { duration: ms, easing: ease.in };
}

export function timingSheetOpen(): WithTimingConfig {
  return { duration: motion.sheetOpenMs, easing: ease.sheet };
}

export function timingSheetClose(): WithTimingConfig {
  return { duration: motion.sheetCloseMs, easing: ease.in };
}

/** Soft layout shift for selection bars / chip swaps (not heavy springs). */
export function animateLayoutSoft(): void {
  LayoutAnimation.configureNext({
    duration: motion.fastMs,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

/** FlatList defaults tuned for messenger-length lists (60fps target). */
export const listPerf = {
  chatList: {
    initialNumToRender: 16,
    maxToRenderPerBatch: 10,
    windowSize: 9,
    updateCellsBatchingPeriod: 50,
    removeClippedSubviews: Platform.OS === 'android',
  },
  messageList: {
    initialNumToRender: 20,
    maxToRenderPerBatch: 10,
    windowSize: 9,
    updateCellsBatchingPeriod: 48,
    removeClippedSubviews: Platform.OS === 'android',
  },
  generic: {
    initialNumToRender: 12,
    maxToRenderPerBatch: 8,
    windowSize: 7,
    updateCellsBatchingPeriod: 50,
    removeClippedSubviews: Platform.OS === 'android',
  },
} as const;
