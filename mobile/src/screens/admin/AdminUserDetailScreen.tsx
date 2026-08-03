// Lumixo mobile — Admin ▸ User detail + actions. Native drilldown from the
// Admin dashboard's Users tab. Mirrors web AdminUsers.tsx: every button calls a
// server RPC (via @shared/adminApi) that re-checks privilege and writes an
// audit_log row — this screen only decides what to *offer*. Owner accounts are
// protected from non-owners; admin role + lifetime premium are owner-only.
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native';
import SafeScrollView from '../../ui/SafeScrollView';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../../lib/supabase';
import {
  adminGetUser,
  adminBanUser, adminSuspendUser, adminRestoreUser, adminDisableUser, adminLockUser,
  adminVerifyUser, adminForceLogout, adminDeleteAccount, adminSetRole,
  adminGrantPremium, adminRevokePremium, adminRemoveDevice,
  assignModerator, removeModerator,
} from '../../lib/shared';
import type { AdminUserDetail, PremiumDuration } from '../../lib/shared';
import InputModal from '../../components/InputModal';
import Avatar from '../../components/Avatar';
import { useColors, spacing, radius, font, type Palette } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';
import { Alert } from '../../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList, 'AdminUserDetail'>;
type Rt = RouteProp<RootStackParamList, 'AdminUserDetail'>;

const DURATIONS: { id: PremiumDuration; label: string; ownerOnly?: boolean }[] = [
  { id: '1m', label: '1 Month' }, { id: '3m', label: '3 Months' },
  { id: '6m', label: '6 Months' }, { id: '1y', label: '1 Year' },
  { id: 'lifetime', label: 'Lifetime', ownerOnly: true }, { id: 'custom', label: 'Custom…' },
];

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return '—'; }
}

