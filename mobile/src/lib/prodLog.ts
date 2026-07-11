// Lumixo — production-safe logging. Verbose logs only in __DEV__; errors always
// surface, and the last N crash breadcrumbs are kept for ErrorBoundary dumps.
import AsyncStorage from '@react-native-async-storage/async-storage';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;
const CRASH_KEY = 'fh:crash:last';
const BREAD_KEY = 'fh:crash:breadcrumbs';
const BREAD_MAX = 40;

export function logDebug(...args: unknown[]): void {
  if (IS_DEV) console.log(...args);
}

export function logWarn(...args: unknown[]): void {
  if (IS_DEV) console.warn(...args);
  else console.warn(...args); // keep warnings for release diagnosis (low volume)
}

export function logError(...args: unknown[]): void {
  console.error(...args);
}

/** Record a short breadcrumb for post-crash diagnosis (no PII). */
export async function breadcrumb(tag: string, detail?: string): Promise<void> {
  try {
    const line = `${new Date().toISOString()} [${tag}] ${detail ?? ''}`.slice(0, 200);
    const raw = await AsyncStorage.getItem(BREAD_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    list.push(line);
    while (list.length > BREAD_MAX) list.shift();
    await AsyncStorage.setItem(BREAD_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** Persist last crash payload for Settings → Diagnostics (optional). */
export async function recordCrash(label: string, error: Error, stack?: string | null): Promise<void> {
  try {
    await AsyncStorage.setItem(
      CRASH_KEY,
      JSON.stringify({
        at: new Date().toISOString(),
        label,
        message: error?.message?.slice(0, 500) ?? 'unknown',
        stack: (stack ?? error?.stack ?? '').slice(0, 4000),
      }),
    );
    await breadcrumb('crash', `${label}: ${error?.message ?? ''}`);
  } catch {
    /* ignore */
  }
}

export async function getLastCrash(): Promise<{
  at: string;
  label: string;
  message: string;
  stack: string;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(CRASH_KEY);
    return raw ? (JSON.parse(raw) as any) : null;
  } catch {
    return null;
  }
}
