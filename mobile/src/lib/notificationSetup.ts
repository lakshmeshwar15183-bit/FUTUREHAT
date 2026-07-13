/**
 * Lumixo — first-launch notification setup (permission + OEM battery guidance).
 * Policy-safe: explain first, request once, never spam after dismiss.
 */
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { registerForPush } from './notifications';
import {
  getOemGuide as getOemGuidePure,
  oemFamilyFromBrand,
  type OemFamily,
  type OemGuide,
} from './oemNotifGuides';
import { openBatteryAssistantSettings } from './batteryAssistant';

export type { OemFamily, OemGuide };
export { getOemGuidePure as getOemGuideForFamily };

const KEY_SETUP_DONE = 'fh:notifSetupDone:v1';
const KEY_BATTERY_DISMISS = 'fh:batteryGuideDismissed:v1';
const KEY_OEM_DISMISS = 'fh:oemGuideDismissed:v1';
const KEY_PERM_DENY_COUNT = 'fh:notifDenyCount:v1';

export type NotifPermissionState =
  | 'granted'
  | 'denied_can_ask'
  | 'denied_permanent'
  | 'undetermined';

function androidBrand(): string {
  if (Platform.OS !== 'android') return '';
  const c = Platform.constants as { Brand?: string; Manufacturer?: string };
  return `${c?.Brand ?? ''} ${c?.Manufacturer ?? ''}`.trim().toLowerCase();
}

/** Detect OEM family for battery / autostart guidance. */
export function detectOemFamily(): OemFamily {
  if (Platform.OS === 'ios') return 'ios';
  return oemFamilyFromBrand(androidBrand());
}

export function getOemGuide(family: OemFamily = detectOemFamily()): OemGuide {
  return getOemGuidePure(family);
}

export async function getPermissionState(): Promise<NotifPermissionState> {
  try {
    const s = await Notifications.getPermissionsAsync();
    if (s.granted || s.status === 'granted') return 'granted';
    if (s.status === 'undetermined' || s.canAskAgain) {
      return s.status === 'undetermined' ? 'undetermined' : 'denied_can_ask';
    }
    return 'denied_permanent';
  } catch {
    return 'undetermined';
  }
}

export async function shouldShowNotificationSetup(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const done = await AsyncStorage.getItem(KEY_SETUP_DONE);
    if (done === '1') {
      // Re-prompt only if permanently broken (no permission) and never completed with grant.
      const state = await getPermissionState();
      return state !== 'granted' && state === 'denied_permanent' ? false : false;
    }
    const state = await getPermissionState();
    return state !== 'granted';
  } catch {
    return true;
  }
}

export async function markNotificationSetupDone(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_SETUP_DONE, '1');
  } catch { /* ignore */ }
}

export async function shouldShowBatteryGuide(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const d = await AsyncStorage.getItem(KEY_BATTERY_DISMISS);
    if (d === '1') return false;
    const oem = getOemGuide();
    // Always offer once on aggressive OEMs; optional on others after setup.
    return oem.aggressive;
  } catch {
    return false;
  }
}

export async function dismissBatteryGuide(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_BATTERY_DISMISS, '1');
  } catch { /* ignore */ }
}

export async function shouldShowOemGuide(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    if ((await AsyncStorage.getItem(KEY_OEM_DISMISS)) === '1') return false;
    return getOemGuide().aggressive;
  } catch {
    return false;
  }
}

export async function dismissOemGuide(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_OEM_DISMISS, '1');
  } catch { /* ignore */ }
}

/**
 * Request notification permission with rationale already shown by the UI.
 * Returns final state after the system dialog.
 */
export async function requestNotificationPermissionFromUser(): Promise<NotifPermissionState> {
  const before = await getPermissionState();
  if (before === 'granted') {
    await registerForPush();
    await markNotificationSetupDone();
    return 'granted';
  }
  if (before === 'denied_permanent') {
    return 'denied_permanent';
  }
  // System dialog
  const ok = await registerForPush();
  if (ok) {
    await markNotificationSetupDone();
    try {
      await AsyncStorage.removeItem(KEY_PERM_DENY_COUNT);
    } catch { /* ignore */ }
    return 'granted';
  }
  try {
    const n = Number((await AsyncStorage.getItem(KEY_PERM_DENY_COUNT)) ?? '0') + 1;
    await AsyncStorage.setItem(KEY_PERM_DENY_COUNT, String(n));
  } catch { /* ignore */ }
  return getPermissionState();
}

export async function openAppNotificationSettings(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      try {
        await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
          { key: 'android.provider.extra.APP_PACKAGE', value: 'dev.lakshmeshwar.futurehat' },
        ]);
        return;
      } catch { /* fall through */ }
    }
    await Linking.openSettings();
  } catch { /* ignore */ }
}

export async function openAppBatterySettings(): Promise<void> {
  // Prefer OEM-aware battery assistant deep-links (never crash).
  try {
    if (await openBatteryAssistantSettings()) return;
  } catch { /* fall through */ }
  try {
    if (Platform.OS === 'android') {
      try {
        await Linking.openURL('package:dev.lakshmeshwar.futurehat');
        return;
      } catch { /* fall through */ }
    }
    await Linking.openSettings();
  } catch { /* ignore */ }
}

/** Rationale copy shown before the OS permission dialog. */
export const NOTIF_RATIONALE = {
  title: 'Never miss a message',
  body:
    'Lumixo needs notification permission to alert you about new messages and calls — even when the app is closed or your phone is locked. We never use this for ads.',
  bullets: [
    'Message alerts when the app is closed',
    'Incoming call rings with Answer / Decline',
    'Missed call and group mentions',
  ],
} as const;
