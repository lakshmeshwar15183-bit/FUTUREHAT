// Lumixo mobile — Scheduled Calls. List upcoming scheduled calls, schedule a
// new one with a contact (voice/video + a time preset), and cancel. Persisted in
// public.scheduled_calls (0024) + realtime. Reached from the Calls overflow menu.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import {
  getScheduledCalls, scheduleCall, cancelScheduledCall, subscribeScheduledCalls,
  getMyConversations, getCurrentUser,
} from '../lib/shared';
import type { ScheduledCall, ConversationSummary, CallType } from '../lib/shared';
import Avatar from '../components/Avatar';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { Alert } from '../ui/dialog';

const PRESETS: { label: string; ms: number }[] = [
  { label: 'In 1 hour', ms: 3600e3 },
  { label: 'In 3 hours', ms: 3 * 3600e3 },
  { label: 'Tonight 8 PM', ms: -1 },     // computed
  { label: 'Tomorrow 9 AM', ms: -2 },    // computed
];

function presetDate(ms: number): Date {
  const now = new Date();
  if (ms === -1) { const d = new Date(now); d.setHours(20, 0, 0, 0); if (d < now) d.setDate(d.getDate() + 1); return d; }
  if (ms === -2) { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }
  return new Date(now.getTime() + ms);
}

export default function ScheduledCallsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rows, setRows] = useState<ScheduledCall[]>([]);
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await getScheduledCalls(supabase)); } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const sub = subscribeScheduledCalls(supabase, load);
    return () => sub.unsubscribe();
  }, [load]);

  const titleFor = useCallback((r: ScheduledCall) => {
    const c = convs.find((x) => x.conversation.id === r.conversation_id);
    return c?.title ?? r.title ?? 'Scheduled call';
  }, [convs]);

  useEffect(() => { getMyConversations(supabase).then(setConvs).catch(() => {}); }, []);

  async function create(conv: ConversationSummary, type: CallType, when: Date) {
    setComposeOpen(false);
    const me = (await getCurrentUser(supabase))?.id;
    const callee = conv.participants.find((p) => p.id !== me)?.id ?? null;
    const { error } = await scheduleCall(supabase, conv.conversation.id, callee, type, when.toISOString(), conv.title);
    if (error) Alert.alert('Error', error.message); else load();
  }

  function cancel(r: ScheduledCall) {
    Alert.alert('Cancel scheduled call', 'Cancel this scheduled call?', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel call', style: 'destructive', onPress: async () => { await cancelScheduledCall(supabase, r.id).catch(() => {}); load(); } },
    ]);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={rows.length === 0 ? { flex: 1 } : { paddingVertical: spacing(2), paddingBottom: 96 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIllus}><Ionicons name="calendar-outline" size={48} color={colors.primary} /></View>
            <Text style={styles.emptyText}>No scheduled calls</Text>
            <Text style={styles.emptySub}>Plan a voice or video call and it will appear here.</Text>
          </View>
        }
        renderItem={({ item: r }) => (
          <View style={styles.row}>
            <Ionicons name={r.type === 'video' ? 'videocam' : 'call'} size={22} color={colors.primary} />
            <View style={styles.body}>
              <Text style={styles.name} numberOfLines={1}>{titleFor(r)}</Text>
              <Text style={styles.when}>{new Date(r.scheduled_at).toLocaleString()}</Text>
            </View>
            <Pressable hitSlop={8} onPress={() => cancel(r)}><Text style={styles.cancel}>Cancel</Text></Pressable>
          </View>
        )}
      />
      <Pressable style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]} onPress={() => setComposeOpen(true)}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>

      <ComposeModal visible={composeOpen} convs={convs} onClose={() => setComposeOpen(false)} onCreate={create} colors={colors} styles={styles} />
    </View>
  );
}

