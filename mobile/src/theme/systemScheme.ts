// Lumixo — live OS light/dark scheme observation.
//
// Layers (first reliable win wins on each poll):
//  1. Native Android UI_MODE_NIGHT via LumixoSystemTheme (OEM-safe)
//  2. React Native Appearance API
//
// Events:
//  • Native `systemColorSchemeChanged` (config change / resume)
//  • Appearance.addChangeListener
//  • AppState 'active' re-poll (quick settings applied while backgrounded)
//
// No React imports beyond RN core — safe for unit-testable pure helpers.
import {
  Appearance,
  AppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
  type AppStateStatus,
  type ColorSchemeName,
  type NativeModule,
} from 'react-native';
import { normalizeSystemScheme } from './themeMode';

export type SystemScheme = 'light' | 'dark';

type NativeThemeModule = NativeModule & {
  getColorScheme?: () => Promise<string | null | undefined>;
  setSystemChrome?: (
    isLightSurfaces: boolean,
    statusBarColor: string | null,
    navigationBarColor: string | null,
  ) => Promise<boolean>;
  addListener?: (eventName: string) => void;
  removeListeners?: (count: number) => void;
};

const native: NativeThemeModule | undefined = NativeModules.LumixoSystemTheme;

function fromUnknown(raw: unknown): SystemScheme {
  if (raw === 'dark' || raw === 'light') return raw;
  if (typeof raw === 'string' && raw.toLowerCase() === 'dark') return 'dark';
  return normalizeSystemScheme(raw as ColorSchemeName);
}

/** Synchronous best-effort read (Appearance only — native is async). */
export function readAppearanceScheme(): SystemScheme {
  return normalizeSystemScheme(Appearance.getColorScheme());
}

/** Prefer native Android UI_MODE when available; fall back to Appearance. */
export async function readSystemScheme(): Promise<SystemScheme> {
  if (native?.getColorScheme) {
    try {
      const v = await native.getColorScheme();
      if (v === 'dark' || v === 'light') return v;
      if (v) return fromUnknown(v);
    } catch {
      // fall through
    }
  }
  return readAppearanceScheme();
}

export type SystemSchemeListener = (scheme: SystemScheme) => void;

/**
 * Subscribe to live OS appearance changes. Returns an unsubscribe function.
 * Deduplicates consecutive identical schemes.
 */
export function subscribeSystemScheme(listener: SystemSchemeListener): () => void {
  let last: SystemScheme | null = null;
  const emit = (scheme: SystemScheme) => {
    if (scheme === last) return;
    last = scheme;
    listener(scheme);
  };

  // Seed
  emit(readAppearanceScheme());
  void readSystemScheme().then(emit);

  const appSub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') {
      void readSystemScheme().then(emit);
      // Appearance sometimes only updates after resume on OEMs.
      emit(readAppearanceScheme());
    }
  });

  const appearanceSub = Appearance.addChangeListener(({ colorScheme }) => {
    emit(normalizeSystemScheme(colorScheme));
    // Native may be a frame ahead/behind — reconcile.
    void readSystemScheme().then(emit);
  });

  let nativeSub: { remove: () => void } | null = null;
  if (native && Platform.OS === 'android') {
    try {
      const emitter = new NativeEventEmitter(native as NativeModule);
      nativeSub = emitter.addListener(
        'systemColorSchemeChanged',
        (payload: { colorScheme?: string } | string | null) => {
          if (typeof payload === 'string') {
            emit(fromUnknown(payload));
            return;
          }
          emit(fromUnknown(payload?.colorScheme));
        },
      );
    } catch {
      nativeSub = null;
    }
  }

  return () => {
    appSub.remove();
    appearanceSub.remove();
    nativeSub?.remove();
  };
}

/** Push status + navigation bar colors to the native window (Android). */
export async function applySystemChrome(opts: {
  isLightSurfaces: boolean;
  statusBarColor: string;
  navigationBarColor: string;
}): Promise<void> {
  if (Platform.OS !== 'android' || !native?.setSystemChrome) return;
  try {
    await native.setSystemChrome(
      opts.isLightSurfaces,
      opts.statusBarColor,
      opts.navigationBarColor,
    );
  } catch {
    // non-fatal
  }
}
