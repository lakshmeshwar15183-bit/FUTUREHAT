// FUTUREHAT mobile — community members list with Owner/Admin badges and search.
// Standalone; reads route param { communityId, ownerId } (typed loosely until
// registered in RootStackParamList). Backed by getCommunityMembers.
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRoute } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { getCommunityMembers, type CommunityMember } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';

export default function MembersScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const route = useRoute<any>();
  const communityId: string = route.params?.communityId;
  const ownerId: string | undefined = route.params?.ownerId;

  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (communityId) getCommunityMembers(supabase, communityId).then(setMembers).catch(() => {});
  }, [communityId]);

  const filtered = members.filter((m) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (m.profile?.display_name || '').toLowerCase().includes(s) || (m.profile?.username || '').toLowerCase().includes(s);
  });
  const roleOf = (m: CommunityMember) => (m.user_id === ownerId ? 'Owner' : m.role === 'admin' ? 'Admin' : null);

  return (
    <View style={styles.container}>
      <TextInput style={styles.search} placeholder="Search members" placeholderTextColor={colors.textFaint} value={q} onChangeText={setQ} />
      <ScrollView>
        {filtered.length === 0 ? (
          <Text style={styles.empty}>No members found.</Text>
        ) : filtered.map((m) => (
          <View key={m.user_id} style={styles.row}>
            <Avatar uri={m.profile?.avatar_url} name={m.profile?.display_name} size={44} />
            <View style={styles.body}>
              <Text style={styles.name} numberOfLines={1}>{m.profile?.display_name || 'User'}</Text>
              {m.profile?.username ? <Text style={styles.handle}>@{m.profile.username}</Text> : null}
            </View>
            {roleOf(m) && (
              <View style={[styles.badge, roleOf(m) === 'Owner' && styles.badgeOwner]}>
                <Text style={[styles.badgeText, roleOf(m) === 'Owner' && styles.badgeTextOwner]}>{roleOf(m)}</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    search: { backgroundColor: colors.surface, color: colors.text, fontSize: font.body, margin: spacing(3), paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderRadius: radius.pill },
    empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing(10), fontSize: font.body },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    body: { flex: 1, marginLeft: spacing(3) },
    name: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    handle: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    badge: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing(3), paddingVertical: spacing(1) },
    badgeOwner: { backgroundColor: colors.accentPlus + '33' },
    badgeText: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700' },
    badgeTextOwner: { color: colors.accentPlusText },
  });
