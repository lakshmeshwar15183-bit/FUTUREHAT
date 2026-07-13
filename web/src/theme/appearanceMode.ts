// Web system / light / dark appearance (WhatsApp-class Follow System default).
// Independent of premium color themes: when Classic (default) is active, these
// base vars define light vs dark chrome. Premium named themes stay dark-tinted.

export type AppearanceMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'lumixo.appearance.mode';

export const APPEARANCE_OPTIONS: { id: AppearanceMode; label: string; sub: string }[] = [
  { id: 'system', label: 'Follow System', sub: 'Default · like WhatsApp · matches device' },
  { id: 'light', label: 'Light', sub: 'Always light · your choice' },
  { id: 'dark', label: 'Dark', sub: 'Always dark · your choice' },
];

/** Factory default — first open matches the device (WhatsApp-class). */
export const DEFAULT_APPEARANCE_MODE: AppearanceMode = 'system';

const LIGHT_VARS: Record<string, string> = {
  '--fh-bg': '#ffffff',
  '--fh-panel': '#ffffff',
  '--fh-elevated': '#f0f2f5',
  '--fh-chat-bg': '#efeae2',
  '--fh-accent': '#008069',
  '--fh-accent-2': '#00a884',
  '--fh-bubble-mine': '#d9fdd3',
  '--fh-bubble-theirs': '#ffffff',
  '--fh-text': '#111b21',
  '--fh-muted': '#667781',
  '--fh-border': '#e9edef',
  '--fh-shadow': '0 2px 12px rgba(11, 20, 26, 0.08)',
  '--fh-shadow-soft': '0 1px 4px rgba(11, 20, 26, 0.06)',
};

const DARK_VARS: Record<string, string> = {
  '--fh-bg': '#111b21',
  '--fh-panel': '#202c33',
  '--fh-elevated': '#2a3942',
  '--fh-chat-bg': '#0b141a',
  '--fh-accent': '#00a884',
  '--fh-accent-2': '#06cf9c',
  '--fh-bubble-mine': '#005c4b',
  '--fh-bubble-theirs': '#202c33',
  '--fh-text': '#e9edef',
  '--fh-muted': '#8696a0',
  '--fh-border': '#2a3942',
  '--fh-shadow': '0 10px 30px rgba(0, 0, 0, 0.35)',
  '--fh-shadow-soft': '0 4px 16px rgba(0, 0, 0, 0.25)',
};

export function getStoredAppearanceMode(): AppearanceMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'system' || v === 'light' || v === 'dark') return v;
  } catch {
    /* private mode */
  }
  return DEFAULT_APPEARANCE_MODE;
}

export function setStoredAppearanceMode(mode: AppearanceMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function resolveAppearanceIsLight(mode: AppearanceMode = getStoredAppearanceMode()): boolean {
  if (mode === 'light') return true;
  if (mode === 'dark') return false;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  }
  return false;
}

/** Apply light/dark base CSS vars. Call before premium theme overlay when Classic. */
export function applyAppearanceMode(mode?: AppearanceMode) {
  const m = mode ?? getStoredAppearanceMode();
  const light = resolveAppearanceIsLight(m);
  const root = document.documentElement;
  const vars = light ? LIGHT_VARS : DARK_VARS;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.appearance = light ? 'light' : 'dark';
  root.style.colorScheme = light ? 'light' : 'dark';
  // Theme-color for mobile browser chrome
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = light ? '#008069' : '#111b21';
}

/** Subscribe to OS theme changes when mode is system. Returns unsubscribe. */
export function watchSystemAppearance(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => {
    if (getStoredAppearanceMode() === 'system') onChange();
  };
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else mq.addListener(handler);
  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', handler);
    else mq.removeListener(handler);
  };
}
