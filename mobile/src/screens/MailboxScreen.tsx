// Lumixo mobile — user Mailbox. The official inbox surfacing user_warnings
// notifications (0017/0023): moderator appointment / removal, official warnings,
// and once-per-lifetime streak milestone rewards (Diamond / Hall of Legends).
// Everyday streak +1 / tier / penalty events are silent (0032) — this screen
// stays a clean, WhatsApp/Telegram-style inbox instead of a debug log.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import SafeFlatList from '../ui/SafeFlatList';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { getMyMailbox, markAllMailboxSeen, WARNING_REASONS } from '../lib/shared';
import type { MailboxItem } from '../lib/shared';
import { formatListTimestamp } from '../lib/time';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { LumixoCat } from '../components/LumixoCat';

const REASON_LABEL: Record<string, string> =
  Object.fromEntries(WARNING_REASONS.map((r) => [r.value, r.label]));

// Visual category for a mailbox entry — icon + tint. Chosen from `kind` and,
// for `info`, the title so milestone rewards get their proper flair without
// requiring a new column. Everything else falls back to the neutral bell.
type Visual = { icon: keyof typeof Ionicons.glyphMap; tint: string; bg: string };
function visualFor(item: MailboxItem, colors: Palette): Visual {
  const title = (item.title ?? '').toLowerCase();
  if (item.kind === 'warning') {
    return { icon: 'warning', tint: '#f59e0b', bg: 'rgba(245,158,11,0.14)' };
  }
  if (item.kind === 'mod_appointed') {
    return { icon: 'shield-checkmark', tint: '#10b981', bg: 'rgba(16,185,129,0.16)' };
  }
  if (item.kind === 'mod_removed') {
    return { icon: 'shield-outline', tint: colors.textMuted, bg: colors.surfaceAlt };
  }
  if (title.includes('diamond')) return { icon: 'diamond', tint: '#60a5fa', bg: 'rgba(96,165,250,0.16)' };
  if (title.includes('hall of legends')) return { icon: 'trophy', tint: '#f5b800', bg: 'rgba(245,184,0,0.16)' };
  if (title.includes('premium')) return { icon: 'star', tint: '#f5b800', bg: 'rgba(245,184,0,0.16)' };
  if (title.includes('security') || title.includes('login') || title.includes('device') || title.includes('password') || title.includes('email')) {
    return { icon: 'lock-closed', tint: '#ef4444', bg: 'rgba(239,68,68,0.14)' };
  }
  if (title.includes('friend')) return { icon: 'person-add', tint: colors.primary, bg: colors.primary + '22' };
  if (title.includes('community') || title.includes('invit')) {
    return { icon: 'people', tint: colors.primary, bg: colors.primary + '22' };
  }
  if (title.includes('report')) return { icon: 'flag', tint: '#f59e0b', bg: 'rgba(245,158,11,0.14)' };
  if (title.includes('update')) return { icon: 'sparkles', tint: colors.primary, bg: colors.primary + '22' };
  return { icon: 'notifications', tint: colors.primary, bg: colors.primary + '22' };
}

function defaultTitle(kind: string): string {
  switch (kind) {
    case 'warning': return 'Official Lumixo Warning';
    case 'mod_appointed': return 'You are now a Lumixo Moderator';
    case 'mod_removed': return 'Moderator role removed';
    default: return 'Lumixo notice';
  }
}

export default function MailboxScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<MailboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const rows = await getMyMailbox(supabase, 200);
      setItems(rows);
      setError(null);
      await markAllMailboxSeen(supabase).catch(() => {});
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your mailbox.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      load().catch(() => {});
      return () => { alive = false; };
    }, [load]),
  );

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (error) return <View style={styles.center}><Text style={styles.warn}>{error}</Text></View>;

  return (
    <SafeFlatList
      style={styles.container}
      data={items}
      keyExtractor={(m) => m.id}
      contentContainerStyle={items.length === 0 ? styles.flexGrow : styles.listPad}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load({ silent: true }); }}
          tintColor={colors.primary}
        />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <View style={styles.emptyIconWrap}>
            <LumixoCat mood="sleeping" size="md" decorative />
          </View>
          <Text style={styles.emptyTitle}>No new notifications</Text>
          <Text style={styles.emptySub}>
            Friend requests, community invites, security alerts, and official Lumixo
            notices appear here.
          </Text>
        </View>
      }
      renderItem={({ item: m }) => {
        const v = visualFor(m, colors);
        const unseen = !m.seen_at;
        return (
          <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
            <View style={[styles.iconWrap, { backgroundColor: v.bg }]}>
              <Ionicons name={v.icon} size={22} color={v.tint} />
            </View>
            <View style={styles.body}>
              <View style={styles.topLine}>
                <Text style={[styles.title, unseen && styles.titleUnseen]} numberOfLines={1}>
                  {m.title || defaultTitle(m.kind)}
                </Text>
                <Text style={[styles.time, unseen && styles.timeUnseen]}>
                  {formatListTimestamp(m.created_at)}
                </Text>
              </View>
              {m.reason ? (
                <Text style={styles.reason}>{REASON_LABEL[m.reason] ?? m.reason}</Text>
              ) : null}
              {m.message ? (
                <Text style={styles.message} numberOfLines={2}>{m.message}</Text>
              ) : null}
            </View>
            {unseen && <View style={styles.unseenDot} />}
          </Pressable>
        );
      }}
    />
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing(6) },
    flexGrow: { flexGrow: 1 },
    listPad: { paddingTop: spacing(1), paddingBottom: spacing(10) },
    warn: { color: colors.danger, fontSize: font.small, textAlign: 'center' },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(2.75),
      backgroundColor: colors.bg,
    },
    rowPressed: { backgroundColor: colors.surface },
    iconWrap: {
      width: 48, height: 48, borderRadius: 24,
      alignItems: 'center', justifyContent: 'center',
    },
    body: { flex: 1, marginLeft: spacing(3) },
    topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: colors.text, fontSize: font.heading, fontWeight: '500', flex: 1 },
    titleUnseen: { fontWeight: '700' },
    time: { color: colors.textFaint, fontSize: font.tiny, marginLeft: spacing(2) },
    timeUnseen: { color: colors.primary, fontWeight: '700' },
    reason: {
      alignSelf: 'flex-start',
      color: '#f59e0b',
      backgroundColor: 'rgba(245,158,11,0.16)',
      fontSize: font.tiny,
      fontWeight: '700',
      textTransform: 'capitalize',
      paddingHorizontal: spacing(2),
      paddingVertical: 2,
      borderRadius: radius.pill,
      marginTop: spacing(1),
      overflow: 'hidden',
    },
    message: { color: colors.textMuted, fontSize: font.small, marginTop: spacing(0.5), lineHeight: 18 },
    unseenDot: {
      width: 8, height: 8, borderRadius: 4,
      backgroundColor: colors.primary, marginLeft: spacing(2),
    },
    sep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: spacing(4) + 48 + spacing(3),
    },

    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(8) },
    emptyIconWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing(2),
    },
    emptyTitle: { color: colors.text, fontSize: font.heading, fontWeight: '600' },
    emptySub: {
      color: colors.textMuted,
      fontSize: font.small,
      textAlign: 'center',
      marginTop: spacing(2),
      lineHeight: 20,
      maxWidth: 300,
    },
  });
