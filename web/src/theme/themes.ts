// Lumixo — appearance engine. Themes/fonts/bubbles/wallpapers are applied by
// setting CSS variables + data attributes on <html>; premium.css reacts to them.
// Free users are always pinned to the base options (premium values are ignored
// until the user is premium) so gating is enforced even if a stored pref leaks.

export interface ThemeDef {
  id: string;
  label: string;
  premium: boolean;
  swatch: string; // preview gradient
  vars: Record<string, string>;
}

export interface FontDef {
  id: string;
  label: string;
  premium: boolean;
  stack: string;
}

export interface OptionDef {
  id: string;
  label: string;
  premium: boolean;
  preview: string; // small CSS background for the picker chip
}

// ── Themes ──────────────────────────────────────────────────────────────────
export const THEMES: Record<string, ThemeDef> = {
  default: {
    id: 'default', label: 'Classic', premium: false,
    swatch: 'linear-gradient(135deg,#202c33,#00a884)',
    vars: {
      '--fh-bg': '#111b21', '--fh-panel': '#202c33', '--fh-elevated': '#2a3942',
      '--fh-chat-bg': '#0b141a', '--fh-accent': '#00a884', '--fh-accent-2': '#06cf9c',
      '--fh-bubble-mine': '#005c4b', '--fh-bubble-theirs': '#202c33',
      '--fh-text': '#e9edef', '--fh-muted': '#8696a0', '--fh-border': '#2a3942',
    },
  },
  midnight: {
    id: 'midnight', label: 'Midnight', premium: true,
    swatch: 'linear-gradient(135deg,#0b1020,#5b8cff)',
    vars: {
      '--fh-bg': '#0a0e1a', '--fh-panel': '#121829', '--fh-elevated': '#1c2440',
      '--fh-chat-bg': '#070a14', '--fh-accent': '#5b8cff', '--fh-accent-2': '#8aa9ff',
      '--fh-bubble-mine': '#26336b', '--fh-bubble-theirs': '#141b30',
      '--fh-text': '#eaf0ff', '--fh-muted': '#8b97b8', '--fh-border': '#1d2542',
    },
  },
  aurora: {
    id: 'aurora', label: 'Aurora', premium: true,
    swatch: 'linear-gradient(135deg,#0f2027,#2bd6c0)',
    vars: {
      '--fh-bg': '#0c1b1c', '--fh-panel': '#10302f', '--fh-elevated': '#16413f',
      '--fh-chat-bg': '#071413', '--fh-accent': '#2bd6c0', '--fh-accent-2': '#6ef0c8',
      '--fh-bubble-mine': '#0f5d52', '--fh-bubble-theirs': '#103030',
      '--fh-text': '#e7fff9', '--fh-muted': '#79a89f', '--fh-border': '#16413f',
    },
  },
  sunset: {
    id: 'sunset', label: 'Sunset', premium: true,
    swatch: 'linear-gradient(135deg,#2a1320,#ff7a59)',
    vars: {
      '--fh-bg': '#1a0f16', '--fh-panel': '#2a1622', '--fh-elevated': '#3a1f2d',
      '--fh-chat-bg': '#140a10', '--fh-accent': '#ff7a59', '--fh-accent-2': '#ffb37a',
      '--fh-bubble-mine': '#7a2f47', '--fh-bubble-theirs': '#2a1622',
      '--fh-text': '#ffeede', '--fh-muted': '#b88a93', '--fh-border': '#3a1f2d',
    },
  },
  royal: {
    id: 'royal', label: 'Royal', premium: true,
    swatch: 'linear-gradient(135deg,#1a1030,#b388ff)',
    vars: {
      '--fh-bg': '#120a24', '--fh-panel': '#1e1238', '--fh-elevated': '#2a1a4d',
      '--fh-chat-bg': '#0c0719', '--fh-accent': '#b388ff', '--fh-accent-2': '#d4b8ff',
      '--fh-bubble-mine': '#4a2e80', '--fh-bubble-theirs': '#1e1238',
      '--fh-text': '#f1eaff', '--fh-muted': '#9b8bc4', '--fh-border': '#2a1a4d',
    },
  },
  mono: {
    id: 'mono', label: 'Graphite', premium: true,
    swatch: 'linear-gradient(135deg,#1c1c1e,#c7c7cc)',
    vars: {
      '--fh-bg': '#1c1c1e', '--fh-panel': '#2c2c2e', '--fh-elevated': '#3a3a3c',
      '--fh-chat-bg': '#0e0e10', '--fh-accent': '#c7c7cc', '--fh-accent-2': '#ffffff',
      '--fh-bubble-mine': '#3a3a3c', '--fh-bubble-theirs': '#242426',
      '--fh-text': '#f2f2f7', '--fh-muted': '#8e8e93', '--fh-border': '#3a3a3c',
    },
  },
};

