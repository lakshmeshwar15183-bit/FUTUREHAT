// Lumixo — interactive profile avatar with WhatsApp-style status ring + press.
//
// Modes:
//  • auto (default): active status → open status viewer; else profile photo
//  • photo: always open profile photo (long-press also photo)
//  • choice: if status exists, show clear dual actions (View Status / View Photo)
//
// Long-press always prefers profile photo when a uri exists (escape hatch after
// viewing status, or when the ring is distracting).
import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Avatar from './Avatar';
import StatusRing, { type StatusRingState } from './status/StatusRing';
import { useStatusPresence } from './status/StatusPresenceContext';
import { useColors, spacing, font, type Palette } from '../theme';

export type ProfileAvatarMode = 'auto' | 'photo' | 'choice';

export interface ProfileAvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
  /** Peer user id — enables status ring + status open. Omit for groups/objects. */
  userId?: string | null;
  mode?: ProfileAvatarMode;
  /** Disable press handling (still renders ring if applicable). */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Extra action after opening status/photo (analytics, etc.). */
  onOpened?: (kind: 'status' | 'photo' | 'choice') => void;
}

export default function ProfileAvatar({
  uri,
  name,
  size = 48,
  userId,
  mode = 'auto',
  disabled = false,
  style,
  accessibilityLabel,
  onOpened,
}: ProfileAvatarProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const presence = useStatusPresence();
  const [choiceOpen, setChoiceOpen] = useState(false);

  const active = !!(userId && presence.hasActive(userId));
  const unseen = !!(userId && presence.isUnseen(userId));
  const segments = userId ? presence.segmentCount(userId) : 0;

  const ringState: StatusRingState = !active
    ? 'none'
    : unseen
      ? 'unseen'
      : 'seen';

  const a11y = useMemo(() => {
    if (accessibilityLabel) return accessibilityLabel;
    const who = name?.trim() || 'Contact';
    if (active) {
      return unseen
        ? `${who}, has unviewed status. Double tap to view status.`
        : `${who}, has status. Double tap to view status.`;
    }
    return uri
      ? `${who}, profile photo. Double tap to view.`
      : `${who}, no profile photo.`;
  }, [accessibilityLabel, name, active, unseen, uri]);

  const openPhoto = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    presence.openPhoto({ uri: uri ?? null, name });
    onOpened?.('photo');
  }, [presence, uri, name, onOpened]);

  const openStatus = useCallback(() => {
    if (!userId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    presence.openStatus(userId);
    onOpened?.('status');
  }, [presence, userId, onOpened]);

  const onPress = useCallback(() => {
    if (disabled) return;
    if (mode === 'photo') {
      openPhoto();
      return;
    }
    if (mode === 'choice' && active) {
      void Haptics.selectionAsync().catch(() => {});
      setChoiceOpen(true);
      onOpened?.('choice');
      return;
    }
    // auto
    if (active && userId) {
      openStatus();
      return;
    }
    openPhoto();
  }, [disabled, mode, active, userId, openPhoto, openStatus, onOpened]);

  const onLongPress = useCallback(() => {
    if (disabled) return;
    // Escape hatch: always allow photo (or empty-state viewer).
    openPhoto();
  }, [disabled, openPhoto]);

  // Touch target min ~44pt
  const hit = Math.max(44, size + (ringState === 'none' ? 0 : 12));

  return (
    <>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={280}
        disabled={disabled}
        hitSlop={6}
        accessibilityRole="imagebutton"
        accessibilityLabel={a11y}
        style={({ pressed }) => [
          {
            width: hit,
            height: hit,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed && !disabled ? 0.85 : 1,
          },
          style,
        ]}
      >
        <StatusRing size={size} state={ringState} segments={segments || 1}>
          <Avatar uri={uri} name={name} size={size} />
        </StatusRing>
      </Pressable>

      {/* Profile-screen dual actions — large clear cards, not a dense menu */}
      <Modal
        visible={choiceOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setChoiceOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.sheetScrim} onPress={() => setChoiceOpen(false)}>
          <View
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
            // prevent scrim close when tapping card area
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {name?.trim() || 'Contact'}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              onPress={() => {
                setChoiceOpen(false);
                openStatus();
              }}
              accessibilityRole="button"
              accessibilityLabel="View status"
            >
              <View style={[styles.actionIcon, { backgroundColor: colors.primary + '22' }]}>
                <Ionicons name="radio-button-on" size={22} color={colors.primary} />
              </View>
              <View style={styles.actionTextCol}>
                <Text style={styles.actionTitle}>View status</Text>
                <Text style={styles.actionSub}>
                  {segments > 1 ? `${segments} updates` : 'Latest update'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              onPress={() => {
                setChoiceOpen(false);
                openPhoto();
              }}
              accessibilityRole="button"
              accessibilityLabel="View profile photo"
            >
              <View style={[styles.actionIcon, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="person-circle-outline" size={24} color={colors.text} />
              </View>
              <View style={styles.actionTextCol}>
                <Text style={styles.actionTitle}>View profile photo</Text>
                <Text style={styles.actionSub}>
                  {uri ? 'Full screen' : 'No photo set'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
            <Pressable
              style={styles.cancel}
              onPress={() => setChoiceOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetScrim: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingHorizontal: spacing(4),
      paddingTop: spacing(2),
      gap: spacing(1.5),
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: spacing(1),
    },
    sheetTitle: {
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '700',
      marginBottom: spacing(1),
      textAlign: 'center',
    },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 14,
      gap: 12,
      minHeight: 64,
    },
    actionPressed: { opacity: 0.88 },
    actionIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionTextCol: { flex: 1 },
    actionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    actionSub: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
    cancel: {
      alignItems: 'center',
      paddingVertical: 14,
      marginTop: 4,
    },
    cancelText: {
      color: colors.primary,
      fontSize: 16,
      fontWeight: '600',
    },
  });
