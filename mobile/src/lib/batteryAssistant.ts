/**
 * Lumixo — battery / background-activity assistant (logic + native bridge).
 * Never forces settings changes. Never crashes on missing intents / OEMs.
 */
import { AppState, Linking, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getOemGuide,
  oemFamilyFromBrand,
  oemNeedsProactiveBatteryAssist,
  type OemFamily,
  type OemGuide,
} from './oemNotifGuides';
import { logDebug } from './prodLog';

const KEY_NEVER_ASK = 'fh:batteryAssist:neverAsk:v2';
const KEY_REMIND_AFTER = 'fh:batteryAssist:remindAfter:v2';
const KEY_SUCCESS = 'fh:batteryAssist:success:v2';
const KEY_SEEN = 'fh:batteryAssist:seen:v2';

const REMIND_LATER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PACKAGE = 'dev.lakshmeshwar.futurehat';

type NativeBattery = {
  getStatus?: () => Promise<{
    manufacturer?: string;
    brand?: string;
    model?: string;
    sdk?: number;
    ignoringBatteryOptimizations?: boolean;
    statusKnown?: boolean;
    backgroundAllowed?: boolean;
    error?: string;
  } | null>;
  openBatterySettings?: () => Promise<boolean>;
};

const Native: NativeBattery | undefined = NativeModules.LumixoBatteryAssistant;

export type BatteryAssistStatus = {
  /** True when OS reports app is exempt from battery optimization. */
  backgroundAllowed: boolean;
  /** False when native status is unavailable (iOS / old builds). */
  statusKnown: boolean;
  manufacturer: string;
  brand: string;
  model: string;
  family: OemFamily;
  guide: OemGuide;
};

function androidBrandString(status?: { manufacturer?: string; brand?: string }): string {
  if (status?.brand || status?.manufacturer) {
    return `${status.brand ?? ''} ${status.manufacturer ?? ''}`.trim();
  }
  if (Platform.OS !== 'android') return '';
  const c = Platform.constants as { Brand?: string; Manufacturer?: string };
  return `${c?.Brand ?? ''} ${c?.Manufacturer ?? ''}`.trim();
}

/** Detect OEM + current optimization status (best-effort). */
export async function getBatteryAssistStatus(): Promise<BatteryAssistStatus> {
  let manufacturer = '';
  let brand = '';
  let model = '';
  let backgroundAllowed = false;
  let statusKnown = false;

  if (Platform.OS === 'android' && Native?.getStatus) {
    try {
      const s = await Native.getStatus();
      if (s) {
        manufacturer = String(s.manufacturer ?? '');
        brand = String(s.brand ?? '');
        model = String(s.model ?? '');
        statusKnown = !!s.statusKnown;
        backgroundAllowed = !!(s.backgroundAllowed || s.ignoringBatteryOptimizations);
      }
    } catch (e) {
      logDebug('[batteryAssist] getStatus failed', e);
    }
  }

  const family =
    Platform.OS === 'ios'
      ? 'ios'
      : oemFamilyFromBrand(androidBrandString({ manufacturer, brand }));
  const guide = getOemGuide(family);

  return {
    backgroundAllowed,
    statusKnown,
    manufacturer,
    brand,
    model,
    family,
    guide,
  };
}

/**
 * Whether the assistant should appear automatically (not forced from Settings).
 * - iOS: never
 * - Never-ask preference: never
 * - Already success + still allowed: never
 * - Remind-later window: never
 * - Non-aggressive OEM: never (user opens from Settings only)
 * - Aggressive OEM: once until skip / success / never-ask
 */
