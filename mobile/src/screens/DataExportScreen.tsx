// FUTUREHAT mobile — Export my data. Gathers the user's own data via shared APIs
// and writes a JSON file, then opens the native share sheet. Standalone.
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { supabase } from '../lib/supabase';
import {
  getMyProfile, getMyConversations, getMessages,
  getPreferences, getSubscription, getMyTickets, getBlockedIds, getMutedIds, getMyCommunities,
} from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_VERSION, CREDIT } from '../branding';

export default function DataExportScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [includeMessages, setIncludeMessages] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  async function exportData() {
    setBusy(true); setStatus('Gathering your data…');
    try {
      const [profile, conversations, preferences, subscription, tickets, blocked, muted, communities] = await Promise.all([
        getMyProfile(supabase).catch(() => null),
        getMyConversations(supabase).catch(() => []),
        getPreferences(supabase).catch(() => null),
        getSubscription(supabase).catch(() => null),
        getMyTickets(supabase).catch(() => []),
        getBlockedIds(supabase).catch(() => []),
        getMutedIds(supabase).catch(() => []),
        getMyCommunities(supabase).catch(() => []),
      ]);
      let messages: Record<string, unknown[]> | undefined;
      if (includeMessages) {
        setStatus('Collecting messages…');
        messages = {};
        for (const c of conversations.slice(0, 50)) {
          messages[c.conversation.id] = await getMessages(supabase, c.conversation.id, 500).catch(() => []);
        }
      }
      const payload = {
        export: { app: 'FUTUREHAT', version: APP_VERSION, generated_at: new Date().toISOString(), credit: CREDIT },
        profile, preferences, subscription, conversations, messages, communities,
        support_tickets: tickets, blocked_user_ids: blocked, muted_conversation_ids: muted,
      };
      const uri = FileSystem.cacheDirectory + `futurehat-data-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/json' });
      setStatus('Done — your data has been exported.');
    } catch {
      setStatus('Something went wrong. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(4) }}>
      <Text style={styles.title}>Export my data</Text>
      <Text style={styles.desc}>Download a copy of your FUTUREHAT data — profile, preferences, subscription, conversations, communities and support history — as a JSON file.</Text>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Include message history</Text>
        <Switch value={includeMessages} onValueChange={setIncludeMessages} trackColor={{ true: colors.primary, false: colors.border }} />
      </View>
      <Pressable style={styles.btn} onPress={exportData} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Export &amp; share</Text>}
      </Pressable>
      {status && <Text style={styles.status}>{status}</Text>}
      <Text style={styles.note}>Your data is gathered on your device and only shared if you choose to.</Text>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    title: { color: colors.text, fontSize: font.title, fontWeight: '700', marginBottom: spacing(2) },
    desc: { color: colors.textMuted, fontSize: font.body, lineHeight: 21, marginBottom: spacing(4) },
    row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(4), marginBottom: spacing(3) },
    rowLabel: { flex: 1, color: colors.text, fontSize: font.body },
    btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing(4), alignItems: 'center' },
    btnText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
    status: { color: colors.text, fontSize: font.small, textAlign: 'center', marginTop: spacing(3) },
    note: { color: colors.textFaint, fontSize: font.small, textAlign: 'center', marginTop: spacing(3) },
  });
