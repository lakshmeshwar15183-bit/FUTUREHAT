// FUTUREHAT mobile — colour palettes for each theme mode. Keys are identical
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
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  danger: string;
  accentPlus: string;
  /** True on light backgrounds — used to flip status-bar / icon tint. */
  isLight: boolean;
}

export const palettes: Record<ThemeMode, Palette> = {
  dark: {
    bg: '#0B141A',
    surface: '#111B21',
    surfaceAlt: '#1F2C33',
    header: '#1F2C33',
    primary: '#00A884',
    primaryDark: '#008069',
    bubbleOut: '#005C4B',
    bubbleIn: '#1F2C33',
    text: '#E9EDEF',
    textMuted: '#8696A0',
    textFaint: '#667781',
    border: '#222E35',
    danger: '#F15C6D',
    accentPlus: '#F7C948',
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
    text: '#111B21',
    textMuted: '#667781',
    textFaint: '#8696A0',
    border: '#E2E8ED',
    danger: '#D11A2A',
    accentPlus: '#B7791F',
    isLight: true,
  },
  amoled: {
    bg: '#000000',
    surface: '#0A0A0A',
    surfaceAlt: '#161616',
    header: '#0A0A0A',
    primary: '#00A884',
    primaryDark: '#008069',
    bubbleOut: '#04503F',
    bubbleIn: '#161616',
    text: '#F5F5F5',
    textMuted: '#9AA0A6',
    textFaint: '#6B7176',
    border: '#1A1A1A',
    danger: '#F15C6D',
    accentPlus: '#F7C948',
    isLight: false,
  },
};

// Static design tokens — identical across all themes.
export const spacing = (n: number) => n * 4;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
};

export const font = {
  title: 22,
  heading: 17,
  body: 15,
  small: 13,
  tiny: 11,
};
