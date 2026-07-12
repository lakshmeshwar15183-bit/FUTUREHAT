// Lumixo mobile — Status audience picker (WhatsApp "Status privacy").
// Choose who can see a status: Everyone / My contacts / Except… / Only share with…
// The Except/Only modes reveal a searchable multi-select of contacts (people you
// share a direct conversation with). The chosen list is snapshotted per-post
// server-side (see shared/api.ts createStatus) — this picker only collects intent.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../../lib/supabase';
import { getMyConversations, getCurrentUser } from '../../lib/shared';
import type { StatusAudience, Profile } from '../../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../../theme';
import Avatar from '../Avatar';

interface Props {
  visible: boolean;
  audience: StatusAudience;
  memberIds: string[];
  onClose: () => void;
  onSave: (audience: StatusAudience, memberIds: string[]) => void;
}

const OPTIONS: { key: StatusAudience; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'everyone', label: 'Everyone', sub: 'Anyone on Lumixo can see', icon: 'earth-outline' },
  { key: 'contacts', label: 'My contacts', sub: 'People you chat with', icon: 'people-outline' },
  { key: 'except', label: 'My contacts except…', sub: 'Hide from some contacts', icon: 'remove-circle-outline' },
  { key: 'only', label: 'Only share with…', sub: 'Show to selected contacts', icon: 'checkmark-circle-outline' },
];

export default function AudiencePicker({ visible, audience, memberIds, onClose, onSave }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [sel, setSel] = useState<StatusAudience>(audience);
  const [members, setMembers] = useState<Set<string>>(new Set(memberIds));
  const [contacts, setContacts] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  // Reset local state whenever the picker is (re)opened.
  useEffect(() => {
    if (visible) {
      setSel(audience);
      setMembers(new Set(memberIds));
      setQuery('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Lazily load contacts (direct-conversation peers) the first time a list-based
  // mode is shown. Deduped by peer id; blocked users are already excluded server-side.
  const needsList = sel === 'except' || sel === 'only';
  useEffect(() => {
    if (!visible || !needsList || contacts.length || loading) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const [me, convs] = await Promise.all([
          getCurrentUser(supabase),
          getMyConversations(supabase),
        ]);
        const myId = me?.id;
        const seen = new Map<string, Profile>();
        for (const c of convs) {
          if (c.conversation.type !== 'direct') continue;
          for (const p of c.participants) {
            if (p.id !== myId && !seen.has(p.id)) seen.set(p.id, p);
          }
        }
        const list = [...seen.values()].sort((a, b) =>
          (a.display_name ?? '').localeCompare(b.display_name ?? ''),
        );
        if (alive) setContacts(list);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, needsList]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => (c.display_name ?? '').toLowerCase().includes(q));
  }, [contacts, query]);

  function toggle(id: string) {
    setMembers((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function save() {
    // Only Except/Only carry a member list; the others clear it to avoid stale snapshots.
    onSave(sel, needsList ? [...members] : []);
    onClose();
  }

  const canSave = !needsList || members.size > 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) + 8 }]}>
          <Pressable hitSlop={10} onPress={onClose}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Status privacy</Text>
          <Pressable hitSlop={10} onPress={save} disabled={!canSave}>
            <Text style={[styles.done, !canSave && styles.doneOff]}>Done</Text>
          </Pressable>
        </View>

        <FlatList
          data={needsList ? filtered : []}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              {OPTIONS.map((o) => {
                const on = sel === o.key;
                return (
                  <Pressable key={o.key} style={styles.optRow} onPress={() => setSel(o.key)}>
                    <Ionicons name={o.icon} size={22} color={on ? colors.primary : colors.textMuted} />
                    <View style={styles.optBody}>
                      <Text style={[styles.optLabel, on && { color: colors.primary }]}>{o.label}</Text>
                      <Text style={styles.optSub}>{o.sub}</Text>
                    </View>
                    <Ionicons
                      name={on ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={on ? colors.primary : colors.textFaint}
                    />
                  </Pressable>
                );
              })}
              {needsList && (
                <>
                  <View style={styles.searchBar}>
                    <Ionicons name="search" size={16} color={colors.textMuted} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Search contacts"
                      placeholderTextColor={colors.textFaint}
                      value={query}
                      onChangeText={setQuery}
                    />
                  </View>
                  <Text style={styles.listLabel}>
                    {sel === 'except' ? 'HIDE STATUS FROM' : 'SHARE STATUS WITH'}
                    {members.size > 0 ? ` · ${members.size}` : ''}
                  </Text>
                  {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing(6) }} />}
                </>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const on = members.has(item.id);
            return (
              <Pressable style={styles.contactRow} onPress={() => toggle(item.id)}>
                <Avatar uri={item.avatar_url} name={item.display_name} size={44} />
                <Text style={styles.contactName} numberOfLines={1}>
                  {item.display_name ?? 'Lumixo user'}
                </Text>
                <View style={[styles.check, on && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                  {on && <Ionicons name="checkmark" size={15} color="#fff" />}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            needsList && !loading ? (
              <Text style={styles.empty}>
                {query ? 'No matching contacts.' : 'No contacts yet — start a chat first.'}
              </Text>
            ) : null
          }
        />
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: spacing(4),
      paddingHorizontal: spacing(4), paddingTop: spacing(4), paddingBottom: spacing(3),
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    headerTitle: { flex: 1, color: colors.text, fontSize: font.heading, fontWeight: '700' },
    done: { color: colors.primary, fontSize: font.body, fontWeight: '700' },
    doneOff: { color: colors.textFaint },
    optRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing(3),
      paddingHorizontal: spacing(4), paddingVertical: spacing(3),
    },
    optBody: { flex: 1 },
    optLabel: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    optSub: { color: colors.textMuted, fontSize: font.small, marginTop: 1 },
    searchBar: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginHorizontal: spacing(4), marginTop: spacing(3),
      paddingHorizontal: 12, paddingVertical: 8,
      backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: font.body, paddingVertical: 0 },
    listLabel: {
      color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', letterSpacing: 0.5,
      paddingHorizontal: spacing(4), paddingTop: spacing(4), paddingBottom: spacing(1),
    },
    contactRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing(3),
      paddingHorizontal: spacing(4), paddingVertical: spacing(2.5),
    },
    contactName: { flex: 1, color: colors.text, fontSize: font.body },
    check: {
      width: 24, height: 24, borderRadius: 12,
      borderWidth: 2, borderColor: colors.border,
      alignItems: 'center', justifyContent: 'center',
    },
    empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing(8), paddingHorizontal: spacing(6) },
  });
