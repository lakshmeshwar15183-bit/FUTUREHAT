// Lumixo mobile — Owner/Admin dashboard. Native tabbed console over the same
// admin RPCs the web dashboard uses (0013_owner_admin.sql), reached from Settings
// (gated by getServerAdmin). Owner-only tabs (Feature Flags / App / Audit) are
// hidden unless getServerOwner AND re-checked server-side by each RPC. Mirrors
// web/src/admin/{AdminDashboard,AdminUsers,AdminOps}.tsx.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../../lib/supabase';
import {
  getServerAdmin, getServerOwner,
  adminSearchUsers, adminStats, adminCallStats, adminMessageStats, adminDbHealth,
  adminGlobalSearch, adminAuditLog, adminDeleteMessage, adminDeleteCommunity,
  getFeatureFlags, adminSetFeatureFlag, adminSetAppEnabled,
  getActiveAnnouncements, adminSendAnnouncement, adminRemoveCurrentAnnouncement,
  adminSetReportStatus, getStreakAudit,
} from '../../lib/shared';
import type {
  AdminUserSummary, AdminStats, AdminCallStats, AdminMessageStats, AdminDbHealth,
  AdminGlobalSearch, AuditEntry, FeatureFlag, Announcement, AnnouncementKind,
} from '../../lib/shared';
import Avatar from '../../components/Avatar';
import { useColors, spacing, radius, font, type Palette } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Admin'>;
type Tab =
  | 'overview' | 'users' | 'reports' | 'tickets' | 'calls' | 'messages'
  | 'search' | 'health' | 'flags' | 'app' | 'audit' | 'streaks';

interface ReportRow { id: string; reporter_id: string; target_type: string; target_id: string; reason: string; details: string | null; status: string; created_at: string; }
interface TicketRow { id: string; user_id: string; kind: string; subject: string; body: string; status: string; created_at: string; device_info: string | null; }

const STAT_CARDS: { key: keyof AdminStats; label: string; icon: string }[] = [
  { key: 'users', label: 'Total users', icon: '👤' },
  { key: 'online_users', label: 'Online now', icon: '🟢' },
  { key: 'dau', label: 'DAU', icon: '📅' },
  { key: 'mau', label: 'MAU', icon: '🗓️' },
  { key: 'new_today', label: 'New today', icon: '✨' },
  { key: 'premium_users', label: 'Premium', icon: '✦' },
  { key: 'banned_users', label: 'Banned', icon: '⛔' },
  { key: 'messages', label: 'Messages', icon: '💬' },
  { key: 'conversations', label: 'Chats', icon: '🗨️' },
  { key: 'communities', label: 'Communities', icon: '🌐' },
  { key: 'channels', label: 'Channels', icon: '📢' },
  { key: 'statuses', label: 'Live statuses', icon: '📸' },
  { key: 'total_calls', label: 'Total calls', icon: '📞' },
  { key: 'failed_calls', label: 'Failed calls', icon: '📵' },
  { key: 'open_reports', label: 'Open reports', icon: '🚩' },
  { key: 'open_tickets', label: 'Open tickets', icon: '🎫' },
];

