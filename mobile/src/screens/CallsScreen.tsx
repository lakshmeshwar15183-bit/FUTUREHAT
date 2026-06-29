// FUTUREHAT mobile — Calls tab: call history with direction + type, newest first.
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { getCallHistory, getCurrentUser, getProfile } from '../lib/shared';
import type { Call, Profile } from '../lib/shared';
import { formatListTimestamp } from '../lib/time';
import { useColors, spacing, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';

interface Row {
  call: Call;
  peer: Profile | null;
  outgoing: boolean;
  missed: boolean;
}

export default function CallsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const me = await getCurrentUser(supabase);
    const calls = await getCallHistory(supabase, 100);
    const cache = new Map<string, Profile | null>();
    const built: Row[] = [];
    for (const call of calls) {
      const outgoing = call.caller_id === me?.id;
      // For 1:1 the "peer" of an outgoing call is unknown from the row alone;
      // we show the caller for incoming and a generic label for outgoing.
      const peerId = call.caller_id;
      if (!cache.has(peerId)) cache.set(peerId, await getProfile(supabase, peerId));
      built.push({
        call,
        peer: cache.get(peerId) ?? null,
        outgoing,
        missed: call.status === 'missed' || call.status === 'declined',
      });
    }
    setRows(built);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.call.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Avatar uri={item.peer?.avatar_url} name={item.peer?.display_name} size={48} />
            <View style={styles.body}>
              <Text style={[styles.name, item.missed && { color: colors.danger }]}>
                {item.peer?.display_name ?? 'FUTUREHAT user'}
              </Text>
              <View style={styles.meta}>
                <Ionicons
                  name={item.outgoing ? 'arrow-up-outline' : item.missed ? 'arrow-down-outline' : 'arrow-down-outline'}
                  size={14}
                  color={item.missed ? colors.danger : colors.primary}
                />
                <Text style={styles.metaText}>{formatListTimestamp(item.call.started_at)}</Text>
              </View>
            </View>
            <Ionicons name={item.call.type === 'video' ? 'videocam' : 'call'} size={22} color={colors.primary} />
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="call-outline" size={56} color={colors.textFaint} />
              <Text style={styles.emptyText}>No calls yet</Text>
              <Text style={styles.emptySub}>Start a voice or video call from any chat.</Text>
            </View>
          ) : null
        }
        contentContainerStyle={rows.length === 0 ? { flex: 1 } : undefined}
      />
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(2.5) },
    body: { flex: 1, marginLeft: spacing(3) },
    name: { color: colors.text, fontSize: font.heading, fontWeight: '500' },
    meta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    metaText: { color: colors.textMuted, fontSize: font.small, marginLeft: 4 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyText: { color: colors.text, fontSize: font.heading, fontWeight: '600', marginTop: spacing(3) },
    emptySub: { color: colors.textMuted, fontSize: font.small, marginTop: spacing(1) },
  });
