// FUTUREHAT mobile — Chats tab. Loads getMyConversations on focus, shows
// title/avatar/last-message/unread, and routes into a thread.
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { getMyConversations, getCurrentUser } from '../lib/shared';
import type { ConversationSummary } from '../lib/shared';
import { formatListTimestamp } from '../lib/time';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ConversationsScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getCurrentUser(supabase).then((u) => { if (alive) setUid(u?.id ?? null); }).catch(() => {});
      return () => { alive = false; };
    }, []),
  );

  const load = useCallback(async () => {
    try {
      const data = await getMyConversations(supabase);
      setItems(data);
    } catch {
      // keep last known list on transient errors
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const lastPreview = (c: ConversationSummary): string => {
    const m = c.lastMessage;
    if (!m) return 'Tap to start chatting';
    if (m.is_deleted) return 'This message was deleted';
    const body =
      m.type === 'image' ? '📷 Photo' :
      m.type === 'audio' ? '🎤 Voice message' :
      m.type === 'file' ? '📎 Attachment' :
      (m.content ?? '');
    if (uid && m.sender_id === uid) return `You: ${body}`;
    if (c.conversation.type === 'group') {
      const name = c.participants.find((p) => p.id === m.sender_id)?.display_name;
      return name ? `${name.split(' ')[0]}: ${body}` : body;
    }
    return body;
  };

  const renderItem = ({ item }: { item: ConversationSummary }) => (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() =>
        navigation.navigate('Chat', {
          conversationId: item.conversation.id,
          title: item.title,
        })
      }
    >
      <Avatar uri={item.avatarUrl} name={item.title} size={52} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.time, item.unreadCount > 0 && styles.timeUnread]}>
            {formatListTimestamp(item.lastMessage?.created_at)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.preview} numberOfLines={1}>
            {lastPreview(item)}
          </Text>
          {item.unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {item.unreadCount > 99 ? '99+' : item.unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(c) => c.conversation.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={64} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptySub}>
                Tap the button below to find someone and say hello.
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={items.length === 0 ? styles.flexGrow : undefined}
      />

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={() => navigation.navigate('NewChat')}
      >
        <Ionicons name="create-outline" size={26} color="#fff" />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    flexGrow: { flexGrow: 1 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3),
    },
    rowPressed: { backgroundColor: colors.surface },
    rowBody: { flex: 1, marginLeft: spacing(3) },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing(1),
    },
    title: { color: colors.text, fontSize: font.heading, fontWeight: '600', flex: 1 },
    time: { color: colors.textFaint, fontSize: font.tiny, marginLeft: spacing(2) },
    timeUnread: { color: colors.primary },
    preview: { color: colors.textMuted, fontSize: font.small, flex: 1 },
    badge: {
      backgroundColor: colors.primary,
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: spacing(2),
    },
    badgeText: { color: '#fff', fontSize: font.tiny, fontWeight: '700' },
    sep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: spacing(4) + 52 + spacing(3),
    },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(8) },
    emptyTitle: {
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '600',
      marginTop: spacing(4),
    },
    emptySub: {
      color: colors.textMuted,
      fontSize: font.small,
      textAlign: 'center',
      marginTop: spacing(2),
    },
    fab: {
      position: 'absolute',
      right: spacing(5),
      bottom: spacing(6),
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    fabPressed: { backgroundColor: colors.primaryDark },
  });