// ── Fonts ───────────────────────────────────────────────────────────────────
export const FONTS: Record<string, FontDef> = {
  system: { id: 'system', label: 'System', premium: false,
    stack: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif' },
  inter: { id: 'inter', label: 'Inter', premium: true,
    stack: '"Inter","SF Pro Display",-apple-system,sans-serif' },
  rounded: { id: 'rounded', label: 'Rounded', premium: true,
    stack: '"SF Pro Rounded","Varela Round","Nunito",-apple-system,sans-serif' },
  serif: { id: 'serif', label: 'Serif', premium: true,
    stack: '"New York","Iowan Old Style","Georgia",serif' },
  mono: { id: 'mono', label: 'Mono', premium: true,
    stack: '"SF Mono","JetBrains Mono","Fira Code",ui-monospace,monospace' },
};

// ── Bubble styles ─────────────────────────────────────────────────────────────
export const BUBBLES: OptionDef[] = [
  { id: 'rounded', label: 'Rounded', premium: false, preview: 'border-radius:12px' },
  { id: 'sharp', label: 'Sharp', premium: true, preview: 'border-radius:3px' },
  { id: 'minimal', label: 'Minimal', premium: true, preview: 'border-radius:18px' },
  { id: 'classic', label: 'Tailed', premium: true, preview: 'border-radius:12px 12px 12px 2px' },
];

// ── Wallpapers ────────────────────────────────────────────────────────────────
export const WALLPAPERS: OptionDef[] = [
  { id: 'default', label: 'Default', premium: false, preview: 'background:#0b141a' },
  { id: 'aurora', label: 'Aurora', premium: true, preview: 'background:linear-gradient(135deg,#0f2027,#2bd6c0)' },
  { id: 'mesh', label: 'Mesh', premium: true, preview: 'background:radial-gradient(circle at 30% 30%,#5b8cff,#0a0e1a)' },
  { id: 'dusk', label: 'Dusk', premium: true, preview: 'background:linear-gradient(135deg,#2a1320,#ff7a59)' },
  { id: 'grid', label: 'Grid', premium: true, preview: 'background:#0b141a' },
  { id: 'bubbles', label: 'Bubbles', premium: true, preview: 'background:radial-gradient(circle at 70% 40%,#b388ff,#120a24)' },
];

// ── App icons (favicon emoji glyph) ──────────────────────────────────────────
export const APP_ICONS: { id: string; label: string; premium: boolean; glyph: string }[] = [
  { id: 'classic', label: 'Classic', premium: false, glyph: '🎩' },
  { id: 'neon', label: 'Neon', premium: true, glyph: '🪩' },
  { id: 'gold', label: 'Gold', premium: true, glyph: '👑' },
  { id: 'star', label: 'Star', premium: true, glyph: '✨' },
  { id: 'ghost', label: 'Ghost', premium: true, glyph: '👻' },
];

function setFavicon(glyph: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="0.9em" font-size="84">${glyph}</text></svg>`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export interface AppliedPrefs {
  theme: string; font: string; bubble_style: string; wallpaper: string; app_icon: string;
}

// Apply preferences to the document. Premium-only choices are forced to base
// values when `isPremium` is false.
export function applyPreferences(p: AppliedPrefs, isPremium: boolean) {
  const root = document.documentElement;

  const theme = THEMES[p.theme] && (isPremium || !THEMES[p.theme].premium) ? THEMES[p.theme] : THEMES.default;
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);

  const font = FONTS[p.font] && (isPremium || !FONTS[p.font].premium) ? FONTS[p.font] : FONTS.system;
  root.style.setProperty('--fh-font', font.stack);

  const bubble = BUBBLES.find((b) => b.id === p.bubble_style);
  root.dataset.bubble = bubble && (isPremium || !bubble.premium) ? bubble.id : 'rounded';

  const wp = WALLPAPERS.find((w) => w.id === p.wallpaper);
  root.dataset.wallpaper = wp && (isPremium || !wp.premium) ? wp.id : 'default';

  const icon = APP_ICONS.find((a) => a.id === p.app_icon);
  setFavicon(icon && (isPremium || !icon.premium) ? icon.glyph : '🎩');
}
