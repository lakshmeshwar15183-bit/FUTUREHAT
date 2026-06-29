// FUTUREHAT mobile — Status (stories) tab. Create text/image statuses and view
// others' active statuses in a full-screen viewer. Uses the shared Status API.
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { getActiveStatuses, createStatus, getCurrentUser, getProfile } from '../lib/shared';
import type { Status, Profile } from '../lib/shared';
import { uploadMediaFromUri } from '../lib/media';
import { formatLastSeen } from '../lib/time';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';

const BG_COLORS = ['#00A884', '#5B6EF5', '#E8638A', '#F7A948', '#9B6EF5', '#0B141A'];

interface Group {
  userId: string;
  profile: Profile | null;
  statuses: Status[];
}

export default function StatusScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [uid, setUid] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [mine, setMine] = useState<Status[]>([]);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [viewing, setViewing] = useState<Group | null>(null);
  const [viewIndex, setViewIndex] = useState(0);

  const load = useCallback(async () => {
    const user = await getCurrentUser(supabase);
    setUid(user?.id ?? null);
    const all = await getActiveStatuses(supabase);

    const byUser = new Map<string, Status[]>();
    for (const s of all) {
      const arr = byUser.get(s.user_id) ?? [];
      arr.push(s);
      byUser.set(s.user_id, arr);
    }
    setMine(byUser.get(user?.id ?? '') ?? []);
    byUser.delete(user?.id ?? '');

    const built: Group[] = [];
    for (const [userId, statuses] of byUser) {
      built.push({ userId, profile: await getProfile(supabase, userId), statuses });
    }
    setGroups(built);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function postText() {
    if (!text.trim()) return;
    await createStatus(supabase, 'text', text.trim(), undefined, bg);
    setText('');
    setComposing(false);
    load();
  }

  async function postImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (res.canceled || !res.assets?.length || !uid) return;
    const { url, error } = await uploadMediaFromUri(uid, res.assets[0].uri, `status_${Date.now()}.jpg`);
    if (error || !url) {
      Alert.alert('Upload failed', error?.message ?? 'Try again.');
      return;
    }
    await createStatus(supabase, 'image', undefined, url);
    load();
  }

  function openViewer(g: Group) {
    setViewing(g);
    setViewIndex(0);
  }

  const current = viewing?.statuses[viewIndex];

  return (
    <View style={styles.container}>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.userId}
        ListHeaderComponent={
          <Pressable style={styles.myRow} onPress={() => (mine.length ? openViewer({ userId: uid!, profile: null, statuses: mine }) : setComposing(true))}>
            <View>
              <Avatar uri={null} name="Me" size={56} />
              <View style={styles.addBadge}>
                <Ionicons name="add" size={16} color="#fff" />
              </View>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.name}>My status</Text>
              <Text style={styles.sub}>{mine.length ? `${mine.length} update(s)` : 'Tap to add status update'}</Text>
            </View>
          </Pressable>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => openViewer(item)}>
            <View style={[styles.ring, { borderColor: colors.primary }]}>
              <Avatar uri={item.profile?.avatar_url} name={item.profile?.display_name} size={52} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.name}>{item.profile?.display_name ?? 'FUTUREHAT user'}</Text>
              <Text style={styles.sub}>{formatLastSeen(item.statuses[0]?.created_at)}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No recent updates from your contacts.</Text>}
      />

      <View style={styles.fabCol}>
        <Pressable style={[styles.fabSmall]} onPress={() => setComposing(true)}>
          <Ionicons name="pencil" size={20} color={colors.text} />
        </Pressable>
        <Pressable style={styles.fab} onPress={postImage}>
          <Ionicons name="camera" size={26} color="#fff" />
        </Pressable>
      </View>

      {/* Text status composer */}
      <Modal visible={composing} animationType="slide" onRequestClose={() => setComposing(false)}>
        <View style={[styles.composer, { backgroundColor: bg }]}>
          <Pressable style={styles.composerClose} onPress={() => setComposing(false)}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <TextInput
            style={styles.composerInput}
            placeholder="Type a status"
            placeholderTextColor="rgba(255,255,255,0.7)"
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
          />
          <View style={styles.bgRow}>
            {BG_COLORS.map((c) => (
              <Pressable key={c} onPress={() => setBg(c)} style={[styles.bgDot, { backgroundColor: c }, bg === c && styles.bgDotOn]} />
            ))}
          </View>
          <Pressable style={styles.postBtn} onPress={postText}>
            <Ionicons name="send" size={24} color="#fff" />
          </Pressable>
        </View>
      </Modal>

      {/* Story viewer */}
      <Modal visible={!!viewing} animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable
          style={styles.viewer}
          onPress={() => {
            if (viewing && viewIndex < viewing.statuses.length - 1) setViewIndex((i) => i + 1);
            else setViewing(null);
          }}
        >
          <View style={styles.progressRow}>
            {viewing?.statuses.map((_, i) => (
              <View key={i} style={[styles.progressSeg, { backgroundColor: i <= viewIndex ? '#fff' : 'rgba(255,255,255,0.3)' }]} />
            ))}
          </View>
          {current?.type === 'image' && current.media_url ? (
            <Image source={{ uri: current.media_url }} style={styles.viewerImg} resizeMode="contain" />
          ) : (
            <View style={[styles.textStatus, { backgroundColor: current?.background ?? '#000' }]}>
              <Text style={styles.textStatusText}>{current?.content}</Text>
            </View>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    myRow: { flexDirection: 'row', alignItems: 'center', padding: spacing(4), backgroundColor: colors.surface },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(2.5) },
    ring: { borderWidth: 2, borderRadius: 30, padding: 2 },
    addBadge: {
      position: 'absolute',
      bottom: -2,
      right: -2,
      backgroundColor: colors.primary,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.surface,
    },
    rowBody: { marginLeft: spacing(3) },
    name: { color: colors.text, fontSize: font.heading, fontWeight: '500' },
    sub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing(8) },
    fabCol: { position: 'absolute', right: spacing(5), bottom: spacing(6), alignItems: 'center', gap: spacing(3) },
    fabSmall: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fab: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 6 },
    composer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(6) },
    composerClose: { position: 'absolute', top: spacing(12), left: spacing(5) },
    composerInput: { color: '#fff', fontSize: 26, fontWeight: '600', textAlign: 'center', width: '100%' },
    bgRow: { flexDirection: 'row', gap: spacing(3), position: 'absolute', bottom: spacing(20) },
    bgDot: { width: 32, height: 32, borderRadius: 16 },
    bgDotOn: { borderWidth: 3, borderColor: '#fff' },
    postBtn: {
      position: 'absolute',
      bottom: spacing(8),
      right: spacing(6),
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
    progressRow: { position: 'absolute', top: spacing(10), left: spacing(3), right: spacing(3), flexDirection: 'row', gap: 3 },
    progressSeg: { flex: 1, height: 3, borderRadius: 2 },
    viewerImg: { width: '100%', height: '100%' },
    textStatus: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(8) },
    textStatusText: { color: '#fff', fontSize: 28, fontWeight: '700', textAlign: 'center' },
  });
