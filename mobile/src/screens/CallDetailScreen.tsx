// Lumixo mobile — Call detail: the specific call(s) behind a history row plus
// per-contact actions. Shows the REAL metadata of the tapped call log — type,
// direction/status, date, time range and connected duration — computed from the
// stored call record (started_at / answered_at / ended_at), never hardcoded.
// Actions: Voice / Video call (CallContext.startCall), Delete this call log
// (delete-for-me, offline-first), Block, Report, Contact Info.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import {
  getCallHistoryV2, deleteCallLogs, blockUser, submitReport,
} from '../lib/shared';
import type { Profile, CallType, CallHistoryItem } from '../lib/shared';
import { useCalls } from '../calls/CallContext';
import { getCache, setCache } from '../lib/localCache';
import { formatTime } from '../lib/time';
import InputModal from '../components/InputModal';
import Avatar from '../components/Avatar';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { Alert } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList, 'CallDetail'>;
type Rt = RouteProp<RootStackParamList, 'CallDetail'>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "7 July 2026 at 11:42 PM"
function formatCallDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} at ${formatTime(iso)}`;
}

// Clean, human-readable talk time — never raw seconds/ms:
//   8 sec · 1 min 24 sec · 12 min 38 sec · 1 hr 5 min 17 sec
function formatCallDuration(totalSecs: number): string {
  let s = Math.max(0, Math.round(totalSecs));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hr`);
  if (m) parts.push(`${m} min`);
  if (s || parts.length === 0) parts.push(`${s} sec`);
  return parts.join(' ');
}

type Tone = 'normal' | 'danger';
interface CallDescription { title: string; sub: string; tone: Tone; }

// Derive the human summary from REAL fields only. A call is "connected" iff it
// was both answered AND ended — its duration is then ended − answered (talk
// time), never measured from when it started ringing. Calls that never
// connected show a status (Missed / Cancelled / Declined), never "0 sec".
function describeCall(c: CallHistoryItem): CallDescription {
  const kind = c.type === 'video' ? 'video' : 'voice';
  const out = c.direction === 'outgoing';
  const connected = !!c.answered_at && !!c.ended_at;

  if (connected) {
    const secs = (new Date(c.ended_at!).getTime() - new Date(c.answered_at!).getTime()) / 1000;
    return {
      title: `${out ? 'Outgoing' : 'Incoming'} ${kind} call`,
      sub: `Duration: ${formatCallDuration(secs)}`,
      tone: 'normal',
    };
  }
  if (c.status === 'declined') {
    return {
      title: `Declined ${kind} call`,
      sub: out ? 'Call declined' : 'You declined',
      tone: 'danger',
    };
  }
  // Rang but never answered: the caller's side reads as a cancelled call, the
  // callee's side as a missed call.
  if (out) return { title: `Cancelled ${kind} call`, sub: 'No answer', tone: 'normal' };
  return { title: `Missed ${kind} call`, sub: 'No answer', tone: 'danger' };
}

// Date + time line. Connected calls show the wall-clock span (start – end).
function callWhenLine(c: CallHistoryItem): string {
  const base = formatCallDateTime(c.started_at);
  if (c.answered_at && c.ended_at) return `${base} – ${formatTime(c.ended_at)}`;
  return base;
}

