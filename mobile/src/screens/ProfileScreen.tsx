// FUTUREHAT mobile — view a user's profile. Shows avatar/name/username/about
// and contextual actions (message / call, or edit when it's me).
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { getCurrentUser, getProfile, startDirectConversation } from '../lib/shared';
import type { Profile } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Profile'>;
type Rt = RouteProp<RootStackParamList, 'Profile'>;

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [isMe, setIsMe] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const me = await getCurrentUser(supabase);
      setIsMe(me?.id === params.userId);
      const p = await getProfile(supabase, params.userId);
      setProfile(p);
      setLoading(false);
    })();
  }, [params.userId]);

  async function message() {
    const { conversationId } = await startDirectConversation(supabase, params.userId);
    if (conversationId) {
      navigation.replace('Chat', {
        conversationId,
        title: profile?.display_name ?? 'Chat',
      });
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={120} />
        <Text style={styles.name}>{profile?.display_name ?? 'FUTUREHAT user'}</Text>
        {!!profile?.username && <Text style={styles.username}>@{profile.username}</Text>}
      </View>

      {!isMe && (
        <View style={styles.actions}>
          <ActionButton icon="chatbubble" label="Message" onPress={message} />
          <ActionButton icon="call" label="Voice" onPress={() => notYet('Voice calling')} />
          <ActionButton icon="videocam" label="Video" onPress={() => notYet('Video calling')} />
        </View>
      )}

      <Section title="About">
        <Text style={styles.about}>{profile?.about || 'Hey there! I am using FUTUREHAT.'}</Text>
      </Section>

      {isMe && (
        <Pressable style={styles.editBtn} onPress={() => navigation.navigate('EditProfile')}>
          <Ionicons name="create-outline" size={20} color={colors.primary} />
          <Text style={styles.editText}>Edit profile</Text>
        </Pressable>
      )}

      {!isMe && (
        <Pressable style={styles.blockBtn} onPress={() => notYet('Blocking')}>
          <Ionicons name="ban-outline" size={20} color={colors.danger} />
          <Text style={styles.blockText}>Block {profile?.display_name ?? 'user'}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function notYet(feature: string) {
  Alert.alert(feature, `${feature} is coming in a later update.`);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ paddingHorizontal: spacing(5), paddingVertical: spacing(3) }}>
      <Text style={{ color: colors.primary, fontSize: font.small, fontWeight: '700', marginBottom: 6 }}>{title}</Text>
      {children}
    </View>
  );
}

function ActionButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable style={{ alignItems: 'center' }} onPress={onPress}>
      <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={24} color={colors.primary} />
      </View>
      <Text style={{ color: colors.textMuted, fontSize: font.tiny, marginTop: 4 }}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    header: { alignItems: 'center', paddingVertical: spacing(8), backgroundColor: colors.surface },
    name: { color: colors.text, fontSize: font.title, fontWeight: '700', marginTop: spacing(3) },
    username: { color: colors.textMuted, fontSize: font.body, marginTop: 2 },
    actions: { flexDirection: 'row', justifyContent: 'center', gap: spacing(8), paddingVertical: spacing(5), backgroundColor: colors.surface, marginBottom: spacing(2) },
    about: { color: colors.text, fontSize: font.body, lineHeight: 21 },
    editBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: spacing(4), gap: 8 },
    editText: { color: colors.primary, fontSize: font.heading, fontWeight: '600' },
    blockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: spacing(4), gap: 8 },
    blockText: { color: colors.danger, fontSize: font.heading },
  });
