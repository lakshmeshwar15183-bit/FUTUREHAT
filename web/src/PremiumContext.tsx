// Lumixo+ — premium state. Network refresh is deferred so first paint never waits.

import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';
import {
  getSubscription,
  isSubscriptionActive,
  getServerPremium,
  getServerAdmin,
  getPreferences,
  updatePreferences,
  getPremiumUserIds,
  DEFAULT_PREFERENCES,
} from '@shared/premiumApi';
import { getServerOwner } from '@shared/adminApi';
import type { Subscription, UserPreferences } from '@shared/types';
import { applyPreferences } from './theme/themes';
import { afterFirstPaint, readCachedPrefs, writeCachedPrefs } from './lib/startupCache';

interface PremiumContextValue {
  isPremium: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  subscription: Subscription | null;
  preferences: UserPreferences;
  premiumUserIds: Set<string>;
  loading: boolean;
  refresh: () => Promise<void>;
  setPreference: (updates: Partial<UserPreferences>) => Promise<void>;
}

function defaultPrefs(userId = ''): UserPreferences {
  return { user_id: userId, updated_at: new Date().toISOString(), ...DEFAULT_PREFERENCES };
}

const PremiumContext = createContext<PremiumContextValue>({
  isPremium: false,
  isAdmin: false,
  isOwner: false,
  subscription: null,
  preferences: defaultPrefs(),
  premiumUserIds: new Set(),
  loading: true,
  refresh: async () => {},
  setPreference: async () => {},
});

export function PremiumProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [serverPremium, setServerPremium] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    const uid = user?.id;
    if (!uid) return defaultPrefs();
    const cached = readCachedPrefs(uid);
    return cached ? { ...defaultPrefs(uid), ...cached, user_id: uid } : defaultPrefs(uid);
  });
  const [premiumUserIds, setPremiumUserIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false); // never block shell

  const isPremium = isSubscriptionActive(subscription) || serverPremium;

  const refresh = useCallback(async () => {
    if (!user) {
      setSubscription(null);
      setServerPremium(false);
      setIsAdmin(false);
      setIsOwner(false);
      setPreferences(defaultPrefs());
      setPremiumUserIds(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [sub, srvPremium, admin, owner, prefs, premiumIds] = await Promise.all([
        getSubscription(supabase),
        getServerPremium(supabase),
        getServerAdmin(supabase),
        getServerOwner(supabase),
        getPreferences(supabase),
        getPremiumUserIds(supabase),
      ]);
      setSubscription(sub);
      setServerPremium(srvPremium);
      setIsAdmin(admin);
      setIsOwner(owner);
      const next = prefs ?? defaultPrefs(user.id);
      setPreferences(next);
      writeCachedPrefs(user.id, next);
      setPremiumUserIds(new Set(premiumIds));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      void refresh();
      return;
    }
    // Apply cached prefs immediately for theme; fetch network after first paint.
    const cached = readCachedPrefs(user.id);
    if (cached) {
      setPreferences((prev) => ({ ...prev, ...cached, user_id: user.id }));
    }
    afterFirstPaint(() => {
      void refresh();
    });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    applyPreferences(preferences, isPremium);
  }, [preferences, isPremium]);

  const setPreference = useCallback(async (updates: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...updates };
      if (prev.user_id) writeCachedPrefs(prev.user_id, next as UserPreferences);
      return next;
    });
    const { preferences: saved } = await updatePreferences(supabase, updates as any);
    if (saved) {
      setPreferences(saved);
      if (saved.user_id) writeCachedPrefs(saved.user_id, saved);
    }
  }, []);

  const value = useMemo(
    () => ({
      isPremium,
      isAdmin,
      isOwner,
      subscription,
      preferences,
      premiumUserIds,
      loading,
      refresh,
      setPreference,
    }),
    [isPremium, isAdmin, isOwner, subscription, preferences, premiumUserIds, loading, refresh, setPreference],
  );

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremium() {
  return useContext(PremiumContext);
}
