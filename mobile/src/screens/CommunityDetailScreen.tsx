// Lumixo mobile — inside a community: its channels and events.
// Channels reuse the conversations/messages stack, so opening one is just a Chat.
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import {
  getChannels,
  createChannel,
  getCommunityEvents,
  createEvent,
  rsvpEvent,
  getCommunityMembers,
  getCurrentUser,
  leaveCommunity,
} from '../lib/shared';
import type { Channel, CommunityEvent, CommunityMember } from '../lib/shared';
import { getCache, setCache } from '../lib/localCache';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import ProfileAvatar from '../components/ProfileAvatar';
import EventComposerModal, { type EventDraft } from '../components/EventComposerModal';
import type { RootStackParamList } from '../navigation/types';
import { Alert, showSheet } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList, 'CommunityDetail'>;
type Rt = RouteProp<RootStackParamList, 'CommunityDetail'>;

type Tab = 'channels' | 'events' | 'members';

const CHANNEL_KINDS: { kind: Channel['kind']; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: 'text', label: 'Text', icon: 'chatbubbles' },
  { kind: 'announcement', label: 'Announcement', icon: 'megaphone' },
  { kind: 'broadcast', label: 'Broadcast', icon: 'radio' },
];
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CommunityDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const { communityId, name } = params;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [tab, setTab] = useState<Tab>('channels');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [channelModal, setChannelModal] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelKind, setChannelKind] = useState<Channel['kind']>('text');
  const [eventModal, setEventModal] = useState(false);

  const cacheKey = `community:${communityId}`;

  const load = useCallback(async () => {
    // Instant: paint channels/events/members from cache first (offline included),
    // so the community opens with no blank/spinner, then refresh in background.
    getCache<{ channels: Channel[]; events: CommunityEvent[]; members: CommunityMember[]; ownerId: string | null } | null>(cacheKey, null)
      .then((c) => {
        if (!c) return;
        setChannels(c.channels);
        setEvents(c.events);
        setMembers(c.members);
        setOwnerId(c.ownerId);
      });
    const [ch, ev, mem, comm, me] = await Promise.all([
      getChannels(supabase, communityId).catch(() => [] as Channel[]),
      getCommunityEvents(supabase, communityId).catch(() => [] as CommunityEvent[]),
      getCommunityMembers(supabase, communityId).catch(() => [] as CommunityMember[]),
      supabase.from('communities').select('owner_id').eq('id', communityId).maybeSingle(),
      getCurrentUser(supabase),
    ]);
    const ownerId = (comm.data as any)?.owner_id ?? null;
    setChannels(ch);
    setEvents(ev);
    setMembers(mem);
    setOwnerId(ownerId);
    setMyId(me?.id ?? null);
    setCache(cacheKey, { channels: ch, events: ev, members: mem, ownerId }).catch(() => {});
  }, [communityId, cacheKey]);

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        (m.profile?.display_name || '').toLowerCase().includes(q) ||
        (m.profile?.username || '').toLowerCase().includes(q),
    );
  }, [members, memberQuery]);

  // Announcements first (WhatsApp), then other groups A–Z.
  const orderedChannels = useMemo(() => {
    return [...channels].sort((a, b) => {
      const aAnn = a.kind === 'announcement' ? 0 : 1;
      const bAnn = b.kind === 'announcement' ? 0 : 1;
      if (aAnn !== bAnn) return aAnn - bAnn;
      return a.name.localeCompare(b.name);
    });
  }, [channels]);

  const roleOf = (m: CommunityMember) => (m.user_id === ownerId ? 'Owner' : m.role === 'admin' ? 'Admin' : null);
  const isAdmin =
    !!myId &&
    (myId === ownerId || members.some((m) => m.user_id === myId && m.role === 'admin'));

  const openOverflow = useCallback(() => {
    showSheet({
      title: name,
      actions: [
        {
          text: 'Add group',
          icon: 'group',
          onPress: () => {
            if (isAdmin) openChannelModal();
            else Alert.alert('Admins only', 'Only community admins can add groups.');
          },
        },
        {
          text: 'Invite via ID',
          icon: 'link',
          onPress: () =>
            Alert.alert('Community ID', communityId, [{ text: 'OK' }]),
        },
        {
          text: 'Exit community',
          icon: 'exit',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Exit community?', `Leave “${name}”?`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Exit',
                style: 'destructive',
                onPress: async () => {
                  const { error } = await leaveCommunity(supabase, communityId);
                  if (error) {
                    Alert.alert('Could not leave', error.message);
                    return;
                  }
                  navigation.goBack();
                },
              },
            ]);
          },
        },
        {
          text: 'Report',
          icon: 'report',
          style: 'destructive',
          onPress: () => Alert.alert('Report', 'Thanks — our team will review this community.'),
        },
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, communityId, isAdmin, navigation]);

  useFocusEffect(
    useCallback(() => {
      navigation.setOptions({
        title: name,
        headerRight: () => (
          <Pressable onPress={openOverflow} hitSlop={10} style={{ paddingHorizontal: 8 }}>
            <Ionicons name="ellipsis-vertical" size={20} color="#fff" />
          </Pressable>
        ),
      });
      load();
    }, [load, name, navigation, openOverflow]),
  );

  function openChannelModal() {
    setChannelName('');
    setChannelKind('text');
    setChannelModal(true);
  }

  async function addChannel() {
    const trimmed = channelName.trim();
    if (!trimmed) return;
    setChannelModal(false);
    const { error } = await createChannel(supabase, communityId, trimmed, channelKind);
    if (error) {
      Alert.alert('Could not add channel', /row-level|policy|permission/i.test(error.message)
        ? 'Only community admins can add channels.'
        : error.message);
      return;
    }
    load();
  }

  async function addEvent(draft: EventDraft) {
    setEventModal(false);
    const { error } = await createEvent(supabase, {
      communityId,
      title: draft.title,
      location: draft.location || undefined,
      startsAt: draft.startsAt,
    });
    if (error) {
      Alert.alert('Could not create event', error.message);
      return;
    }
    load();
  }

  async function rsvp(eventId: string, status: 'going' | 'maybe' | 'no') {
    const { error } = await rsvpEvent(supabase, eventId, status);
    if (error) {
      Alert.alert('RSVP failed', error.message);
      return;
    }
    const label = status === 'going' ? 'You’re going 🎉' : status === 'maybe' ? 'Marked as maybe' : 'Marked as can’t go';
    Alert.alert('RSVP saved', label);
  }

  return (
    <View style={styles.container}>
      {isAdmin && (
        <View style={styles.adminBanner}>
          <Ionicons name="shield-checkmark" size={14} color={colors.accentPlusText} />
          <Text style={styles.adminBannerText}>You’re an admin of {name}</Text>
        </View>
      )}
      <View style={styles.tabs}>
        {(['channels', 'events', 'members'] as Tab[]).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'channels' ? 'Channels' : t === 'events' ? 'Events' : 'Members'}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'channels' ? (
        <FlatList
          data={orderedChannels}
          keyExtractor={(c) => c.id}
          ListHeaderComponent={
            <>
              <View style={styles.infoHeader}>
                <Text style={styles.infoTitle}>Groups</Text>
                <Text style={styles.infoSub}>
                  {orderedChannels.length} group{orderedChannels.length === 1 ? '' : 's'}
                  {members.length ? ` · ${members.length} members` : ''}
                </Text>
              </View>
              {isAdmin ? (
                <Pressable style={styles.addRow} onPress={openChannelModal}>
                  <View style={styles.addIcon}>
                    <Ionicons name="add" size={22} color="#fff" />
                  </View>
                  <Text style={styles.addLabel}>Add group</Text>
                </Pressable>
              ) : null}
            </>
          }
          renderItem={({ item }) => {
            const isAnn = item.kind === 'announcement';
            const title = isAnn ? 'Announcements' : item.name;
            return (
              <Pressable
                style={styles.groupRow}
                onPress={() =>
                  navigation.navigate('Chat', {
                    conversationId: item.conversation_id,
                    title,
                  })
                }
              >
                <View style={[styles.groupAvatar, isAnn && styles.annAvatar]}>
                  {isAnn ? (
                    <Ionicons name="megaphone" size={22} color="#fff" />
                  ) : (
                    <Avatar uri={null} name={item.name} size={48} />
                  )}
                </View>
                <View style={styles.groupBody}>
                  <Text style={styles.groupName} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={styles.groupSub} numberOfLines={1}>
                    {isAnn
                      ? 'Only admins can post'
                      : item.kind === 'broadcast'
                        ? 'Broadcast'
                        : 'Group'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              </Pressable>
            );
          }}
          ListEmptyComponent={<Empty colors={colors} icon="chatbubbles-outline" text="No groups yet" />}
        />
      ) : tab === 'events' ? (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          ListHeaderComponent={
            <Pressable style={styles.addRow} onPress={() => setEventModal(true)}>
              <View style={styles.addIcon}>
                <Ionicons name="calendar" size={20} color="#fff" />
              </View>
              <Text style={styles.addLabel}>Create event</Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <View style={styles.eventCard}>
              <Text style={styles.eventTitle}>{item.title}</Text>
              <View style={styles.eventMetaRow}>
                <Ionicons name="time-outline" size={15} color={colors.textMuted} />
                <Text style={styles.eventMeta}>{formatWhen(item.starts_at)}</Text>
              </View>
              {!!item.location && (
                <View style={styles.eventMetaRow}>
                  <Ionicons name="location-outline" size={15} color={colors.textMuted} />
                  <Text style={styles.eventMeta}>{item.location}</Text>
                </View>
              )}
              <View style={styles.rsvpRow}>
                <Pressable style={styles.rsvpBtn} onPress={() => rsvp(item.id, 'going')}>
                  <Ionicons name="checkmark-circle" size={16} color="#fff" />
                  <Text style={styles.rsvpText}>Going</Text>
                </Pressable>
                <Pressable style={[styles.rsvpBtn, styles.rsvpBtnAlt]} onPress={() => rsvp(item.id, 'maybe')}>
                  <Ionicons name="help-circle" size={16} color={colors.primary} />
                  <Text style={[styles.rsvpText, styles.rsvpTextAlt]}>Maybe</Text>
                </Pressable>
                <Pressable style={[styles.rsvpBtn, styles.rsvpBtnAlt]} onPress={() => rsvp(item.id, 'no')}>
                  <Ionicons name="close-circle" size={16} color={colors.primary} />
                  <Text style={[styles.rsvpText, styles.rsvpTextAlt]}>Can’t</Text>
                </Pressable>
              </View>
            </View>
          )}
          ListEmptyComponent={<Empty colors={colors} icon="calendar-outline" text="No events yet" />}
        />
      ) : (
        <FlatList
          data={filteredMembers}
          keyExtractor={(m) => m.user_id}
          ListHeaderComponent={
            <TextInput
              style={styles.memberSearch}
              placeholder="Search members"
              placeholderTextColor={colors.textFaint}
              value={memberQuery}
              onChangeText={setMemberQuery}
            />
          }
          renderItem={({ item }) => (
            <Pressable style={styles.memberRow} onPress={() => navigation.navigate('Profile', { userId: item.user_id })}>
              <ProfileAvatar
                uri={item.profile?.avatar_url}
                name={item.profile?.display_name}
                size={42}
                userId={item.user_id}
                mode="auto"
              />
              <View style={{ flex: 1, marginLeft: spacing(3) }}>
                <Text style={styles.rowText} numberOfLines={1}>{item.profile?.display_name || 'User'}</Text>
                {!!item.profile?.username && <Text style={styles.memberHandle}>@{item.profile.username}</Text>}
              </View>
              {roleOf(item) && (
                <View style={[styles.badge, roleOf(item) === 'Owner' && styles.badgeOwner]}>
                  <Text style={[styles.badgeText, roleOf(item) === 'Owner' && styles.badgeTextOwner]}>{roleOf(item)}</Text>
                </View>
              )}
            </Pressable>
          )}
          ListEmptyComponent={<Empty colors={colors} icon="people-outline" text="No members found" />}
        />
      )}

      <Modal visible={channelModal} transparent animationType="fade" onRequestClose={() => setChannelModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setChannelModal(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>New channel</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Channel name (e.g. announcements)"
              placeholderTextColor={colors.textFaint}
              value={channelName}
              onChangeText={setChannelName}
              autoFocus
            />
            <Text style={styles.modalLabel}>Type</Text>
            <View style={styles.kindRow}>
              {CHANNEL_KINDS.map((k) => {
                const on = channelKind === k.kind;
                return (
                  <Pressable
                    key={k.kind}
                    style={[styles.kindOption, on && styles.kindOptionOn]}
                    onPress={() => setChannelKind(k.kind)}
                  >
                    <Ionicons name={k.icon} size={18} color={on ? '#fff' : colors.textMuted} />
                    <Text style={[styles.kindLabel, on && styles.kindLabelOn]}>{k.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setChannelModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalSubmit, !channelName.trim() && styles.modalSubmitDisabled]}
                onPress={addChannel}
                disabled={!channelName.trim()}
              >
                <Text style={styles.modalSubmitText}>Create</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <EventComposerModal
        visible={eventModal}
        onCancel={() => setEventModal(false)}
        onSubmit={addEvent}
      />
    </View>
  );
}

function Empty({ colors, icon, text }: { colors: Palette; icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={{ alignItems: 'center', paddingTop: spacing(16) }}>
      <Ionicons name={icon} size={52} color={colors.textFaint} />
      <Text style={{ color: colors.textMuted, fontSize: font.body, marginTop: spacing(3) }}>{text}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    adminBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing(1.5), backgroundColor: colors.accentPlus + '22', paddingVertical: spacing(2) },
    adminBannerText: { color: colors.accentPlusText, fontSize: font.small, fontWeight: '700' },
    tabs: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    tab: { flex: 1, alignItems: 'center', paddingVertical: spacing(3.5) },
    tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
    tabLabel: { color: colors.textMuted, fontSize: font.body, fontWeight: '600' },
    tabLabelActive: { color: colors.primary },
    addRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
    addIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    addLabel: { color: colors.text, fontSize: font.body, fontWeight: '600', marginLeft: spacing(3) },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3.5), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowText: { flex: 1, color: colors.text, fontSize: font.body, marginLeft: spacing(3) },
    eventCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(4), marginHorizontal: spacing(4), marginTop: spacing(3) },
    eventTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: spacing(2) },
    eventMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing(1) },
    eventMeta: { color: colors.textMuted, fontSize: font.small, marginLeft: spacing(2) },
    rsvpRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(3) },
    rsvpBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
    rsvpBtnAlt: { backgroundColor: colors.surfaceAlt },
    rsvpText: { color: '#fff', fontSize: font.small, fontWeight: '700', marginLeft: spacing(1.5) },
    rsvpTextAlt: { color: colors.primary },
    memberSearch: { backgroundColor: colors.surface, color: colors.text, fontSize: font.body, margin: spacing(3), paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderRadius: radius.pill },
    memberRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    memberHandle: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    badge: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing(3), paddingVertical: spacing(1) },
    badgeOwner: { backgroundColor: colors.accentPlus + '33' },
    badgeText: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700' },
    badgeTextOwner: { color: colors.accentPlusText },
    modalBackdrop: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', padding: spacing(6) },
    modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(5) },
    modalTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: spacing(4) },
    modalInput: { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.md, paddingHorizontal: spacing(4), paddingVertical: spacing(3), fontSize: font.body },
    modalLabel: { color: colors.textMuted, fontSize: font.small, fontWeight: '600', marginTop: spacing(4), marginBottom: spacing(2) },
    kindRow: { flexDirection: 'row', gap: spacing(2) },
    kindOption: { flex: 1, flexDirection: 'column', alignItems: 'center', gap: spacing(1), paddingVertical: spacing(3), borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    kindOptionOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    kindLabel: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '600' },
    kindLabelOn: { color: '#fff' },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(3), marginTop: spacing(5) },
    modalCancel: { paddingHorizontal: spacing(4), paddingVertical: spacing(2.5) },
    modalCancelText: { color: colors.textMuted, fontSize: font.body, fontWeight: '600' },
    modalSubmit: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing(5), paddingVertical: spacing(2.5) },
    modalSubmitDisabled: { opacity: 0.5 },
    modalSubmitText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
    infoHeader: {
      paddingHorizontal: spacing(4),
      paddingTop: spacing(4),
      paddingBottom: spacing(2),
    },
    infoTitle: {
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '700',
    },
    infoSub: {
      color: colors.textMuted,
      fontSize: font.small,
      marginTop: 4,
    },
    groupRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(2.5),
      minHeight: 68,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    groupAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    annAvatar: {
      backgroundColor: colors.primary,
    },
    groupBody: { flex: 1, marginLeft: spacing(3), minWidth: 0 },
    groupName: {
      color: colors.text,
      fontSize: font.body,
      fontWeight: '600',
    },
    groupSub: {
      color: colors.textMuted,
      fontSize: font.small,
      marginTop: 2,
    },
  });
