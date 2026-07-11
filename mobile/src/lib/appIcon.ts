// Lumixo — dynamic launcher icon switcher.
// Android: activity-alias + PackageManager (no app restart required for most OEMs).
// iOS: UIApplication.setAlternateIconName (when the iOS target is linked).
// Web: browser tab favicon via preferences (handled separately).
import { NativeModules, Platform } from 'react-native';
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
 * Switch the launcher icon. Persists locally so the choice survives reboot and
 * app updates. Preferences sync (app_icon field) is handled by the caller.
 */
export async function setAppIcon(id: string): Promise<{ ok: boolean; error?: string }> {
  const icon = normalize(id);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, icon);
  } catch {
    /* still try native */
  }

  if (Platform.OS === 'web') {
    return { ok: true };
  }

  if (!NativeIcon?.setIcon) {
    // Native module not linked (e.g. Expo Go). Preference still saved.
    return {
      ok: true,
      error: Platform.OS === 'ios'
        ? 'Icon will apply in a production iOS build.'
        : 'Icon preference saved. Install a release build to switch the launcher icon.',
    };
  }

  try {
    await NativeIcon.setIcon(icon);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Could not change app icon' };
  }
}

/** Call once at app start so Android alias state matches stored preference. */
export async function hydrateAppIcon(): Promise<void> {
  const stored = await getStoredAppIcon();
  if (NativeIcon?.setIcon) {
    try {
      await NativeIcon.setIcon(stored);
    } catch {
      /* ignore — icon may already match */
    }
  }
}
