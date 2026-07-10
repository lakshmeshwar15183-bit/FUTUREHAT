// FUTUREHAT mobile — premium color themes + chat wallpapers. Ported 1:1 from the
// web theme engine (web/src/theme/themes.ts THEMES + WALLPAPERS) so a theme/wallpaper
// chosen on either platform renders the same and persists to the SAME shared
// `user_preferences.theme` / `user_preferences.wallpaper` columns.
//
// A color theme layers a full palette over the base light/dark/amoled MODE. The
// free 'default' theme means "use the mode palette"; the five named palettes are
// premium and are only applied when the account is FUTUREHAT+ (gating mirrors the
// web `applyPreferences` premium guard).
import { palettes, type Palette } from './palettes';

export interface ColorTheme {
  id: string;
  label: string;
  premium: boolean;
  /** [start, end] preview swatch colors for the picker chip. */
  swatch: [string, string];
  /** null = fall back to the active light/dark/amoled palette. */
  palette: Palette | null;
}

// Non-color tokens shared by every named palette (they're all dark variants,
// matching web where premium themes never expose a light mode).
const SHARED = {
  danger: '#F15C6D',
  accentPlus: '#F7C948',
  accentPlusText: '#F7C948',
  isLight: false as const,
};

export const COLOR_THEMES: Record<string, ColorTheme> = {
  default: {
    id: 'default', label: 'Classic', premium: false,
    swatch: ['#202c33', '#00a884'], palette: null, // uses the active mode palette
  },
  midnight: {
    id: 'midnight', label: 'Midnight', premium: true, swatch: ['#0b1020', '#5b8cff'],
    palette: {
      bg: '#0a0e1a', surface: '#121829', surfaceAlt: '#1c2440', header: '#121829',
      primary: '#5b8cff', primaryDark: '#3f6fe0',
      bubbleOut: '#26336b', bubbleIn: '#141b30',
      bubbleOutText: '#eaf0ff', bubbleOutMuted: '#9fb0e0',
      text: '#eaf0ff', textMuted: '#8b97b8', textFaint: '#8b97b8', border: '#1d2542',
      ...SHARED,
    },
  },
  aurora: {
    id: 'aurora', label: 'Aurora', premium: true, swatch: ['#0f2027', '#2bd6c0'],
    palette: {
      bg: '#0c1b1c', surface: '#10302f', surfaceAlt: '#16413f', header: '#10302f',
      primary: '#2bd6c0', primaryDark: '#1fae9c',
      bubbleOut: '#0f5d52', bubbleIn: '#103030',
      bubbleOutText: '#e7fff9', bubbleOutMuted: '#9fd3c8',
      text: '#e7fff9', textMuted: '#79a89f', textFaint: '#79a89f', border: '#16413f',
      ...SHARED,
    },
  },
  sunset: {
    id: 'sunset', label: 'Sunset', premium: true, swatch: ['#2a1320', '#ff7a59'],
    palette: {
      bg: '#1a0f16', surface: '#2a1622', surfaceAlt: '#3a1f2d', header: '#2a1622',
      primary: '#ff7a59', primaryDark: '#e05f40',
      bubbleOut: '#7a2f47', bubbleIn: '#2a1622',
      bubbleOutText: '#ffeede', bubbleOutMuted: '#d3a9a0',
      text: '#ffeede', textMuted: '#b88a93', textFaint: '#b88a93', border: '#3a1f2d',
      ...SHARED,
    },
  },
  royal: {
    id: 'royal', label: 'Royal', premium: true, swatch: ['#1a1030', '#b388ff'],
    palette: {
      bg: '#120a24', surface: '#1e1238', surfaceAlt: '#2a1a4d', header: '#1e1238',
      primary: '#b388ff', primaryDark: '#9668e6',
      bubbleOut: '#4a2e80', bubbleIn: '#1e1238',
      bubbleOutText: '#f1eaff', bubbleOutMuted: '#c3b3e6',
      text: '#f1eaff', textMuted: '#9b8bc4', textFaint: '#9b8bc4', border: '#2a1a4d',
      ...SHARED,
    },
  },
  mono: {
    id: 'mono', label: 'Graphite', premium: true, swatch: ['#1c1c1e', '#c7c7cc'],
    palette: {
      bg: '#1c1c1e', surface: '#2c2c2e', surfaceAlt: '#3a3a3c', header: '#2c2c2e',
      primary: '#c7c7cc', primaryDark: '#a8a8ad',
      bubbleOut: '#3a3a3c', bubbleIn: '#242426',
      bubbleOutText: '#f2f2f7', bubbleOutMuted: '#c3c3c8',
      text: '#f2f2f7', textMuted: '#8e8e93', textFaint: '#8e8e93', border: '#3a3a3c',
      ...SHARED,
    },
  },
  ocean: {
    id: 'ocean', label: 'Ocean', premium: true, swatch: ['#071726', '#38bdf8'],
    palette: {
      bg: '#071726', surface: '#0d2135', surfaceAlt: '#143047', header: '#0d2135',
      primary: '#38bdf8', primaryDark: '#0ea5d9',
      bubbleOut: '#0f3f5f', bubbleIn: '#0f2536',
      bubbleOutText: '#e6f6ff', bubbleOutMuted: '#9fd0e8',
      text: '#e6f6ff', textMuted: '#7fa3ba', textFaint: '#7fa3ba', border: '#143047',
      ...SHARED,
    },
  },
  forest: {
    id: 'forest', label: 'Forest', premium: true, swatch: ['#0a1710', '#34d399'],
    palette: {
      bg: '#0a1710', surface: '#0f2318', surfaceAlt: '#163422', header: '#0f2318',
      primary: '#34d399', primaryDark: '#10b981',
      bubbleOut: '#14532d', bubbleIn: '#0f2318',
      bubbleOutText: '#e7fbef', bubbleOutMuted: '#a7d8bd',
      text: '#e7fbef', textMuted: '#7fae91', textFaint: '#7fae91', border: '#163422',
      ...SHARED,
    },
  },
  crimson: {
    id: 'crimson', label: 'Crimson', premium: true, swatch: ['#1a0c0f', '#fb7185'],
    palette: {
      bg: '#1a0c0f', surface: '#271317', surfaceAlt: '#371a20', header: '#271317',
      primary: '#fb7185', primaryDark: '#e04861',
      bubbleOut: '#7f1d2e', bubbleIn: '#271317',
      bubbleOutText: '#ffe9ec', bubbleOutMuted: '#e0a9b1',
      text: '#ffe9ec', textMuted: '#b98891', textFaint: '#b98891', border: '#371a20',
      ...SHARED,
    },
  },
  slate: {
    id: 'slate', label: 'Slate', premium: true, swatch: ['#0f141a', '#94a3b8'],
    palette: {
      bg: '#0f141a', surface: '#1a222c', surfaceAlt: '#26313d', header: '#1a222c',
      primary: '#94a3b8', primaryDark: '#64748b',
      bubbleOut: '#334155', bubbleIn: '#1a222c',
      bubbleOutText: '#eef2f7', bubbleOutMuted: '#b8c2cf',
      text: '#eef2f7', textMuted: '#8b97a6', textFaint: '#8b97a6', border: '#26313d',
      ...SHARED,
    },
  },
  coffee: {
    id: 'coffee', label: 'Latte', premium: true, swatch: ['#17110c', '#d6a86a'],
    palette: {
      bg: '#17110c', surface: '#241a12', surfaceAlt: '#33261a', header: '#241a12',
      primary: '#d6a86a', primaryDark: '#b98a4e',
      bubbleOut: '#5c4326', bubbleIn: '#241a12',
      bubbleOutText: '#fbeede', bubbleOutMuted: '#d5bfa3',
      text: '#fbeede', textMuted: '#ab9376', textFaint: '#ab9376', border: '#33261a',
      ...SHARED,
    },
  },
  bubblegum: {
    id: 'bubblegum', label: 'Bubblegum', premium: true, swatch: ['#1a0f1e', '#f472b6'],
    palette: {
      bg: '#1a0f1e', surface: '#271630', surfaceAlt: '#382142', header: '#271630',
      primary: '#f472b6', primaryDark: '#db5da0',
      bubbleOut: '#6b2f5e', bubbleIn: '#271630',
      bubbleOutText: '#ffe9f6', bubbleOutMuted: '#e0aecf',
      text: '#ffe9f6', textMuted: '#b78aa8', textFaint: '#b78aa8', border: '#382142',
      ...SHARED,
    },
  },
};

