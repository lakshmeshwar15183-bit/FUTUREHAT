// FUTUREHAT mobile — horizontal Status strip. Compact home-screen row: small
// "My status" avatar (with blue +) + horizontal row of recent updates. Opens
// the full-screen viewer or the composer. Loads instantly from cache, refreshes
// on focus, and stays live via realtime status changes. Height ~58dp — fits
// snugly below the filter chips so more chats are visible.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../../lib/supabase';
import {
  getActiveStatuses,
  getMyViewedStatusIds,
  getCurrentUser,
  getProfile,
  getStatusAudiencePref,
  subscribeStatusChanges,
} from '../../lib/shared';
import type { StatusAudience } from '../../lib/shared';
import { getCache, setCache } from '../../lib/localCache';
import { useColors, spacing, radius, font, type Palette } from '../../theme';
import Avatar from '../Avatar';
import { buildStatusGroups, pruneExpiredGroups, type StatusGroup } from './statusData';
import StatusViewer from './StatusViewer';
import StatusComposer, { type ComposerMode } from './StatusComposer';

const CACHE_KEY = 'status:tray';

export default function StatusStrip() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [uid, setUid] = useState<string | null>(null);
  const [mine, setMine] = useState<StatusGroup | null>(null);
  const [groups, setGroups] = useState<StatusGroup[]>([]);
  const [viewing, setViewing] = useState<StatusGroup | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposerMode | null>(null);
  const [audience, setAudience] = useState<StatusAudience>('everyone');
  const [members, setMembers] = useState<string[]>([]);

  const load = useCallback(async () => {
    // Instant: paint the cached tray, then reconcile from the network.
    getCache<{ mine: StatusGroup | null; groups: StatusGroup[] }>(CACHE_KEY, { mine: null, groups: [] })
      .then((cached) => {
        if (cached.groups.length || cached.mine) {
          setMine(cached.mine);
          setGroups(cached.groups);
        }
      });

    const user = await getCurrentUser(supabase);
    const myId = user?.id ?? '';
    setUid(user?.id ?? null);
    getStatusAudiencePref(supabase)
      .then((pref) => { setAudience(pref.audience); setMembers(pref.memberIds); })
      .catch(() => {});

    let all; let viewed: Set<string>;
    try {
      [all, viewed] = await Promise.all([getActiveStatuses(supabase), getMyViewedStatusIds(supabase)]);
    } catch {
      return; // offline — keep cached tray
    }

    const { mine: mineGroup, groups: built } = await buildStatusGroups(
      all,
      myId,
      viewed,
      (id) => getProfile(supabase, id),
    );
    setMine(mineGroup);
    setGroups(built);
    setCache(CACHE_KEY, { mine: mineGroup, groups: built });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Realtime: a new/removed status anywhere refreshes the tray.
  const chRef = useRef<ReturnType<typeof subscribeStatusChanges> | null>(null);
  useFocusEffect(
    useCallback(() => {
      chRef.current = subscribeStatusChanges(supabase, () => { load(); });
      return () => {
        if (chRef.current) { chRef.current.unsubscribe(); chRef.current = null; }
      };
    }, [load]),
  );

  // Client-side 36h expiry (CP5): prune expired statuses the instant they hit
  // `expires_at` and schedule the next tick — no polling, no refetch. A state
  // change re-runs this effect and reschedules for the next-soonest expiry.
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    const now = Date.now();
    const res = pruneExpiredGroups(mine, groups, now);
    if (res.changed) {
      setMine(res.mine);
      setGroups(res.groups);
      setCache(CACHE_KEY, { mine: res.mine, groups: res.groups });
      return; // the state change re-runs this effect and reschedules
    }
    if (res.nextExpiry == null) return;
    const delay = Math.max(0, res.nextExpiry - now) + 500;
    expiryTimer.current = setTimeout(() => {
      const t = Date.now();
      setGroups((gs) => pruneExpiredGroups(null, gs, t).groups);
      setMine((m) => pruneExpiredGroups(m, [], t).mine);
    }, delay);
    return () => { if (expiryTimer.current) clearTimeout(expiryTimer.current); };
  }, [mine, groups]);

  function openMine() {
    if (mine) setViewing(mine);
    else setMenuOpen(true);
  }

  function choose(mode: ComposerMode) {
    setMenuOpen(false);
    setComposeMode(mode);
  }

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {/* My status tile — WhatsApp behavior: avatar opens the viewer (or the
            picker if no status yet); the "+" badge is its own Pressable that
            ALWAYS opens the picker so users can post additional statuses. */}
        <View style={styles.tile}>
          <View>
            <Pressable
              onPress={openMine}
              onLongPress={() => setMenuOpen(true)}
              style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
            >
              <View style={[styles.ring, { borderColor: mine ? colors.primary : 'transparent' }]}>
                <Avatar uri={mine?.profile?.avatar_url} name="Me" size={42} />
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.addBadge, pressed && { opacity: 0.7 }]}
              onPress={() => setMenuOpen(true)}
              hitSlop={8}
              accessibilityLabel="Add status"
              accessibilityRole="button"
            >
              <Ionicons name="add" size={12} color="#fff" />
            </Pressable>
          </View>
        </View>

        {/* Recent updates — avatar-only tiles keep the row height compact */}
        {groups.map((g) => (
          <Pressable key={g.userId} style={styles.tile} onPress={() => setViewing(g)}>
            <View style={[styles.ring, { borderColor: g.allSeen ? colors.border : colors.primary }]}>
              <Avatar uri={g.profile?.avatar_url} name={g.profile?.display_name} size={42} />
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {/* Add-status menu */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Add to status</Text>
            <MenuItem icon="text" label="Text" onPress={() => choose('text')} colors={colors} />
            <MenuItem icon="camera" label="Photo or video" onPress={() => choose('media')} colors={colors} />
            <MenuItem icon="mic" label="Audio" onPress={() => choose('audio')} colors={colors} />
          </View>
        </Pressable>
      </Modal>

      {/* Composer */}
      {composeMode && uid && (
        <StatusComposer
          visible={!!composeMode}
          mode={composeMode}
          uid={uid}
          initialAudience={audience}
          initialMembers={members}
          onClose={() => setComposeMode(null)}
          onPosted={load}
        />
      )}

      {/* Viewer */}
      <Modal visible={!!viewing} animationType="fade" onRequestClose={() => setViewing(null)}>
        {viewing && (
          <StatusViewer
            group={viewing}
            isMine={viewing.userId === uid}
            onClose={() => setViewing(null)}
            onChanged={load}
          />
        )}
      </Modal>
    </View>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  colors: Palette;
}) {
  return (
    <Pressable
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(3.5) }, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={20} color="#fff" />
      </View>
      <Text style={{ color: colors.text, fontSize: font.body, marginLeft: spacing(4) }}>{label}</Text>
    </Pressable>
  );
}

function firstName(name?: string | null): string | null {
  if (!name) return null;
  return name.split(' ')[0];
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: {
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    // Compact row: total height ≈ 58dp — small avatar + minimal padding.
    row: { paddingHorizontal: spacing(3), paddingVertical: spacing(1.5), gap: spacing(2) },
    tile: { alignItems: 'center' },
    ring: { borderWidth: 2, borderRadius: 26, padding: 1.5 },
    addBadge: {
      position: 'absolute', bottom: -1, right: -1,
      backgroundColor: colors.primary, width: 16, height: 16, borderRadius: 8,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderColor: colors.surface,
    },
    tileLabel: { color: colors.textMuted, fontSize: font.tiny, marginTop: spacing(1), maxWidth: 66 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
      paddingHorizontal: 20, paddingTop: 16, paddingBottom: spacing(8),
    },
    sheetTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: 8 },
  });
