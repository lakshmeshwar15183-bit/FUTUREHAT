// Lumixo mobile — client enforcement of the owner/admin controls, mirroring
// web/src/admin/AdminGate.tsx. Mounted high in the tree; it:
//   • registers this device (so the Owner can see/revoke it),
//   • registers this session in user_sessions (2-phone limit + device list),
//   • signs out banned / disabled / locked accounts,
//   • honours a force-logout pulse (force_logout_at),
//   • honours per-session revocation (remote sign-out / phone limit),
//   • shows a maintenance screen when the `app_enabled` flag is off (non-admins),
//   • shows the latest active announcement as a dismissible banner.
// Fail-safe: any error path renders null and never blocks the app. Authoritative
// enforcement lives in the RLS + RPCs; this is advisory UX.
import React, { useEffect, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

import { supabase } from '../lib/supabase';
import {
  getCurrentUser, signOut, getServerAdmin,
  registerDevice, isFeatureEnabled, getActiveAnnouncements,
  registerSession, subscribeToSessionRevoked, revokedSignOutMessage, getSessionId,
} from '../lib/shared';
import type { Announcement, RevokedReason, SessionPlatform } from '../lib/shared';
import { decideForceLogout, sessionIssuedAtMs } from '../../../shared/forceLogout';
import { useColors } from '../theme';

const BLOCKED = new Set(['banned', 'disabled', 'locked']);
const DEVICE_KEY = 'fh:deviceId';
const FORCE_ACK_KEY = 'fh:forceLogoutAck';

// Cheap RFC4122-ish id; only needs to be stable + unique per install.
function makeId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const SESSION_PLATFORM: SessionPlatform = Platform.OS === 'ios' ? 'ios' : 'android';
const DEVICE_LABEL = (Constants.deviceName ?? `${Platform.OS} device`).slice(0, 120);

// Sign out because THIS session was revoked (phone limit / remote sign-out).
let revokeHandled = false;
function handleSessionRevoked(reason: RevokedReason | null) {
  if (revokeHandled) return;
  revokeHandled = true;
  Alert.alert('Signed out', revokedSignOutMessage(reason));
  void signOut(supabase).finally(() => { revokeHandled = false; });
}

export default function AdminGate() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [blocked, setBlocked] = useState<string | null>(null);
  const [maintenance, setMaintenance] = useState(false);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const user = await getCurrentUser(supabase).catch(() => null);
      if (!user) { if (active) { setBlocked(null); setMaintenance(false); setAnnouncement(null); } return; }

      // 1) Register this device (best-effort).
      try {
        let devId = await AsyncStorage.getItem(DEVICE_KEY);
        if (!devId) { devId = makeId(); await AsyncStorage.setItem(DEVICE_KEY, devId); }
        void registerDevice(supabase, devId, `${Platform.OS} device`, Platform.OS);
      } catch { /* ignore */ }

      // 1b) Register this session (2-phone limit + device list). If the server
      // says THIS session was revoked, sign out with an explanation.
      try {
        const res = await registerSession(supabase, SESSION_PLATFORM, DEVICE_LABEL);
        if (res.revoked) { if (active) handleSessionRevoked(res.reason ?? null); return; }
      } catch { /* RPC may predate the migration — ignore */ }

      // 2) Enforce account status + force-logout from the caller's own row.
      try {
        const { data } = await supabase
          .from('profiles')
          .select('account_status, force_logout_at')
          .eq('id', user.id)
          .maybeSingle();
        if (!active) return;
        const row = data as { account_status?: string; force_logout_at?: string } | null;
        if (row?.account_status && BLOCKED.has(row.account_status)) {
          setBlocked(row.account_status);
          void signOut(supabase);
          return;
        }
        if (row?.force_logout_at) {
          // Only revoke sessions that predate the force-logout stamp.
          // Fresh logins (after "sign out everywhere" / password change) must stay.
          const ack = await AsyncStorage.getItem(FORCE_ACK_KEY);
          const { data: sessWrap } = await supabase.auth.getSession();
          const decision = decideForceLogout(
            row.force_logout_at,
            sessionIssuedAtMs(sessWrap.session),
            ack,
          );
          if (decision === 'revoke') {
            await AsyncStorage.setItem(FORCE_ACK_KEY, row.force_logout_at);
            void signOut(supabase);
            return;
          }
          if (decision === 'ack_keep' && ack !== row.force_logout_at) {
            await AsyncStorage.setItem(FORCE_ACK_KEY, row.force_logout_at);
          }
        }
      } catch { /* columns may predate the migration — ignore */ }

      // 3) App kill-switch (non-admins only).
      try {
        const [enabled, isAdmin] = await Promise.all([
          isFeatureEnabled(supabase, 'app_enabled', true),
          getServerAdmin(supabase).catch(() => false),
        ]);
        if (active && !enabled && !isAdmin) setMaintenance(true);
      } catch { /* ignore */ }

      // 4) Latest announcement banner.
      try {
        const anns = await getActiveAnnouncements(supabase);
        if (active && anns.length) setAnnouncement(anns[0]);
      } catch { /* ignore */ }
    })();
    return () => { active = false; };
  }, []);

  // Realtime: drop the banner the instant the active announcement is removed
  // (or replaced) — no restart or manual refresh needed. Reuses the existing
  // getActiveAnnouncements read path + the supabase_realtime publication on the
  // announcements table (added in 0020). Fail-safe: errors are ignored.
  useEffect(() => {
    const ch = supabase
      .channel('admin-announcements')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => {
        getActiveAnnouncements(supabase)
          .then((anns) => { setAnnouncement(anns.length ? anns[0] : null); })
          .catch(() => { /* ignore — never block the app */ });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Per-session revocation: realtime pulse on our own user_sessions row (~1s
  // when foregrounded) + re-register on every foreground as fallback/heartbeat.
  // AdminGate unmounts on sign-out, so cleanup handles teardown. Fail-safe:
  // if the table/RPC doesn't exist yet, everything no-ops.
  useEffect(() => {
    let channel: ReturnType<typeof subscribeToSessionRevoked> | null = null;
    let active = true;

    (async () => {
      const sid = await getSessionId(supabase).catch(() => null);
      if (!sid || !active) return;
      channel = subscribeToSessionRevoked(supabase, sid, (reason) => {
        if (active) handleSessionRevoked(reason);
      });
    })();

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      registerSession(supabase, SESSION_PLATFORM, DEVICE_LABEL)
        .then((res) => { if (active && res.revoked) handleSessionRevoked(res.reason ?? null); })
        .catch(() => { /* ignore */ });
    });

    return () => {
      active = false;
      sub.remove();
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  if (blocked) {
    return <Overlay title="Account unavailable" body={`Your account has been ${blocked}. Contact support if you believe this is a mistake.`} colors={colors} />;
  }
  if (maintenance) {
    return <Overlay title="Under maintenance" body="Lumixo is temporarily unavailable. Please check back soon." colors={colors} />;
  }
  if (announcement && !dismissed) {
    return (
      <View style={[styles.banner, { paddingTop: insets.top + 8 }]} accessibilityRole="alert">
        <Text style={styles.bannerText}>
          <Text style={{ fontWeight: '800', textTransform: 'capitalize' }}>{announcement.kind.replace('_', ' ')}: </Text>
          <Text style={{ fontWeight: '700' }}>{announcement.title}</Text>
          {announcement.body ? <Text style={{ opacity: 0.9 }}> — {announcement.body}</Text> : null}
        </Text>
        <Pressable style={styles.bannerClose} hitSlop={8} onPress={() => setDismissed(true)}>
          <Text style={styles.bannerCloseText}>✕</Text>
        </Pressable>
      </View>
    );
  }
  return null;
}

function Overlay({ title, body, colors }: { title: string; body: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={{ fontSize: 40, marginBottom: 12 }}>🛠️</Text>
        <Text style={[styles.overlayTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.overlayBody, { color: colors.textMuted }]}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 900,
    backgroundColor: '#6C5CE7',
    paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center',
  },
  bannerText: { color: '#fff', fontSize: 13, flex: 1, lineHeight: 18 },
  bannerClose: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  bannerCloseText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  overlay: { zIndex: 2000, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.72)', padding: 20 },
  card: { maxWidth: 420, width: '100%', alignItems: 'center', padding: 32, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  overlayTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  overlayBody: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