export interface Wallpaper {
  id: string;
  label: string;
  premium: boolean;
  /** Solid tint applied behind chat messages (RN has no CSS gradients natively). */
  color: string;
}

// Mirrors web WALLPAPERS; the gradient/pattern previews collapse to a dark base
// tint on mobile so the chat surface stays legible.
export const WALLPAPERS: Wallpaper[] = [
  { id: 'default', label: 'Default', premium: false, color: '#0B141A' },
  { id: 'aurora', label: 'Aurora', premium: true, color: '#0F2027' },
  { id: 'mesh', label: 'Mesh', premium: true, color: '#0A0E1A' },
  { id: 'dusk', label: 'Dusk', premium: true, color: '#2A1320' },
  { id: 'grid', label: 'Grid', premium: true, color: '#0B141A' },
  { id: 'bubbles', label: 'Bubbles', premium: true, color: '#120A24' },
  { id: 'ocean', label: 'Ocean', premium: true, color: '#071726' },
  { id: 'forest', label: 'Forest', premium: true, color: '#0A1710' },
  { id: 'crimson', label: 'Crimson', premium: true, color: '#1A0C0F' },
  { id: 'latte', label: 'Latte', premium: true, color: '#17110C' },
  { id: 'slate', label: 'Slate', premium: true, color: '#0F141A' },
  { id: 'plum', label: 'Plum', premium: true, color: '#1A0F1E' },
];

/** Resolve the palette for a color-theme id, gated by premium (web parity). */
export function resolveThemePalette(
  themeId: string,
  base: Palette,
  isPremium: boolean,
): Palette {
  const t = COLOR_THEMES[themeId];
  if (!t || !t.palette) return base;
  if (t.premium && !isPremium) return base;
  return t.palette;
}

/** Resolve the chat wallpaper color, gated by premium. null = no override. */
export function resolveWallpaperColor(wallpaperId: string, isPremium: boolean): string | null {
  const w = WALLPAPERS.find((x) => x.id === wallpaperId);
  if (!w || w.id === 'default') return null;
  if (w.premium && !isPremium) return null;
  return w.color;
}

// Re-export so callers can `import { palettes } from './appearance'` if desired.
export { palettes };