export async function shouldShowBatteryAssistant(opts?: {
  force?: boolean;
}): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (opts?.force) return true;

  try {
    if ((await AsyncStorage.getItem(KEY_NEVER_ASK)) === '1') return false;

    const remindRaw = await AsyncStorage.getItem(KEY_REMIND_AFTER);
    if (remindRaw) {
      const t = Number(remindRaw);
      if (Number.isFinite(t) && Date.now() < t) return false;
    }

    const status = await getBatteryAssistStatus();
    if (status.statusKnown && status.backgroundAllowed) {
      await AsyncStorage.setItem(KEY_SUCCESS, '1');
      return false;
    }

    if (!oemNeedsProactiveBatteryAssist(status.family)) {
      return false;
    }

    // Already completed successfully once — only re-show if status known & revoked.
    if ((await AsyncStorage.getItem(KEY_SUCCESS)) === '1') {
      if (status.statusKnown && !status.backgroundAllowed) {
        // Optimization re-enabled by user — soft re-offer is OK once.
        return true;
      }
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export async function markBatteryAssistantSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_SEEN, '1');
  } catch { /* ignore */ }
}

export async function markBatteryAssistantSuccess(): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [KEY_SUCCESS, '1'],
      [KEY_REMIND_AFTER, ''],
    ]);
  } catch { /* ignore */ }
}

export async function setBatteryAssistantNeverAsk(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_NEVER_ASK, '1');
  } catch { /* ignore */ }
}

export async function setBatteryAssistantRemindLater(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_REMIND_AFTER, String(Date.now() + REMIND_LATER_MS));
  } catch { /* ignore */ }
}

/** Clear never-ask so Settings → Battery Optimization can show the assistant again. */
export async function resetBatteryAssistantForManualOpen(): Promise<void> {
  // Manual open always shows; we do not clear never-ask so auto-prompt stays off.
  // Only clears remind timer so "Remind me later" does not block Settings entry.
  try {
    await AsyncStorage.removeItem(KEY_REMIND_AFTER);
  } catch { /* ignore */ }
}

/**
 * Open the best battery / background settings page for this OEM.
 * Falls back to app details → system settings. Never throws.
 */
export async function openBatteryAssistantSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    try {
      await Linking.openSettings();
      return true;
    } catch {
      return false;
    }
  }

  if (Native?.openBatterySettings) {
    try {
      const ok = await Native.openBatterySettings();
      if (ok) return true;
    } catch (e) {
      logDebug('[batteryAssist] openBatterySettings native failed', e);
    }
  }

  // JS fallbacks
  try {
    await Linking.openURL(`package:${PACKAGE}`);
    return true;
  } catch { /* fall through */ }

  try {
    await Linking.sendIntent('android.settings.APPLICATION_DETAILS_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: PACKAGE },
    ]);
    return true;
  } catch { /* fall through */ }

  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribe to AppState 'active' and re-check battery status.
 * Calls onAllowed when background is confirmed allowed.
 * Calls onStillRestricted when user returned but still restricted (status known).
 * Calls onUnknown when status cannot be read (still soft-success path for UX).
 */
export function watchBatteryStatusOnResume(handlers: {
  onAllowed: (status: BatteryAssistStatus) => void;
  onStillRestricted: (status: BatteryAssistStatus) => void;
  onUnknown?: (status: BatteryAssistStatus) => void;
}): () => void {
  let alive = true;

  const check = async () => {
    if (!alive) return;
    try {
      const status = await getBatteryAssistStatus();
      if (!alive) return;
      if (status.statusKnown && status.backgroundAllowed) {
        handlers.onAllowed(status);
      } else if (status.statusKnown && !status.backgroundAllowed) {
        handlers.onStillRestricted(status);
      } else {
        handlers.onUnknown?.(status);
      }
    } catch (e) {
      logDebug('[batteryAssist] resume check failed', e);
    }
  };

  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') void check();
  });

  return () => {
    alive = false;
    try {
      sub.remove();
    } catch { /* ignore */ }
  };
}

/** Soft copy when user declines or returns without enabling. */
export const BATTERY_SOFT_DECLINE_COPY = {
  title: "You're all set",
  body:
    "Lumixo will continue to work, but calls or notifications may occasionally be delayed because of your phone's battery settings.",
} as const;

export const BATTERY_SUCCESS_COPY = {
  title: 'Background activity enabled',
  body: 'Calls and notifications should now work reliably.',
} as const;

export const BATTERY_WHY_COPY =
  'Phones often pause apps to save power. Allowing background activity for Lumixo helps incoming calls ring and message alerts arrive even when the app is closed.';
