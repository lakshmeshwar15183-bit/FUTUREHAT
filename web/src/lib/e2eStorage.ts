// Lumixo web — E2EE storage adapter (localStorage)
// Private key is per-user, per-origin. Not hardware-backed on web — document as
// residual risk. Phase 2 could use WebCrypto non-extractable keys + IndexedDB.

export const e2eStorage = {
  getItem: (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem: (key: string, value: string): void => {
    try { localStorage.setItem(key, value); } catch { /* quota */ }
  },
  removeItem: (key: string): void => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};
