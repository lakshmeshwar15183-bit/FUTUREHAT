// FUTUREHAT mobile — edit my profile: avatar, display name, username, about.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { getCurrentUser, getMyProfile, updateMyProfile } from '../lib/shared';
import type { Profile } from '../lib/shared';
import { getCachedProfile, cacheProfile } from '../lib/localCache';
import { queueAction } from '../lib/sync';
import { uploadAvatarFromUri } from '../lib/media';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';

export default function EditProfileScreen() {
  const navigation = useNavigation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [uid, setUid] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [about, setAbout] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const apply = (p: Profile) => {
        setDisplayName(p.display_name ?? '');
        setUsername(p.username ?? '');
        setAbout(p.about ?? '');
        setAvatarUrl(p.avatar_url);
      };
      const user = await getCurrentUser(supabase); // local session read — instant
      const id = user?.id ?? null;
      setUid(id);
      // Instant: fill the form from the cached profile first (offline included).
      if (id) {
        const cached = await getCachedProfile(id);
        if (cached) { apply(cached); setLoading(false); }
      }
      // Then refresh from the network in the background and update the cache.
      const p = await getMyProfile(supabase).catch(() => null);
      if (p) { apply(p); cacheProfile(p); }
      setLoading(false);
    })();
  }, []);

  async function changeAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (res.canceled || !res.assets?.length || !uid) return;
    setUploading(true);
    const { url, error } = await uploadAvatarFromUri(uid, res.assets[0].uri);
    if (url) {
      await updateMyProfile(supabase, { avatar_url: url });
      setAvatarUrl(`${url}?t=${Date.now()}`); // bust cache
    } else if (error) {
      Alert.alert('Upload failed', error.message);
    }
    setUploading(false);
  }

  async function save() {
    if (!displayName.trim()) {
      Alert.alert('Name required', 'Please enter a display name.');
      return;
    }
    const updates = {
      display_name: displayName.trim(),
      username: username.trim() || null,
      about: about.trim() || null,
    };
    // Instant: write the new profile to the local cache and queue the server
    // sync (auto-retries on reconnect), then leave immediately. No network wait.
    if (uid) {
      const cached = await getCachedProfile(uid);
      cacheProfile({ ...(cached ?? ({ id: uid } as Profile)), ...updates } as Profile);
    }
    queueAction('updateProfile', { updates });
    navigation.goBack();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(5) }}>
      <Pressable style={styles.avatarWrap} onPress={changeAvatar}>
        <Avatar uri={avatarUrl} name={displayName} size={110} />
        <View style={styles.cameraBadge}>
          {uploading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="camera" size={20} color="#fff" />
          )}
        </View>
      </Pressable>

      <Field label="Display name">
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={colors.textFaint} />
      </Field>
      <Field label="Username">
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={(t) => setUsername(t.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
          placeholder="username"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
        />
      </Field>
      <Field label="About">
        <TextInput
          style={[styles.input, styles.about]}
          value={about}
          onChangeText={setAbout}
          placeholder="Hey there! I am using FUTUREHAT."
          placeholderTextColor={colors.textFaint}
          multiline
        />
      </Field>

      <Pressable style={styles.saveBtn} onPress={save} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
      </Pressable>
    </ScrollView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ marginBottom: spacing(4) }}>
      <Text style={{ color: colors.primary, fontSize: font.small, fontWeight: '600', marginBottom: 6 }}>{label}</Text>
      {children}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    avatarWrap: { alignSelf: 'center', marginBottom: spacing(6) },
    cameraBadge: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: colors.bg,
    },
    input: {
      backgroundColor: colors.surface,
      color: colors.text,
      borderRadius: radius.md,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3),
      fontSize: font.body,
    },
    about: { minHeight: 80, textAlignVertical: 'top' },
    saveBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing(3.5),
      alignItems: 'center',
      marginTop: spacing(2),
    },
    saveText: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
  });
