// FUTUREHAT mobile — view a user's profile. Shows avatar/name/username/about
// and contextual actions (message / call, or edit when it's me).
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import {
  getCurrentUser, getProfile, startDirectConversation,
  blockUser, unblockUser, getBlockedIds, submitReport, getSharedMedia,
} from '../lib/shared';
import type { Profile, CallType, Message } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { useCalls } from '../calls/CallContext';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Profile'>;
type Rt = RouteProp<RootStackParamList, 'Profile'>;

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { startCall } = useCalls();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [isMe, setIsMe] = useState(false);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [photos, setPhotos] = useState<Message[]>([]);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const me = await getCurrentUser(supabase);
      setIsMe(me?.id === params.userId);
      const p = await getProfile(supabase, params.userId);
      setProfile(p);
      const ids = await getBlockedIds(supabase).catch(() => [] as string[]);
      setBlocked(ids.includes(params.userId));
      setLoading(false);
      if (params.conversationId) {
        const media = await getSharedMedia(supabase, params.conversationId).catch(() => [] as Message[]);
        setPhotos(media.filter((m) => m.type === 'image' && m.media_url));
      }
    })();
  }, [params.userId, params.conversationId]);

  async function toggleBlock() {
    const was = blocked;
    if (!was && !(await confirmAsync('Block user', `Block ${profile?.display_name ?? 'this user'}?`))) return;
    setBlocked(!was);
    const { error } = was ? await unblockUser(supabase, params.userId) : await blockUser(supabase, params.userId);
    if (error) setBlocked(was);
  }

  function report() {
    Alert.prompt?.('Report user', 'What is the issue?', async (reason?: string) => {
      if (!reason?.trim()) return;
      const { error } = await submitReport(supabase, 'user', params.userId, reason.trim());
      Alert.alert(error ? 'Error' : 'Reported', error ? error.message : 'Our safety team will review this.');
    });
    // Android lacks Alert.prompt; fall back to a direct report.
    if (!Alert.prompt) {
      submitReport(supabase, 'user', params.userId, 'Reported from profile').then(({ error }) =>
        Alert.alert(error ? 'Error' : 'Reported', error ? error.message : 'Our safety team will review this.'),
      );
    }
  }

  function shareContact() {
    const handle = profile?.username ? `@${profile.username}` : params.userId.slice(0, 8);
    Share.share({ message: `${profile?.display_name ?? 'FUTUREHAT user'} (${handle}) on FUTUREHAT` });
  }

  async function message() {
    const { conversationId } = await startDirectConversation(supabase, params.userId);
    if (conversationId) {
      navigation.replace('Chat', {
        conversationId,
        title: profile?.display_name ?? 'Chat',
      });
    }
  }

  async function call(type: CallType) {
    if (!profile) return;
    const { conversationId } = await startDirectConversation(supabase, params.userId);
    if (conversationId) startCall(conversationId, profile, type);
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
          <ActionButton icon="call" label="Voice" onPress={() => call('audio')} />
          <ActionButton icon="videocam" label="Video" onPress={() => call('video')} />
        </View>
      )}

      <Section title="About">
        <Text style={styles.about}>{profile?.about || 'Hey there! I am using FUTUREHAT.'}</Text>
      </Section>

      {!!profile?.phone && (
        <Section title="Phone">
          <Text style={styles.about}>{profile.phone}</Text>
        </Section>
      )}

      {photos.length > 0 && (
        <Section title={`Media · ${photos.length}`}>
          <View style={styles.mediaGrid}>
            {photos.slice(0, 12).map((m) => (
              <Pressable key={m.id} onPress={() => setViewerUrl(m.media_url!)}>
                <Image source={{ uri: m.media_url! }} style={styles.mediaThumb} />
              </Pressable>
            ))}
          </View>
        </Section>
      )}

      {isMe && (
        <Pressable style={styles.editBtn} onPress={() => navigation.navigate('EditProfile')}>
          <Ionicons name="create-outline" size={20} color={colors.primary} />
          <Text style={styles.editText}>Edit profile</Text>
        </Pressable>
      )}

      {!isMe && (
        <View>
          <Pressable style={styles.actionRow} onPress={shareContact}>
            <Ionicons name="share-social-outline" size={20} color={colors.text} />
            <Text style={styles.actionRowText}>Share contact</Text>
          </Pressable>
          <Pressable style={styles.actionRow} onPress={report}>
            <Ionicons name="flag-outline" size={20} color={colors.text} />
            <Text style={styles.actionRowText}>Report</Text>
          </Pressable>
          <Pressable style={styles.actionRow} onPress={toggleBlock}>
            <Ionicons name={blocked ? 'checkmark-circle-outline' : 'ban-outline'} size={20} color={colors.danger} />
            <Text style={[styles.actionRowText, { color: colors.danger }]}>
              {blocked ? 'Unblock' : 'Block'} {profile?.display_name ?? 'user'}
            </Text>
          </Pressable>
        </View>
      )}

      <Modal visible={!!viewerUrl} transparent animationType="fade" onRequestClose={() => setViewerUrl(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewerUrl(null)}>
          {viewerUrl && <Image source={{ uri: viewerUrl }} style={styles.viewerImg} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function confirmAsync(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Block', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
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
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(4), paddingHorizontal: spacing(5), paddingVertical: spacing(3.5), backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    actionRowText: { color: colors.text, fontSize: font.body },
    mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    mediaThumb: { width: 78, height: 78, borderRadius: radius.sm, backgroundColor: colors.surface },
    viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
    viewerImg: { width: '100%', height: '100%' },
  });