export default function CallDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { startCall } = useCalls();
  const [reportOpen, setReportOpen] = useState(false);

  // Offline-first: render the exact call records the list handed over (already
  // in memory / from cache — no spinner, no network wait), then reconcile with
  // cache + server in the background. `calls` stays scoped to the tapped history
  // group so multiple calls with the same person remain separate records.
  const [calls, setCalls] = useState<CallHistoryItem[]>(params.calls ?? []);

  // The specific call ids for this history row — pins reconciliation to THIS
  // group (not the contact's whole history). Null on a deep-link with no calls.
  const groupIds = useMemo(
    () => (params.calls?.length ? new Set(params.calls.map((c) => c.id)) : null),
    [params.calls],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      // 1) INSTANT cache read for deep-links where no records were passed in.
      if (!params.calls?.length) {
        const cached = await getCache<CallHistoryItem[]>('callHistoryV2', []).catch(() => [] as CallHistoryItem[]);
        if (active && cached.length) {
          const mine = cached.filter((r) => r.conversation_id === params.conversationId);
          if (mine.length) setCalls((cur) => (cur.length ? cur : mine));
        }
      }
      // 2) BACKGROUND reconcile with the server; refresh the shared cache.
      try {
        const rows = await getCallHistoryV2(supabase, { limit: 200 });
        if (!active) return;
        const fresh = groupIds
          ? rows.filter((r) => groupIds.has(r.id))
          : rows.filter((r) => r.conversation_id === params.conversationId);
        setCalls(fresh);
        setCache('callHistoryV2', rows).catch(() => {});
      } catch {
        // Offline / transient: keep whatever we already rendered.
      }
    })();
    return () => { active = false; };
  }, [params.conversationId, params.calls, groupIds]);

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

  function deleteLog() {
    const ids = calls.map((c) => c.id);
    if (!ids.length) { navigation.goBack(); return; }
    const many = ids.length > 1;
    Alert.alert(
      'Delete call log',
      `Remove ${many ? `these ${ids.length} calls` : 'this call'} from your history? Only your copy is affected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          // Offline-first: drop from the shared cache immediately so the Calls
          // list reflects it on return, then sync the deletion in the background
          // (auto-safe if offline — the server row simply isn't removed yet).
          const idSet = new Set(ids);
          getCache<CallHistoryItem[]>('callHistoryV2', [])
            .then((c) => setCache('callHistoryV2', c.filter((r) => !idSet.has(r.id))))
            .catch(() => {});
          deleteCallLogs(supabase, ids).catch(() => {});
          navigation.goBack();
        } },
      ],
    );
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

      {/* ── Call details: the real metadata of the tapped call(s) ── */}
      {calls.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Call details</Text>
          <View style={styles.group}>
            {calls.map((c, i) => {
              const d = describeCall(c);
              const danger = d.tone === 'danger';
              return (
                <View key={c.id} style={[styles.callRow, i > 0 && styles.callDivider]}>
                  <View style={[styles.callIcon, { backgroundColor: (danger ? colors.danger : colors.primary) + '1A' }]}>
                    <Ionicons
                      name={c.type === 'video' ? 'videocam' : 'call'}
                      size={18}
                      color={danger ? colors.danger : colors.primary}
                    />
                  </View>
                  <View style={styles.callBody}>
                    <Text style={[styles.callTitle, danger && { color: colors.danger }]}>{d.title}</Text>
                    <Text style={styles.callWhen}>{callWhenLine(c)}</Text>
                    <Text style={[styles.callSub, danger && { color: colors.danger }]}>{d.sub}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      <View style={styles.group}>
        <Row icon="person-circle-outline" label="Contact info" onPress={() => params.peerId && navigation.navigate('Profile', { userId: params.peerId, conversationId: params.conversationId })} colors={colors} styles={styles} disabled={!params.peerId} />
        <Row icon="trash-outline" label="Delete this call log" onPress={deleteLog} colors={colors} styles={styles} danger />
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
    // Call details section
    section: { marginBottom: spacing(3) },
    sectionLabel: { color: colors.textMuted, fontSize: font.small, fontWeight: '600', marginLeft: spacing(5), marginBottom: spacing(1.5) },
    callRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
    callDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    callIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: spacing(3) },
    callBody: { flex: 1 },
    callTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    callWhen: { color: colors.textMuted, fontSize: font.small, marginTop: 3 },
    callSub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    group: { backgroundColor: colors.surface, borderRadius: radius.md, marginHorizontal: spacing(3), overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3.5) },
    rowLabel: { color: colors.text, fontSize: font.body, marginLeft: spacing(4) },
  });
