// Lumixo mobile — Lumixo+ premium plans + Razorpay checkout.
//
// WhatsApp-class purchase UX:
//  • After pay: optimistic premium unlock immediately (global PremiumContext).
//  • Verify server-side in the background — never remount app / auth / splash.
//  • Navigation stack, drafts, chats, scroll stay mounted.
//  • Subtle "Activating Premium…" banner (root) — this screen stays interactive.
//  • Failures roll back optimistic state + show retry (no crash / freeze).
//
// Security: client never writes subscriptions. Edge Function verifies HMAC.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';

import { supabase } from '../lib/supabase';
import {
  isSubscriptionActive,
  cancelSubscription,
  PLAN_LIST,
  PLANS,
  formatInr,
  PREMIUM_FEATURES,
  FEATURE_CATEGORIES,
  type PlanId,
} from '../lib/shared';
import {
  getRazorpayConfig,
  createRazorpayOrder,
  verifyRazorpayPayment,
  getRazorpayOrderStatus,
  markRazorpayOrderCancelled,
} from '../../../shared/payments/razorpayApi';
import {
  RazorpayCheckoutModal,
  type RazorpayCheckoutParams,
  type RazorpayCheckoutOutcome,
} from '../payments/RazorpayCheckoutModal';
import { usePremium } from '../premium';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME } from '../branding';
import { Alert } from '../ui/dialog';

type CheckoutPhase = 'idle' | 'creating_order' | 'checkout';