function ComposeModal({
  visible, convs, onClose, onCreate, colors, styles,
}: {
  visible: boolean; convs: ConversationSummary[];
  onClose: () => void; onCreate: (c: ConversationSummary, t: CallType, when: Date) => void;
  colors: Palette; styles: Styles;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<ConversationSummary | null>(null);
  const [type, setType] = useState<CallType>('audio');
  const directs = convs.filter((c) => c.conversation.type !== 'group');
  const filtered = directs.filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.sheetTitle}>Schedule a call</Text>
          {!picked ? (
            <>
              <View style={styles.searchBar}>
                <Ionicons name="search" size={18} color={colors.textFaint} />
                <TextInput style={styles.searchInput} value={q} onChangeText={setQ} placeholder="Choose a contact" placeholderTextColor={colors.textFaint} autoCapitalize="none" />
              </View>
              <FlatList
                data={filtered}
                keyExtractor={(c) => c.conversation.id}
                style={{ maxHeight: 320 }}
                ListEmptyComponent={<Text style={styles.emptySub}>No contacts.</Text>}
                renderItem={({ item: c }) => (
                  <Pressable style={styles.pickRow} onPress={() => setPicked(c)}>
                    <Avatar uri={c.avatarUrl} name={c.title} size={40} />
                    <Text style={styles.pickName} numberOfLines={1}>{c.title}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                  </Pressable>
                )}
              />
            </>
          ) : (
            <>
              <Text style={styles.pickedName}>{picked.title}</Text>
              <Text style={styles.fieldLabel}>Call type</Text>
              <View style={styles.chipRow}>
                {(['audio', 'video'] as CallType[]).map((t) => (
                  <Pressable key={t} onPress={() => setType(t)} style={[styles.chip, type === t && styles.chipActive]}>
                    <Ionicons name={t === 'video' ? 'videocam' : 'call'} size={16} color={type === t ? '#fff' : colors.textMuted} />
                    <Text style={[styles.chipText, type === t && { color: '#fff' }]}>{t === 'video' ? 'Video' : 'Voice'}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.fieldLabel}>When</Text>
              <View style={styles.chipRow}>
                {PRESETS.map((p) => (
                  <Pressable key={p.label} onPress={() => onCreate(picked, type, presetDate(p.ms))} style={styles.presetChip}>
                    <Text style={styles.presetText}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.backLink} onPress={() => setPicked(null)}><Text style={styles.backText}>← Choose another contact</Text></Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type Styles = ReturnType<typeof makeStyles>;
const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
    body: { flex: 1, marginLeft: spacing(3) },
    name: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    when: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    cancel: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing(8) },
    emptyIllus: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primary + '18', alignItems: 'center', justifyContent: 'center', marginBottom: spacing(3) },
    emptyText: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
    emptySub: { color: colors.textMuted, fontSize: font.small, marginTop: spacing(2), textAlign: 'center' },
    fab: { position: 'absolute', right: spacing(5), bottom: spacing(6), width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } },
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing(4), paddingBottom: spacing(8) },
    sheetTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: spacing(2) },
    searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing(3), borderRadius: radius.pill },
    searchInput: { flex: 1, color: colors.text, fontSize: font.body, paddingVertical: spacing(2.5) },
    pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(2.5) },
    pickName: { flex: 1, color: colors.text, fontSize: font.body, marginLeft: spacing(3) },
    pickedName: { color: colors.text, fontSize: font.body, fontWeight: '700', marginBottom: spacing(2) },
    fieldLabel: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase', marginTop: spacing(3), marginBottom: spacing(2) },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
    chip: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), paddingHorizontal: spacing(3), paddingVertical: spacing(2), borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
    chipActive: { backgroundColor: colors.primary },
    chipText: { color: colors.textMuted, fontSize: font.small, fontWeight: '600' },
    presetChip: { paddingHorizontal: spacing(3.5), paddingVertical: spacing(2.5), borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    presetText: { color: colors.text, fontSize: font.small, fontWeight: '600' },
    backLink: { marginTop: spacing(4) },
    backText: { color: colors.primary, fontSize: font.small, fontWeight: '600' },
  });
