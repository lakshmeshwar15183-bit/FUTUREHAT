// Lumixo — production health checks at startup.
// Surfaces misconfiguration that would break auth / calls / push in the wild.
// Results are available to Diagnostics; never blocks app launch.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { hasTurn, buildIceServers } from './shared';
import { resetPasswordRedirectUrl } from './authLinks';
import { breadcrumb } from './prodLog';

const KEY = 'fh:prodHealth:v1';

export type HealthItem = {
  id: string;
  ok: boolean;
  severity: 'critical' | 'warn' | 'info';
  message: string;
};

export type HealthReport = {
  at: string;
  items: HealthItem[];
  criticalCount: number;
  warnCount: number;
};

function isUnsafeUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|exp:\/\/|192\.168\./i.test(url);
}

export async function runProdHealthChecks(): Promise<HealthReport> {
  const items: HealthItem[] = [];

  // Supabase
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  items.push({
    id: 'supabase_url',
    ok: !!url && url.startsWith('https://') && !isUnsafeUrl(url),
    severity: 'critical',
    message: url ? `Supabase URL set (${url.replace(/^https?:\/\//, '').slice(0, 24)}…)` : 'EXPO_PUBLIC_SUPABASE_URL missing',
  });
  items.push({
    id: 'supabase_anon',
    ok: !!anon && anon.length > 20,
    severity: 'critical',
    message: anon ? 'Supabase anon key present' : 'EXPO_PUBLIC_SUPABASE_ANON_KEY missing',
  });

  // Password-reset redirect
  let resetUrl = '';
  try {
    resetUrl = resetPasswordRedirectUrl();
  } catch {
    resetUrl = '';
  }
  items.push({
    id: 'auth_reset_redirect',
    ok: !!resetUrl && !isUnsafeUrl(resetUrl),
    severity: 'critical',
    message: resetUrl
      ? `Reset redirect: ${resetUrl.slice(0, 48)}${resetUrl.length > 48 ? '…' : ''}`
      : 'Password-reset redirect could not be built',
  });
  if (resetUrl && isUnsafeUrl(resetUrl)) {
    items[items.length - 1].ok = false;
    items[items.length - 1].message = `UNSAFE reset redirect (localhost/Expo): ${resetUrl}`;
  }

  // Site URL for App Links
  const site = process.env.EXPO_PUBLIC_SITE_URL ?? '';
  items.push({
    id: 'site_url',
    ok: !!site && site.startsWith('https://'),
    severity: 'warn',
    message: site ? `Site URL: ${site}` : 'EXPO_PUBLIC_SITE_URL unset — App Link password reset may fail',
  });

  // TURN / calls
  const ice = buildIceServers(
    process.env.EXPO_PUBLIC_TURN_URL
      ? {
          urls: process.env.EXPO_PUBLIC_TURN_URL,
          username: process.env.EXPO_PUBLIC_TURN_USERNAME,
          credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL,
        }
      : null,
  );
  const turnOk = hasTurn(ice);
  items.push({
    id: 'turn',
    ok: turnOk,
    severity: turnOk ? 'info' : 'critical',
    message: turnOk
      ? 'TURN relay configured (cross-network calls OK)'
      : 'NO TURN configured — cross-network calls will often fail (set EXPO_PUBLIC_TURN_*)',
  });

  // FCM / google services (presence of config file is build-time; runtime we only note platform)
  items.push({
    id: 'push_platform',
    ok: Platform.OS === 'android' || Platform.OS === 'ios',
    severity: 'info',
    message: `Push platform: ${Platform.OS} (FCM requires google-services.json + Edge secret FCM_SERVICE_ACCOUNT)`,
  });

  // App ownership
  const ownership = (Constants as any).appOwnership as string | undefined;
  items.push({
    id: 'build_type',
    ok: ownership !== 'expo',
    severity: ownership === 'expo' ? 'warn' : 'info',
    message:
      ownership === 'expo'
        ? 'Running in Expo Go — notifications/calls limited; use release APK for production tests'
        : `Build: ${ownership ?? 'standalone/release'}`,
  });

  const report: HealthReport = {
    at: new Date().toISOString(),
    items,
    criticalCount: items.filter((i) => !i.ok && i.severity === 'critical').length,
    warnCount: items.filter((i) => !i.ok && i.severity === 'warn').length,
  };

  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(report));
  } catch {
    /* ignore */
  }

  for (const i of items) {
    if (!i.ok && i.severity === 'critical') {
      void breadcrumb('health-critical', i.message);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[prodHealth:CRITICAL]', i.id, i.message);
      }
    }
  }

  return report;
}

export async function getLastHealthReport(): Promise<HealthReport | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HealthReport) : null;
  } catch {
    return null;
  }
}
