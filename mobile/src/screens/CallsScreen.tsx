// FUTUREHAT mobile — Calls tab: WhatsApp-style call history.
//   • Grouped history (repeated calls from one contact → "Name (n)"), newest
//     first, incoming/outgoing/missed direction + voice/video icons, WA timestamps.
//   • Long-press → multi-select with a top action bar (count · select all · delete).
//   • Header search (instant filter) + overflow menu (Clear Call Log / Scheduled
//     Calls / Call Settings).
//   • Per-row overflow → Delete this call log. Tap a row → CallDetail.
//   • Empty state + always-visible FAB (contact picker → place a voice/video call).
//   • Realtime reload + keyset pagination. Delete is per-user (delete-for-me).
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import {
  getCallHistoryV2, groupCalls, deleteCallLogs, clearCallLog, subscribeCallChanges,
  getCurrentUser, getMyConversations,
} from '../lib/shared';
import type { CallGroup, CallHistoryItem, ConversationSummary, Profile, CallType } from '../lib/shared';
import { useCalls } from '../calls/CallContext';
import { getCache, setCache } from '../lib/localCache';
import { formatListTimestamp } from '../lib/time';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const PAGE = 60;

export default function CallsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();
  const { startCall } = useCalls();

  const [items, setItems] = useState<CallHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // group keys
  const [selecting, setSelecting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) {
      getCache<CallHistoryItem[]>('callHistoryV2', []).then((c) => {
        if (c.length) { setItems(c); setLoading(false); }
      });
    }
    try {
      const rows = await getCallHistoryV2(supabase, { limit: PAGE });
      setItems(rows);
      setReachedEnd(rows.length < PAGE);
      setCache('callHistoryV2', rows).catch(() => {});
    } catch { /* keep cache */ }
    setLoading(false);
  }, []);

  const loadMore = useCallback(async () => {
    if (reachedEnd || loading || items.length === 0) return;
    const before = items[items.length - 1]?.started_at;
    try {
      const older = await getCallHistoryV2(supabase, { limit: PAGE, before });
      if (older.length) setItems((cur) => dedupe([...cur, ...older]));
      if (older.length < PAGE) setReachedEnd(true);
    } catch { /* ignore */ }
  }, [items, reachedEnd, loading]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Realtime: a new/updated call or a delete-for-me on another device reloads.
  useEffect(() => {
    const sub = subscribeCallChanges(supabase, () => load({ silent: true }));
    return () => sub.unsubscribe();
  }, [load]);

  const groups = useMemo(() => {
    const g = groupCalls(items);
    const q = search.trim().toLowerCase();
    if (!q) return g;
    return g.filter((x) => x.title.toLowerCase().includes(q) || (x.peer_username ?? '').toLowerCase().includes(q));
  }, [items, search]);

  // ── Selection ────────────────────────────────────────────────────────────
  const enterSelect = (key: string) => { setSelecting(true); setSelected(new Set([key])); };
  const toggle = (key: string) =>
    setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const cancelSelect = useCallback(() => { setSelecting(false); setSelected(new Set()); }, []);
  const selectAll = () => setSelected(new Set(groups.map((g) => g.key)));

  const deleteSelected = useCallback(() => {
    const ids = groups.filter((g) => selected.has(g.key)).flatMap((g) => g.callIds);
    if (!ids.length) return;
    Alert.alert('Delete calls', `Delete ${selected.size} selected call log${selected.size > 1 ? 's' : ''}? This removes them only from your history.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setItems((cur) => cur.filter((it) => !ids.includes(it.id)));
        cancelSelect();
        await deleteCallLogs(supabase, ids).catch(() => {});
        load({ silent: true });
      } },
    ]);
  }, [groups, selected, cancelSelect, load]);

  const deleteOne = useCallback((g: CallGroup) => {
    Alert.alert('Delete call log', 'Remove this call log from your history?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setItems((cur) => cur.filter((it) => !g.callIds.includes(it.id)));
        await deleteCallLogs(supabase, g.callIds).catch(() => {});
        load({ silent: true });
      } },
    ]);
  }, [load]);

  const clearAll = useCallback(() => {
    setMenuOpen(false);
    Alert.alert('Clear call log', 'Clear your entire call history? This only affects you — contacts and chats are not deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        setItems([]);
        await clearCallLog(supabase).catch(() => {});
        load({ silent: true });
      } },
    ]);
  }, [load]);

  // ── Header (native tab header, swapped for selection) ──────────────────────
  useLayoutEffect(() => {
    if (selecting) {
      navigation.setOptions({
        headerTitle: `${selected.size} selected`,
        headerLeft: () => (
          <Pressable onPress={cancelSelect} hitSlop={10} style={{ paddingHorizontal: spacing(3) }}>
            <Ionicons name="close" size={24} color={colors.isLight ? '#fff' : colors.text} />
          </Pressable>
        ),
        headerRight: () => (
          <View style={{ flexDirection: 'row', gap: spacing(4), paddingHorizontal: spacing(3) }}>
            <Pressable onPress={selectAll} hitSlop={10}><Ionicons name="checkmark-done" size={22} color={colors.isLight ? '#fff' : colors.text} /></Pressable>
            <Pressable onPress={deleteSelected} hitSlop={10}><Ionicons name="trash" size={22} color={colors.isLight ? '#fff' : colors.text} /></Pressable>
          </View>
        ),
      });
    } else {
      navigation.setOptions({
        headerTitle: 'Calls',
        headerLeft: undefined,
        headerRight: () => (
          <View style={{ flexDirection: 'row', gap: spacing(4), paddingHorizontal: spacing(3) }}>
            <Pressable onPress={() => setSearchOpen((v) => !v)} hitSlop={10}><Ionicons name="search" size={22} color={colors.isLight ? '#fff' : colors.text} /></Pressable>
            <Pressable onPress={() => setMenuOpen(true)} hitSlop={10}><Ionicons name="ellipsis-vertical" size={22} color={colors.isLight ? '#fff' : colors.text} /></Pressable>
          </View>
        ),
      });
    }
  }, [navigation, selecting, selected, colors, cancelSelect, deleteSelected]);

  // ── Place a call from the FAB picker ───────────────────────────────────────
  const placeCall = useCallback(async (conv: ConversationSummary, type: CallType) => {
    setPickerOpen(false);
    const me = (await getCurrentUser(supabase))?.id;
    const peer = conv.participants.find((p) => p.id !== me) ?? conv.participants[0];
    if (!peer) return;
    await startCall(conv.conversation.id, peer, type);
  }, [startCall]);

  const renderRow = ({ item: g }: { item: CallGroup }) => {
    const isSel = selected.has(g.key);
    const missed = g.anyMissed;
    const out = g.latest.direction === 'outgoing';
    return (
      <Pressable
        onLongPress={() => enterSelect(g.key)}
        onPress={() => {
          if (selecting) return toggle(g.key);
          navigation.navigate('CallDetail', {
            conversationId: g.conversation_id,
            peerId: g.peer_id ?? undefined,
            title: g.title,
            username: g.peer_username ?? undefined,
            avatarUrl: g.peer_avatar,
          });
        }}
        style={({ pressed }) => [styles.row, (isSel || pressed) && { backgroundColor: colors.surfaceAlt }]}
      >
        {selecting && (
          <Ionicons
            name={isSel ? 'checkmark-circle' : 'ellipse-outline'}
            size={22} color={isSel ? colors.primary : colors.textFaint}
            style={{ marginRight: spacing(2) }}
          />
        )}
        <Avatar uri={g.peer_avatar} name={g.title} size={48} />
        <View style={styles.body}>
          <Text style={[styles.name, missed && { color: colors.danger }]} numberOfLines={1}>
            {g.title}{g.count > 1 ? ` (${g.count})` : ''}
          </Text>
          <View style={styles.meta}>
            <Ionicons
              name={out ? 'arrow-up-outline' : 'arrow-down-outline'}
              size={15}
              color={missed ? colors.danger : out ? colors.primary : '#22c55e'}
            />
            <Text style={styles.metaText}>{formatListTimestamp(g.latest.started_at)}</Text>
          </View>
        </View>
        <Pressable
          hitSlop={10}
          onPress={() => (selecting ? toggle(g.key) : navigation.navigate('CallDetail', {
            conversationId: g.conversation_id, peerId: g.peer_id ?? undefined,
            title: g.title, username: g.peer_username ?? undefined, avatarUrl: g.peer_avatar,
          }))}
        >
          <Ionicons name={g.latest.type === 'video' ? 'videocam' : 'call'} size={22} color={colors.primary} />
        </Pressable>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {searchOpen && !selecting && (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textFaint} />
          <TextInput
            style={styles.searchInput} value={search} onChangeText={setSearch}
            placeholder="Search calls" placeholderTextColor={colors.textFaint} autoFocus autoCapitalize="none"
          />
          {search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.textFaint} /></Pressable> : null}
        </View>
      )}

      <FlatList
        data={groups}
        keyExtractor={(g) => g.key}
        renderItem={renderRow}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        contentContainerStyle={groups.length === 0 ? { flex: 1 } : { paddingBottom: 96 }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <View style={styles.emptyIllus}><Ionicons name="call-outline" size={54} color={colors.primary} /></View>
              <Text style={styles.emptyText}>No recent calls</Text>
              <Text style={styles.emptySub}>Start a voice or video call from any chat, or tap the button below.</Text>
            </View>
          ) : loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View> : null
        }
      />

      {/* Always-visible FAB */}
      <Pressable style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]} onPress={() => setPickerOpen(true)}>
        <Ionicons name="call" size={24} color="#fff" />
        <Ionicons name="add" size={16} color="#fff" style={styles.fabPlus} />
      </Pressable>

      {/* Overflow menu */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menu}>
            <MenuItem label="Clear call log" onPress={clearAll} colors={colors} styles={styles} />
            <MenuItem label="Scheduled calls" onPress={() => { setMenuOpen(false); navigation.navigate('ScheduledCalls'); }} colors={colors} styles={styles} />
            <MenuItem label="Call settings" onPress={() => { setMenuOpen(false); navigation.navigate('CallSettings'); }} colors={colors} styles={styles} />
          </View>
        </Pressable>
      </Modal>

      {/* FAB contact picker */}
      <ContactPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onCall={placeCall} colors={colors} styles={styles} />
    </View>
  );
}

function MenuItem({ label, onPress, colors, styles }: { label: string; onPress: () => void; colors: Palette; styles: Styles }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.surfaceAlt }]}>
      <Text style={styles.menuText}>{label}</Text>
    </Pressable>
  );
}

function ContactPicker({
  visible, onClose, onCall, colors, styles,
}: {
  visible: boolean; onClose: () => void;
  onCall: (conv: ConversationSummary, type: CallType) => void;
  colors: Palette; styles: Styles;
}) {
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!visible) return;
    getMyConversations(supabase).then((cs) => setConvs(cs.filter((c) => c.conversation.type !== 'group'))).catch(() => {});
  }, [visible]);
  const filtered = convs.filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.sheetTitle}>Call a contact</Text>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.textFaint} />
            <TextInput style={styles.searchInput} value={q} onChangeText={setQ} placeholder="Search contacts" placeholderTextColor={colors.textFaint} autoCapitalize="none" />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.conversation.id}
            style={{ maxHeight: 380 }}
            ListEmptyComponent={<Text style={styles.emptySub}>No contacts to call yet.</Text>}
            renderItem={({ item: c }) => (
              <View style={styles.pickRow}>
                <Avatar uri={c.avatarUrl} name={c.title} size={42} />
                <Text style={styles.pickName} numberOfLines={1}>{c.title}</Text>
                <Pressable hitSlop={8} onPress={() => onCall(c, 'audio')}><Ionicons name="call" size={22} color={colors.primary} /></Pressable>
                <Pressable hitSlop={8} onPress={() => onCall(c, 'video')} style={{ marginLeft: spacing(4) }}><Ionicons name="videocam" size={22} color={colors.primary} /></Pressable>
              </View>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function dedupe(list: CallHistoryItem[]): CallHistoryItem[] {
  const seen = new Set<string>();
  return list.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

type Styles = ReturnType<typeof makeStyles>;
const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(2.5) },
    body: { flex: 1, marginLeft: spacing(3) },
    name: { color: colors.text, fontSize: font.heading, fontWeight: '500' },
    meta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    metaText: { color: colors.textMuted, fontSize: font.small, marginLeft: 4 },
    searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), backgroundColor: colors.surfaceAlt, marginHorizontal: spacing(3), marginTop: spacing(2), paddingHorizontal: spacing(3), borderRadius: radius.pill },
    searchInput: { flex: 1, color: colors.text, fontSize: font.body, paddingVertical: spacing(2.5) },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing(8) },
    emptyIllus: { width: 108, height: 108, borderRadius: 54, backgroundColor: colors.primary + '18', alignItems: 'center', justifyContent: 'center', marginBottom: spacing(4) },
    emptyText: { color: colors.text, fontSize: font.title, fontWeight: '700' },
    emptySub: { color: colors.textMuted, fontSize: font.small, marginTop: spacing(2), textAlign: 'center' },
    fab: { position: 'absolute', right: spacing(5), bottom: spacing(6), width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } },
    fabPlus: { position: 'absolute', right: 12, top: 12 },
    menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)' },
    menu: { position: 'absolute', top: 8, right: 8, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing(1), minWidth: 200, elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
    menuItem: { paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
    menuText: { color: colors.text, fontSize: font.body },
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing(4), paddingBottom: spacing(8) },
    sheetTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: spacing(2) },
    pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(2.5) },
    pickName: { flex: 1, color: colors.text, fontSize: font.body, marginLeft: spacing(3) },
  });
