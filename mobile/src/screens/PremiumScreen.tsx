// FUTUREHAT mobile — FUTUREHAT+ premium. Shows plans + feature list and
// activates a subscription. Reuses the shared premium API and presets.
//
// NOTE: like the web app, in-app purchase billing (Google Play Billing) is not
// wired yet — activation here records a subscription via the shared API for
// testing. Real Play Billing / "restore purchases" lands before public release.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

export default function PremiumScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [sub, setSub] = useState<Subscription | null>(null);
  const [plan, setPlan] = useState<PlanId>('yearly');
  const [busy, setBusy] = useState(false);

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
        <Ionicons name="diamond" size={48} color={colors.accentPlus} />
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

      {active ? (
        <Pressable style={styles.cancelBtn} onPress={cancel}>
          <Text style={styles.cancelText}>Cancel renewal</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.cta} onPress={activate} disabled={busy}>
          {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.ctaText}>Get {APP_NAME}+</Text>}
        </Pressable>
      )}

      <Text style={styles.restore}>Restore purchases (available with Play Billing).</Text>

      <View style={styles.features}>
        {Object.entries(FEATURE_CATEGORIES).map(([cat, meta]) => {
          const items = PREMIUM_FEATURES.filter((f) => f.category === cat);
          if (!items.length) return null;
          return (
            <View key={cat} style={{ marginBottom: spacing(5) }}>
              <Text style={styles.catTitle}>{meta.icon} {meta.label}</Text>
              {items.map((f) => (
                <View key={f.key} style={styles.featureRow}>
                  <Text style={styles.featureIcon}>{f.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.featureTitle}>
                      {f.title} {f.status === 'soon' && <Text style={styles.soon}>· soon</Text>}
                    </Text>
                    <Text style={styles.featureDesc}>{f.description}</Text>
                  </View>
                </View>
              ))}
            </View>
          );
        })}
      </View>
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
    badge: { color: colors.accentPlus, fontSize: font.tiny, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
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
    restore: { color: colors.textFaint, fontSize: font.small, textAlign: 'center', marginTop: spacing(3) },
    features: { padding: spacing(5), marginTop: spacing(4) },
    catTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: spacing(2) },
    featureRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing(2) },
    featureIcon: { fontSize: 20, marginRight: spacing(3), width: 26, textAlign: 'center' },
    featureTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    soon: { color: colors.accentPlus, fontSize: font.tiny, fontWeight: '700' },
    featureDesc: { color: colors.textMuted, fontSize: font.small, marginTop: 1 },
  });
