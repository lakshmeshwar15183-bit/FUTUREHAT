// FUTUREHAT+ — premium state: subscription, preferences, gating, and the live
// set of premium users (for badges). Applies appearance preferences to the DOM.

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';
import {
  getSubscription,
  isSubscriptionActive,
  getServerPremium,
  getServerAdmin,
  getPreferences,
  // (getServerOwner imported from adminApi below)
  updatePreferences,
  getPremiumUserIds,
  DEFAULT_PREFERENCES,
} from '@shared/premiumApi';
import { getServerOwner } from '@shared/adminApi';
import type { Subscription, UserPreferences } from '@shared/types';
import { applyPreferences } from './theme/themes';

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
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPrefs());
  const [premiumUserIds, setPremiumUserIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Premium if the local subscription is active OR the server says so (the latter
  // honors the developer override even with no subscription row).
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
    setPreferences(prefs ?? defaultPrefs(user.id));
    setPremiumUserIds(new Set(premiumIds));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  // Apply appearance whenever preferences or premium status changes.
  useEffect(() => {
    applyPreferences(preferences, isPremium);
  }, [preferences, isPremium]);

  const setPreference = useCallback(
    async (updates: Partial<UserPreferences>) => {
      setPreferences((prev) => ({ ...prev, ...updates })); // optimistic
      const { preferences: saved } = await updatePreferences(supabase, updates as any);
      if (saved) setPreferences(saved);
    },
    [],
  );

  return (
    <PremiumContext.Provider
      value={{ isPremium, isAdmin, isOwner, subscription, preferences, premiumUserIds, loading, refresh, setPreference }}
    >
      {children}
    </PremiumContext.Provider>
  );
}

export function usePremium() {
  return useContext(PremiumContext);
}
