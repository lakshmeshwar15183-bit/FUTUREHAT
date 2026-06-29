// FUTUREHAT mobile — Privacy settings. Visibility controls (last seen, photo,
// about, links, status, groups, calls, avatar), read receipts, and a blocked-
// contacts manager. Standalone screen; persists via privacyApi / supportApi.
// Wire into RootStackParamList + SettingsScreen on recovery (see PHASE4 log).
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../lib/supabase';
import {
  getPrivacy, setPrivacy, getBlockedIds, unblockUser, getProfile,
  type PrivacySettings, type Visibility, type Profile,
} from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';

const VIS_ROWS: { key: keyof PrivacySettings; label: string }[] = [
  { key: 'lastSeen', label: 'Last seen & online' },
  { key: 'profilePhoto', label: 'Profile photo' },
  { key: 'about', label: 'About' },
  { key: 'links', label: 'Links' },
  { key: 'status', label: 'Status' },
  { key: 'groups', label: 'Groups' },
  { key: 'calls', label: 'Calls' },
  { key: 'avatar', label: 'Avatar' },
];
const VIS_LABEL: Record<Visibility, string> = { everyone: 'Everyone', contacts: 'My contacts', nobody: 'Nobody' };

export default function PrivacyScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [p, setP] = useState<PrivacySettings | null>(null);
  const [blocked, setBlocked] = useState<Profile[]>([]);

  useEffect(() => {
    getPrivacy(supabase).then(setP).catch(() => {});
    (async () => {
      const ids = await getBlockedIds(supabase).catch(() => [] as string[]);
      const profiles = await Promise.all(ids.map((id) => getProfile(supabase, id).catch(() => null)));
      setBlocked(profiles.filter(Boolean) as Profile[]);
    })();
  }, []);

  async function update(patch: Partial<PrivacySettings>) {
    setP((cur) => (cur ? { ...cur, ...patch } : cur));
    await setPrivacy(supabase, patch);
  }

  function pickVisibility(key: keyof PrivacySettings) {
    Alert.alert(VIS_ROWS.find((r) => r.key === key)?.label ?? 'Visibility', 'Who can see this?', [
      { text: 'Everyone', onPress: () => update({ [key]: 'everyone' } as Partial<PrivacySettings>) },
      { text: 'My contacts', onPress: () => update({ [key]: 'contacts' } as Partial<PrivacySettings>) },
      { text: 'Nobody', onPress: () => update({ [key]: 'nobody' } as Partial<PrivacySettings>) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function unblock(id: string) {
    setBlocked((b) => b.filter((x) => x.id !== id));
    await unblockUser(supabase, id);
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionLabel}>WHO CAN SEE</Text>
      <View style={styles.group}>
        {p && VIS_ROWS.map((row) => (
          <Pressable key={row.key} style={styles.row} onPress={() => pickVisibility(row.key)}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <Text style={styles.rowValue}>{VIS_LABEL[p[row.key] as Visibility]}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>RECEIPTS</Text>
      <View style={styles.group}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Read receipts</Text>
          <Switch
            value={!!p?.readReceipts}
            onValueChange={(v) => update({ readReceipts: v })}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
      </View>

      <Text style={styles.sectionLabel}>BLOCKED CONTACTS ({blocked.length})</Text>
      <View style={styles.group}>
        {blocked.length === 0 ? (
          <Text style={styles.empty}>You haven’t blocked anyone.</Text>
        ) : blocked.map((u) => (
          <View key={u.id} style={styles.blockedRow}>
            <Avatar uri={u.avatar_url} name={u.display_name} size={38} />
            <Text style={styles.blockedName} numberOfLines={1}>{u.display_name || 'User'}</Text>
            <Pressable onPress={() => unblock(u.id)}><Text style={styles.unblock}>Unblock</Text></Pressable>
          </View>
        ))}
      </View>
      <View style={{ height: spacing(8) }} />
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    sectionLabel: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', marginTop: spacing(5), marginBottom: spacing(2), marginHorizontal: spacing(4), letterSpacing: 0.5 },
    group: { backgroundColor: colors.surface, marginHorizontal: spacing(3), borderRadius: radius.md, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowLabel: { flex: 1, color: colors.text, fontSize: font.body },
    rowValue: { color: colors.textMuted, fontSize: font.small, marginRight: spacing(2) },
    empty: { color: colors.textMuted, fontSize: font.small, padding: spacing(4) },
    blockedRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
    blockedName: { flex: 1, color: colors.text, fontSize: font.body, marginLeft: spacing(3) },
    unblock: { color: colors.primary, fontSize: font.small, fontWeight: '600' },
  });
