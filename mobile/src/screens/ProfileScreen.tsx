// Lumixo mobile — view a user's profile. Shows avatar/name/username/about
// and contextual actions (message / call, or edit when it's me).
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import {
  getCurrentUser, getProfile, startDirectConversation,
  blockUser, unblockUser, getBlockedIds, submitReport, getSharedMedia,
  getMutedIds, muteConversation, unmuteConversation,
  getPremiumUserIds, joinPresence, leavePresence,
  getDisappearing, setConversationDisappearing, isVideoMessage,
} from '../lib/shared';
import type { Profile, CallType, Message } from '../lib/shared';
import { getCachedProfile, cacheProfile } from '../lib/localCache';
import { queueAction } from '../lib/sync';
import { formatLastSeen } from '../lib/time';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { useCalls } from '../calls/CallContext';
import { useChatLock } from '../security/ChatLock';
import Avatar from '../components/Avatar';
import MediaViewer, { type ViewerItem } from '../components/MediaViewer';
import { isVideoUrl } from '../components/MessageBubble';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Profile'>;
type Rt = RouteProp<RootStackParamList, 'Profile'>;

// Disappearing-messages timer options (0022): Off + 1..8 hours (in seconds).
const DISAPPEAR_OPTIONS: { secs: number; label: string }[] = [
  { secs: 0, label: 'Off' },
  ...Array.from({ length: 8 }, (_, i) => ({ secs: (i + 1) * 3600, label: `${i + 1} hour${i ? 's' : ''}` })),
];
const disappearLabel = (secs: number) =>
  DISAPPEAR_OPTIONS.find((o) => o.secs === secs)?.label ?? 'Off';

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { startCall } = useCalls();
  const chatLock = useChatLock();
  const convId = params.conversationId;
  const locked = !!convId && chatLock.isLocked(convId);

  // Toggle Chat Lock for this conversation. Enabling requires device auth (WhatsApp
  // parity); Lumixo never stores the credential — the OS verifies it.
  async function toggleChatLock(value: boolean) {
    if (!convId) return;
    if (value) {
      if (!chatLock.available) {
        Alert.alert('Chat Lock unavailable', 'Set up a screen lock (fingerprint, face, or PIN) on your device to use Chat Lock.');
        return;
      }
      const ok = await chatLock.authenticate('Confirm to lock this chat');
      if (!ok) return;
      chatLock.lockChat(convId);
    } else {
      chatLock.unlockChat(convId);
    }
  }

  const [profile, setProfile] = useState<Profile | null>(null);
  const [isMe, setIsMe] = useState(false);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [online, setOnline] = useState(false);
  const [photos, setPhotos] = useState<Message[]>([]);
  const [docs, setDocs] = useState<Message[]>([]);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  // Disappearing messages (0022): per-chat timer, 0 = off else 3600..28800 (1–8h).
  const [disappearSecs, setDisappearSecs] = useState(0);
  const [disappearOpen, setDisappearOpen] = useState(false);

  // Shared-media gallery — swipeable full-screen viewer with captions (web
  // ContactProfileModal opens MediaLightbox the same way).
  const viewerItems = useMemo<ViewerItem[]>(
    () => photos.map((m) => ({
      id: m.id,
      url: m.media_url!,
      kind: m.type === 'image' && !isVideoUrl(m.media_url) ? ('image' as const) : ('video' as const),
      caption: m.content || null,
    })),
    [photos],
  );
  const viewerIndex = viewerUrl ? Math.max(0, viewerItems.findIndex((v) => v.url === viewerUrl)) : -1;

  useEffect(() => {
    (async () => {
      // Instant: show the cached profile first (offline included, no spinner),
      // then refresh from the network below.
      const cached = await getCachedProfile(params.userId);
      if (cached) { setProfile(cached); setLoading(false); }
      const me = await getCurrentUser(supabase);
      setIsMe(me?.id === params.userId);
      const p = await getProfile(supabase, params.userId).catch(() => null);
      if (p) { setProfile(p); cacheProfile(p); }
      const ids = await getBlockedIds(supabase).catch(() => [] as string[]);
      setBlocked(ids.includes(params.userId));
      const premiumIds = await getPremiumUserIds(supabase).catch(() => [] as string[]);
      setIsPremium(premiumIds.includes(params.userId));
      // Moderator badge (0023): profiles.role is world-readable.
      try {
        const { data: r } = await supabase.from('profiles').select('role').eq('id', params.userId).maybeSingle();
        setIsModerator(['moderator', 'admin', 'owner'].includes((r as { role?: string } | null)?.role ?? ''));
      } catch { /* ignore */ }
      setLoading(false);
      if (params.conversationId) {
        const convId = params.conversationId;
        const mutedIds = await getMutedIds(supabase).catch(() => [] as string[]);
        setMuted(mutedIds.includes(convId));
        const media = await getSharedMedia(supabase, convId).catch(() => [] as Message[]);
        setPhotos(media.filter((m) => m.type === 'image' && m.media_url));
        setDocs(media.filter((m) => m.type === 'file'));
        setDisappearSecs(await getDisappearing(supabase, convId).catch(() => 0));
      }
    })();
  }, [params.userId, params.conversationId]);

  // Real-time presence: mirror ChatScreen — join the global presence channel and
  // mark this contact "online" when their id is present. Skip for self.
  useEffect(() => {
    if (isMe) return;
    let channel: ReturnType<typeof joinPresence> | null = null;
    (async () => {
      const me = await getCurrentUser(supabase);
      if (!me) return;
      channel = joinPresence(supabase, me.id, (onlineIds) => setOnline(onlineIds.has(params.userId)));
    })();
    return () => {
      leavePresence(channel); // shared room: unhook this screen only
    };
  }, [isMe, params.userId]);

  const presence = online ? 'online' : formatLastSeen(profile?.last_seen) || 'offline';

  async function toggleBlock() {
    const was = blocked;
    if (!was && !(await confirmAsync('Block user', `Block ${profile?.display_name ?? 'this user'}?`))) return;
    setBlocked(!was); // instant; syncs in the background (auto-retries offline)
    queueAction(was ? 'unblock' : 'block', { userId: params.userId });
  }

  function toggleMute() {
    if (!params.conversationId) return;
    const was = muted;
    setMuted(!was);
    queueAction(was ? 'unmute' : 'mute', { conversationId: params.conversationId });
  }

  async function chooseDisappearing(secs: number) {
    if (!params.conversationId) return;
    const prev = disappearSecs;
    setDisappearSecs(secs); // instant
    setDisappearOpen(false);
    const { error } = await setConversationDisappearing(supabase, params.conversationId, secs);
    if (error) {
      setDisappearSecs(prev); // revert on failure
      Alert.alert('Could not update', error.message);
    }
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
    Share.share({ message: `${profile?.display_name ?? 'Lumixo user'} (${handle}) on Lumixo` });
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
        <View>
          <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={120} />
          {!!convId && disappearSecs > 0 && (
            <View style={styles.avatarDisappearBadge}>
              <Ionicons name="timer-outline" size={16} color="#fff" />
            </View>
          )}
        </View>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{profile?.display_name ?? 'Lumixo user'}</Text>
          {isPremium && (
            <Ionicons name="star" size={18} color={colors.primary} style={styles.premiumBadge} />
          )}
          {isModerator && (
            <Ionicons name="shield-checkmark" size={18} color="#3b82f6" style={styles.premiumBadge} />
          )}
        </View>
        {!!profile?.username && <Text style={styles.username}>@{profile.username}</Text>}
        {!isMe && <Text style={styles.presence}>{presence}</Text>}
      </View>

      {!isMe && (
        <View style={styles.actions}>
          <ActionButton icon="chatbubble" label="Message" onPress={message} />
          {!!params.conversationId && (
            <ActionButton
              icon={muted ? 'notifications-off' : 'notifications'}
              label={muted ? 'Unmute' : 'Mute'}
              onPress={toggleMute}
            />
          )}
          <ActionButton icon="call" label="Voice" onPress={() => call('audio')} />
          <ActionButton icon="videocam" label="Video" onPress={() => call('video')} />
        </View>
      )}

      {!isMe && blocked && (
        <View style={styles.blockedBanner}>
          <Text style={styles.blockedText}>🚫 You have blocked this user.</Text>
        </View>
      )}

      <Section title="About">
        <Text style={styles.about}>{profile?.about || 'Hey there! I am using Lumixo.'}</Text>
      </Section>

      {!!profile?.phone && (
        <Section title="Phone">
          <Text style={styles.about}>{profile.phone}</Text>
        </Section>
      )}

      {!isMe && !!params.conversationId && (
        <Section title="Disappearing messages">
          <Pressable style={styles.disappearRow} onPress={() => setDisappearOpen(true)}>
            <Ionicons name="timer-outline" size={20} color={colors.primary} />
            <View style={styles.disappearTextWrap}>
              <Text style={styles.actionRowText}>
                {disappearSecs > 0 ? `On · ${disappearLabel(disappearSecs)}` : 'Off'}
              </Text>
              <Text style={styles.disappearHint}>
                New messages in this chat will disappear after the selected duration.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        </Section>
      )}

      {!isMe && !!convId && (
        <Section title="Chat lock">
          <View style={styles.disappearRow}>
            <Ionicons name={locked ? 'lock-closed' : 'lock-open-outline'} size={20} color={colors.primary} />
            <View style={styles.disappearTextWrap}>
              <Text style={styles.actionRowText}>{locked ? 'On' : 'Off'}</Text>
              <Text style={styles.disappearHint}>
                Require fingerprint, face, or your device PIN to open this chat. Lumixo never stores your PIN or biometrics.
              </Text>
            </View>
            <Switch
              value={locked}
              onValueChange={toggleChatLock}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
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

      {docs.length > 0 && (
        <Section title={`Files & docs · ${docs.length}`}>
          {docs.slice(0, 12).map((m) => (
            <Pressable
              key={m.id}
              style={styles.docRow}
              onPress={() => {
                const url = m.media_url;
                if (!url || !/^https?:\/\//i.test(url)) return; // only open safe http(s) links
                Linking.openURL(url).catch(() => Alert.alert('Could not open', 'This file could not be opened.'));
              }}
            >
              <Ionicons name="document-attach-outline" size={22} color={colors.primary} />
              <Text style={styles.docName} numberOfLines={1}>
                {m.content || 'Attachment'}
              </Text>
              <Ionicons name="open-outline" size={18} color={colors.textFaint} />
            </Pressable>
          ))}
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

      {viewerIndex >= 0 && (
        <MediaViewer items={viewerItems} index={viewerIndex} onClose={() => setViewerUrl(null)} />
      )}

      <Modal visible={disappearOpen} transparent animationType="fade" onRequestClose={() => setDisappearOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setDisappearOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Disappearing messages</Text>
            <Text style={styles.sheetSubtitle}>
              For this chat, new messages will disappear after the selected duration.
            </Text>
            {DISAPPEAR_OPTIONS.map((o) => {
              const active = o.secs === disappearSecs;
              return (
                <Pressable key={o.secs} style={styles.sheetRow} onPress={() => chooseDisappearing(o.secs)}>
                  <Text style={[styles.sheetRowText, active && { color: colors.primary, fontWeight: '700' }]}>
                    {o.label}
                  </Text>
                  {active && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                </Pressable>
              );
            })}
          </Pressable>
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
    nameRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing(3) },
    name: { color: colors.text, fontSize: font.title, fontWeight: '700' },
    premiumBadge: { marginLeft: 6 },
    avatarDisappearBadge: {
      position: 'absolute', right: 2, bottom: 2,
      width: 30, height: 30, borderRadius: 15,
      backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: colors.surface,
    },
    username: { color: colors.textMuted, fontSize: font.body, marginTop: 2 },
    presence: { color: colors.primary, fontSize: font.small, marginTop: 4 },
    actions: { flexDirection: 'row', justifyContent: 'center', gap: spacing(8), paddingVertical: spacing(5), backgroundColor: colors.surface, marginBottom: spacing(2) },
    about: { color: colors.text, fontSize: font.body, lineHeight: 21 },
    editBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: spacing(4), gap: 8 },
    editText: { color: colors.primary, fontSize: font.heading, fontWeight: '600' },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(4), paddingHorizontal: spacing(5), paddingVertical: spacing(3.5), backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    actionRowText: { color: colors.text, fontSize: font.body },
    blockedBanner: { backgroundColor: colors.surface, paddingHorizontal: spacing(5), paddingVertical: spacing(3), marginBottom: spacing(2) },
    blockedText: { color: colors.danger, fontSize: font.body, textAlign: 'center' },
    docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), paddingVertical: spacing(2) },
    docName: { flex: 1, color: colors.text, fontSize: font.body },
    mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    mediaThumb: { width: 78, height: 78, borderRadius: radius.sm, backgroundColor: colors.surface },
    disappearRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(4) },
    disappearTextWrap: { flex: 1 },
    disappearHint: { color: colors.textFaint, fontSize: font.small, marginTop: 2 },
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingVertical: spacing(4), paddingHorizontal: spacing(5) },
    sheetTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: spacing(1) },
    sheetSubtitle: { color: colors.textFaint, fontSize: font.small, marginBottom: spacing(3) },
    sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing(3.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    sheetRowText: { color: colors.text, fontSize: font.body },
  });
