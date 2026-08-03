// Lumixo — shared press / ripple helpers for consistent micro-interactions.
import { Platform, type PressableProps, type ViewStyle } from 'react-native';
import type { Palette } from '../theme';

/** Android Material ripple matching Lumixo primary/surface. */
export function primaryRipple(colors: Palette): PressableProps['android_ripple'] {
  if (Platform.OS !== 'android') return undefined;
  return {
    color: colors.isLight ? 'rgba(0,128,105,0.12)' : 'rgba(0,168,132,0.22)',
    borderless: false,
  };
}

export function borderlessRipple(colors: Palette): PressableProps['android_ripple'] {
  if (Platform.OS !== 'android') return undefined;
  return {
    color: colors.isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)',
    borderless: true,
  };
}

/** Soft opacity press (iOS / fallback). */
export function pressedStyle(pressed: boolean, extra?: ViewStyle): ViewStyle | undefined {
  if (!pressed) return extra;
  return { opacity: 0.72, ...(extra ?? {}) };
}

/** Slight scale — use sparingly on FABs / send buttons only. */
export function pressedScale(pressed: boolean): ViewStyle | undefined {
  if (!pressed) return undefined;
  return { opacity: 0.9, transform: [{ scale: 0.96 }] };
}
