/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // Production TURN relay — REQUIRED for cross-network calls (STUN alone only
  // connects peers on the same/permissive network). VITE_TURN_URL may be a
  // comma-separated list of transport URLs under one credential.
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