export default function AdminDashboardScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getServerAdmin(supabase), getServerOwner(supabase).catch(() => false)]).then(([admin, owner]) => {
      setAllowed(admin); setIsOwner(owner);
      if (admin) loadAll();
    });
  }, []);

  async function loadAll() {
    try { setStats(await adminStats(supabase)); }
    catch { setError('Admin backend not provisioned yet (apply migrations 0009 + 0013).'); }
    // Active queue only: reports still needing admin attention (open + reviewing).
    // Resolved / dismissed reports are completed and must not sit mixed in with
    // actionable ones, and must not resurface here after a refresh or restart.
    const { data: rep } = await supabase.from('reports').select('*')
      .in('status', ['open', 'reviewing'])
      .order('created_at', { ascending: false }).limit(100);
    setReports((rep as ReportRow[]) ?? []);
    const { data: tic } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false }).limit(100);
    setTickets((tic as TicketRow[]) ?? []);
  }

  async function setReportStatus(id: string, status: string) {
    const snapshot = reports;
    // Resolve / Dismiss complete the report → remove it from the active queue
    // immediately. Reviewing keeps it (still being worked) but updates the label.
    setReports((rs) =>
      status === 'resolved' || status === 'dismissed'
        ? rs.filter((r) => r.id !== id)
        : rs.map((r) => (r.id === id ? { ...r, status } : r)),
    );
    // Route through the audited RPC (0017) rather than a direct table write, so
    // every status change stamps reviewer + time and lands in the audit log.
    try { await adminSetReportStatus(supabase, id, status as any); }
    catch { setReports(snapshot); /* rollback the optimistic removal on failure */ }
  }
  async function setTicketStatus(id: string, status: string) {
    setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    await supabase.from('support_tickets').update({ status }).eq('id', id);
  }

  const TABS: { id: Tab; label: string; ownerOnly?: boolean }[] = [
    { id: 'overview', label: 'Analytics' },
    { id: 'users', label: 'Users' },
    { id: 'reports', label: `Reports${stats ? ` (${stats.open_reports})` : ''}` },
    { id: 'tickets', label: `Tickets${stats ? ` (${stats.open_tickets})` : ''}` },
    { id: 'calls', label: 'Calls' },
    { id: 'messages', label: 'Messages' },
    { id: 'search', label: 'Search' },
    { id: 'health', label: 'Database' },
    { id: 'flags', label: 'Feature Flags', ownerOnly: true },
    { id: 'app', label: 'App', ownerOnly: true },
    { id: 'audit', label: 'Audit Log', ownerOnly: true },
    { id: 'streaks', label: 'Streaks' },
  ];

  if (allowed === null) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!allowed) return <View style={styles.center}><Text style={styles.empty}>You don’t have admin access.</Text></View>;

  return (
    <View style={styles.container}>
      {/* Tab bar */}
      <View style={styles.tabBarWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
          {TABS.filter((t) => !t.ownerOnly || isOwner).map((t) => (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={[styles.tabChip, tab === t.id && styles.tabChipActive]}>
              <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {error ? <Text style={styles.warn}>{error}</Text> : null}

      {tab === 'overview' && (
        <ScrollView contentContainerStyle={styles.grid}>
          {STAT_CARDS.map((c) => (
            <View key={String(c.key)} style={styles.stat}>
              <Text style={styles.statIcon}>{c.icon}</Text>
              <Text style={styles.statNum}>{stats && stats[c.key] != null ? String(stats[c.key]) : '—'}</Text>
              <Text style={styles.statLabel}>{c.label}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {tab === 'users' && <UsersTab isOwner={isOwner} colors={colors} styles={styles} />}
      {tab === 'calls' && <CallsTab colors={colors} styles={styles} />}
      {tab === 'messages' && <MessagesTab colors={colors} styles={styles} />}
      {tab === 'search' && <SearchTab colors={colors} styles={styles} />}
      {tab === 'health' && <HealthTab colors={colors} styles={styles} />}
      {tab === 'flags' && isOwner && <FlagsTab colors={colors} styles={styles} />}
      {tab === 'app' && isOwner && <AppTab colors={colors} styles={styles} />}
      {tab === 'audit' && isOwner && <AuditTab colors={colors} styles={styles} />}
      {tab === 'streaks' && <StreakAuditTab colors={colors} styles={styles} />}

      {tab === 'reports' && (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          ListEmptyComponent={<Text style={styles.empty}>No reports.</Text>}
          contentContainerStyle={styles.listPad}
          renderItem={({ item: r }) => (
            <View style={styles.row}>
              <View style={styles.rowHead}>
                <Text style={styles.tag}>{r.target_type}</Text>
                <Text style={styles.rowStatus}>{r.status}</Text>
              </View>
              <Text style={styles.rowTitle}>{r.reason}</Text>
              {r.details ? <Text style={styles.rowBody}>{r.details}</Text> : null}
              <Text style={styles.rowMeta}>target {r.target_id.slice(0, 8)} · {new Date(r.created_at).toLocaleString()}</Text>
              <View style={styles.rowActions}>
                <MiniBtn label="Reviewing" onPress={() => setReportStatus(r.id, 'reviewing')} colors={colors} />
                <MiniBtn label="Resolve" onPress={() => setReportStatus(r.id, 'resolved')} colors={colors} />
                <MiniBtn label="Dismiss" onPress={() => setReportStatus(r.id, 'dismissed')} colors={colors} />
              </View>
            </View>
          )}
        />
      )}

      {tab === 'tickets' && (
        <FlatList
          data={tickets}
          keyExtractor={(t) => t.id}
          ListEmptyComponent={<Text style={styles.empty}>No tickets.</Text>}
          contentContainerStyle={styles.listPad}
          renderItem={({ item: t }) => (
            <View style={styles.row}>
              <View style={styles.rowHead}>
                <Text style={styles.tag}>{t.kind}</Text>
                <Text style={styles.rowStatus}>{t.status.replace('_', ' ')}</Text>
              </View>
              <Text style={styles.rowTitle}>{t.subject}</Text>
              <Text style={styles.rowBody}>{t.body}</Text>
              {t.device_info ? <Text style={styles.rowMeta}>📱 {t.device_info}</Text> : null}
              <Text style={styles.rowMeta}>{new Date(t.created_at).toLocaleString()}</Text>
              <View style={styles.rowActions}>
                <MiniBtn label="In progress" onPress={() => setTicketStatus(t.id, 'in_progress')} colors={colors} />
                <MiniBtn label="Resolve" onPress={() => setTicketStatus(t.id, 'resolved')} colors={colors} />
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────
function UsersTab({ isOwner, colors, styles }: { isOwner: boolean; colors: Palette; styles: Styles }) {
  const navigation = useNavigation<Nav>();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AdminUserSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (!q.trim()) return;
    setSearching(true); setMsg(null);
    try { setResults(await adminSearchUsers(supabase, q.trim())); }
    catch (e: any) { setMsg(e?.message ?? 'Search failed'); }
    finally { setSearching(false); }
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Search by ID, username, email or phone…"
          placeholderTextColor={colors.textFaint}
          onSubmitEditing={run}
          returnKeyType="search"
          autoCapitalize="none"
        />
        <Pressable style={styles.searchBtn} onPress={run} disabled={searching}>
          <Text style={styles.searchBtnText}>{searching ? '…' : 'Search'}</Text>
        </Pressable>
      </View>
      {msg ? <Text style={styles.warn}>{msg}</Text> : null}
      <FlatList
        data={results}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.listPad}
        ListEmptyComponent={<Text style={styles.empty}>No results yet — search above.</Text>}
        renderItem={({ item: r }) => (
          <Pressable style={styles.userRow} onPress={() => navigation.navigate('AdminUserDetail', { userId: r.id, isOwner })}>
            <Avatar uri={r.avatar_url} name={r.display_name ?? r.username} size={40} />
            <View style={{ flex: 1, marginLeft: spacing(3) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), flexWrap: 'wrap' }}>
                <Text style={styles.userName} numberOfLines={1}>{r.display_name || r.username || 'Unnamed'}</Text>
                {r.verified && <Ionicons name="checkmark-circle" size={13} color={colors.primary} />}
                {r.owner && <Text style={styles.ownerBadge}>OWNER</Text>}
                {r.role !== 'user' && !r.owner && <Text style={styles.roleBadge}>{r.role}</Text>}
              </View>
              <Text style={styles.userSub} numberOfLines={1}>{r.email || r.phone || r.id.slice(0, 12)}</Text>
            </View>
            <Text style={[styles.rowStatus, { textTransform: 'capitalize' }]}>{r.account_status}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

// ── Calls tab ─────────────────────────────────────────────────────────────────
function CallsTab({ colors, styles }: { colors: Palette; styles: Styles }) {
  const [s, setS] = useState<AdminCallStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { adminCallStats(supabase).then(setS).catch((e) => setErr(e.message)); }, []);
  if (err) return <Text style={styles.warn}>{err}</Text>;
  if (!s) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  const cards: [string, string | number][] = [
    ['Active voice', s.active_audio], ['Active video', s.active_video], ['Ringing', s.ringing],
    ['Failed', s.failed], ['ICE failures', s.ice_failures], ['Reconnects', s.reconnects],
    ['TURN calls', s.turn_calls], ['Avg duration', `${s.avg_duration_s}s`],
  ];
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: spacing(8) }}>
      <View style={styles.grid}>
        {cards.map(([l, v]) => <View key={l} style={styles.stat}><Text style={styles.statNum}>{String(v)}</Text><Text style={styles.statLabel}>{l}</Text></View>)}
      </View>
      <Text style={styles.subhead}>Recent calls</Text>
      {s.recent.length === 0 && <Text style={styles.empty}>No calls recorded.</Text>}
      {s.recent.map((c) => (
        <View key={c.id} style={styles.compactRow}>
          <Text style={styles.tag}>{c.type}</Text>
          <Text style={styles.rowStatus}>{c.status}</Text>
          <Text style={styles.rowMeta}>conn: {c.connection_state || '—'}</Text>
          <Text style={styles.rowMeta}>ICE✗ {c.ice_failures ?? 0}</Text>
          <Text style={styles.rowMeta}>↻ {c.reconnects ?? 0}</Text>
          {c.turn_used ? <Text style={styles.rowMeta}>TURN</Text> : null}
          {c.failure_reason ? <Text style={[styles.rowMeta, { color: colors.danger }]}>{c.failure_reason}</Text> : null}
          <Text style={styles.rowMeta}>{new Date(c.started_at).toLocaleString()}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ── Messages tab ──────────────────────────────────────────────────────────────
function MessagesTab({ colors, styles }: { colors: Palette; styles: Styles }) {
  const [s, setS] = useState<AdminMessageStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [delId, setDelId] = useState('');
  useEffect(() => { adminMessageStats(supabase).then(setS).catch((e) => setErr(e.message)); }, []);
  if (err) return <Text style={styles.warn}>{err}</Text>;
  if (!s) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  const cards: [string, number][] = [
    ['Total', s.total], ['Deleted', s.deleted], ['Delivered', s.delivered],
    ['Read', s.read], ['Undelivered', s.undelivered], ['Scheduled', s.scheduled_pending],
  ];
  async function del() {
    try { await adminDeleteMessage(supabase, delId.trim()); setDelId(''); Alert.alert('Deleted', 'Message deleted.'); }
    catch (e: any) { Alert.alert('Error', e.message); }
  }
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: spacing(8) }}>
      <View style={styles.grid}>
        {cards.map(([l, v]) => <View key={l} style={styles.stat}><Text style={styles.statNum}>{String(v)}</Text><Text style={styles.statLabel}>{l}</Text></View>)}
      </View>
      <Text style={styles.subhead}>Delete a message by ID</Text>
      <View style={styles.searchBar}>
        <TextInput style={styles.searchInput} value={delId} onChangeText={setDelId} placeholder="message UUID" placeholderTextColor={colors.textFaint} autoCapitalize="none" />
        <Pressable style={[styles.searchBtn, { backgroundColor: colors.danger }]} onPress={del} disabled={!delId}>
          <Text style={styles.searchBtnText}>Delete</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ── Global search tab ─────────────────────────────────────────────────────────
function SearchTab({ colors, styles }: { colors: Palette; styles: Styles }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<AdminGlobalSearch | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    if (!q.trim()) return;
    setBusy(true); setErr(null);
    try { setRes(await adminGlobalSearch(supabase, q.trim())); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  function confirmDelMsg(id: string) {
    Alert.alert('Delete message?', '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { await adminDeleteMessage(supabase, id); Alert.alert('Deleted'); } catch (e: any) { Alert.alert('Error', e.message); } } }]);
  }
  function confirmDelComm(id: string, name: string) {
    Alert.alert(`Delete community "${name}"?`, '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { await adminDeleteCommunity(supabase, id); Alert.alert('Deleted'); } catch (e: any) { Alert.alert('Error', e.message); } } }]);
  }
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchBar}>
        <TextInput style={styles.searchInput} value={q} onChangeText={setQ} placeholder="Users, communities, channels, messages, reports…" placeholderTextColor={colors.textFaint} onSubmitEditing={run} returnKeyType="search" autoCapitalize="none" />
        <Pressable style={styles.searchBtn} onPress={run} disabled={busy}><Text style={styles.searchBtnText}>{busy ? '…' : 'Search'}</Text></Pressable>
      </View>
      {err ? <Text style={styles.warn}>{err}</Text> : null}
      {res && (
        <ScrollView contentContainerStyle={styles.listPad}>
          <Text style={styles.subhead}>Users ({res.users.length})</Text>
          {res.users.map((u) => <View key={u.id} style={styles.compactRow}><Text style={styles.rowTitle}>{u.display_name || u.username}</Text><Text style={styles.rowMeta}>{u.email}</Text><Text style={styles.rowStatus}>{u.account_status}</Text></View>)}
          <Text style={styles.subhead}>Communities ({res.communities.length})</Text>
          {res.communities.map((c) => <View key={c.id} style={styles.compactRow}><Text style={styles.rowTitle}>{c.name}</Text><MiniBtn label="Delete" danger onPress={() => confirmDelComm(c.id, c.name)} colors={colors} /></View>)}
          <Text style={styles.subhead}>Channels ({res.channels.length})</Text>
          {res.channels.map((c) => <View key={c.id} style={styles.compactRow}><Text style={styles.rowTitle}>{c.name}</Text><Text style={styles.tag}>{c.kind}</Text></View>)}
          <Text style={styles.subhead}>Messages ({res.messages.length})</Text>
          {res.messages.map((m) => <View key={m.id} style={styles.compactRow}><Text style={styles.rowBody} numberOfLines={1}>{m.content?.slice(0, 60) || `[${m.type}]`}</Text><MiniBtn label="Delete" danger onPress={() => confirmDelMsg(m.id)} colors={colors} /></View>)}
          <Text style={styles.subhead}>Reports ({res.reports.length})</Text>
          {res.reports.map((r) => <View key={r.id} style={styles.compactRow}><Text style={styles.tag}>{r.target_type}</Text><Text style={styles.rowBody}>{r.reason}</Text><Text style={styles.rowStatus}>{r.status}</Text></View>)}
        </ScrollView>
      )}
    </View>
  );
}

// ── Database health tab ───────────────────────────────────────────────────────
function HealthTab({ colors, styles }: { colors: Palette; styles: Styles }) {
  const [h, setH] = useState<AdminDbHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, string>>({});
  useEffect(() => {
    adminDbHealth(supabase).then(setH).catch((e) => setErr(e.message));
    (async () => {
      const p: Record<string, string> = {};
      try { const { error } = await supabase.auth.getSession(); p.auth = error ? 'error' : 'ok'; } catch { p.auth = 'error'; }
      try { const { error } = await supabase.storage.listBuckets(); p.storage = error ? 'error' : 'ok'; } catch { p.storage = 'error'; }
      // Live realtime probe (SQL can't see channel health) — mirrors web AdminOps.
      try {
        const ch = supabase.channel('health-probe-' + Math.random().toString(36).slice(2));
        await new Promise<void>((res) => {
          ch.subscribe((st: string) => {
            if (st === 'SUBSCRIBED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
              p.realtime = st === 'SUBSCRIBED' ? 'ok' : 'error';
              res();
            }
          });
          setTimeout(res, 4000);
        });
        supabase.removeChannel(ch);
      } catch { p.realtime = 'error'; }
      setProbes(p);
    })();
  }, []);
  if (err) return <Text style={styles.warn}>{err}</Text>;
  const rows: [string, string][] = [
    ['Database', h ? h.database : '…'],
    ['DB latency', h ? `${h.latency_ms} ms` : '…'],
    ['Authentication', probes.auth || '…'],
    ['Storage', probes.storage || '…'],
    ['Realtime', probes.realtime || '…'],
    ['Pending deletions', h ? String(h.pending_deletions) : '…'],
    ['Oldest queued scheduled', h?.oldest_pending_scheduled ? new Date(h.oldest_pending_scheduled).toLocaleString() : 'none'],
  ];
  return (
    <ScrollView contentContainerStyle={styles.listPad}>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.healthRow}>
          <Text style={styles.rowTitle}>{k}</Text>
          <Text style={[styles.healthVal, v === 'ok' && { color: colors.primary }, v === 'error' && { color: colors.danger }]}>{v}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ── Feature flags tab (owner) ─────────────────────────────────────────────────
function FlagsTab({ colors, styles }: { colors: Palette; styles: Styles }) {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { getFeatureFlags(supabase).then(setFlags); }, []);
  useEffect(() => { load(); }, [load]);
  async function toggle(f: FeatureFlag) {
    setBusy(f.key);
    try { await adminSetFeatureFlag(supabase, f.key, !f.enabled); load(); }
    catch (e: any) { Alert.alert('Error', e.message); } finally { setBusy(null); }
  }
  return (
    <ScrollView contentContainerStyle={styles.listPad}>
      <Text style={styles.hint}>Toggle features live for all clients — no app release required.</Text>
      {flags.map((f) => (
        <View key={f.key} style={styles.flagRow}>
          <Text style={styles.rowTitle}>{f.label || f.key}</Text>
          <Pressable onPress={() => toggle(f)} disabled={busy === f.key} style={[styles.toggle, f.enabled ? styles.toggleOn : styles.toggleOff]}>
            <Text style={[styles.toggleText, { color: f.enabled ? '#fff' : colors.textMuted }]}>{f.enabled ? 'Enabled' : 'Disabled'}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

// ── App management tab (owner): announcements + kill-switch ────────────────────
function AppTab({ colors, styles }: { colors: Palette; styles: Styles }) {
  const [kind, setKind] = useState<AnnouncementKind>('announcement');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [list, setList] = useState<Announcement[]>([]);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const load = useCallback(() => { getActiveAnnouncements(supabase).then(setList); }, []);
  useEffect(() => { load(); }, [load]);
  const KINDS: AnnouncementKind[] = ['announcement', 'maintenance', 'update', 'force_update'];
  async function send() {
    if (!title.trim()) return;
    setBusy(true);
    try { await adminSendAnnouncement(supabase, kind, title.trim(), body.trim() || undefined); setTitle(''); setBody(''); load(); }
    catch (e: any) { Alert.alert('Error', e.message); } finally { setBusy(false); }
  }
  async function removeCurrent() {
    if (!list.length) return;
    Alert.alert(
      'Remove Current Announcement?',
      'Are you sure you want to remove the current announcement?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try { await adminRemoveCurrentAnnouncement(supabase); load(); }
            catch (e: any) { Alert.alert('Error', e.message); }
            finally { setRemoving(false); }
          },
        },
      ],
    );
  }
  function setApp(enabled: boolean) {
    Alert.alert(enabled ? 'Enable app?' : 'Disable the app for ALL users?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: enabled ? 'Enable' : 'Disable', style: enabled ? 'default' : 'destructive', onPress: async () => { try { await adminSetAppEnabled(supabase, enabled); Alert.alert(enabled ? 'App enabled.' : 'App disabled.'); } catch (e: any) { Alert.alert('Error', e.message); } } },
    ]);
  }
  return (
    <ScrollView contentContainerStyle={styles.listPad}>
      <Text style={styles.subhead}>Broadcast to all users</Text>
      <View style={styles.chipRow}>
        {KINDS.map((k) => (
          <Pressable key={k} onPress={() => setKind(k)} style={[styles.durChip, kind === k && styles.durChipActive]}>
            <Text style={[styles.durChipText, kind === k && styles.durChipTextActive]}>{k.replace('_', ' ')}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={styles.field} value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={colors.textFaint} />
      <TextInput style={[styles.field, styles.fieldMulti]} value={body} onChangeText={setBody} placeholder="Message (optional)" placeholderTextColor={colors.textFaint} multiline />
      <Pressable style={[styles.searchBtn, { alignSelf: 'flex-start', opacity: title.trim() && !busy ? 1 : 0.5 }]} onPress={send} disabled={!title.trim() || busy}>
        <Text style={styles.searchBtnText}>Send</Text>
      </Pressable>
      <Pressable
        style={[styles.searchBtn, { alignSelf: 'flex-start', marginTop: 10, backgroundColor: colors.danger, opacity: !list.length || removing ? 0.5 : 1 }]}
        onPress={removeCurrent}
        disabled={!list.length || removing}
      >
        <Text style={styles.searchBtnText}>{removing ? 'Removing…' : list.length ? 'Remove Current Announcement' : 'No active announcement'}</Text>
      </Pressable>

      <Text style={styles.subhead}>App availability</Text>
      <View style={styles.rowActions}>
        <MiniBtn label="Disable app" danger onPress={() => setApp(false)} colors={colors} />
        <MiniBtn label="Enable app" onPress={() => setApp(true)} colors={colors} />
      </View>

      <Text style={styles.subhead}>Active announcements</Text>
      {list.length === 0 && <Text style={styles.empty}>None active.</Text>}
      {list.map((a) => (
        <View key={a.id} style={styles.compactRow}>
          <Text style={styles.tag}>{a.kind}</Text>
          <Text style={styles.rowTitle}>{a.title}</Text>
          <Text style={styles.rowMeta}>{new Date(a.created_at).toLocaleDateString()}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ── Audit log tab (owner) ─────────────────────────────────────────────────────
function AuditTab({ colors, styles }: { colors: Palette; styles: Styles }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { adminAuditLog(supabase, 300).then(setRows).catch((e) => setErr(e.message)); }, []);
  if (err) return <Text style={styles.warn}>{err}</Text>;
  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.listPad}
      ListEmptyComponent={<Text style={styles.empty}>No audit entries yet.</Text>}
      renderItem={({ item: r }) => (
        <View style={styles.compactRow}>
          <Text style={styles.tag}>{r.action}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowBody} numberOfLines={1}>{r.actor_email || (r.actor_id ? r.actor_id.slice(0, 8) : '—')} → {r.target ? String(r.target).slice(0, 12) : '—'}</Text>
            <Text style={styles.rowMeta}>{new Date(r.created_at).toLocaleString()}</Text>
          </View>
        </View>
      )}
    />
  );
}

// ── Streak audit tab (admin, READ-ONLY) ───────────────────────────────────────
// Surfaces milestone/reward history, moderator rewards, and Hall of Legends via the
// admin-gated admin_streak_audit() RPC. Intentionally has NO score-write controls —
// streak scores are server-authoritative and not admin-editable.
function StreakAuditTab({ colors, styles }: { colors: Palette; styles: Styles }) {
  const [data, setData] = useState<{ milestones: any[]; mod_grants: any[]; hall_of_legends: any[]; recent_events: any[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getStreakAudit(supabase, 200).then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <Text style={styles.warn}>{err}</Text>;
  if (!data) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  const kindLabel = (k: string) => k === 'diamond' ? '💎 Diamond' : k === 'hall_of_legends' ? '🏆 Hall of Legends' : '🛡 Mod milestone';
  return (
    <ScrollView contentContainerStyle={styles.listPad}>
      <Text style={styles.subhead}>Milestones & rewards ({data.milestones.length})</Text>
      {data.milestones.length === 0 && <Text style={styles.empty}>None yet.</Text>}
      {data.milestones.map((m, i) => (
        <View key={i} style={styles.compactRow}>
          <Text style={styles.tag}>{kindLabel(m.kind)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowBody} numberOfLines={1}>score {m.achieved_score} · now {m.current_score}{m.reward_granted ? ' · rewarded' : ''}</Text>
            <Text style={styles.rowMeta}>{new Date(m.achieved_at).toLocaleString()}</Text>
          </View>
        </View>
      ))}

      <Text style={styles.subhead}>Moderator rewards ({data.mod_grants.length})</Text>
      {data.mod_grants.length === 0 && <Text style={styles.empty}>None yet.</Text>}
      {data.mod_grants.map((g, i) => (
        <View key={i} style={styles.compactRow}>
          <Text style={styles.tag}>🛡</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowBody} numberOfLines={1}>moderator {String(g.moderator_id).slice(0, 8)}</Text>
            <Text style={styles.rowMeta}>{new Date(g.created_at).toLocaleString()}</Text>
          </View>
        </View>
      ))}

      <Text style={styles.subhead}>Hall of Legends ({data.hall_of_legends.length})</Text>
      {data.hall_of_legends.length === 0 && <Text style={styles.empty}>None yet.</Text>}
      {data.hall_of_legends.map((h, i) => (
        <View key={i} style={styles.compactRow}>
          <Text style={styles.tag}>🏆</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowBody} numberOfLines={1}>{String(h.user_lo).slice(0, 8)} & {String(h.user_hi).slice(0, 8)} · now {h.current_score}</Text>
            <Text style={styles.rowMeta}>{new Date(h.achieved_at).toLocaleString()}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function MiniBtn({ label, onPress, danger, colors }: { label: string; onPress: () => void; danger?: boolean; colors: Palette }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{
      paddingHorizontal: spacing(3), paddingVertical: spacing(1.5), borderRadius: radius.sm,
      backgroundColor: danger ? colors.danger + '22' : colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth, borderColor: danger ? colors.danger : colors.border, opacity: pressed ? 0.7 : 1,
    }]}>
      <Text style={{ color: danger ? colors.danger : colors.text, fontSize: font.tiny, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;
const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(6) },
    empty: { color: colors.textMuted, fontSize: font.small, textAlign: 'center', padding: spacing(6) },
    warn: { color: colors.danger, fontSize: font.small, padding: spacing(3) },
    hint: { color: colors.textFaint, fontSize: font.tiny, marginBottom: spacing(2) },
    subhead: { color: colors.text, fontSize: font.small, fontWeight: '700', marginTop: spacing(4), marginBottom: spacing(2) },
    tabBarWrap: { backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    tabBar: { paddingHorizontal: spacing(2), paddingVertical: spacing(2), gap: spacing(2) },
    tabChip: { paddingHorizontal: spacing(3.5), paddingVertical: spacing(2), borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
    tabChipActive: { backgroundColor: colors.primary },
    tabText: { color: colors.textMuted, fontSize: font.small, fontWeight: '600' },
    tabTextActive: { color: '#fff' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing(2), gap: spacing(2) },
    stat: { width: '31%', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(3), alignItems: 'center', flexGrow: 1 },
    statIcon: { fontSize: 20 },
    statNum: { color: colors.text, fontSize: font.title, fontWeight: '800', marginTop: 2 },
    statLabel: { color: colors.textMuted, fontSize: font.tiny, marginTop: 2, textAlign: 'center' },
    listPad: { padding: spacing(3), paddingBottom: spacing(10) },
    row: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(3), marginBottom: spacing(2) },
    rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing(1) },
    rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    rowBody: { color: colors.textMuted, fontSize: font.small, marginTop: 2, flexShrink: 1 },
    rowMeta: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
    rowActions: { flexDirection: 'row', gap: spacing(2), marginTop: spacing(2), flexWrap: 'wrap' },
    rowStatus: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700' },
    tag: { color: colors.primary, fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase' },
    compactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing(2.5), marginBottom: spacing(1.5) },
    searchBar: { flexDirection: 'row', gap: spacing(2), padding: spacing(3), alignItems: 'center' },
    searchInput: { flex: 1, backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radius.md, paddingHorizontal: spacing(3), paddingVertical: spacing(2.5), fontSize: font.body },
    searchBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing(4), paddingVertical: spacing(2.5) },
    searchBtnText: { color: '#fff', fontWeight: '700', fontSize: font.small },
    userRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(3), marginBottom: spacing(2) },
    userName: { color: colors.text, fontSize: font.body, fontWeight: '600', flexShrink: 1 },
    userSub: { color: colors.textMuted, fontSize: font.tiny, marginTop: 2 },
    ownerBadge: { color: colors.accentPlusText, fontSize: 9, fontWeight: '800' },
    roleBadge: { color: colors.textMuted, fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
    healthRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing(3), marginBottom: spacing(1.5) },
    healthVal: { color: colors.text, fontSize: font.small, fontWeight: '700' },
    flagRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing(3), marginBottom: spacing(1.5) },
    toggle: { paddingHorizontal: spacing(3), paddingVertical: spacing(1.5), borderRadius: radius.pill },
    toggleOn: { backgroundColor: colors.primary },
    toggleOff: { backgroundColor: colors.surfaceAlt },
    toggleText: { fontSize: font.tiny, fontWeight: '700' },
    durChip: { paddingHorizontal: spacing(3), paddingVertical: spacing(1.5), borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
    durChipActive: { backgroundColor: colors.primary },
    durChipText: { color: colors.textMuted, fontSize: font.small, textTransform: 'capitalize' },
    durChipTextActive: { color: '#fff', fontWeight: '700' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginBottom: spacing(2) },
    field: { backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radius.md, paddingHorizontal: spacing(3), paddingVertical: spacing(2.5), fontSize: font.body, marginBottom: spacing(2) },
    fieldMulti: { minHeight: 70, textAlignVertical: 'top' },
  });