export default function PremiumScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    isPremium,
    subscription,
    isActivating,
    beginActivation,
    completeActivation,
    failActivation,
    refresh: refreshPremium,
  } = usePremium();

  const [plan, setPlan] = useState<PlanId>('yearly');
  const [paymentsReady, setPaymentsReady] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [checkoutPhase, setCheckoutPhase] = useState<CheckoutPhase>('idle');
  const [localError, setLocalError] = useState('');
  const [checkoutParams, setCheckoutParams] = useState<RazorpayCheckoutParams | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [userMeta, setUserMeta] = useState<{ email?: string; name?: string }>({});
  const [justUnlocked, setJustUnlocked] = useState(false);
  const verifyingRef = useRef(false);

  // Soft hydrate config + identity — never blocks paint with a full-screen spinner.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const [auth, cfg] = await Promise.all([
          supabase.auth.getUser(),
          getRazorpayConfig(supabase),
        ]);
        if (!alive) return;
        setPaymentsReady(!!cfg.config?.configured);
        setConfigLoaded(true);
        const u = auth.data.user;
        setUserMeta({
          email: u?.email ?? undefined,
          name: (u?.user_metadata as any)?.display_name || u?.email || undefined,
        });
        // Silent reconcile — does not flip UI to loading.
        void refreshPremium();
      })();
      return () => {
        alive = false;
      };
    }, [refreshPremium]),
  );

  useEffect(() => {
    if (isPremium && justUnlocked) {
      const t = setTimeout(() => setJustUnlocked(false), 2400);
      return () => clearTimeout(t);
    }
  }, [isPremium, justUnlocked]);

  const active = isPremium || isSubscriptionActive(subscription);
  const checkoutBusy = checkoutPhase === 'creating_order' || checkoutPhase === 'checkout';

  async function ensureOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    if (state.isConnected === false) {
      setLocalError('No internet connection. Connect and try again.');
      return false;
    }
    return true;
  }

  async function startCheckout() {
    setLocalError('');
    if (!paymentsReady) {
      Alert.alert(
        'Payments unavailable',
        'Secure Razorpay billing is not configured on the server yet. Please try again later.',
      );
      return;
    }
    if (!(await ensureOnline())) return;

    setCheckoutPhase('creating_order');
    const { order, error: orderErr } = await createRazorpayOrder(supabase, plan);
    if (orderErr || !order) {
      // Never surface raw Edge Function platform strings.
      const raw = orderErr?.message || '';
      const friendly =
        !raw || /edge function|non-2xx|functions\.invoke/i.test(raw)
          ? 'Could not start secure checkout. Please sign in again or try later.'
          : raw;
      setLocalError(friendly);
      setCheckoutPhase('idle');
      return;
    }

    setPendingOrderId(order.orderId);
    setCheckoutParams({
      keyId: order.keyId,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      planLabel: `${PLANS[plan].label} plan`,
      name: userMeta.name,
      email: userMeta.email,
      description: `Lumixo+ ${PLANS[plan].label}`,
    });
    setCheckoutPhase('checkout');
  }

  /**
   * Background verify — must never navigate away or remount auth.
   * Optimistic unlock runs first so badges/themes/limits flip immediately.
   */
  async function verifyInBackground(proof: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    try {
      beginActivation(plan);
      setJustUnlocked(true);

      const verified = await verifyRazorpayPayment(supabase, proof);
      if (verified.ok) {
        await completeActivation();
        setPendingOrderId(null);
        setLocalError('');
        return;
      }

      // Recover if webhook already activated.
      const orderId = pendingOrderId || proof.razorpay_order_id;
      if (orderId) {
        const st = await getRazorpayOrderStatus(supabase, orderId);
        if (st.subscriptionActive || st.recovered) {
          await completeActivation();
          setPendingOrderId(null);
          setLocalError('');
          return;
        }
      }

      failActivation(
        verified.error ||
          'Payment verification failed. If you were charged, tap Retry on the banner.',
      );
      setLocalError(
        verified.error ||
          'Could not confirm payment yet. Premium will unlock automatically once verified.',
      );
    } finally {
      verifyingRef.current = false;
    }
  }

  async function onCheckoutResult(result: RazorpayCheckoutOutcome) {
    setCheckoutParams(null);
    setCheckoutPhase('idle');

    if (result.type === 'cancelled') {
      if (pendingOrderId) {
        // Paid-then-dismiss recovery without blocking the whole tree.
        const st = await getRazorpayOrderStatus(supabase, pendingOrderId);
        if (st.subscriptionActive || st.recovered) {
          beginActivation(plan);
          setJustUnlocked(true);
          await completeActivation();
          setPendingOrderId(null);
          return;
        }
        void markRazorpayOrderCancelled(supabase, pendingOrderId);
      }
      setLocalError('Payment cancelled.');
      return;
    }

    if (result.type === 'failed') {
      setLocalError(result.description || 'Payment failed. No charge was completed.');
      return;
    }

    if (result.type === 'error') {
      setLocalError(result.message || 'Checkout error. Please try again.');
      return;
    }

    // Success path: unlock now, verify async — stay on this screen.
    setLocalError('');
    void verifyInBackground({
      razorpay_order_id: result.razorpay_order_id,
      razorpay_payment_id: result.razorpay_payment_id,
      razorpay_signature: result.razorpay_signature,
    });
  }

  async function cancel() {
    Alert.alert('Cancel subscription', 'You keep premium until the period ends. Continue?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel renewal',
        style: 'destructive',
        onPress: async () => {
          const { error: cancelErr } = await cancelSubscription(supabase);
          if (cancelErr) {
            setLocalError(cancelErr.message || 'Could not cancel subscription');
            return;
          }
          await refreshPremium({ force: true });
        },
      },
    ]);
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: spacing(10) }}
        // Preserve scroll while activation banner updates global premium.
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Ionicons name="diamond" size={48} color={colors.accentPlusText} />
          <Text style={styles.heroTitle}>{APP_NAME}+</Text>
          <Text style={styles.heroSub}>
            {active
              ? 'Your premium is active. Enjoy everything.'
              : 'Unlock the full Lumixo experience.'}
          </Text>
        </View>

        {(justUnlocked || (active && isActivating)) && (
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>✦</Text>
            <Text style={styles.successTitle}>
              {isActivating ? 'Activating Premium…' : `Welcome to ${APP_NAME}+`}
            </Text>
            <Text style={styles.successBody}>
              {isActivating
                ? 'Features are unlocking now. You can keep using the app.'
                : 'Premium features are unlocked across the app.'}
            </Text>
          </View>
        )}

        {!active && (
          <View style={styles.plans}>
            {PLAN_LIST.map((p) => {
              const on = plan === p.id;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.plan, on && styles.planOn]}
                  onPress={() => !checkoutBusy && setPlan(p.id)}
                  disabled={checkoutBusy}
                >
                  {!!p.badge && <Text style={styles.badge}>{p.badge}</Text>}
                  <Text style={styles.planLabel}>{p.label}</Text>
                  <Text style={styles.planPrice}>{formatInr(p.priceInr)}</Text>
                  <Text style={styles.planPer}>per {p.period}</Text>
                  {!!p.perMonthInr && (
                    <Text style={styles.planPerMonth}>≈ {formatInr(p.perMonthInr)}/mo</Text>
                  )}
                  <Ionicons
                    name={on ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={on ? colors.primary : colors.textFaint}
                    style={{ marginTop: 8 }}
                  />
                </Pressable>
              );
            })}
          </View>
        )}

        {active && subscription && !justUnlocked && (
          <View style={styles.memberCard}>
            <Text style={styles.memberPlan}>
              {subscription.plan === 'yearly' ? 'Yearly' : 'Monthly'} plan
            </Text>
            <Text style={styles.memberDate}>
              {subscription.cancel_at_period_end ? 'Ends ' : 'Renews '}
              {subscription.current_period_end
                ? new Date(subscription.current_period_end).toLocaleDateString()
                : '—'}
            </Text>
            {subscription.cancel_at_period_end && (
              <Text style={styles.memberCancels}>Cancels at period end.</Text>
            )}
          </View>
        )}

        {!!localError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{localError}</Text>
            {pendingOrderId ? (
              <Pressable
                style={styles.retryLink}
                onPress={() => {
                  setLocalError('');
                  void (async () => {
                    beginActivation(plan);
                    const st = await getRazorpayOrderStatus(supabase, pendingOrderId!);
                    if (st.subscriptionActive || st.recovered) {
                      await completeActivation();
                      setPendingOrderId(null);
                    } else {
                      failActivation(
                        st.error?.message ||
                          'Payment not confirmed yet. If you were charged, try again in a moment.',
                      );
                    }
                  })();
                }}
              >
                <Text style={styles.retryLinkText}>Check payment status</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {active ? (
          !subscription?.cancel_at_period_end ? (
            <Pressable style={styles.cancelBtn} onPress={cancel} disabled={checkoutBusy}>
              <Text style={styles.cancelText}>Cancel subscription</Text>
            </Pressable>
          ) : null
        ) : (
          <Pressable
            style={[
              styles.cta,
              (!paymentsReady || checkoutBusy || !configLoaded) && styles.ctaDisabled,
            ]}
            onPress={startCheckout}
            disabled={checkoutBusy || !paymentsReady || !configLoaded}
            accessibilityRole="button"
          >
            {checkoutPhase === 'creating_order' ? (
              <View style={styles.ctaBusy}>
                <ActivityIndicator color="#000" />
                <Text style={styles.ctaText}>Opening secure checkout…</Text>
              </View>
            ) : (
              <>
                <Text style={styles.ctaText}>
                  {paymentsReady
                    ? `Upgrade — ${formatInr(PLANS[plan].priceInr)}/${PLANS[plan].period}`
                    : configLoaded
                      ? `${APP_NAME}+ — Payments unavailable`
                      : 'Checking payments…'}
                </Text>
                <Text style={styles.ctaSub}>
                  {paymentsReady
                    ? 'Secure Razorpay · unlocks instantly after payment'
                    : 'Server billing is not configured yet'}
                </Text>
              </>
            )}
          </Pressable>
        )}

        <View style={styles.features}>
          {Object.entries(FEATURE_CATEGORIES).map(([cat, meta]) => {
            const items = PREMIUM_FEATURES.filter((f) => f.category === cat && f.status !== 'soon');
            if (!items.length) return null;
            return (
              <View key={cat} style={{ marginBottom: spacing(5) }}>
                <Text style={styles.catTitle}>
                  {meta.icon} {meta.label}
                </Text>
                {items.map((f) => (
                  <View key={f.key} style={styles.featureRow}>
                    <Text style={styles.featureIcon}>{f.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.featureTitle}>{f.title}</Text>
                      <Text style={styles.featureDesc}>{f.description}</Text>
                    </View>
                    {active ? (
                      <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                    ) : null}
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <RazorpayCheckoutModal
        visible={checkoutPhase === 'checkout' && !!checkoutParams}
        params={checkoutParams}
        onResult={onCheckoutResult}
      />
    </>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    hero: { alignItems: 'center', padding: spacing(8) },
    heroTitle: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: spacing(2) },
    heroSub: {
      color: colors.textMuted,
      fontSize: font.body,
      textAlign: 'center',
      marginTop: spacing(2),
    },
    plans: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing(3),
      paddingHorizontal: spacing(4),
    },
    plan: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing(4),
      alignItems: 'center',
      borderWidth: 2,
      borderColor: colors.border,
    },
    planOn: { borderColor: colors.primary },
    badge: {
      color: colors.accentPlusText,
      fontSize: font.tiny,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: 4,
    },
    planLabel: { color: colors.textMuted, fontSize: font.body },
    planPrice: { color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 4 },
    planPer: { color: colors.textMuted, fontSize: font.small },
    planPerMonth: { color: colors.primary, fontSize: font.tiny, marginTop: 2 },
    cta: {
      backgroundColor: colors.accentPlus,
      marginHorizontal: spacing(4),
      marginTop: spacing(5),
      borderRadius: radius.pill,
      paddingVertical: spacing(4),
      paddingHorizontal: spacing(4),
      alignItems: 'center',
    },
    ctaDisabled: { opacity: 0.55 },
    ctaBusy: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    ctaText: { color: '#000', fontSize: font.heading, fontWeight: '800', textAlign: 'center' },
    ctaSub: {
      color: 'rgba(0,0,0,0.65)',
      fontSize: font.tiny,
      marginTop: 6,
      textAlign: 'center',
      fontWeight: '600',
    },
    cancelBtn: { marginTop: spacing(4), alignItems: 'center' },
    cancelText: { color: colors.danger, fontSize: font.body },
    memberCard: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing(4),
      borderRadius: radius.md,
      paddingVertical: spacing(4),
      paddingHorizontal: spacing(4),
      alignItems: 'center',
    },
    memberPlan: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
    memberDate: { color: colors.textMuted, fontSize: font.small, marginTop: 4 },
    memberCancels: {
      color: colors.accentPlusText,
      fontSize: font.small,
      marginTop: 4,
      fontWeight: '600',
    },
    errorBox: {
      marginHorizontal: spacing(4),
      marginTop: spacing(4),
      backgroundColor: 'rgba(239,68,68,0.12)',
      borderRadius: radius.md,
      padding: spacing(3),
      borderWidth: 1,
      borderColor: 'rgba(239,68,68,0.35)',
    },
    errorText: { color: colors.danger, fontSize: font.small, lineHeight: 18, textAlign: 'center' },
    retryLink: { marginTop: spacing(2), alignItems: 'center' },
    retryLinkText: { color: colors.primary, fontSize: font.small, fontWeight: '700' },
    successCard: {
      marginHorizontal: spacing(4),
      marginBottom: spacing(4),
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing(5),
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.primary,
    },
    successEmoji: { fontSize: 32, marginBottom: spacing(2), color: colors.primary },
    successTitle: { color: colors.text, fontSize: font.title, fontWeight: '800' },
    successBody: {
      color: colors.textMuted,
      fontSize: font.body,
      textAlign: 'center',
      marginTop: spacing(2),
    },
    features: { padding: spacing(5), marginTop: spacing(4) },
    catTitle: {
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '700',
      marginBottom: spacing(2),
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: spacing(2),
    },
    featureIcon: { fontSize: 20, marginRight: spacing(3), width: 26, textAlign: 'center' },
    featureTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    featureDesc: { color: colors.textMuted, fontSize: font.small, marginTop: 1 },
  });
