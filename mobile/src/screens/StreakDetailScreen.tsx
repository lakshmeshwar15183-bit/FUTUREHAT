// Lumixo mobile — one pair's streak detail: big tier emoji, score, progress to
// the next tier, milestone history, and the recent score-change ledger (Streak
// History). Server-authoritative reads via get_streak(). Loading/empty/error.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { getStreak, nextTier, tierForScore } from '../lib/shared';
import type { StreakDetail } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type R = RouteProp<RootStackParamList, 'StreakDetail'>;

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'daily_award': return 'Daily streak completed';
    case 'missed_penalty': return 'Missed day penalty';
    case 'milestone': return 'Milestone';
    default: return reason;
  }
}

export default function StreakDetailScreen() {
  const route = useRoute<R>();
  const { conversationId } = route.params;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [data, setData] = useState<StreakDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const d = await getStreak(supabase, conversationId);
      setData(d);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const score = data?.streak?.score ?? 0;
  const tier = tierForScore(score);
  const next = nextTier(score);
  const pct = next && next.max !== Infinity
    ? Math.min(1, Math.max(0, (score - (tier?.min ?? 0)) / ((next.min) - (tier?.min ?? 0))))
    : 1;

  if (loading && !data) {
    return <View style={[styles.container, styles.center]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (error && !data) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textFaint} />
        <Text style={styles.muted}>Couldn't load this streak.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.heroEmoji} allowFontScaling={false}>{tier?.emoji ?? '🎏'}</Text>
        <Text style={styles.heroScore}>{score}</Text>
        <Text style={styles.heroTier}>{tier?.label ?? 'No streak yet'}</Text>
        <Text style={styles.heroDays}>{data?.streak?.successful_days ?? 0} successful days</Text>

        {next && (
          <View style={styles.progressWrap}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
            </View>
            <Text style={styles.progressLabel}>
              {next.max === Infinity ? 'Top tier reached 🏆' : `${next.min - score} to ${next.emoji} ${next.label}`}
            </Text>
          </View>
        )}
      </View>

      {(data?.milestones?.length ?? 0) > 0 && (
        <>
          <Text style={styles.sectionHead}>MILESTONES</Text>
          <View style={styles.group}>
            {data!.milestones.map((m, i) => (
              <View key={i} style={styles.mrow}>
                <Text style={styles.mIcon}>
                  {m.kind === 'diamond' ? '💎' : m.kind === 'hall_of_legends' ? '🏆' : '🛡'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mTitle}>
                    {m.kind === 'diamond' ? 'Diamond — 1 month Lumixo+'
                      : m.kind === 'hall_of_legends' ? 'Hall of Legends'
                      : 'Moderator milestone'}
                  </Text>
                  <Text style={styles.mSub}>
                    Reached at {m.achieved_score} · {new Date(m.achieved_at).toLocaleDateString()}
                    {m.reward_granted ? ' · reward granted' : ''}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionHead}>STREAK HISTORY</Text>
      {(data?.events?.length ?? 0) === 0 ? (
        <View style={styles.group}><Text style={styles.emptyRow}>No history yet.</Text></View>
      ) : (
        <View style={styles.group}>
          {data!.events.map((e, i) => (
            <View key={i} style={styles.erow}>
              <Text style={[styles.eDelta, { color: e.delta >= 0 ? colors.primary : colors.danger }]}>
                {e.delta >= 0 ? `+${e.delta}` : e.delta}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.eReason}>{reasonLabel(e.reason)}</Text>
                <Text style={styles.eMeta}>{e.day ?? new Date(e.created_at).toLocaleDateString()} · {e.old_score} → {e.new_score}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
      <View style={{ height: spacing(8) }} />
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { alignItems: 'center', justifyContent: 'center' },
    muted: { color: colors.textMuted, marginTop: spacing(3) },
    hero: { alignItems: 'center', paddingVertical: spacing(7), backgroundColor: colors.surface, marginBottom: spacing(1) },
    heroEmoji: { fontSize: 64 },
    heroScore: { color: colors.text, fontSize: 44, fontWeight: '800', marginTop: spacing(2) },
    heroTier: { color: colors.text, fontSize: font.heading, fontWeight: '600', marginTop: 2 },
    heroDays: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    progressWrap: { width: '80%', marginTop: spacing(5) },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
    progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
    progressLabel: { color: colors.textMuted, fontSize: font.tiny, textAlign: 'center', marginTop: spacing(2) },
    sectionHead: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: spacing(5), paddingTop: spacing(5), paddingBottom: spacing(2) },
    group: { backgroundColor: colors.surface, marginHorizontal: spacing(3), borderRadius: radius.md, overflow: 'hidden' },
    mrow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
    mIcon: { fontSize: 24, marginRight: spacing(3) },
    mTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    mSub: { color: colors.textMuted, fontSize: font.small, marginTop: 1 },
    erow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    eDelta: { fontSize: font.heading, fontWeight: '800', width: 44 },
    eReason: { color: colors.text, fontSize: font.body },
    eMeta: { color: colors.textMuted, fontSize: font.tiny, marginTop: 1 },
    emptyRow: { color: colors.textMuted, fontSize: font.small, padding: spacing(4) },
  });
