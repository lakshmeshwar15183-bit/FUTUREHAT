// FUTUREHAT mobile — FUTUREHAT+ premium. Shows plans + feature list and
// activates a subscription. Reuses the shared premium API and presets.
//
// NOTE: like the web app, in-app purchase billing (Google Play Billing) is not
// wired yet — activation here records a subscription via the shared API for
// testing. Real Play Billing / "restore purchases" lands before public release.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import {
  getSubscription,
  isSubscriptionActive,
  activateSubscription,
  cancelSubscription,
  PLAN_LIST,
  formatInr,
  PREMIUM_FEATURES,
  FEATURE_CATEGORIES,
  type Subscription,
  type PlanId,
} from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME } from '../branding';

// Purchases are gated until a payment gateway (Razorpay / Google Play Billing) is
// wired. Flip to true once it's integrated and the real activate() flow takes over.
const PAYMENTS_READY = false;

export default function PremiumScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [sub, setSub] = useState<Subscription | null>(null);
  const [plan, setPlan] = useState<PlanId>('yearly');
  const [busy, setBusy] = useState(false);
  const [showSoon, setShowSoon] = useState(false);

  const load = useCallback(async () => {
    setSub(await getSubscription(supabase));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const active = isSubscriptionActive(sub);

  async function activate() {
    setBusy(true);
    const { error } = await activateSubscription(supabase, plan, {
      provider: 'manual',
      providerSubscriptionId: null,
      providerCustomerId: null,
    } as any);
    setBusy(false);
    if (error) {
      Alert.alert('Could not activate', error.message);
      return;
    }
    Alert.alert('Welcome to FUTUREHAT+', 'Premium features are now unlocked.');
    load();
  }

  async function cancel() {
    Alert.alert('Cancel subscription', 'You keep premium until the period ends. Continue?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel renewal',
        style: 'destructive',
        onPress: async () => {
          await cancelSubscription(supabase);
          load();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: spacing(10) }}>
      <View style={styles.hero}>
        <Ionicons name="diamond" size={48} color={colors.accentPlusText} />
        <Text style={styles.heroTitle}>{APP_NAME}+</Text>
        <Text style={styles.heroSub}>
          {active ? 'Your premium is active. Enjoy everything.' : 'Unlock the full FUTUREHAT experience.'}
        </Text>
      </View>

      {!active && (
        <View style={styles.plans}>
          {PLAN_LIST.map((p) => {
            const on = plan === p.id;
            return (
              <Pressable key={p.id} style={[styles.plan, on && styles.planOn]} onPress={() => setPlan(p.id)}>
                {!!p.badge && <Text style={styles.badge}>{p.badge}</Text>}
                <Text style={styles.planLabel}>{p.label}</Text>
                <Text style={styles.planPrice}>{formatInr(p.priceInr)}</Text>
                <Text style={styles.planPer}>per {p.period}</Text>
                {!!p.perMonthInr && <Text style={styles.planPerMonth}>≈ {formatInr(p.perMonthInr)}/mo</Text>}
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

      {active && sub && (
        <View style={styles.memberCard}>
          <Text style={styles.memberPlan}>
            {sub.plan === 'yearly' ? 'Yearly' : 'Monthly'} plan
          </Text>
          <Text style={styles.memberDate}>
            {sub.cancel_at_period_end ? 'Ends ' : 'Renews '}
            {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : '—'}
          </Text>
          {sub.cancel_at_period_end && <Text style={styles.memberCancels}>Cancels at period end.</Text>}
        </View>
      )}

      {active ? (
        // Once the subscription is set to cancel, there's nothing left to cancel
        // (mirrors web hiding the Cancel button when cancel_at_period_end).
        !sub?.cancel_at_period_end ? (
          <Pressable style={styles.cancelBtn} onPress={cancel}>
            <Text style={styles.cancelText}>Cancel subscription</Text>
          </Pressable>
        ) : null
      ) : PAYMENTS_READY ? (
        <Pressable style={styles.cta} onPress={activate} disabled={busy}>
          {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.ctaText}>Get {APP_NAME}+</Text>}
        </Pressable>
      ) : (
        <Pressable style={styles.cta} onPress={() => setShowSoon(true)}>
          <Text style={styles.ctaText}>Get {APP_NAME}+</Text>
          <View style={styles.soonPill}><Text style={styles.soonPillText}>🟡 Available soon</Text></View>
        </Pressable>
      )}

      <View style={styles.features}>
        {Object.entries(FEATURE_CATEGORIES).map(([cat, meta]) => {
          // Only advertise features that actually work today — no "soon" items.
          const items = PREMIUM_FEATURES.filter((f) => f.category === cat && f.status !== 'soon');
          if (!items.length) return null;
          return (
            <View key={cat} style={{ marginBottom: spacing(5) }}>
              <Text style={styles.catTitle}>{meta.icon} {meta.label}</Text>
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

      <Modal visible={showSoon} transparent animationType="slide" onRequestClose={() => setShowSoon(false)}>
        <Pressable style={styles.soonBackdrop} onPress={() => setShowSoon(false)}>
          <Pressable style={styles.soonSheet} onPress={() => {}}>
            <View style={styles.soonHandle} />
            <Text style={styles.soonEmoji}>🟡</Text>
            <Text style={styles.soonTitle}>Available soon</Text>
            <Text style={styles.soonBody}>
              Premium subscriptions will be available in a future update once secure payment integration is completed.
            </Text>
            <Pressable style={styles.soonBtn} onPress={() => setShowSoon(false)}>
              <Text style={styles.soonBtnText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    hero: { alignItems: 'center', padding: spacing(8) },
    heroTitle: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: spacing(2) },
    heroSub: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', marginTop: spacing(2) },
    plans: { flexDirection: 'row', justifyContent: 'center', gap: spacing(3), paddingHorizontal: spacing(4) },
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
    badge: { color: colors.accentPlusText, fontSize: font.tiny, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
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
      alignItems: 'center',
    },
    ctaText: { color: '#000', fontSize: font.heading, fontWeight: '800' },
    cancelBtn: { marginTop: spacing(4), alignItems: 'center' },
    cancelText: { color: colors.danger, fontSize: font.body },
    memberCard: {
      backgroundColor: colors.surface, marginHorizontal: spacing(4), borderRadius: radius.md,
      paddingVertical: spacing(4), paddingHorizontal: spacing(4), alignItems: 'center',
    },
    memberPlan: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
    memberDate: { color: colors.textMuted, fontSize: font.small, marginTop: 4 },
    memberCancels: { color: colors.accentPlusText, fontSize: font.small, marginTop: 4, fontWeight: '600' },
    restore: { color: colors.textFaint, fontSize: font.small, textAlign: 'center', marginTop: spacing(3) },
    features: { padding: spacing(5), marginTop: spacing(4) },
    catTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: spacing(2) },
    featureRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing(2) },
    featureIcon: { fontSize: 20, marginRight: spacing(3), width: 26, textAlign: 'center' },
    featureTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    soon: { color: colors.accentPlusText, fontSize: font.tiny, fontWeight: '700' },
    featureDesc: { color: colors.textMuted, fontSize: font.small, marginTop: 1 },
    soonPill: { marginTop: 6, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: radius.pill, paddingHorizontal: spacing(3), paddingVertical: 2 },
    soonPillText: { color: '#000', fontSize: font.tiny, fontWeight: '700' },
    soonBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    soonSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
      padding: spacing(6), alignItems: 'center',
    },
    soonHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing(4) },
    soonEmoji: { fontSize: 40, marginBottom: spacing(2) },
    soonTitle: { color: colors.text, fontSize: font.title, fontWeight: '800', marginBottom: spacing(2) },
    soonBody: { color: colors.textMuted, fontSize: font.body, lineHeight: 22, textAlign: 'center', marginBottom: spacing(5) },
    soonBtn: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: spacing(3.5), paddingHorizontal: spacing(10) },
    soonBtnText: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
  });
