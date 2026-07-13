// Lumixo mobile — Lumixo+ premium plans + Razorpay checkout.
//
// P0 SECURITY: client never writes subscriptions. Flow:
//   1) Edge Function create_order (server amount)
//   2) Razorpay Checkout (public key_id only)
//   3) Edge Function verify (HMAC + Razorpay API) → admin_activate_subscription
//   4) Optional status/retry if network drops after pay
import React, { useCallback, useMemo, useState } from 'react';
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
  getSubscription,
  isSubscriptionActive,
  cancelSubscription,
  getServerPremium,
  PLAN_LIST,
  PLANS,
  formatInr,
  PREMIUM_FEATURES,
  FEATURE_CATEGORIES,
  type Subscription,
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
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME } from '../branding';
import { Alert } from '../ui/dialog';

type UiPhase =
  | 'idle'
  | 'checking'
  | 'creating_order'
  | 'checkout'
  | 'verifying'
  | 'success'
  | 'error';

export default function PremiumScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [sub, setSub] = useState<Subscription | null>(null);
  const [serverPremium, setServerPremium] = useState(false);
  const [plan, setPlan] = useState<PlanId>('yearly');
  const [paymentsReady, setPaymentsReady] = useState(false);
  const [phase, setPhase] = useState<UiPhase>('idle');
  const [error, setError] = useState('');
  const [checkoutParams, setCheckoutParams] = useState<RazorpayCheckoutParams | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [userMeta, setUserMeta] = useState<{ email?: string; name?: string }>({});

  const load = useCallback(async () => {
    setPhase((p) => (p === 'success' ? p : 'checking'));
    const [subscription, premium, auth, cfg] = await Promise.all([
      getSubscription(supabase),
      getServerPremium(supabase),
      supabase.auth.getUser(),
      getRazorpayConfig(supabase),
    ]);
    setSub(subscription);
    setServerPremium(premium);
    setPaymentsReady(!!cfg.config?.configured);
    const u = auth.data.user;
    setUserMeta({
      email: u?.email ?? undefined,
      name: (u?.user_metadata as any)?.display_name || u?.email || undefined,
    });
    setPhase((p) => (p === 'success' || p === 'checkout' || p === 'verifying' ? p : 'idle'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const active = isSubscriptionActive(sub) || serverPremium;
  const busy =
    phase === 'creating_order' ||
    phase === 'checkout' ||
    phase === 'verifying' ||
    phase === 'checking';

  async function ensureOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    if (state.isConnected === false) {
      setError('No internet connection. Connect and try again.');
      setPhase('error');
      return false;
    }
    return true;
  }

  async function startCheckout() {
    setError('');
    if (!paymentsReady) {
      Alert.alert(
        'Payments unavailable',
        'Secure Razorpay billing is not configured on the server yet. Please try again later.',
      );
      return;
    }
    if (!(await ensureOnline())) return;

    setPhase('creating_order');
    const { order, error: orderErr } = await createRazorpayOrder(supabase, plan);
    if (orderErr || !order) {
      setError(orderErr?.message || 'Could not start checkout. Please try again.');
      setPhase('error');
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
    setPhase('checkout');
  }

  async function onCheckoutResult(result: RazorpayCheckoutOutcome) {
    setCheckoutParams(null);

    if (result.type === 'cancelled') {
      // User may have paid then dismissed — recover via status if we have order id.
      if (pendingOrderId) {
        setPhase('verifying');
        const st = await getRazorpayOrderStatus(supabase, pendingOrderId);
        if (st.subscriptionActive || st.recovered) {
          await load();
          setPhase('success');
          setPendingOrderId(null);
          return;
        }
        // Unpaid dismiss → ledger cancelled (no-ops if already captured).
        await markRazorpayOrderCancelled(supabase, pendingOrderId);
      }
      setError('Payment cancelled.');
      setPhase('error');
      return;
    }

    if (result.type === 'failed') {
      setError(result.description || 'Payment failed. No charge was completed.');
      setPhase('error');
      return;
    }

    if (result.type === 'error') {
      setError(result.message || 'Checkout error. Please try again.');
      setPhase('error');
      return;
    }

    // success → server verify
    setPhase('verifying');
    setError('');
    const verified = await verifyRazorpayPayment(supabase, {
      razorpay_order_id: result.razorpay_order_id,
      razorpay_payment_id: result.razorpay_payment_id,
      razorpay_signature: result.razorpay_signature,
    });

    if (!verified.ok) {
      // Retry once via status recovery (webhook or paid order).
      if (pendingOrderId || result.razorpay_order_id) {
        const st = await getRazorpayOrderStatus(
          supabase,
          pendingOrderId || result.razorpay_order_id,
        );
        if (st.subscriptionActive || st.recovered) {
          await load();
          setPhase('success');
          setPendingOrderId(null);
          return;
        }
      }
      setError(verified.error || 'Payment verification failed. If you were charged, open this screen again or contact support.');
      setPhase('error');
      return;
    }

    setPendingOrderId(null);
    await load();
    setPhase('success');
  }

  async function cancel() {
    Alert.alert('Cancel subscription', 'You keep premium until the period ends. Continue?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel renewal',
        style: 'destructive',
        onPress: async () => {
          setPhase('checking');
          const { error: cancelErr } = await cancelSubscription(supabase);
          if (cancelErr) {
            setError(cancelErr.message || 'Could not cancel subscription');
            setPhase('error');
            return;
          }
          await load();
          setPhase('idle');
        },
      },
    ]);
  }

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: spacing(10) }}>
        <View style={styles.hero}>
          <Ionicons name="diamond" size={48} color={colors.accentPlusText} />
          <Text style={styles.heroTitle}>{APP_NAME}+</Text>
          <Text style={styles.heroSub}>
            {phase === 'success' || active
              ? 'Your premium is active. Enjoy everything.'
              : 'Unlock the full Lumixo experience.'}
          </Text>
        </View>

        {phase === 'success' && (
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>🎉</Text>
            <Text style={styles.successTitle}>Welcome to {APP_NAME}+</Text>
            <Text style={styles.successBody}>Your premium features are now unlocked.</Text>
          </View>
        )}

        {!active && phase !== 'success' && (
          <View style={styles.plans}>
            {PLAN_LIST.map((p) => {
              const on = plan === p.id;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.plan, on && styles.planOn]}
                  onPress={() => !busy && setPlan(p.id)}
                  disabled={busy}
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

        {active && sub && phase !== 'success' && (
          <View style={styles.memberCard}>
            <Text style={styles.memberPlan}>
              {sub.plan === 'yearly' ? 'Yearly' : 'Monthly'} plan
            </Text>
            <Text style={styles.memberDate}>
              {sub.cancel_at_period_end ? 'Ends ' : 'Renews '}
              {sub.current_period_end
                ? new Date(sub.current_period_end).toLocaleDateString()
                : '—'}
            </Text>
            {sub.cancel_at_period_end && (
              <Text style={styles.memberCancels}>Cancels at period end.</Text>
            )}
          </View>
        )}

        {!!error && phase !== 'success' && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            {pendingOrderId ? (
              <Pressable
                style={styles.retryLink}
                onPress={async () => {
                  setPhase('verifying');
                  const st = await getRazorpayOrderStatus(supabase, pendingOrderId);
                  if (st.subscriptionActive || st.recovered) {
                    await load();
                    setPhase('success');
                    setPendingOrderId(null);
                    setError('');
                  } else {
                    setError(
                      st.error?.message ||
                        'Payment not confirmed yet. If you were charged, wait a moment and retry.',
                    );
                    setPhase('error');
                  }
                }}
              >
                <Text style={styles.retryLinkText}>Check payment status</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {active && phase !== 'success' ? (
          !sub?.cancel_at_period_end ? (
            <Pressable style={styles.cancelBtn} onPress={cancel} disabled={busy}>
              <Text style={styles.cancelText}>Cancel subscription</Text>
            </Pressable>
          ) : null
        ) : phase !== 'success' ? (
          <Pressable
            style={[styles.cta, (!paymentsReady || busy) && styles.ctaDisabled]}
            onPress={startCheckout}
            disabled={busy || !paymentsReady}
            accessibilityRole="button"
          >
            {busy ? (
              <View style={styles.ctaBusy}>
                <ActivityIndicator color="#000" />
                <Text style={styles.ctaText}>
                  {phase === 'creating_order'
                    ? 'Starting secure checkout…'
                    : phase === 'verifying'
                      ? 'Verifying payment…'
                      : phase === 'checkout'
                        ? 'Waiting for payment…'
                        : 'Loading…'}
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.ctaText}>
                  {paymentsReady
                    ? `Upgrade — ${formatInr(PLANS[plan].priceInr)}/${PLANS[plan].period}`
                    : `${APP_NAME}+ — Payments unavailable`}
                </Text>
                <Text style={styles.ctaSub}>
                  {paymentsReady
                    ? 'Secure payment via Razorpay · premium only after verification'
                    : 'Server billing is not configured yet'}
                </Text>
              </>
            )}
          </Pressable>
        ) : null}

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
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <RazorpayCheckoutModal
        visible={phase === 'checkout' && !!checkoutParams}
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
    successEmoji: { fontSize: 40, marginBottom: spacing(2) },
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
