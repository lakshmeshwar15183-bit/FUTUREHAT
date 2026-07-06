// FUTUREHAT mobile — Hall of Legends. Legendary streak pairs (🏆, 730+). Server-
// authoritative eligibility (get_hall_of_legends), keyset pagination, offline cache,
// and loading / empty / error states.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { getHallOfLegends } from '../lib/shared';
import type { HallOfLegendsEntry } from '../lib/shared';
import { getCache, setCache } from '../lib/localCache';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';

const PAGE = 50;

export default function HallOfLegendsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [items, setItems] = useState<HallOfLegendsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);

  const loadFirst = useCallback(async () => {
    try {
      setError(false);
      const rows = await getHallOfLegends(supabase, { limit: PAGE });
      setItems(rows);
      setDone(rows.length < PAGE);
      setCache('hall_of_legends', rows).catch(() => {});
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const cached = await getCache<HallOfLegendsEntry[]>('hall_of_legends', []);
      if (alive && cached.length) { setItems(cached); setLoading(false); }
      loadFirst();
    })();
    return () => { alive = false; };
  }, [loadFirst]));

  const loadMore = useCallback(async () => {
    if (loadingMore || done || items.length === 0) return;
    setLoadingMore(true);
    try {
      const before = items[items.length - 1]?.achieved_at;
      const rows = await getHallOfLegends(supabase, { limit: PAGE, before });
      setItems((prev) => [...prev, ...rows]);
      if (rows.length < PAGE) setDone(true);
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore, done]);

  const renderItem = ({ item }: { item: HallOfLegendsEntry }) => (
    <View style={styles.row}>
      <View style={styles.pair}>
        <Avatar uri={item.user_a_avatar} name={item.user_a_name ?? '?'} size={40} />
        <Text style={styles.trophy} allowFontScaling={false}>🏆</Text>
        <Avatar uri={item.user_b_avatar} name={item.user_b_name ?? '?'} size={40} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.names} numberOfLines={1}>
          {(item.user_a_name ?? item.user_a_username ?? 'FUTUREHAT user')} & {(item.user_b_name ?? item.user_b_username ?? 'FUTUREHAT user')}
        </Text>
        <Text style={styles.sub}>
          Legends since {new Date(item.achieved_at).toLocaleDateString()} · now {item.current_score} {item.current_tier}
        </Text>
      </View>
    </View>
  );

  if (loading && items.length === 0) {
    return <View style={[styles.container, styles.center]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (error && items.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textFaint} />
        <Text style={styles.emptyTitle}>Couldn't load the Hall of Legends</Text>
        <Pressable onPress={loadFirst}><Text style={styles.retry}>Try again</Text></Pressable>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={items}
      keyExtractor={(x) => x.streak_id}
      renderItem={renderItem}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.headEmoji}>🏆</Text>
          <Text style={styles.headTitle}>Hall of Legends</Text>
          <Text style={styles.headSub}>Pairs who reached 730 — about two years of streak.</Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.headEmoji}>🏆</Text>
          <Text style={styles.emptyTitle}>No legends yet</Text>
          <Text style={styles.emptySub}>Be the first pair to reach 730.</Text>
        </View>
      }
      ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: spacing(4) }} color={colors.primary} /> : null}
      contentContainerStyle={items.length === 0 ? { flexGrow: 1, justifyContent: 'center' } : undefined}
    />
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { alignItems: 'center', justifyContent: 'center', padding: spacing(8) },
    header: { alignItems: 'center', paddingVertical: spacing(6) },
    headEmoji: { fontSize: 48 },
    headTitle: { color: colors.text, fontSize: font.title, fontWeight: '800', marginTop: spacing(2) },
    headSub: { color: colors.textMuted, fontSize: font.small, marginTop: spacing(1), textAlign: 'center', paddingHorizontal: spacing(6) },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3), backgroundColor: colors.surface, marginHorizontal: spacing(3), marginBottom: spacing(2), borderRadius: radius.md },
    pair: { flexDirection: 'row', alignItems: 'center' },
    trophy: { fontSize: 16, marginHorizontal: -6, zIndex: 1 },
    rowBody: { flex: 1, marginLeft: spacing(3) },
    names: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    sub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    emptyTitle: { color: colors.text, fontSize: font.heading, fontWeight: '600', marginTop: spacing(3) },
    emptySub: { color: colors.textMuted, fontSize: font.small, marginTop: spacing(2), textAlign: 'center' },
    retry: { color: colors.primary, fontSize: font.body, fontWeight: '600', marginTop: spacing(3) },
  });
