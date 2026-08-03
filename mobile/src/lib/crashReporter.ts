// Lumixo — production crash capture without a paid SDK dependency.
//
// Captures:
//   • React render errors (via ErrorBoundary → recordCrash)
//   • Global JS exceptions (ErrorUtils)
//   • Unhandled promise rejections
//
// Persistence: AsyncStorage (Diagnostics screen).
// Remote (P0): posts to Edge Function `crash-report` by default
//   `${EXPO_PUBLIC_SUPABASE_URL}/functions/v1/crash-report`
// Override with EXPO_PUBLIC_CRASH_WEBHOOK_URL if needed.
import { Platform } from 'react-native';

import { APP_VERSION } from '../branding';
import { breadcrumb, recordCrash, logError } from './prodLog';

let installed = false;

function crashEndpoint(): string | null {
  const override = process.env.EXPO_PUBLIC_CRASH_WEBHOOK_URL?.trim();
  if (override) return override;
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/functions/v1/crash-report`;
}

async function maybePostRemote(payload: Record<string, unknown>): Promise<void> {
  const url = crashEndpoint();
  if (!url) return;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(anon
          ? {
              apikey: anon,
              Authorization: `Bearer ${anon}`,
            }
          : {}),
      },
      body: JSON.stringify({
        ...payload,
        app: 'Lumixo',
        version: APP_VERSION,
        platform: Platform.OS,
        platformVersion: String(Platform.Version),
        at: new Date().toISOString(),
      }),
    });
  } catch {
    /* never throw from crash path */
  }
}

export function reportFatal(label: string, error: unknown, extra?: string): void {
  const err = error instanceof Error ? error : new Error(String(error ?? 'unknown'));
  logError(`[crash:${label}]`, err.message, extra ?? '');
  void recordCrash(label, err, extra ?? err.stack ?? null);
  void breadcrumb('fatal', `${label}: ${err.message}`);
  void maybePostRemote({
    kind: 'fatal',
    label,
    message: err.message.slice(0, 500),
    stack: (extra ?? err.stack ?? '').slice(0, 4000),
  });
}

/** Install global handlers once at app boot. */
export function installCrashReporter(): void {
  if (installed) return;
  installed = true;

  try {
    const EU = (global as any).ErrorUtils;
    if (EU?.getGlobalHandler && EU?.setGlobalHandler) {
      const prev = EU.getGlobalHandler();
      EU.setGlobalHandler((error: Error, isFatal?: boolean) => {
        reportFatal(isFatal ? 'js-fatal' : 'js-error', error);
        if (typeof prev === 'function') {
          try {
            prev(error, isFatal);
          } catch {
            /* ignore */
          }
        }
      });
    }
  } catch {
    /* ignore */
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rejectionTracking = require('promise/setimmediate/rejection-tracking');
    if (rejectionTracking?.enable) {
      rejectionTracking.enable({
        allRejections: true,
        onUnhandled: (_id: number, error: unknown) => {
          reportFatal('unhandled-rejection', error);
        },
        onHandled: () => {},
      });
    }
  } catch {
    /* optional */
  }

  void breadcrumb('boot', 'crash reporter installed');
}
