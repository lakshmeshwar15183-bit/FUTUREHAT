// Lumixo mobile — create a community (you become its admin).
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';

import { supabase } from '../lib/supabase';
import { createCommunity, createChannel } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'CreateCommunity'>;

export default function CreateCommunityScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

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
      const fileName = `community-${Date.now()}.${ext}`;
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
      Alert.alert('Upload failed', 'Could not upload community icon');
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function create() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your community a name.');
      return;
    }
    setBusy(true);
    const avatarUrl = await uploadAvatar();
    const { community, error } = await createCommunity(
      supabase,
      name.trim(),
      description.trim() || undefined,
      avatarUrl,
    );
    if (error || !community) {
      setBusy(false);
      Alert.alert('Could not create', error?.message ?? 'Try again.');
      return;
    }
    // Seed a default "General" announcement channel.
    await createChannel(supabase, community.id, 'General', 'text');
    setBusy(false);
    navigation.replace('CommunityDetail', { communityId: community.id, name: community.name });
  }

  return (
    <View style={styles.container}>
      <Pressable style={styles.iconWrap} onPress={pickAvatar} disabled={uploading}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.icon} />
        ) : (
          <View style={styles.icon}>
            <Ionicons name="people" size={40} color="#fff" />
          </View>
        )}
        {uploading && <ActivityIndicator style={styles.uploadSpinner} color={colors.primary} />}
      </Pressable>
      <TextInput
        style={styles.input}
        placeholder="Community name"
        placeholderTextColor={colors.textFaint}
        value={name}
        onChangeText={setName}
      />
      <TextInput
        style={[styles.input, styles.desc]}
        placeholder="What's this community about?"
        placeholderTextColor={colors.textFaint}
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <Pressable style={[styles.btn, (busy || uploading) && styles.btnDisabled]} onPress={create} disabled={busy || uploading}>
        {busy || uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create community</Text>}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: spacing(5) },
    iconWrap: { alignItems: 'center', marginVertical: spacing(5), position: 'relative' },
    icon: { width: 90, height: 90, borderRadius: 45, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    uploadSpinner: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: spacing(1),
    },
    input: {
      backgroundColor: colors.surface,
      color: colors.text,
      borderRadius: radius.md,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3.5),
      fontSize: font.body,
      marginBottom: spacing(3),
    },
    desc: { minHeight: 90, textAlignVertical: 'top' },
    btn: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing(3.5),
      alignItems: 'center',
      marginTop: spacing(2),
    },
    btnDisabled: { opacity: 0.6 },
    btnText: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
  });
