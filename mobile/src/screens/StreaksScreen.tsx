// Lumixo mobile — Settings › Streaks hub. Lists the user's active relationship
// streaks (server-authoritative score → tier emoji), links to per-pair detail, the
// info pages, and Hall of Legends. Offline-first: hydrates from local cache, then
// refreshes in the background. Loading / empty / error states included.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { getCurrentUser, getMyStreaks, processMyStreaks, subscribeStreakChanges } from '../lib/shared';
import type { StreakSummary } from '../lib/shared';
import { getCache, setCache } from '../lib/localCache';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import { LumixoCat } from '../components/LumixoCat';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function StreaksScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [uid, setUid] = useState<string | null>(null);
  const [items, setItems] = useState<StreakSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (background = false) => {
    try {
      if (!background) setError(false);
      await processMyStreaks(supabase).catch(() => 0);
      const list = await getMyStreaks(supabase);
      setItems(list);
      const u = await getCurrentUser(supabase).catch(() => null);
      if (u?.id) setCache(`streaks:${u.id}`, list).catch(() => {});
    } catch {
      if (!background) setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const u = await getCurrentUser(supabase).catch(() => null);
        const id = u?.id ?? null;
        if (!alive) return;
        setUid(id);
        if (id) {
          const cached = await getCache<StreakSummary[]>(`streaks:${id}`, []);
          if (alive && cached.length) { setItems(cached); setLoading(false); }
        }
        load(true);
      })();
      return () => { alive = false; };
    }, [load]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      const sub = subscribeStreakChanges(supabase, () => load(true));
      return () => sub.unsubscribe();
    }, [uid, load]),
  );

  const sorted = useMemo(() => [...items].sort((a, b) => b.score - a.score), [items]);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      {/* Learn / navigation cards */}
      <View style={styles.hubGroup}>
        <HubRow icon="information-circle-outline" label="How streaks work" onPress={() => navigation.navigate('StreakInfo', { page: 'how' })} colors={colors} />
        <HubRow icon="flame-outline" label="Qualifying activities" onPress={() => navigation.navigate('StreakInfo', { page: 'qualifying' })} colors={colors} />
        <HubRow icon="ribbon-outline" label="Streak levels" onPress={() => navigation.navigate('StreakInfo', { page: 'levels' })} colors={colors} />
        <HubRow icon="gift-outline" label="Rewards" onPress={() => navigation.navigate('StreakInfo', { page: 'rewards' })} colors={colors} />
        <HubRow icon="trending-down-outline" label="Penalties & demotions" onPress={() => navigation.navigate('StreakInfo', { page: 'penalties' })} colors={colors} />
        <HubRow icon="shield-checkmark-outline" label="Restrictions & anti-abuse" onPress={() => navigation.navigate('StreakInfo', { page: 'restrictions' })} colors={colors} />
        <HubRow icon="hammer-outline" label="Moderator selection" onPress={() => navigation.navigate('StreakInfo', { page: 'moderator' })} colors={colors} />
        <HubRow icon="trophy-outline" label="Hall of Legends" onPress={() => navigation.navigate('HallOfLegends')} colors={colors} />
      </View>

      <Text style={styles.sectionHead}>YOUR STREAKS</Text>

      {loading && items.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error && items.length === 0 ? (
        <View style={styles.center}>
          <LumixoCat mood="sad" size="md" decorative />
          <Text style={styles.emptyTitle}>Couldn't load streaks</Text>
          <Text style={styles.emptySub}>Pull to refresh to try again.</Text>
        </View>
      ) : sorted.length === 0 ? (
        <View style={styles.center}>
          <LumixoCat mood="sleeping" size="md" decorative />
          <Text style={styles.emptyTitle}>No streaks yet</Text>
          <Text style={styles.emptySub}>
            Message a friend every day — when you BOTH qualify, your streak starts climbing.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {sorted.map((s) => (
            <Pressable
              key={s.streak_id}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
              onPress={() => navigation.navigate('StreakDetail', {
                conversationId: s.conversation_id,
                title: s.peer_name ?? (s.peer_username ? `@${s.peer_username}` : 'Streak'),
              })}
            >
              <Avatar uri={s.peer_avatar} name={s.peer_name ?? s.peer_username ?? '?'} size={46} />
              <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {s.peer_name ?? (s.peer_username ? `@${s.peer_username}` : 'Lumixo user')}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {s.completed_today
                    ? 'Completed today ✓'
                    : s.i_qualified_today
                    ? 'Waiting on them today…'
                    : s.peer_qualified_today
                    ? 'They’re waiting on you today'
                    : `${s.successful_days} successful day${s.successful_days === 1 ? '' : 's'}`}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowEmoji} allowFontScaling={false}>{s.tier}</Text>
                <Text style={styles.rowScore}>{s.score}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <View style={{ height: spacing(8) }} />
    </ScrollView>
  );
}

function HubRow({ icon, label, onPress, colors }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; colors: Palette;
}) {
  return (
    <Pressable
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3.5) }, pressed && { backgroundColor: colors.surfaceAlt }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={colors.textMuted} />
      <Text style={{ flex: 1, color: colors.text, fontSize: font.body, marginLeft: spacing(4) }}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    hubGroup: { backgroundColor: colors.surface, marginTop: spacing(3), borderRadius: radius.md, marginHorizontal: spacing(3), overflow: 'hidden' },
    sectionHead: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: spacing(5), paddingTop: spacing(5), paddingBottom: spacing(2) },
    list: { backgroundColor: colors.surface, marginHorizontal: spacing(3), borderRadius: radius.md, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
    rowBody: { flex: 1, marginLeft: spacing(3) },
    rowName: { color: colors.text, fontSize: font.heading, fontWeight: '600' },
    rowSub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    rowRight: { alignItems: 'center', marginLeft: spacing(2) },
    rowEmoji: { fontSize: 22 },
    rowScore: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', marginTop: 2 },
    center: { alignItems: 'center', justifyContent: 'center', padding: spacing(8) },
    bigEmoji: { fontSize: 48, marginBottom: spacing(3) },
    emptyTitle: { color: colors.text, fontSize: font.heading, fontWeight: '600', marginTop: spacing(3) },
    emptySub: { color: colors.textMuted, fontSize: font.small, textAlign: 'center', marginTop: spacing(2) },
  });
