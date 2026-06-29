// FUTUREHAT mobile — Supabase client singleton.
// Reuses the shared client factory; supplies AsyncStorage so the session
// persists on-device (web uses localStorage by default).
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createFutureHatClient } from './shared';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'FUTUREHAT: missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Check mobile/.env',
  );
}

export const supabase = createFutureHatClient({
  url,
  anonKey,
  storage: AsyncStorage,
});
