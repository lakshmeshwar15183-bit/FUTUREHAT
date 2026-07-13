// Lumixo mobile — start a new conversation. Two modes:
//   • no search query  → persistent "recent contacts" (people you've chatted
//     with before), rendered instantly from local cache and refreshed in the
//     background. Survives deleting the conversation (independent data source).
//   • search query      → live user search by name/@username via the shared API.
// Tap a person to open/create the 1:1 thread. Long-press a recent contact to
// remove them from this history (removal only — never deletes messages, the
// conversation, or blocks anyone).
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import SafeFlatList from '../ui/SafeFlatList';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import ProfileAvatar from '../components/ProfileAvatar';
import {
  searchProfiles,
  startDirectConversation,
  getCurrentUser,
  listRecentContacts,
  discoverContactsFromEntries,
  resolveDisplayName,
  type Profile,
  type RecentContact,
  type DiscoveredContact,
} from '../lib/shared';
import { readLocalContactEntries } from '../lib/deviceContacts';
import { LumixoCat } from '../components/LumixoCat';
import {
  getCachedRecentContacts,
  cacheRecentContacts,
  getActionQueue,
} from '../lib/localCache';
import { queueAction } from '../lib/sync';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';
import { Alert } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList, 'NewChat'>;

export default function NewChatScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentContact[]>([]);
  const [phoneMatches, setPhoneMatches] = useState<DiscoveredContact[]>([]);
  const [discovering, setDiscovering] = useState(false);

  // ── Offline-first load of recent contacts ──────────────────────────────────
  // 1) render the local cache immediately (no network wait), then
  // 2) refresh from the server and reconcile against not-yet-synced removals so
  //    a contact the user just removed doesn't flash back in.
  useEffect(() => {
    let active = true;
    (async () => {
      const u = await getCurrentUser(supabase);
      if (!active) return;
      const myId = u?.id ?? null;
      setUid(myId);
      if (!myId) return;

      const cached = await getCachedRecentContacts(myId);
      if (active && cached.length) {
        setRecent(cached.filter((r) => r.contact && r.contact.id !== myId));
      }

      const [server, queue] = await Promise.all([listRecentContacts(supabase), getActionQueue()]);
      if (!active) return;
      const pendingRemovals = new Set(
        queue.filter((a) => a.kind === 'removeRecentContact').map((a) => a.payload?.contactId),
      );
      const reconciled = server.filter(
        (r) => r.contact && r.contact.id !== myId && !pendingRemovals.has(r.contact.id),
      );
      setRecent(reconciled);
      cacheRecentContacts(myId, reconciled);
    })();
    return () => {
      active = false;
    };
  }, []);

  // ── Live user search (unchanged behaviour) ─────────────────────────────────
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const data = await searchProfiles(supabase, q);
        if (active) {
          // never surface the current user in their own results
          setResults(data.filter((p) => p.id !== uid));
        }
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, uid]);

  // Optimistically fold a just-contacted person into the local recent list +
  // cache BEFORE the server responds (the server also records it inside
  // start_direct_conversation). Moves an existing entry to the top.
  function addRecentOptimistic(p: Profile) {
    if (!uid || p.id === uid) return;
    const now = new Date().toISOString();
    setRecent((cur) => {
      const existing = cur.find((r) => r.contact.id === p.id);
      const entry: RecentContact = existing
        ? { ...existing, contact: p, last_interaction_at: now }
        : { contact: p, first_interaction_at: now, last_interaction_at: now };
      const next = [entry, ...cur.filter((r) => r.contact.id !== p.id)];
      cacheRecentContacts(uid, next);
      return next;
    });
  }

  async function open(p: Profile) {
    if (opening) return;
    setOpening(true);
    addRecentOptimistic(p); // instant + offline-first; server persists it too
    const { conversationId, error } = await startDirectConversation(supabase, p.id);
    setOpening(false);
    if (error || !conversationId) return;
    navigation.replace('Chat', {
      conversationId,
      title: p.display_name ?? p.username ?? 'Chat',
    });
  }

  // Remove-only: forget the New Chat history entry. Updates UI + cache instantly,
  // then syncs the deletion via the durable action queue (works offline). Does
  // NOT delete messages, delete the conversation, or block the user.
  function confirmRemove(p: Profile) {
    Alert.alert(
      p.display_name ?? p.username ?? 'Contact',
      'Remove from recent contacts? This only removes them from New Chat — your messages and the conversation are kept, and the user is not blocked.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeContact(p.id) },
      ],
    );
  }

  function removeContact(contactId: string) {
    setRecent((cur) => {
      const next = cur.filter((r) => r.contact.id !== contactId);
      if (uid) cacheRecentContacts(uid, next);
      return next;
    });
    queueAction('removeRecentContact', { contactId });
  }

  async function findFromPhoneContacts() {
    if (discovering) return;
    setDiscovering(true);
    try {
      // WhatsApp-class: tap → system permission dialog first (no custom pre-prompt).
      // Permanent deny → Open Settings. Soft deny → friendly note, stay usable.
      const { entries, permission, error: readErr } = await readLocalContactEntries();

      if (permission === 'unavailable') {
        Alert.alert(
          'Contacts',
          readErr?.message ??
            'Contacts are not available on this build. Update the app to find friends by phone.',
        );
        return;
      }

      if (permission === 'permanently_denied') {
        Alert.alert(
          'Contacts access',
          'Contacts permission is permanently turned off for Lumixo. Open Settings to enable it so you can find friends from your address book.',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => {
                void Linking.openSettings().catch(() => {});
              },
            },
          ],
        );
        return;
      }

      if (permission === 'denied' || permission === 'undetermined') {
        // User dismissed the system dialog once — do not block the rest of the app.
        Alert.alert(
          'Contacts',
          'You can still search by name or @username. Allow Contacts anytime to find friends who are already on Lumixo.',
        );
        return;
      }

      // granted
      if (readErr) {
        Alert.alert('Contacts', readErr.message);
        return;
      }
      if (!entries.length) {
        Alert.alert('Contacts', 'No phone numbers found in your contacts.');
        return;
      }
      const { matches, error } = await discoverContactsFromEntries(supabase, entries);
      if (error) {
        Alert.alert('Contacts', error.message);
        return;
      }
      setPhoneMatches(matches.filter((m) => m.userId !== uid));
      if (!matches.length) {
        Alert.alert(
          'No matches',
          'None of your contacts are on Lumixo yet. Invite friends to join with their email.',
        );
      }
    } finally {
      setDiscovering(false);
    }
  }

  const isSearching = query.trim().length >= 2;
  const recentProfiles = recent.map((r) => r.contact).filter((p) => p && p.id !== uid);
  const phoneProfiles = phoneMatches.map((m) => ({
    ...m.profile,
    // Prefer local address-book name for the subtitle only; open() uses profile.
    _localName: m.localName,
  }));

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or @username"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoFocus
        />
        {searching && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      <Pressable style={styles.actionRow} onPress={() => navigation.navigate('NewGroup')}>
        <View style={[styles.actionIcon, { backgroundColor: colors.primary }]}>
          <Ionicons name="people" size={22} color="#fff" />
        </View>
        <Text style={styles.actionLabel}>New group</Text>
      </Pressable>

      <Pressable style={styles.actionRow} onPress={findFromPhoneContacts} disabled={discovering}>
        <View style={[styles.actionIcon, { backgroundColor: colors.primary }]}>
          {discovering ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name="person-add" size={22} color="#fff" />
          )}
        </View>
        <View style={{ flex: 1, marginLeft: spacing(3) }}>
          <Text style={[styles.actionLabel, { marginLeft: 0 }]}>Find from contacts</Text>
          <Text style={styles.actionSub}>
            Numbers stay on your phone — only private hashes are checked
          </Text>
        </View>
      </Pressable>

      <SafeFlatList
        data={isSearching ? results : [...phoneProfiles.map((p) => p as Profile), ...recentProfiles.filter((r) => !phoneMatches.some((m) => m.userId === r.id))]}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: spacing(4) }}
        ListHeaderComponent={
          !isSearching ? (
            <>
              {phoneMatches.length > 0 ? (
                <Text style={styles.sectionLabel}>ON LUMIXO FROM YOUR CONTACTS</Text>
              ) : null}
              {phoneMatches.length === 0 && recentProfiles.length > 0 ? (
                <Text style={styles.sectionLabel}>RECENT CONTACTS</Text>
              ) : null}
            </>
          ) : null
        }
        renderItem={({ item }) => {
          const local = phoneMatches.find((m) => m.userId === item.id)?.localName;
          const title = resolveDisplayName(item) || local || 'Lumixo user';
          return (
            <Pressable
              style={styles.row}
              onPress={() => open(item)}
              onLongPress={!isSearching && !phoneMatches.some((m) => m.userId === item.id) ? () => confirmRemove(item) : undefined}
              delayLongPress={300}
            >
              <ProfileAvatar
                uri={item.avatar_url}
                name={item.display_name ?? item.username}
                size={48}
                userId={item.id}
                mode="auto"
              />
              <View style={styles.rowBody}>
                <Text style={styles.name}>{title}</Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {local && item.display_name
                    ? `${item.display_name}${item.username ? ` · @${item.username}` : ''}`
                    : item.about || (item.username ? `@${item.username}` : 'Available')}
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          isSearching && !searching ? (
            <View style={styles.emptyWrap}>
              <LumixoCat mood="confused" size="sm" decorative />
              <Text style={styles.empty}>No users found for “{query.trim()}”.</Text>
            </View>
          ) : !isSearching ? (
            <View style={styles.emptyWrap}>
              <LumixoCat mood="wave" size="sm" decorative />
              <Text style={styles.empty}>
                No recent contacts yet. Search above or find friends from your phone contacts.
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      margin: spacing(3),
      paddingHorizontal: spacing(3),
      borderRadius: radius.pill,
    },
    searchInput: { flex: 1, color: colors.text, paddingVertical: spacing(2.5), marginLeft: 8, fontSize: font.body },
    actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
    actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    actionLabel: { color: colors.text, fontSize: font.heading, marginLeft: spacing(3), fontWeight: '500' },
    actionSub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: font.small,
      fontWeight: '600',
      letterSpacing: 0.5,
      paddingHorizontal: spacing(4),
      paddingTop: spacing(2),
      paddingBottom: spacing(1),
    },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(2.5) },
    rowBody: { flex: 1, marginLeft: spacing(3) },
    name: { color: colors.text, fontSize: font.heading, fontWeight: '500' },
    sub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    emptyWrap: { alignItems: 'center', marginTop: spacing(6), paddingHorizontal: spacing(6) },
    empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing(3), fontSize: font.body },
  });
