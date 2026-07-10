// Lumixo — Supabase client factory shared by web and mobile.
// Each platform passes its own URL/key and (for mobile) a storage adapter.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface LumixoClientOptions {
  url: string;
  anonKey: string;
  /** Storage adapter — web uses window.localStorage by default; mobile passes AsyncStorage. */
  storage?: {
    getItem: (key: string) => Promise<string | null> | string | null;
    setItem: (key: string, value: string) => Promise<void> | void;
    removeItem: (key: string) => Promise<void> | void;
  };
}

export function createLumixoClient(opts: LumixoClientOptions): SupabaseClient {
  if (!opts.url || !opts.anonKey) {
    throw new Error(
      'Lumixo: missing Supabase URL or anon key. Check your .env configuration.',
    );
  }
  return createClient(opts.url, opts.anonKey, {
    auth: {
      // mobile must avoid touching window; web is fine with defaults
      storage: opts.storage as never,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: typeof window !== 'undefined',
    },
    realtime: {
      params: { eventsPerSecond: 20 },
    },
    global: {
      headers: { 'x-futurehat-client': 'true' },
    },
  });
}

export type { SupabaseClient };
