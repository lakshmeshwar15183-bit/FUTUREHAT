// Lumixo mobile — Archived chats. Lists archived conversations with unarchive
// and open. Standalone; backed by 0010 archived_conversations + accountApi.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import SafeScrollView from '../ui/SafeScrollView';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { getMyConversations, getArchivedIds, getCurrentUser, type ConversationSummary } from '../lib/shared';
import {
  getCachedConversations, getCache, setCache,
  pendingConversationEffects, reconcileIds, mergeEffects,
} from '../lib/localCache';
import { queueAction } from '../lib/sync';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import { LumixoCat } from '../components/LumixoCat';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ArchivedChatsScreen() {
  const colors = useColors();
  const navigation = useNavigation<Nav>();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // The archived set is the server/cached id list reconciled with any archive /
    // unarchive still queued (not yet synced). This makes a chat the user just
    // archived from the main list appear here INSTANTLY and offline (local-first,
    // Issue 4), and a just-unarchived chat disappear — without waiting on a
    // successful server read, and without a stale read dropping a pending archive.
    const filterArchived = (
      convs: ConversationSummary[],
      ids: Iterable<string>,
      eff: { adds: Set<string>; removes: Set<string> },
    ) => {
      const set = reconcileIds(ids, eff);
      return convs.filter((c) => set.has(c.conversation.id));
    };
    (async () => {
      const u = await getCurrentUser(supabase).catch(() => null);
      if (!active) return;
      const id = u?.id ?? null;
      setUid(id);
      // Instant: paint from cached conversations + cached archived ids (offline
      // included), folding in pending archive/unarchive. No spinner when cached.
      if (id) {
        const [cachedConvs, cachedIds, eff] = await Promise.all([
          getCachedConversations(id),
          getCache<string[]>(`archivedIds:${id}`, []),
          pendingConversationEffects(['archive'], ['unarchive']),
        ]);
        if (active && cachedConvs.length) { setItems(filterArchived(cachedConvs, cachedIds, eff)); setLoading(false); }
      }
      // Background refresh + re-cache. Capture pending effects before and after the
      // reads so an archive/unarchive that syncs (and dequeues) mid-read still
      // counts. If EITHER read fails (offline / transient), keep the cached paint
      // instead of blanking the list — the cache is still the best truth we have.
      try {
        const effBefore = await pendingConversationEffects(['archive'], ['unarchive']);
        const [convs, ids] = await Promise.all([
          getMyConversations(supabase),
          getArchivedIds(supabase),
        ]);
        const effAfter = await pendingConversationEffects(['archive'], ['unarchive']);
        if (!active) return;
        setItems(filterArchived(convs, ids, mergeEffects(effBefore, effAfter)));
        if (id) setCache(`archivedIds:${id}`, ids).catch(() => {});
      } catch {
        /* keep cached paint */
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  function unarchive(id: string) {
    setItems((cur) => cur.filter((c) => c.conversation.id !== id)); // instant
    if (uid) getCache<string[]>(`archivedIds:${uid}`, []).then((ids) =>
      setCache(`archivedIds:${uid}`, ids.filter((x) => x !== id)),
    );
    queueAction('unarchive', { conversationId: id }); // durable, auto-retry
  }

  return (
    <SafeScrollView style={styles.container}>
      <Text style={styles.subtitle}>Archived chats stay hidden from your main list. They reappear there when a new message arrives.</Text>
      {loading ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <LumixoCat mood="sleeping" size="md" decorative />
          <Text style={styles.empty}>No archived chats.</Text>
        </View>
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
    </SafeScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    emptyWrap: { alignItems: 'center', marginTop: spacing(8), paddingHorizontal: spacing(4) },
    empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing(3), fontSize: font.body },
    subtitle: { color: colors.textMuted, fontSize: font.small, paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    rowBody: { flex: 1, marginLeft: spacing(3) },
    rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    rowPreview: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    unarchive: { color: colors.primary, fontSize: font.small, fontWeight: '600', marginLeft: spacing(2) },
  });
