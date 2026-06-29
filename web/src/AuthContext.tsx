// FUTUREHAT web — Auth context provider

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Profile } from '@shared/types';
import { supabase } from './supabase';
import { onAuthChange, getMyProfile } from '@shared/api';

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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
    <AuthContext.Provider value={{ user, profile, loading, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
