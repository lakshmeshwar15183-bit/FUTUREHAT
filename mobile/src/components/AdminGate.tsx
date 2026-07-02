// FUTUREHAT mobile — client enforcement of the owner/admin controls, mirroring
// web/src/admin/AdminGate.tsx. Mounted high in the tree; it:
//   • registers this device (so the Owner can see/revoke it),
//   • signs out banned / disabled / locked accounts,
//   • honours a force-logout pulse (force_logout_at),
//   • shows a maintenance screen when the `app_enabled` flag is off (non-admins),
//   • shows the latest active announcement as a dismissible banner.
// Fail-safe: any error path renders null and never blocks the app. Authoritative
// enforcement lives in the RLS + RPCs; this is advisory UX.
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '../lib/supabase';
import {
  getCurrentUser, signOut, getServerAdmin,
  registerDevice, isFeatureEnabled, getActiveAnnouncements,
} from '../lib/shared';
import type { Announcement } from '../lib/shared';
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
          const ack = await AsyncStorage.getItem(FORCE_ACK_KEY);
          if (ack !== row.force_logout_at) {
            await AsyncStorage.setItem(FORCE_ACK_KEY, row.force_logout_at);
            void signOut(supabase);
            return;
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

  if (blocked) {
    return <Overlay title="Account unavailable" body={`Your account has been ${blocked}. Contact support if you believe this is a mistake.`} colors={colors} />;
  }
  if (maintenance) {
    return <Overlay title="Under maintenance" body="FUTUREHAT is temporarily unavailable. Please check back soon." colors={colors} />;
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
