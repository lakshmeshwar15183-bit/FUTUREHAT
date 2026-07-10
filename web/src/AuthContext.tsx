// Lumixo web — Auth context provider

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Profile } from '@shared/types';
import { supabase } from './supabase';
import { onAuthChange, getMyProfile } from '@shared/api';

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** True from the moment Supabase fires PASSWORD_RECOVERY until the caller
   *  clears it via clearRecoveryMode(). While on, main.tsx renders the
   *  ResetPassword screen instead of the chat app so the user actually gets
   *  a chance to set a new password (the recovery token also opens a real
   *  session, so without this flag the app would look "signed in" and skip
   *  the recovery UI entirely — the classic "reset link opens the wrong
   *  page" bug). */
  recoveryMode: boolean;
  clearRecoveryMode: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  recoveryMode: false,
  clearRecoveryMode: () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // Seed from the URL — Supabase processes the fragment asynchronously, but if
  // the pathname is `/reset-password` we can show the recovery UI immediately
  // (before the PASSWORD_RECOVERY event fires) so the user doesn't see a flash
  // of the chat app.
  const [recoveryMode, setRecoveryMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.location.pathname === '/reset-password' ||
      /[?#].*type=recovery/.test(window.location.href)
    );
  });
  const clearRecoveryMode = useCallback(() => setRecoveryMode(false), []);

  const refreshProfile = useCallback(async () => {
    setProfile(await getMyProfile(supabase));
  }, []);

  useEffect(() => {
    let active = true;
    let currentUserId: string | null = null;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      currentUserId = session?.user?.id ?? null;
      setUser(session?.user ?? null);
      if (session?.user) getMyProfile(supabase).then((p) => { if (active) setProfile(p); }).catch(() => {});
      setLoading(false);
    }).catch(() => { if (active) setLoading(false); });

    // Only react to real identity changes — ignore TOKEN_REFRESHED etc. so we
    // don't refetch the profile (and flash the UI) on every token rotation.
    const { unsubscribe } = onAuthChange(supabase, (event: any, session: any) => {
      // PASSWORD_RECOVERY fires exactly once, right after the SDK reads the
      // recovery tokens out of the URL fragment. Flip the flag so main.tsx
      // renders the ResetPassword screen instead of the chat app.
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);

      const nextId = session?.user?.id ?? null;
      if (event === 'SIGNED_OUT' || !nextId) {
        currentUserId = null;
        setUser(null);
        setProfile(null);
        return;
      }
      const identityChanged = nextId !== currentUserId;
      currentUserId = nextId;
      setUser(session.user);
      if (identityChanged || event === 'USER_UPDATED') {
        getMyProfile(supabase).then((p) => { if (active) setProfile(p); }).catch(() => {});
      }
    });

    return () => { active = false; unsubscribe(); };
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, recoveryMode, clearRecoveryMode, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
