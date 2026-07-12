// Lumixo mobile — colour palettes for each theme mode. Keys are identical
// across palettes so screens can switch themes without touching layout code.

export type ThemeMode = 'dark' | 'light' | 'amoled';

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  header: string;
  primary: string;
  primaryDark: string;
  bubbleOut: string;
  bubbleIn: string;
  /** Text/muted colors that sit ON the outgoing bubble. These must track the
   *  bubble fill, NOT the app text color: in light mode bubbleOut is light green,
   *  so its text has to be DARK (near-white text there is invisible). */
  bubbleOutText: string;
  bubbleOutMuted: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  danger: string;
  /** Gold brand accent as a fill/background (bright — dark text sits on it). */
  accentPlus: string;
  /** Gold accent when used as TEXT/icon on an adaptive surface — dark enough to
   *  stay readable on white in light mode (bright gold on white fails contrast). */
  accentPlusText: string;
  /** True on light backgrounds — used to flip status-bar / icon tint. */
  isLight: boolean;
}

export const palettes: Record<ThemeMode, Palette> = {
  dark: {
    // Slightly cooler/deeper base with clearer elevation steps (bg → surface →
    // surfaceAlt) and a more defined border, so cards and rows read as layered
    // instead of flat. Text/brand/bubble colors are unchanged (already WCAG-tuned).
    bg: '#0A1116',
    surface: '#151E24',
    surfaceAlt: '#24313A',
    header: '#1A252C',
    primary: '#00A884',
    primaryDark: '#008069',
    bubbleOut: '#005C4B',
    bubbleIn: '#1F2C33',
    bubbleOutText: '#E9EDEF',
    bubbleOutMuted: '#B4D2C8',
    text: '#E9EDEF',
    textMuted: '#8696A0',
    textFaint: '#8E9CA8',
    border: '#2A363E',
    danger: '#F15C6D',
    accentPlus: '#F7C948',
    accentPlusText: '#F7C948',
    isLight: false,
  },
  light: {
    bg: '#F0F2F5',
    surface: '#FFFFFF',
    surfaceAlt: '#F0F2F5',
    header: '#008069',
    primary: '#008069',
    primaryDark: '#006B5B',
    bubbleOut: '#D9FDD3',
    bubbleIn: '#FFFFFF',
    // Dark text on the light-green outgoing bubble (WCAG AA on #D9FDD3).
    bubbleOutText: '#0B1B12',
    bubbleOutMuted: '#4A6B5F',
    text: '#111B21',
    // Darkened for WCAG AA: the old #667781/#8696A0 failed 4.5:1 on the #F0F2F5
    // app background and #8696A0 failed even on white. These pass on both.
    textMuted: '#55616B',
    textFaint: '#5C6A73',
    border: '#D1D9DF',
    danger: '#D11A2A',
    // Bright gold on purpose: it is used as a BADGE BACKGROUND with dark text,
    // so it must stay light enough for that dark text to pass contrast.
    accentPlus: '#E5A400',
    accentPlusText: '#8A6A0C',
    isLight: true,
  },
  amoled: {
    // True black background for OLED; surfaces get a touch more lift and the
    // border is more visible so cards don't disappear into the black.
    bg: '#000000',
    surface: '#0C0C0C',
    surfaceAlt: '#191919',
    header: '#0C0C0C',
    primary: '#00A884',
    primaryDark: '#008069',
    bubbleOut: '#04503F',
    bubbleIn: '#171717',
    bubbleOutText: '#F5F5F5',
    bubbleOutMuted: '#AAC0B7',
    text: '#F5F5F5',
    textMuted: '#9AA0A6',
    textFaint: '#8A9096',
    border: '#262626',
    danger: '#F15C6D',
    accentPlus: '#F7C948',
    accentPlusText: '#F7C948',
    isLight: false,
  },
};

// Static design tokens — identical across all themes.
// Tuned for production messenger density (WhatsApp / Telegram / iMessage class):
// compact rows, soft corners, readable type without game-like oversizing.
export const spacing = (n: number) => n * 4;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

export const font = {
  title: 20,
  heading: 16.5,
  body: 15,
  small: 13,
  tiny: 11.5,
};

/** Shared elevation for FABs / floating controls (subtle, not bulky). */
export const elevation = {
  fab: {
    shadowColor: '#000' as const,
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  card: {
    shadowColor: '#000' as const,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  sheet: {
    shadowColor: '#000' as const,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
};

/**
 * Icon size scale — use these everywhere so tabs/rows/headers never mismatch.
 * Aligns with Material + messenger density (22pt primary chrome).
 */
export const iconSize = {
  xs: 14,
  sm: 16,
  md: 20,
  /** Primary chrome (tab, header actions, list trailing) */
  lg: 22,
  xl: 26,
  /** Empty states */
  empty: 56,
} as const;

/** Minimum touch targets (accessibility + messenger UX). */
export const touch = {
  min: 44,
  hitSlop: { top: 8, bottom: 8, left: 8, right: 8 } as const,
  hitSlopSm: { top: 6, bottom: 6, left: 6, right: 6 } as const,
};

/** Row / list density */
export const density = {
  chatRowMin: 68,
  settingsRowMin: 48,
  tabIcon: 22,
  avatarChat: 48,
  avatarHeader: 36,
  fab: 54,
} as const;

/** Typography line heights paired with `font` sizes for consistent hierarchy. */
export const lineHeight = {
  title: 26,
  heading: 21,
  body: 20,
  small: 17,
  tiny: 15,
} as const;
