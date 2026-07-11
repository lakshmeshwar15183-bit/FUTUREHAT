// FUTUREHAT mobile — create a group: multi-select contacts, photo, name,
// optional description, loading / error / success states.
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
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { supabase } from '../lib/supabase';
import { searchProfiles, createGroupConversation, getCurrentUser, sendPush } from '../lib/shared';
import type { Profile } from '../lib/shared';
import { uploadAvatarFromUri } from '../lib/media';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'NewGroup'>;

export default function NewGroupScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [step, setStep] = useState<'members' | 'details'>('members');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [creating, setCreating] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const q = query.trim();
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
        quality: 0.85,
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
      const user = await getCurrentUser(supabase);
      if (!user) throw new Error('not authenticated');
      const { url, error: upErr } = await uploadAvatarFromUri(user.id, avatarUri);
      if (upErr) throw upErr;
      return url;
    } catch {
      setError('Could not upload group photo. You can create without a photo.');
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function create() {
    if (!name.trim() || selected.length === 0 || creating || uploading) return;
    setCreating(true);
    setError('');
    try {
      const avatarUrl = await uploadAvatar();
      const { conversationId, error: createErr } = await createGroupConversation(
        supabase,
        name.trim(),
        selected.map((s) => s.id),
        avatarUrl,
        description.trim() || null,
      );
      if (createErr || !conversationId) {
        setError(createErr?.message || 'Could not create group. Please try again.');
        setCreating(false);
        return;
      }
      // Extra notify (createGroupConversation already best-effort pushes).
      void sendPush(supabase, {
        conversationId,
        kind: 'group',
        title: name.trim(),
        body: 'You were added to a group',
        data: { type: 'added_to_group' },
      });
      setSuccess(true);
      setTimeout(() => {
        navigation.replace('Chat', { conversationId, title: name.trim() });
      }, 700);
    } catch (e: any) {
      setError(e?.message || 'Could not create group');
      setCreating(false);
    }
  }

  if (success) {
    return (
      <View style={[styles.container, styles.center]}>
        <Animated.View entering={ZoomIn.duration(400)}>
          <View style={styles.successCircle}>
            <Ionicons name="checkmark" size={48} color="#fff" />
          </View>
        </Animated.View>
        <Animated.Text entering={FadeIn.delay(200)} style={styles.successText}>
          Group created
        </Animated.Text>
      </View>
    );
  }

  if (step === 'members') {
    return (
      <View style={styles.container}>
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
            placeholder="Search contacts"
            placeholderTextColor={colors.textFaint}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
        </View>

        <Text style={styles.hint}>
          {selected.length === 0
            ? 'Select at least one contact'
            : `${selected.length} selected`}
        </Text>

        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => {
            const on = selected.some((s) => s.id === item.id);
            return (
              <Pressable style={styles.row} onPress={() => toggle(item)}>
                <Avatar uri={item.avatar_url} name={item.display_name ?? item.username} size={44} />
                <View style={{ flex: 1, marginLeft: spacing(3) }}>
                  <Text style={styles.name}>{item.display_name ?? 'User'}</Text>
                  {!!item.username && (
                    <Text style={styles.username}>@{item.username}</Text>
                  )}
                </View>
                <Ionicons
                  name={on ? 'checkmark-circle' : 'ellipse-outline'}
                  size={24}
                  color={on ? colors.primary : colors.textFaint}
                />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {query.trim() ? 'No contacts found' : 'Type a name or username to find people'}
            </Text>
          }
        />

        <Pressable
          style={[styles.fab, !selected.length && styles.fabDisabled]}
          onPress={() => selected.length > 0 && setStep('details')}
          disabled={!selected.length}
        >
          <Ionicons name="arrow-forward" size={26} color="#fff" />
        </Pressable>
      </View>
    );
  }

  // Details step: photo + name + description
  return (
    <View style={styles.container}>
      <View style={styles.headerSection}>
        <Pressable style={styles.avatarPicker} onPress={pickAvatar} disabled={uploading || creating}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatarImage, styles.avatarPlaceholder]}>
              <Ionicons name="camera" size={28} color={colors.textMuted} />
            </View>
          )}
          {uploading && <ActivityIndicator style={styles.uploadSpinner} color={colors.primary} />}
        </Pressable>
        <View style={{ flex: 1 }}>
          <TextInput
            style={styles.nameInput}
            placeholder="Group name"
            placeholderTextColor={colors.textFaint}
            value={name}
            onChangeText={setName}
            maxLength={100}
            autoFocus
          />
          <TextInput
            style={styles.descInput}
            placeholder="Description (optional)"
            placeholderTextColor={colors.textFaint}
            value={description}
            onChangeText={setDescription}
            maxLength={500}
            multiline
          />
        </View>
      </View>

      <Text style={styles.participantsLabel}>
        Participants: {selected.map((s) => s.display_name?.split(' ')[0] || 'User').join(', ')}
      </Text>

      <Pressable style={styles.backMembers} onPress={() => setStep('members')}>
        <Ionicons name="people-outline" size={18} color={colors.primary} />
        <Text style={{ color: colors.primary, marginLeft: 8, fontWeight: '600' }}>
          Edit members ({selected.length})
        </Text>
      </Pressable>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.createBtn, (!name.trim() || creating) && styles.fabDisabled]}
        onPress={create}
        disabled={creating || !name.trim() || uploading}
      >
        {creating ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.createBtnText}>Create group</Text>
        )}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { alignItems: 'center', justifyContent: 'center' },
    successCircle: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    successText: {
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '700',
      marginTop: spacing(4),
    },
    headerSection: {
      backgroundColor: colors.surface,
      padding: spacing(4),
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing(4),
    },
    avatarPicker: { position: 'relative' },
    avatarImage: { width: 72, height: 72, borderRadius: 36 },
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
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '600',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingVertical: spacing(2),
    },
    descInput: {
      color: colors.text,
      fontSize: font.body,
      marginTop: spacing(2),
      minHeight: 48,
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
    searchInput: {
      flex: 1,
      color: colors.text,
      paddingVertical: spacing(2.5),
      marginLeft: 8,
      fontSize: font.body,
    },
    hint: {
      color: colors.primary,
      fontSize: font.small,
      fontWeight: '600',
      paddingHorizontal: spacing(4),
      marginBottom: spacing(1),
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(2.5),
    },
    name: { color: colors.text, fontSize: font.heading, fontWeight: '500' },
    username: { color: colors.textMuted, fontSize: font.small },
    empty: {
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: spacing(8),
      paddingHorizontal: spacing(6),
    },
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
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 3 },
    },
    fabDisabled: { opacity: 0.4 },
    participantsLabel: {
      color: colors.textMuted,
      fontSize: font.small,
      padding: spacing(4),
    },
    backMembers: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(4),
      marginBottom: spacing(2),
    },
    error: {
      color: colors.danger,
      paddingHorizontal: spacing(4),
      marginBottom: spacing(2),
    },
    createBtn: {
      marginHorizontal: spacing(4),
      marginTop: spacing(4),
      backgroundColor: colors.primary,
      borderRadius: radius.pill,
      paddingVertical: spacing(3.5),
      alignItems: 'center',
    },
    createBtnText: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
  });
