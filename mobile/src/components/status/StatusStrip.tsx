// Lumixo mobile — horizontal Status strip. Compact home-screen row: small
// "My status" avatar (with blue +) + horizontal row of recent updates. Opens
// the full-screen viewer or the composer. Data comes from StatusPresenceContext
// (shared with chat-list rings) so rings never go stale relative to the strip.
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../../lib/supabase';
import { getStatusAudiencePref } from '../../lib/shared';
import type { StatusAudience } from '../../lib/shared';
import { useColors, spacing, type Palette } from '../../theme';
import Avatar from '../Avatar';
import StatusRing from './StatusRing';
import { useStatusPresence } from './StatusPresenceContext';
import StatusComposer, { type ComposerMode } from './StatusComposer';
import { showSheet } from '../../ui/dialog';

export default function StatusStrip() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { myId, mine, groups, refresh, openStatusGroup } = useStatusPresence();

  const [composeMode, setComposeMode] = useState<ComposerMode | null>(null);
  const [audience, setAudience] = useState<StatusAudience>('everyone');
  const [members, setMembers] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      getStatusAudiencePref(supabase)
        .then((pref) => {
          setAudience(pref.audience);
          setMembers(pref.memberIds);
        })
        .catch(() => {});
    }, [refresh]),
  );

  function openMine() {
    if (mine) openStatusGroup(mine);
    else openStatusMenu();
  }

  function openStatusMenu() {
    showSheet({
      title: 'Add to status',
      actions: [
        { text: 'Text', icon: 'info', onPress: () => setComposeMode('text') },
        { text: 'Photo or video', icon: 'photo', onPress: () => setComposeMode('media') },
        { text: 'Audio', icon: 'file', onPress: () => setComposeMode('audio') },
      ],
    });
  }

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.tile}>
          <Pressable
            onPress={openMine}
            onLongPress={openStatusMenu}
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
            accessibilityRole="button"
            accessibilityLabel={mine ? 'My status' : 'Add status'}
          >
            <StatusRing
              size={42}
              state={mine ? 'unseen' : 'none'}
              segments={mine?.statuses.length ?? 1}
            >
              <Avatar uri={mine?.profile?.avatar_url} name="Me" size={42} />
            </StatusRing>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.addBadge, pressed && { opacity: 0.7 }]}
            onPress={openStatusMenu}
            hitSlop={8}
            accessibilityLabel="Add status"
            accessibilityRole="button"
          >
            <Ionicons name="add" size={12} color="#fff" />
          </Pressable>
        </View>

        {groups.map((g) => (
          <Pressable
            key={g.userId}
            style={styles.tile}
            onPress={() => openStatusGroup(g)}
            accessibilityRole="button"
            accessibilityLabel={
              g.allSeen
                ? `${g.profile?.display_name ?? 'Contact'} status`
                : `${g.profile?.display_name ?? 'Contact'} unviewed status`
            }
          >
            <StatusRing
              size={42}
              state={g.allSeen ? 'seen' : 'unseen'}
              segments={g.statuses.length}
            >
              <Avatar
                uri={g.profile?.avatar_url}
                name={g.profile?.display_name}
                size={42}
              />
            </StatusRing>
          </Pressable>
        ))}
      </ScrollView>

      {composeMode && myId && (
        <StatusComposer
          visible={!!composeMode}
          mode={composeMode}
          uid={myId}
          initialAudience={audience}
          initialMembers={members}
          onClose={() => setComposeMode(null)}
          onPosted={() => {
            void refresh();
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: {
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    row: { paddingHorizontal: spacing(3), paddingVertical: spacing(1.5), gap: spacing(2) },
    tile: { alignItems: 'center' },
    addBadge: {
      position: 'absolute',
      bottom: -1,
      right: -1,
      backgroundColor: colors.primary,
      width: 16,
      height: 16,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: colors.surface,
      zIndex: 2,
    },
  });