export default function AdminUserDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { userId, isOwner } = route.params;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [u, setU] = useState<AdminUserDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dur, setDur] = useState<PremiumDuration>('1m');
  // Which InputModal is open, if any.
  const [prompt, setPrompt] = useState<null | 'ban' | 'suspend' | 'disable' | 'lock' | 'delete' | 'custom'>(null);

  const load = useCallback(async () => {
    try { setU(await adminGetUser(supabase, userId)); }
    catch (e: any) { setMsg(e?.message ?? 'Could not load user'); }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Run an action, refresh detail, surface a ✓/✗ toast line.
  async function act(fn: () => Promise<void>, label: string) {
    setBusy(true); setMsg(null);
    try { await fn(); await load(); setMsg(`✓ ${label}`); }
    catch (e: any) { setMsg(`✗ ${label}: ${e?.message ?? 'failed'}`); }
    finally { setBusy(false); }
  }

  function confirmThen(title: string, message: string, fn: () => Promise<void>, label: string, destructive = false) {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: destructive ? 'Confirm' : 'OK', style: destructive ? 'destructive' : 'default', onPress: () => act(fn, label) },
    ]);
  }

  if (!u) {
    return (
      <View style={styles.center}>
        {msg ? <Text style={styles.warn}>{msg}</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  // The permanent OWNER account is absolutely protected: no one (not even the
  // Owner viewing their own account) may ban/suspend/disable/lock/force-logout/
  // delete/demote/un-verify/manage it. When the target is an owner we replace all
  // management controls with a clean read-only "Owner account — protected" state.
  // The server (0013 _guard_owner_target + 0026 _guard_protect_owner) enforces the
  // same rule regardless of what the client sends.
  const protectedOwner = !!u.owner;
  const disabled = busy || protectedOwner;

  return (
    <>
      <SafeScrollView style={styles.container} contentContainerStyle={{ paddingBottom: spacing(10) }}>
        {/* Header */}
        <View style={styles.head}>
          <Avatar uri={u.avatar_url} name={u.display_name ?? u.username} size={60} />
          <View style={{ flex: 1, marginLeft: spacing(3) }}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{u.display_name || 'Unnamed'}</Text>
              {u.verified && <Ionicons name="checkmark-circle" size={16} color={colors.primary} />}
              {u.owner && <Text style={styles.ownerBadge}>OWNER</Text>}
              {u.role === 'moderator' && <Text style={styles.modBadge}>🛡 MOD</Text>}
              {u.premium && <Text style={styles.premiumBadge}>Lumixo+</Text>}
            </View>
            <Text style={styles.sub}>@{u.username || '—'} · {u.role}</Text>
          </View>
          <Text style={[styles.status, statusStyle(u.account_status, colors)]}>{u.account_status}</Text>
        </View>

        {protectedOwner && (
          <View style={styles.protectedCard}>
            <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: spacing(2.5) }}>
              <Text style={styles.protectedTitle}>Owner account — protected</Text>
              <Text style={styles.protectedBody}>
                This is the permanent Lumixo Owner. It cannot be banned, suspended, disabled,
                locked, logged out, deleted, demoted, un-verified, or otherwise modified.
              </Text>
            </View>
          </View>
        )}
        {msg && <Text style={styles.toast}>{msg}</Text>}

        {/* Key/value facts */}
        <View style={styles.kv}>
          <KV label="User ID" value={u.id} mono colors={colors} />
          <KV label="Email" value={u.email || '—'} colors={colors} />
          <KV label="Phone" value={u.phone || '—'} colors={colors} />
          <KV label="Created" value={fmt(u.created_at)} colors={colors} />
          <KV label="Last online" value={fmt(u.last_seen)} colors={colors} />
          <KV label="Premium ends" value={u.subscription?.current_period_end ? fmt(u.subscription.current_period_end) : '—'} colors={colors} />
          {u.status_reason ? <KV label="Status reason" value={u.status_reason} colors={colors} /> : null}
          {u.suspended_until ? <KV label="Suspended until" value={fmt(u.suspended_until)} colors={colors} /> : null}
        </View>

        {/* Management controls — hidden entirely for the protected Owner account. */}
        {!protectedOwner && (<>
        {/* Account actions */}
        <Group title="Account" colors={colors}>
          <ActionBtn label="Ban" danger disabled={disabled} onPress={() => setPrompt('ban')} colors={colors} />
          <ActionBtn label="Suspend" disabled={disabled} onPress={() => setPrompt('suspend')} colors={colors} />
          <ActionBtn label="Restore / Unban" disabled={disabled} onPress={() => act(() => adminRestoreUser(supabase, u.id), 'Restored')} colors={colors} />
          <ActionBtn label="Disable" disabled={disabled} onPress={() => setPrompt('disable')} colors={colors} />
          <ActionBtn label="Lock" disabled={disabled} onPress={() => setPrompt('lock')} colors={colors} />
          <ActionBtn label="Force logout" disabled={disabled} onPress={() => act(() => adminForceLogout(supabase, u.id), 'Forced logout')} colors={colors} />
          <ActionBtn label="Delete" danger disabled={disabled} onPress={() => setPrompt('delete')} colors={colors} />
        </Group>

        {/* Verification */}
        <Group title="Verification" colors={colors}>
          <ActionBtn label="Verify" disabled={disabled} onPress={() => act(() => adminVerifyUser(supabase, u.id, true), 'Verified')} colors={colors} />
          <ActionBtn label="Remove verification" disabled={disabled} onPress={() => act(() => adminVerifyUser(supabase, u.id, false), 'Verification removed')} colors={colors} />
        </Group>

        {/* Premium */}
        <Group title="Premium" colors={colors}>
          <View style={styles.durationRow}>
            {DURATIONS.filter((d) => !d.ownerOnly || isOwner).map((d) => (
              <Pressable
                key={d.id}
                onPress={() => { if (d.id === 'custom') { setDur('custom'); setPrompt('custom'); } else setDur(d.id); }}
                style={[styles.durChip, dur === d.id && styles.durChipActive]}
              >
                <Text style={[styles.durChipText, dur === d.id && styles.durChipTextActive]}>{d.label}</Text>
              </Pressable>
            ))}
          </View>
          <ActionBtn
            label={`Grant / Gift (${dur})`}
            disabled={disabled || dur === 'custom'}
            onPress={() => act(() => adminGrantPremium(supabase, u.id, dur), `Premium: ${dur}`)}
            colors={colors}
          />
          <ActionBtn label="Remove premium" disabled={disabled} onPress={() => act(() => adminRevokePremium(supabase, u.id), 'Premium removed')} colors={colors} />
        </Group>

        {/* Role */}
        <Group title="Role" colors={colors}>
          <ActionBtn label="Demote to User" disabled={disabled} onPress={() => act(() => adminSetRole(supabase, u.id, 'user'), 'Set: User')} colors={colors} />
          {u.role === 'moderator' ? (
            <ActionBtn
              label="Remove Moderator" danger disabled={disabled}
              onPress={() => confirmThen(
                'Remove Moderator?',
                `${u.display_name || 'This user'} will be notified and lose the Moderator Dashboard.`,
                () => removeModerator(supabase, u.id), 'Moderator removed', true,
              )}
              colors={colors}
            />
          ) : (
            <ActionBtn
              label="Assign Moderator" disabled={disabled}
              onPress={() => confirmThen(
                'Assign Moderator?',
                `Appoint ${u.display_name || 'this user'} as an official Lumixo Moderator? They will be notified and gain the Moderator Dashboard.`,
                () => assignModerator(supabase, u.id), 'Moderator assigned',
              )}
              colors={colors}
            />
          )}
          {/* Admin is permanent (single hardcoded owner/admin) — never assignable via the app. */}
        </Group>
        </>)}

        {/* Devices (read-only for the protected Owner — the Remove button is disabled) */}
        <Group title={`Devices (${u.devices.length})`} colors={colors} column>
          {u.devices.length === 0 && <Text style={styles.hint}>No registered devices.</Text>}
          {u.devices.map((d) => (
            <View key={d.id} style={styles.deviceRow}>
              <Text style={styles.deviceText} numberOfLines={1}>
                📱 {d.name || d.device_id} · {d.platform || '?'} · {new Date(d.last_seen).toLocaleDateString()}
              </Text>
              <Pressable disabled={disabled} onPress={() => act(() => adminRemoveDevice(supabase, d.id), 'Device removed')}>
                <Text style={[styles.deviceRemove, disabled && { opacity: 0.4 }]}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </Group>

        {/* Security events */}
        {u.recent_security.length > 0 && (
          <Group title="Recent security events" colors={colors} column>
            {u.recent_security.slice(0, 8).map((e, i) => (
              <Text key={i} style={styles.secRow}>
                <Text style={{ fontWeight: '700', color: colors.text }}>{e.kind}</Text> · {e.ip || '—'} · {fmt(e.created_at)}
              </Text>
            ))}
          </Group>
        )}
      </SafeScrollView>

      {/* Prompt modals for the reason/duration inputs */}
      <InputModal
        visible={prompt === 'ban'}
        title="Ban account"
        submitLabel="Ban"
        fields={[{ key: 'reason', placeholder: 'Ban reason (optional)' }]}
        onCancel={() => setPrompt(null)}
        onSubmit={(v) => { setPrompt(null); act(() => adminBanUser(supabase, u.id, v.reason || undefined), 'Banned'); }}
      />
      <InputModal
        visible={prompt === 'suspend'}
        title="Suspend account"
        submitLabel="Suspend"
        fields={[{ key: 'days', placeholder: 'Suspend for how many days?', initial: '7' }, { key: 'reason', placeholder: 'Reason (optional)' }]}
        onCancel={() => setPrompt(null)}
        onSubmit={(v) => {
          setPrompt(null);
          const days = Number(v.days) || 7;
          const until = new Date(Date.now() + days * 864e5).toISOString();
          act(() => adminSuspendUser(supabase, u.id, until, v.reason || 'temporary suspension'), `Suspended ${days}d`);
        }}
      />
      <InputModal
        visible={prompt === 'disable'}
        title="Disable account"
        submitLabel="Disable"
        fields={[{ key: 'reason', placeholder: 'Reason (optional)' }]}
        onCancel={() => setPrompt(null)}
        onSubmit={(v) => { setPrompt(null); act(() => adminDisableUser(supabase, u.id, v.reason || undefined), 'Disabled'); }}
      />
      <InputModal
        visible={prompt === 'lock'}
        title="Lock account"
        submitLabel="Lock"
        fields={[{ key: 'reason', placeholder: 'Reason (optional)', initial: 'suspicious activity' }]}
        onCancel={() => setPrompt(null)}
        onSubmit={(v) => { setPrompt(null); act(() => adminLockUser(supabase, u.id, v.reason || undefined), 'Locked'); }}
      />
      <InputModal
        visible={prompt === 'delete'}
        title="Delete account"
        submitLabel="Delete"
        fields={[{ key: 'reason', placeholder: 'Delete reason (optional)' }]}
        onCancel={() => setPrompt(null)}
        onSubmit={(v) => {
          setPrompt(null);
          confirmThen('Delete this account?', 'Soft-delete + deletion request. This cannot be easily undone.',
            () => adminDeleteAccount(supabase, u.id, v.reason || undefined), 'Deleted', true);
        }}
      />
      <InputModal
        visible={prompt === 'custom'}
        title="Custom premium end date"
        submitLabel="Grant"
        fields={[{ key: 'end', placeholder: 'YYYY-MM-DD' }]}
        onCancel={() => setPrompt(null)}
        onSubmit={(v) => {
          setPrompt(null);
          const iso = new Date(v.end).toISOString();
          act(() => adminGrantPremium(supabase, u.id, 'custom', iso), `Premium: custom`);
        }}
      />
    </>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────────
function KV({ label, value, mono, colors }: { label: string; value: string; mono?: boolean; colors: Palette }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing(1.5), gap: spacing(3) }}>
      <Text style={{ color: colors.textMuted, fontSize: font.small }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: font.small, flexShrink: 1, textAlign: 'right', fontFamily: mono ? 'monospace' : undefined }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Group({ title, children, colors, column }: { title: string; children: React.ReactNode; colors: Palette; column?: boolean }) {
  return (
    <View style={{ marginTop: spacing(4), paddingHorizontal: spacing(4) }}>
      <Text style={{ color: colors.textMuted, fontSize: font.small, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing(2) }}>{title}</Text>
      <View style={{ flexDirection: column ? 'column' : 'row', flexWrap: 'wrap', gap: spacing(2) }}>{children}</View>
    </View>
  );
}

function ActionBtn({ label, onPress, danger, disabled, colors }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean; colors: Palette }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [{
        paddingHorizontal: spacing(3.5), paddingVertical: spacing(2.5), borderRadius: radius.md,
        backgroundColor: danger ? colors.danger + '22' : colors.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth, borderColor: danger ? colors.danger : colors.border,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      }]}
    >
      <Text style={{ color: danger ? colors.danger : colors.text, fontSize: font.small, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function statusStyle(status: string, colors: Palette) {
  const bad = status === 'banned' || status === 'disabled' || status === 'locked';
  const warn = status === 'suspended';
  return { color: bad ? colors.danger : warn ? colors.accentPlusText : colors.primary };
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing(6) },
    head: { flexDirection: 'row', alignItems: 'center', padding: spacing(4), backgroundColor: colors.surface },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), flexWrap: 'wrap' },
    name: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
    sub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    ownerBadge: { color: colors.accentPlusText, fontSize: font.tiny, fontWeight: '800' },
    modBadge: { color: '#fff', backgroundColor: '#3b82f6', fontSize: 9, fontWeight: '800', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
    premiumBadge: { color: colors.accentPlusText, fontSize: font.tiny, fontWeight: '700' },
    status: { fontSize: font.small, fontWeight: '700', textTransform: 'capitalize' },
    warn: { color: colors.danger, fontSize: font.small, paddingHorizontal: spacing(4), paddingTop: spacing(3) },
    protectedCard: { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: spacing(4), marginTop: spacing(3), padding: spacing(3.5), borderRadius: radius.md, backgroundColor: colors.primary + '14', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.primary + '55' },
    protectedTitle: { color: colors.text, fontSize: font.body, fontWeight: '800' },
    protectedBody: { color: colors.textMuted, fontSize: font.small, marginTop: 2, lineHeight: 18 },
    toast: { color: colors.textMuted, fontSize: font.small, paddingHorizontal: spacing(4), paddingTop: spacing(2) },
    kv: { backgroundColor: colors.surface, marginTop: spacing(3), paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
    hint: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing(1) },
    durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), width: '100%', marginBottom: spacing(2) },
    durChip: { paddingHorizontal: spacing(3), paddingVertical: spacing(1.5), borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    durChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    durChipText: { color: colors.textMuted, fontSize: font.small },
    durChipTextActive: { color: '#fff', fontWeight: '700' },
    deviceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingVertical: spacing(1.5) },
    deviceText: { color: colors.text, fontSize: font.small, flex: 1, marginRight: spacing(2) },
    deviceRemove: { color: colors.danger, fontSize: font.small, fontWeight: '600' },
    secRow: { color: colors.textMuted, fontSize: font.tiny, paddingVertical: spacing(1), width: '100%' },
  });
