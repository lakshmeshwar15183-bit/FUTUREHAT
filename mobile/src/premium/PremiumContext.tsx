// Lumixo mobile — global premium state (single source of truth).
//
// Design goals (WhatsApp-class purchase UX):
//  • Instant optimistic unlock after Razorpay success (server still verifies).
//  • No app restart, no auth remount, no splash, no full-tree remount.
//  • Silent reconcile with server; in-flight refresh is de-duplicated.
//  • Local cache (`me:premium`) so cold open stays instant offline.
//
// Security: optimistic unlock is client UX only. Privileged RPCs / RLS still
// enforce premium server-side until verify completes.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { supabase } from '../lib/supabase';
import {
  getSubscription,
  isSubscriptionActive,
  getServerPremium,
  type PlanId,
  type Subscription,
} from '../lib/shared';
import { getCache, setCache } from '../lib/localCache';

const PREMIUM_CACHE_KEY = 'me:premium';

export type PremiumActivationPhase =
  | 'idle'
  | 'activating' // payment succeeded, server verify in flight
  | 'active'
  | 'failed';

interface PremiumContextValue {
  /** Effective premium (subscription OR server flag OR optimistic). */
  isPremium: boolean;
  subscription: Subscription | null;
  /** True while verifying payment after Checkout success. */
  isActivating: boolean;
  activationPhase: PremiumActivationPhase;
  activationError: string | null;
  /** Last plan the user attempted to buy (for UI). */
  pendingPlan: PlanId | null;
  /**
   * Optimistic unlock immediately after Checkout success.
   * Call BEFORE or in parallel with server verify — never blocks UI.
   */
  beginActivation: (plan: PlanId) => void;
  /**
   * Server confirmed premium. Silently reloads subscription row once.
   */
  completeActivation: () => Promise<void>;
  /**
   * Verify failed — roll back optimistic unlock and surface a retry message.
   */
  failActivation: (message: string) => void;
  clearActivationError: () => void;
  /**
   * Silent background refresh (deduped). Never toggles splash / auth.
   */
  refresh: (opts?: { force?: boolean }) => Promise<boolean>;
}

const PremiumContext = createContext<PremiumContextValue | null>(null);

export function PremiumProvider({ children }: { children: ReactNode }) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [serverPremium, setServerPremium] = useState(false);
  const [optimistic, setOptimistic] = useState(false);
  const [activationPhase, setActivationPhase] = useState<PremiumActivationPhase>('idle');
  const [activationError, setActivationError] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PlanId | null>(null);

  const refreshInflight = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Instant cache hydrate — zero network, zero flicker.
  useEffect(() => {
    getCache<boolean>(PREMIUM_CACHE_KEY, false).then((v) => {
      if (!mounted.current) return;
      if (v) setServerPremium(true);
    }).catch(() => {});
  }, []);

  const applyServer = useCallback((sub: Subscription | null, srv: boolean) => {
    if (!mounted.current) return;
    setSubscription(sub);
    const active = isSubscriptionActive(sub) || srv;
    setServerPremium(active);
    setCache(PREMIUM_CACHE_KEY, active).catch(() => {});
    if (active) {
      setOptimistic(false);
      setActivationPhase((p) => (p === 'activating' ? 'active' : p === 'active' ? 'active' : 'active'));
      setActivationError(null);
    }
  }, []);

  const refresh = useCallback(async (opts?: { force?: boolean }): Promise<boolean> => {
    if (refreshInflight.current && !opts?.force) {
      return refreshInflight.current;
    }
    const run = (async () => {
      try {
        const [sub, srv] = await Promise.all([
          getSubscription(supabase).catch(() => null),
          getServerPremium(supabase).catch(() => false),
        ]);
        const active = isSubscriptionActive(sub) || !!srv;
        applyServer(sub, !!srv);
        return active;
      } catch {
        return isSubscriptionActive(subscription) || serverPremium || optimistic;
      } finally {
        refreshInflight.current = null;
      }
    })();
    refreshInflight.current = run;
    return run;
  }, [applyServer, subscription, serverPremium, optimistic]);

  // One silent reconcile after mount (does not block first paint).
  useEffect(() => {
    const t = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [refresh]);

  // Reconcile when app returns to foreground (covers webhook completed offline).
  useEffect(() => {
    const onChange = (s: AppStateStatus) => {
      if (s === 'active') void refresh();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [refresh]);

  const beginActivation = useCallback((plan: PlanId) => {
    setPendingPlan(plan);
    setActivationError(null);
    setActivationPhase('activating');
    // Instant UI unlock — features gate client-side immediately.
    setOptimistic(true);
    setCache(PREMIUM_CACHE_KEY, true).catch(() => {});
  }, []);

  const completeActivation = useCallback(async () => {
    setActivationPhase('activating');
    // Force one server round-trip so subscription row + period end are fresh.
    const ok = await refresh({ force: true });
    if (!mounted.current) return;
    if (ok) {
      setOptimistic(false);
      setActivationPhase('active');
      setActivationError(null);
    } else {
      // Payment verified server-side but read lag — keep optimistic premium.
      setActivationPhase('active');
      setOptimistic(true);
      setCache(PREMIUM_CACHE_KEY, true).catch(() => {});
      // Soft retry without blocking UI.
      setTimeout(() => {
        void refresh({ force: true });
      }, 1500);
    }
  }, [refresh]);

  const failActivation = useCallback((message: string) => {
    setOptimistic(false);
    setActivationPhase('failed');
    setActivationError(message || 'Payment verification failed');
    // Re-sync from server so we don't leave a false free grant if they actually paid.
    void refresh({ force: true }).then((ok) => {
      if (ok && mounted.current) {
        setActivationPhase('active');
        setActivationError(null);
      }
    });
  }, [refresh]);

  const clearActivationError = useCallback(() => {
    setActivationError(null);
    if (activationPhase === 'failed') setActivationPhase('idle');
  }, [activationPhase]);

  const isPremium =
    optimistic ||
    serverPremium ||
    isSubscriptionActive(subscription);

  const value = useMemo<PremiumContextValue>(
    () => ({
      isPremium,
      subscription,
      isActivating: activationPhase === 'activating',
      activationPhase,
      activationError,
      pendingPlan,
      beginActivation,
      completeActivation,
      failActivation,
      clearActivationError,
      refresh,
    }),
    [
      isPremium,
      subscription,
      activationPhase,
      activationError,
      pendingPlan,
      beginActivation,
      completeActivation,
      failActivation,
      clearActivationError,
      refresh,
    ],
  );

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremium(): PremiumContextValue {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error('usePremium must be used within PremiumProvider');
  return ctx;
}

/** Safe for optional consumers above the provider (returns free defaults). */
export function usePremiumOptional(): PremiumContextValue | null {
  return useContext(PremiumContext);
}
