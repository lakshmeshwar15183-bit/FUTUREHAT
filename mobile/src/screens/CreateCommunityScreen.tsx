// Lumixo mobile — create a community (you become its admin).
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

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
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your community a name.');
      return;
    }
    setBusy(true);
    const { community, error } = await createCommunity(supabase, name.trim(), description.trim() || undefined);
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
      <View style={styles.iconWrap}>
        <View style={styles.icon}>
          <Ionicons name="people" size={40} color="#fff" />
        </View>
      </View>
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
      <Pressable style={styles.btn} onPress={create} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create community</Text>}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: spacing(5) },
    iconWrap: { alignItems: 'center', marginVertical: spacing(5) },
    icon: { width: 90, height: 90, borderRadius: 45, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
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
    btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing(3.5), alignItems: 'center', marginTop: spacing(2) },
    btnText: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
  });
