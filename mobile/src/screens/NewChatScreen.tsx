// FUTUREHAT mobile — start a new conversation. Search users by name/username
// and open (or create) a 1:1 thread via the shared API.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { searchProfiles, startDirectConversation } from '../lib/shared';
import type { Profile } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'NewChat'>;

export default function NewChatScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    setSearching(true);
    const t = setTimeout(async () => {
      const data = await searchProfiles(supabase, q);
      if (active) {
        setResults(data);
        setSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);

  async function open(p: Profile) {
    if (opening) return;
    setOpening(true);
    const { conversationId, error } = await startDirectConversation(supabase, p.id);
    setOpening(false);
    if (error || !conversationId) return;
    navigation.replace('Chat', {
      conversationId,
      title: p.display_name ?? p.username ?? 'Chat',
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or @username"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoFocus
        />
        {searching && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      <Pressable style={styles.actionRow} onPress={() => navigation.navigate('NewGroup')}>
        <View style={[styles.actionIcon, { backgroundColor: colors.primary }]}>
          <Ionicons name="people" size={22} color="#fff" />
        </View>
        <Text style={styles.actionLabel}>New group</Text>
      </Pressable>

      <FlatList
        data={results}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => open(item)}>
            <Avatar uri={item.avatar_url} name={item.display_name ?? item.username} size={48} />
            <View style={styles.rowBody}>
              <Text style={styles.name}>{item.display_name ?? 'FUTUREHAT user'}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {item.about || (item.username ? `@${item.username}` : 'Available')}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          query.trim().length >= 2 && !searching ? (
            <Text style={styles.empty}>No users found for “{query.trim()}”.</Text>
          ) : null
        }
      />
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      margin: spacing(3),
      paddingHorizontal: spacing(3),
      borderRadius: radius.pill,
    },
    searchInput: { flex: 1, color: colors.text, paddingVertical: spacing(2.5), marginLeft: 8, fontSize: font.body },
    actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
    actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    actionLabel: { color: colors.text, fontSize: font.heading, marginLeft: spacing(3), fontWeight: '500' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(2.5) },
    rowBody: { flex: 1, marginLeft: spacing(3) },
    name: { color: colors.text, fontSize: font.heading, fontWeight: '500' },
    sub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing(8), fontSize: font.body },
  });
