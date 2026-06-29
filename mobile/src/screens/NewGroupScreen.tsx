// FUTUREHAT mobile — create a group conversation: pick members, name it, go.
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
import { searchProfiles, createGroupConversation } from '../lib/shared';
import type { Profile } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'NewGroup'>;

export default function NewGroupScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      const data = await searchProfiles(supabase, q);
      if (active) setResults(data);
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);

  function toggle(p: Profile) {
    setSelected((prev) =>
      prev.some((s) => s.id === p.id) ? prev.filter((s) => s.id !== p.id) : [...prev, p],
    );
  }

  async function create() {
    if (!name.trim() || selected.length === 0 || creating) return;
    setCreating(true);
    const { conversationId, error } = await createGroupConversation(
      supabase,
      name.trim(),
      selected.map((s) => s.id),
    );
    setCreating(false);
    if (error || !conversationId) return;
    navigation.replace('Chat', { conversationId, title: name.trim() });
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.nameInput}
        placeholder="Group name"
        placeholderTextColor={colors.textFaint}
        value={name}
        onChangeText={setName}
      />

      {selected.length > 0 && (
        <FlatList
          horizontal
          data={selected}
          keyExtractor={(p) => p.id}
          showsHorizontalScrollIndicator={false}
          style={styles.chips}
          renderItem={({ item }) => (
            <Pressable style={styles.chip} onPress={() => toggle(item)}>
              <Avatar uri={item.avatar_url} name={item.display_name} size={36} />
              <Text style={styles.chipName} numberOfLines={1}>
                {item.display_name?.split(' ')[0] ?? 'User'}
              </Text>
              <View style={styles.chipRemove}>
                <Ionicons name="close" size={12} color="#fff" />
              </View>
            </Pressable>
          )}
        />
      )}

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="Add members"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => {
          const on = selected.some((s) => s.id === item.id);
          return (
            <Pressable style={styles.row} onPress={() => toggle(item)}>
              <Avatar uri={item.avatar_url} name={item.display_name ?? item.username} size={44} />
              <Text style={styles.name}>{item.display_name ?? 'FUTUREHAT user'}</Text>
              <Ionicons
                name={on ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={on ? colors.primary : colors.textFaint}
              />
            </Pressable>
          );
        }}
      />

      <Pressable
        style={[styles.fab, (!name.trim() || !selected.length) && styles.fabDisabled]}
        onPress={create}
        disabled={creating || !name.trim() || !selected.length}
      >
        {creating ? <ActivityIndicator color="#fff" /> : <Ionicons name="arrow-forward" size={26} color="#fff" />}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    nameInput: {
      color: colors.text,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3.5),
      fontSize: font.heading,
    },
    chips: { maxHeight: 80, paddingHorizontal: spacing(2), paddingVertical: spacing(2) },
    chip: { width: 60, alignItems: 'center', marginHorizontal: spacing(1) },
    chipName: { color: colors.textMuted, fontSize: font.tiny, marginTop: 2 },
    chipRemove: {
      position: 'absolute',
      top: 0,
      right: 6,
      backgroundColor: colors.textFaint,
      borderRadius: 9,
      width: 18,
      height: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      margin: spacing(3),
      paddingHorizontal: spacing(3),
      borderRadius: radius.pill,
    },
    searchInput: { flex: 1, color: colors.text, paddingVertical: spacing(2.5), marginLeft: 8, fontSize: font.body },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(2.5) },
    name: { flex: 1, color: colors.text, fontSize: font.heading, marginLeft: spacing(3) },
    fab: {
      position: 'absolute',
      right: spacing(5),
      bottom: spacing(6),
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 6,
    },
    fabDisabled: { opacity: 0.4 },
  });
