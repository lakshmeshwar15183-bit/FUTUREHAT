// FUTUREHAT mobile — "Starred messages" browser. Read-only list of every message
// the user has starred, across all chats (WhatsApp-style), backed by the additive
// get_starred_messages() RPC (0014). Mirrors web StarredMessagesModal. Tapping a
// row opens that conversation. Degrades to an empty state if the RPC isn't applied.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { getStarredMessages } from '../lib/shared';
import type { StarredMessage } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function preview(m: StarredMessage): string {
  if (m.type === 'image') return '📷 Photo';
  if (m.type === 'audio') return '🎤 Voice message';
  if (m.type === 'file') return '📎 Attachment';
  return m.content ?? '';
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export default function StarredScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<StarredMessage[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getStarredMessages(supabase)
        .then((rows) => { if (active) setItems(rows); })
        .catch(() => { if (active) setItems([]); });
      return () => { active = false; };
    }, []),
  );

  if (items === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="star-outline" size={54} color={colors.textFaint} />
        <Text style={styles.emptyTitle}>No starred messages yet</Text>
        <Text style={styles.emptySub}>Tap ⭐ on any message to save it here for quick access.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={items}
      keyExtractor={(m) => m.message_id}
      contentContainerStyle={{ paddingVertical: spacing(2) }}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
          onPress={() =>
            navigation.navigate('Chat', {
              conversationId: item.conversation_id,
              title: item.conversation_title ?? item.sender_name ?? 'Conversation',
            })
          }
        >
          <Avatar uri={item.sender_avatar} name={item.sender_name} size={42} />
          <View style={styles.body}>
            <View style={styles.head}>
              <Text style={styles.chat} numberOfLines={1}>{item.conversation_title ?? item.sender_name ?? 'Conversation'}</Text>
              <Text style={styles.when}>{whenLabel(item.starred_at)}</Text>
            </View>
            <Text style={styles.sender} numberOfLines={1}>{item.sender_name ?? 'Unknown'}</Text>
            <Text style={styles.preview} numberOfLines={2}>{preview(item)}</Text>
          </View>
          <Ionicons name="star" size={15} color={colors.accentPlus} style={{ marginLeft: spacing(2) }} />
        </Pressable>
      )}
    />
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, paddingHorizontal: spacing(8) },
    emptyTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginTop: spacing(4) },
    emptySub: { color: colors.textMuted, fontSize: font.small, textAlign: 'center', marginTop: spacing(2) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3),
    },
    body: { flex: 1, marginLeft: spacing(3) },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    chat: { flex: 1, color: colors.text, fontSize: font.body, fontWeight: '600' },
    when: { color: colors.textFaint, fontSize: font.tiny, marginLeft: spacing(2) },
    sender: { color: colors.textMuted, fontSize: font.small, marginTop: 1 },
    preview: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
  });
