// Lumixo — dynamic launcher icon switcher.
// Android: activity-alias + PackageManager with enable-first + DONT_KILL_APP.
// iOS: UIApplication.setAlternateIconName (when the iOS target is linked).
// Must never crash, kill the activity, or reset navigation state.
import { NativeModules, Platform, ToastAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppIconId = 'icon1' | 'icon2' | 'icon3' | 'icon4' | 'icon5' | 'icon6';

export const APP_ICON_OPTIONS: {
  id: AppIconId;
  label: string;
  /** Local preview image for Settings UI */
  preview: number;
}[] = [
  { id: 'icon1', label: 'Icon 1', preview: require('../../assets/app-icons/icon1_preview_solid.png') },
  { id: 'icon2', label: 'Icon 2', preview: require('../../assets/app-icons/icon2_preview_solid.png') },
  { id: 'icon3', label: 'Icon 3', preview: require('../../assets/app-icons/icon3_preview_solid.png') },
  { id: 'icon4', label: 'Icon 4', preview: require('../../assets/app-icons/icon4_preview_solid.png') },
  { id: 'icon5', label: 'Icon 5', preview: require('../../assets/app-icons/icon5_preview_solid.png') },
  { id: 'icon6', label: 'Icon 6', preview: require('../../assets/app-icons/icon6_preview_solid.png') },
];

const STORAGE_KEY = 'fh:app_icon:v1';
const DEFAULT_ICON: AppIconId = 'icon1';

const LAUNCHER_TOAST =
  'Launcher icon updated. It may refresh on the home screen shortly.';

type NativeIconModule = {
  setIcon: (iconName: string) => Promise<boolean>;
  getIcon: () => Promise<string>;
  supportsAlternateIcons?: () => Promise<boolean>;
};

const NativeIcon: NativeIconModule | undefined = NativeModules.LumixoAppIcon;

function normalize(id: string | null | undefined): AppIconId {
  if (id && APP_ICON_OPTIONS.some((o) => o.id === id)) return id as AppIconId;
  // Legacy placeholder ids from older builds → map to Icon 1
  if (id === 'classic' || id === 'neon' || id === 'gold' || id === 'star' || id === 'ghost') {
    return DEFAULT_ICON;
  }
  return DEFAULT_ICON;
}

function softToast(message: string) {
  if (Platform.OS === 'android') {
    try {
      ToastAndroid.show(message, ToastAndroid.LONG);
    } catch {
      /* ignore */
    }
  }
  // iOS: system shows its own alternate-icon confirmation; avoid a second modal.
}

export async function getStoredAppIcon(): Promise<AppIconId> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return normalize(raw);
  } catch {
    return DEFAULT_ICON;
  }
}

export async function getActiveAppIcon(): Promise<AppIconId> {
  if (NativeIcon?.getIcon) {
    try {
      const native = await NativeIcon.getIcon();
      return normalize(native);
    } catch {
      /* fall through */
    }
  }
  return getStoredAppIcon();
}

/**
 * Switch the launcher icon silently.
 * - Never throws to the UI layer
 * - Never restarts the React activity (native uses DONT_KILL_APP + enable-first)
 * - Persists preference even if native apply is deferred
 */
export async function setAppIcon(id: string): Promise<{
  ok: boolean;
  error?: string;
  changed?: boolean;
  toast?: string;
}> {
  const icon = normalize(id);

  // Persist first so preference survives even if native fails.
  try {
    await AsyncStorage.setItem(STORAGE_KEY, icon);
  } catch {
    /* still try native */
  }

  if (Platform.OS === 'web') {
    return { ok: true, changed: true };
  }

  if (!NativeIcon?.setIcon) {
    return {
      ok: true,
      changed: false,
      error:
        Platform.OS === 'ios'
          ? 'Icon will apply in a production iOS build.'
          : 'Icon preference saved. Install a release build to switch the launcher icon.',
    };
  }

  try {
    // Skip native work if already active (avoids PM thrash / restart risk).
    if (NativeIcon.getIcon) {
      try {
        const current = normalize(await NativeIcon.getIcon());
        if (current === icon) {
          return { ok: true, changed: false };
        }
      } catch {
        /* proceed to set */
      }
    }

    await NativeIcon.setIcon(icon);

    if (Platform.OS === 'android') {
      softToast(LAUNCHER_TOAST);
      return { ok: true, changed: true, toast: LAUNCHER_TOAST };
    }
    return { ok: true, changed: true };
  } catch (e: any) {
    // Preference is saved; do not crash the session.
    return {
      ok: false,
      error: e?.message ?? 'Could not change app icon',
      changed: false,
    };
  }
}

/**
 * Call once at app start so Android alias state matches stored preference.
 * No-ops when already matching — must not toggle components on every cold start.
 */
export async function hydrateAppIcon(): Promise<void> {
  try {
    const stored = await getStoredAppIcon();
    if (!NativeIcon?.setIcon) return;

    if (NativeIcon.getIcon) {
      try {
        const current = normalize(await NativeIcon.getIcon());
        if (current === stored) return;
      } catch {
        /* apply stored */
      }
    }
    await NativeIcon.setIcon(stored);
  } catch {
    /* ignore — never block boot */
  }
}
