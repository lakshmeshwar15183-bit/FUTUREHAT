// FUTUREHAT mobile — inside a community: its channels and events.
// Channels reuse the conversations/messages stack, so opening one is just a Chat.
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
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
} from '../lib/shared';
import type { Channel, CommunityEvent } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import InputModal, { type Field } from '../components/InputModal';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'CommunityDetail'>;
type Rt = RouteProp<RootStackParamList, 'CommunityDetail'>;

type Tab = 'channels' | 'events';

const CHANNEL_FIELDS: Field[] = [{ key: 'name', placeholder: 'Channel name (e.g. announcements)' }];
const EVENT_FIELDS: Field[] = [
  { key: 'title', placeholder: 'Event title' },
  { key: 'location', placeholder: 'Location (optional)' },
  { key: 'when', placeholder: 'When — YYYY-MM-DD HH:mm', initial: '' },
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
  const [channelModal, setChannelModal] = useState(false);
  const [eventModal, setEventModal] = useState(false);

  const load = useCallback(async () => {
    const [ch, ev] = await Promise.all([
      getChannels(supabase, communityId),
      getCommunityEvents(supabase, communityId),
    ]);
    setChannels(ch);
    setEvents(ev);
  }, [communityId]);

  useFocusEffect(useCallback(() => { navigation.setOptions({ title: name }); load(); }, [load, name, navigation]));

  async function addChannel(values: Record<string, string>) {
    setChannelModal(false);
    const channelName = values.name?.trim();
    if (!channelName) return;
    const { error } = await createChannel(supabase, communityId, channelName, 'text');
    if (error) {
      Alert.alert('Could not add channel', /row-level|policy|permission/i.test(error.message)
        ? 'Only community admins can add channels.'
        : error.message);
      return;
    }
    load();
  }

  async function addEvent(values: Record<string, string>) {
    setEventModal(false);
    const title = values.title?.trim();
    if (!title) return;
    const whenRaw = values.when?.trim();
    const parsed = whenRaw ? new Date(whenRaw.replace(' ', 'T')) : new Date();
    const startsAt = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    const { error } = await createEvent(supabase, {
      communityId,
      title,
      location: values.location?.trim() || undefined,
      startsAt,
    });
    if (error) {
      Alert.alert('Could not create event', error.message);
      return;
    }
    load();
  }

  async function rsvp(eventId: string) {
    const { error } = await rsvpEvent(supabase, eventId, 'going');
    if (error) Alert.alert('RSVP failed', error.message);
    else Alert.alert('You’re going 🎉', 'We’ll keep your spot.');
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(['channels', 'events'] as Tab[]).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'channels' ? 'Channels' : 'Events'}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'channels' ? (
        <FlatList
          data={channels}
          keyExtractor={(c) => c.id}
          ListHeaderComponent={
            <Pressable style={styles.addRow} onPress={() => setChannelModal(true)}>
              <View style={styles.addIcon}>
                <Ionicons name="add" size={22} color="#fff" />
              </View>
              <Text style={styles.addLabel}>Add channel</Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate('Chat', { conversationId: item.conversation_id, title: item.name })}
            >
              <Ionicons
                name={item.kind === 'announcement' ? 'megaphone' : item.kind === 'broadcast' ? 'radio' : 'chatbubbles'}
                size={22}
                color={colors.primary}
              />
              <Text style={styles.rowText}># {item.name}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          )}
          ListEmptyComponent={<Empty colors={colors} icon="chatbubbles-outline" text="No channels yet" />}
        />
      ) : (
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
              <Pressable style={styles.rsvpBtn} onPress={() => rsvp(item.id)}>
                <Ionicons name="checkmark-circle" size={16} color="#fff" />
                <Text style={styles.rsvpText}>Going</Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={<Empty colors={colors} icon="calendar-outline" text="No events yet" />}
        />
      )}

      <InputModal
        visible={channelModal}
        title="New channel"
        fields={CHANNEL_FIELDS}
        submitLabel="Create"
        onCancel={() => setChannelModal(false)}
        onSubmit={addChannel}
      />
      <InputModal
        visible={eventModal}
        title="New event"
        fields={EVENT_FIELDS}
        submitLabel="Create"
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
    rsvpBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing(4), paddingVertical: spacing(2), marginTop: spacing(3) },
    rsvpText: { color: '#fff', fontSize: font.small, fontWeight: '700', marginLeft: spacing(1.5) },
  });
