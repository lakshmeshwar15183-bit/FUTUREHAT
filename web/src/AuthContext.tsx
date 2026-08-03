// Lumixo web — Auth context provider (cache-first session restore).

import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Profile } from '@shared/types';
import { supabase } from './supabase';
import { onAuthChange, getMyProfile } from '@shared/api';
import { peekStoredUser, mark } from './lib/startupCache';

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** True from the moment Supabase fires PASSWORD_RECOVERY until the caller
   *  clears it via clearRecoveryMode(). While on, main.tsx renders the
   *  ResetPassword screen instead of the chat app. */
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

function initialRecoveryMode(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.pathname === '/reset-password' ||
    /[?#].*type=recovery/.test(window.location.href)
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Instant paint: seed user from localStorage before any network / getSession.
  const [user, setUser] = useState<User | null>(() => {
    mark('auth-seed');
    return peekStoredUser();
  });
  const [profile, setProfile] = useState<Profile | null>(null);
  // Never block the UI on network when we already know signed-in / signed-out.
  // loading is only true when we have zero signal (first visit + empty storage)
  // AND we're still confirming getSession — keep that window short.
  const [loading, setLoading] = useState(() => {
    // If we peeked a user OR we're clearly on recovery path, skip splash.
    if (peekStoredUser()) return false;
    if (initialRecoveryMode()) return false;
    // First-ever visit: still show a brief shell (index.html boot) not React splash.
    return false;
  });
  const [recoveryMode, setRecoveryMode] = useState<boolean>(initialRecoveryMode);
  const clearRecoveryMode = useCallback(() => setRecoveryMode(false), []);

  const refreshProfile = useCallback(async () => {
    setProfile(await getMyProfile(supabase));
  }, []);

  useEffect(() => {
    let active = true;
    let currentUserId: string | null = peekStoredUser()?.id ?? null;
    mark('auth-getSession-start');

    // Confirm / refresh session asynchronously — never gate first paint on this.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!active) return;
        mark('auth-getSession-done');
        currentUserId = session?.user?.id ?? null;
        setUser(session?.user ?? null);
        if (session?.user) {
          getMyProfile(supabase)
            .then((p) => {
              if (active) setProfile(p);
            })
            .catch(() => {});
        } else {
          setProfile(null);
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    // Only react to real identity changes — ignore TOKEN_REFRESHED etc. so we
    // don't refetch the profile (and flash the UI) on every token rotation.
    const { unsubscribe } = onAuthChange(supabase, (event: any, session: any) => {
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
        getMyProfile(supabase)
          .then((p) => {
            if (active) setProfile(p);
          })
          .catch(() => {});
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ user, profile, loading, recoveryMode, clearRecoveryMode, refreshProfile }),
    [user, profile, loading, recoveryMode, clearRecoveryMode, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
