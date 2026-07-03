// FUTUREHAT mobile — Communities tab: list the communities you're in, create new.
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { getMyCommunities, joinCommunity } from '../lib/shared';
import type { Community } from '../lib/shared';
import { getCache, setCache } from '../lib/localCache';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function CommunitiesScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinId, setJoinId] = useState('');
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    // Instant: show cached communities immediately (offline included), then
    // refresh from the network and rewrite the cache in the background.
    getCache<Community[]>('communities', []).then((cached) => {
      if (cached.length) { setItems((cur) => (cur.length ? cur : cached)); setLoading(false); }
    });
    try {
      const fresh = await getMyCommunities(supabase);
      setItems(fresh);
      setCache('communities', fresh);
    } catch { /* offline — keep cached */ }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleJoin() {
    const id = joinId.trim();
    if (!id || joining) return;
    setJoining(true);
    const { error } = await joinCommunity(supabase, id);
    setJoining(false);
    if (error) {
      Alert.alert('Could not join', error.message || 'Check the community ID and try again.');
      return;
    }
    setJoinId('');
    await load();
    Alert.alert('Joined community', 'You’re in.');
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={10}
        removeClippedSubviews
        ListHeaderComponent={
          <>
            <Pressable style={styles.newRow} onPress={() => navigation.navigate('CreateCommunity')}>
              <View style={styles.newIcon}>
                <Ionicons name="people" size={26} color="#fff" />
              </View>
              <Text style={styles.newLabel}>New community</Text>
            </Pressable>
            <View style={styles.joinRow}>
              <TextInput
                style={styles.joinInput}
                placeholder="Join by community ID"
                placeholderTextColor={colors.textFaint}
                value={joinId}
                onChangeText={setJoinId}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="join"
                onSubmitEditing={handleJoin}
              />
              <Pressable
                style={[styles.joinBtn, (!joinId.trim() || joining) && styles.joinBtnDisabled]}
                onPress={handleJoin}
                disabled={!joinId.trim() || joining}
              >
                <Text style={styles.joinBtnText}>Join</Text>
              </Pressable>
            </View>
          </>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => navigation.navigate('CommunityDetail', { communityId: item.id, name: item.name })}
          >
            <Avatar uri={item.avatar_url} name={item.name} size={52} />
            <View style={styles.body}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {item.description || 'Community'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
          </Pressable>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={56} color={colors.textFaint} />
              <Text style={styles.emptyText}>No communities yet</Text>
              <Text style={styles.emptySub}>Create one to bring people together in channels.</Text>
            </View>
          ) : null
        }
        contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : undefined}
      />
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    newRow: { flexDirection: 'row', alignItems: 'center', padding: spacing(4) },
    newIcon: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    newLabel: { color: colors.text, fontSize: font.heading, fontWeight: '600', marginLeft: spacing(3) },
    joinRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingBottom: spacing(3), gap: spacing(2) },
    joinInput: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: radius.pill, paddingHorizontal: spacing(4), paddingVertical: spacing(3), fontSize: font.body },
    joinBtn: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing(5), paddingVertical: spacing(3), alignItems: 'center', justifyContent: 'center' },
    joinBtnDisabled: { opacity: 0.5 },
    joinBtnText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(2.5) },
    body: { flex: 1, marginLeft: spacing(3) },
    name: { color: colors.text, fontSize: font.heading, fontWeight: '600' },
    sub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(8) },
    emptyText: { color: colors.text, fontSize: font.heading, fontWeight: '600', marginTop: spacing(3) },
    emptySub: { color: colors.textMuted, fontSize: font.small, textAlign: 'center', marginTop: spacing(1) },
  });
