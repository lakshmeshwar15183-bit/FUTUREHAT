// FUTUREHAT mobile — user Mailbox. The official inbox surfacing user_warnings
// notifications (0017/0023): moderator appointment / removal + official warnings.
// Every user has one. Opening it marks everything seen. Mirrors web Mailbox.tsx.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { getMyMailbox, markAllMailboxSeen, WARNING_REASONS } from '../lib/shared';
import type { MailboxItem } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';

const REASON_LABEL: Record<string, string> =
  Object.fromEntries(WARNING_REASONS.map((r) => [r.value, r.label]));
const KIND_ICON: Record<string, string> = {
  warning: '⚠️', mod_appointed: '🛡️', mod_removed: '↩️', info: 'ℹ️',
};

function defaultTitle(kind: string): string {
  switch (kind) {
    case 'warning': return 'Official FUTUREHAT Warning';
    case 'mod_appointed': return 'You are now a FUTUREHAT Moderator';
    case 'mod_removed': return 'Moderator role removed';
    default: return 'FUTUREHAT notice';
  }
}

export default function MailboxScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<MailboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        setLoading(true);
        try {
          const rows = await getMyMailbox(supabase, 200);
          if (alive) { setItems(rows); setError(null); }
          await markAllMailboxSeen(supabase).catch(() => {});
        } catch (e: any) {
          if (alive) setError(e?.message ?? 'Could not load your mailbox.');
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => { alive = false; };
    }, []),
  );

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (error) return <View style={styles.center}><Text style={styles.warn}>{error}</Text></View>;

  return (
    <FlatList
      style={styles.container}
      data={items}
      keyExtractor={(m) => m.id}
      contentContainerStyle={styles.listPad}
      ListEmptyComponent={<Text style={styles.empty}>No messages yet. Official FUTUREHAT notices appear here.</Text>}
      renderItem={({ item: m }) => (
        <View style={[styles.item, m.kind === 'warning' && styles.itemWarning, !m.seen_at && styles.itemUnseen]}>
          <View style={styles.itemHead}>
            <Text style={styles.icon}>{KIND_ICON[m.kind] ?? 'ℹ️'}</Text>
            <Text style={styles.itemTitle}>{m.title || defaultTitle(m.kind)}</Text>
            {!m.seen_at && <View style={styles.unseenDot} />}
          </View>
          {m.reason ? <Text style={styles.reason}>{REASON_LABEL[m.reason] ?? m.reason}</Text> : null}
          {m.message ? <Text style={styles.body}>{m.message}</Text> : null}
          <Text style={styles.meta}>{new Date(m.created_at).toLocaleString()}</Text>
        </View>
      )}
    />
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing(6) },
    listPad: { padding: spacing(3), paddingBottom: spacing(10) },
    empty: { color: colors.textMuted, fontSize: font.small, textAlign: 'center', padding: spacing(8) },
    warn: { color: colors.danger, fontSize: font.small, textAlign: 'center' },
    item: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(3.5), marginBottom: spacing(2.5), borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    itemUnseen: { borderColor: colors.primary },
    itemWarning: { borderLeftWidth: 3, borderLeftColor: '#f59e0b' },
    itemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginBottom: spacing(1.5) },
    icon: { fontSize: 18 },
    itemTitle: { color: colors.text, fontSize: font.body, fontWeight: '700', flexShrink: 1 },
    unseenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginLeft: 'auto' },
    reason: { alignSelf: 'flex-start', color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.16)', fontSize: font.tiny, fontWeight: '700', textTransform: 'capitalize', paddingHorizontal: spacing(2), paddingVertical: 2, borderRadius: radius.pill, marginBottom: spacing(1.5), overflow: 'hidden' },
    body: { color: colors.text, fontSize: font.small, lineHeight: 20 },
    meta: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing(2) },
  });
