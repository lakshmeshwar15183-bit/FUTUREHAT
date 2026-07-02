// FUTUREHAT mobile — Archived chats. Lists archived conversations with unarchive
// and open. Standalone; backed by 0010 archived_conversations + accountApi.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { getMyConversations, getArchivedIds, unarchiveConversation, type ConversationSummary } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ArchivedChatsScreen() {
  const colors = useColors();
  const navigation = useNavigation<Nav>();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [convs, ids] = await Promise.all([
        getMyConversations(supabase).catch(() => [] as ConversationSummary[]),
        getArchivedIds(supabase).catch(() => [] as string[]),
      ]);
      const set = new Set(ids);
      setItems(convs.filter((c) => set.has(c.conversation.id)));
      setLoading(false);
    })();
  }, []);

  async function unarchive(id: string) {
    setItems((cur) => cur.filter((c) => c.conversation.id !== id));
    await unarchiveConversation(supabase, id);
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.subtitle}>Archived chats stay hidden from your main list. They reappear there when a new message arrives.</Text>
      {loading ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : items.length === 0 ? (
        <Text style={styles.empty}>No archived chats.</Text>
      ) : items.map((c) => (
        <View key={c.conversation.id} style={styles.row}>
          <Pressable style={styles.rowMain} onPress={() => navigation.navigate('Chat', { conversationId: c.conversation.id, title: c.title })}>
            <Avatar uri={undefined} name={c.title} size={46} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>{c.title}</Text>
              <Text style={styles.rowPreview} numberOfLines={1}>{c.lastMessage?.content || 'No messages yet'}</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => unarchive(c.conversation.id)}><Text style={styles.unarchive}>Unarchive</Text></Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing(10), fontSize: font.body },
    subtitle: { color: colors.textMuted, fontSize: font.small, paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    rowBody: { flex: 1, marginLeft: spacing(3) },
    rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    rowPreview: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    unarchive: { color: colors.primary, fontSize: font.small, fontWeight: '600', marginLeft: spacing(2) },
  });
