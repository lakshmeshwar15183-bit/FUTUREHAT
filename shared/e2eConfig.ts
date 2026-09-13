// Lumixo E2E storage config — platform sets this once at boot.
// Web passes localStorage adapter, mobile passes SecureStore adapter.

import type { E2EStorage } from './e2eIdentity.js';

let globalStorage: E2EStorage | null = null;

export function setE2EStorage(storage: E2EStorage): void {
  globalStorage = storage;
}

export function getE2EStorage(): E2EStorage | null {
  return globalStorage;
}

// Default web storage (localStorage) — used when platform hasn't set one.
export function defaultWebStorage(): E2EStorage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return {
        getItem: (k) => window.localStorage.getItem(k),
        setItem: (k, v) => window.localStorage.setItem(k, v),
      };
    }
  } catch { /* ignore */ }
  // In-memory fallback (tests / SSR)
  const mem = new Map<string, string>();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => { mem.set(k, v); },
  };
}

export function resolveE2EStorage(): E2EStorage {
  return globalStorage ?? defaultWebStorage();
}
