// Lumixo mobile — create a group conversation: pick members, name it, add icon, go.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';

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
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    // Web searches on any non-empty query (GroupModal.tsx:25); match it rather
    // than requiring 2+ chars so single-character handle/name lookups work.
    if (!q) {
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

  async function pickAvatar() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!res.canceled && res.assets?.[0]) {
        setAvatarUri(res.assets[0].uri);
      }
    } catch {
      Alert.alert('Error', 'Could not pick image');
    }
  }

  async function uploadAvatar(): Promise<string | null> {
    if (!avatarUri) return null;
    try {
      setUploading(true);
      const ext = avatarUri.split('.').pop() || 'jpg';
      const fileName = `group-${Date.now()}.${ext}`;
      const fileBase64 = await FileSystem.readAsStringAsync(avatarUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const { data, error } = await supabase.storage
        .from('avatars')
        .upload(fileName, Buffer.from(fileBase64, 'base64'), {
          contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
        });
      if (error) throw error;
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(data.path);
      return urlData?.publicUrl || null;
    } catch (err) {
      Alert.alert('Upload failed', 'Could not upload group icon');
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function create() {
    if (!name.trim() || selected.length === 0 || creating || uploading) return;
    setCreating(true);
    const avatarUrl = await uploadAvatar();
    const { conversationId, error } = await createGroupConversation(
      supabase,
      name.trim(),
      selected.map((s) => s.id),
      avatarUrl,
    );
    setCreating(false);
    if (error || !conversationId) {
      Alert.alert('Could not create group', error?.message || 'Please try again.');
      return;
    }
    navigation.replace('Chat', { conversationId, title: name.trim() });
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerSection}>
        <Pressable style={styles.avatarPicker} onPress={pickAvatar} disabled={uploading}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatarImage, styles.avatarPlaceholder]}>
              <Ionicons name="image-outline" size={32} color={colors.textMuted} />
            </View>
          )}
          {uploading && <ActivityIndicator style={styles.uploadSpinner} color={colors.primary} />}
        </Pressable>
        <TextInput
          style={styles.nameInput}
          placeholder="Group name"
          placeholderTextColor={colors.textFaint}
          value={name}
          onChangeText={setName}
        />
      </View>

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
              <Text style={styles.name}>{item.display_name ?? 'Lumixo user'}</Text>
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
    headerSection: {
      backgroundColor: colors.surface,
      padding: spacing(4),
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(4),
    },
    avatarPicker: {
      position: 'relative',
    },
    avatarImage: {
      width: 60,
      height: 60,
      borderRadius: 30,
    },
    avatarPlaceholder: {
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    uploadSpinner: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 2,
    },
    nameInput: {
      flex: 1,
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '600',
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
      shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 5, shadowOffset: { width: 0, height: 3 },
    },
    fabDisabled: { opacity: 0.4 },
  });
