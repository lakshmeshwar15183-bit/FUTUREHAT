// FUTUREHAT mobile — Call detail: actions for one contact reached from the Calls
// tab. Voice / Video call (reuses CallContext.startCall), Delete this call log
// (delete-for-me), Block, Report, and Contact Info. Only the call log is deletable
// here — chats and the contact itself are untouched.
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import {
  getCallHistoryV2, deleteCallLogs, blockUser, submitReport,
} from '../lib/shared';
import type { Profile, CallType } from '../lib/shared';
import { useCalls } from '../calls/CallContext';
import InputModal from '../components/InputModal';
import Avatar from '../components/Avatar';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'CallDetail'>;
type Rt = RouteProp<RootStackParamList, 'CallDetail'>;

export default function CallDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { startCall } = useCalls();
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const peer: Profile = {
    id: params.peerId ?? '',
    phone: null,
    username: params.username ?? null,
    display_name: params.title,
    about: null,
    avatar_url: params.avatarUrl ?? null,
    last_seen: null,
    created_at: '',
  };

  async function call(type: CallType) {
    if (!params.peerId) { Alert.alert('Unavailable', 'This is a group conversation.'); return; }
    await startCall(params.conversationId, peer, type);
  }

  async function deleteLog() {
    Alert.alert('Delete call log', 'Remove this call log from your history? Only your copy is affected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setBusy(true);
        try {
          const hist = await getCallHistoryV2(supabase, { limit: 200 });
          const ids = hist.filter((h) => h.conversation_id === params.conversationId).map((h) => h.id);
          await deleteCallLogs(supabase, ids);
          navigation.goBack();
        } catch (e: any) { Alert.alert('Error', e?.message ?? 'Could not delete'); }
        finally { setBusy(false); }
      } },
    ]);
  }

  async function block() {
    if (!params.peerId) return;
    Alert.alert('Block contact', `Block ${params.title}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: async () => {
        const { error } = await blockUser(supabase, params.peerId!);
        Alert.alert(error ? 'Error' : 'Blocked', error ? error.message : `${params.title} is blocked.`);
      } },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: spacing(10) }}>
      <View style={styles.head}>
        <Avatar uri={params.avatarUrl} name={params.title} size={96} />
        <Text style={styles.name}>{params.title}</Text>
        {params.username ? <Text style={styles.sub}>@{params.username}</Text> : null}
      </View>

      <View style={styles.quick}>
        <QuickBtn icon="call" label="Voice call" onPress={() => call('audio')} colors={colors} styles={styles} />
        <QuickBtn icon="videocam" label="Video call" onPress={() => call('video')} colors={colors} styles={styles} />
      </View>

      <View style={styles.group}>
        <Row icon="person-circle-outline" label="Contact info" onPress={() => params.peerId && navigation.navigate('Profile', { userId: params.peerId, conversationId: params.conversationId })} colors={colors} styles={styles} disabled={!params.peerId} />
        <Row icon="trash-outline" label="Delete this call log" onPress={deleteLog} colors={colors} styles={styles} danger disabled={busy} />
        <Row icon="ban-outline" label="Block contact" onPress={block} colors={colors} styles={styles} danger disabled={!params.peerId} />
        <Row icon="flag-outline" label="Report contact" onPress={() => setReportOpen(true)} colors={colors} styles={styles} disabled={!params.peerId} />
      </View>

      <InputModal
        visible={reportOpen}
        title="Report contact"
        submitLabel="Report"
        fields={[{ key: 'reason', placeholder: 'What is the issue?' }]}
        onCancel={() => setReportOpen(false)}
        onSubmit={async (v) => {
          setReportOpen(false);
          if (!params.peerId || !v.reason?.trim()) return;
          const { error } = await submitReport(supabase, 'user', params.peerId, v.reason.trim());
          Alert.alert(error ? 'Error' : 'Reported', error ? error.message : 'Thanks — our safety team will review it.');
        }}
      />
    </ScrollView>
  );
}

function QuickBtn({ icon, label, onPress, colors, styles }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; colors: Palette; styles: Styles }) {
  return (
    <Pressable style={({ pressed }) => [styles.quickBtn, pressed && { opacity: 0.8 }]} onPress={onPress}>
      <Ionicons name={icon} size={26} color={colors.primary} />
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

function Row({ icon, label, onPress, colors, styles, danger, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; colors: Palette; styles: Styles; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }, disabled && { opacity: 0.4 }]}>
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.textMuted} />
      <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;
const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    head: { alignItems: 'center', paddingVertical: spacing(6), backgroundColor: colors.surface },
    name: { color: colors.text, fontSize: font.title, fontWeight: '700', marginTop: spacing(3) },
    sub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    quick: { flexDirection: 'row', justifyContent: 'center', gap: spacing(4), padding: spacing(4), backgroundColor: colors.surface, marginBottom: spacing(3) },
    quickBtn: { alignItems: 'center', paddingHorizontal: spacing(5), paddingVertical: spacing(3), borderRadius: radius.md, backgroundColor: colors.surfaceAlt, minWidth: 120 },
    quickLabel: { color: colors.text, fontSize: font.small, fontWeight: '600', marginTop: spacing(2) },
    group: { backgroundColor: colors.surface, borderRadius: radius.md, marginHorizontal: spacing(3), overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3.5) },
    rowLabel: { color: colors.text, fontSize: font.body, marginLeft: spacing(4) },
  });
