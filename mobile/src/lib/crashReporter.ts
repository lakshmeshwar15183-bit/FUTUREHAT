// Lumixo — production crash capture without a paid SDK dependency.
//
// Captures:
//   • React render errors (via ErrorBoundary → recordCrash)
//   • Global JS exceptions (ErrorUtils)
//   • Unhandled promise rejections
//
// Persistence: AsyncStorage (Diagnostics screen). Optional remote hook:
//   EXPO_PUBLIC_CRASH_WEBHOOK_URL — POST JSON breadcrumbs (no secrets/PII).
//
// When you add Sentry later, keep this as a fallback and also forward here.
import { Platform } from 'react-native';

import { APP_VERSION } from '../branding';
import { breadcrumb, recordCrash, logError } from './prodLog';

let installed = false;

async function maybePostRemote(payload: Record<string, unknown>): Promise<void> {
  const url = process.env.EXPO_PUBLIC_CRASH_WEBHOOK_URL?.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

  // React Native global ErrorUtils
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

  // Unhandled promise rejections (best-effort; optional dependency path).
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
    /* optional — not present in all RN bundles */
  }

  void breadcrumb('boot', 'crash reporter installed');
}
