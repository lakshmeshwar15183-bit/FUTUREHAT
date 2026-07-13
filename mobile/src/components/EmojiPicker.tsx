// Lumixo — WhatsApp-class emoji picker.
//
// Instant open: recents/category preloaded via emojiCache (no AsyncStorage wait).
// One category at a time (FlatList) — never mounts the full catalog ScrollView.
// Modes:
//   • modal (reaction) — bottom sheet Modal
//   • tray (composer)  — inline panel under the composer (replaces keyboard)
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sheetBottomPad } from '../lib/safeLayout';

import {
  EMOJI_CATEGORIES,
  searchEmojis,
  type EmojiCategory,
} from '../lib/emojiData';
import {
  getLastEmojiCategoryId,
  getRecentEmojis,
  preloadEmojiCache,
  pushRecentEmoji,
  setLastEmojiCategoryId,
  subscribeEmojiCache,
} from '../lib/emojiCache';
import { useColors, type Palette } from '../theme';

export interface EmojiPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  /**
   * `composer` — stay open after pick (insert into draft).
   * `reaction` — close after pick.
   */
  mode?: 'composer' | 'reaction';
  /**
   * `modal` — full-screen dim + bottom sheet (reactions).
   * `tray` — fixed-height panel (composer, WhatsApp keyboard replacement).
   */
  presentation?: 'modal' | 'tray';
  title?: string;
  /** Fixed tray height (defaults to ~46% of window, WhatsApp-ish). */
  trayHeight?: number;
}

const COLS = 8;

export default function EmojiPicker({
  visible,
  onClose,
  onSelect,
  mode = 'composer',
  presentation = 'modal',
  title,
  trayHeight,
}: EmojiPickerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width, height: winH } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, width), [colors, width]);

  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(() => getRecentEmojis());
  const [activeCatId, setActiveCatId] = useState(() => getLastEmojiCategoryId());
  const [ready, setReady] = useState(() => getRecentEmojis().length >= 0);

  // Warm cache on mount; stay subscribed so recents appear without re-open.
  useEffect(() => {
    void preloadEmojiCache();
    const unsub = subscribeEmojiCache(() => {
      setRecent(getRecentEmojis());
      setActiveCatId(getLastEmojiCategoryId());
      setReady(true);
    });
    setRecent(getRecentEmojis());
    setActiveCatId(getLastEmojiCategoryId());
    return unsub;
  }, []);

  // Clear search when hidden; keep category (WhatsApp remembers last tab).
  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const handlePick = useCallback(
    (emoji: string) => {
      pushRecentEmoji(emoji);
      onSelect(emoji);
      if (mode === 'reaction') onClose();
    },
    [mode, onClose, onSelect],
  );

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const searchHits = useMemo(() => {
    if (!searching) return [] as string[];
    return searchEmojis(q, 120);
  }, [q, searching]);

  const tabs = useMemo(() => {
    const list: { id: string; icon: string }[] = [];
    list.push({ id: 'recent', icon: '🕒' });
    for (const c of EMOJI_CATEGORIES) {
      list.push({ id: c.id, icon: c.icon });
    }
    return list;
  }, []);

  const activeEmojis = useMemo(() => {
    if (searching) return searchHits;
    if (activeCatId === 'recent') {
      return recent.length ? recent : EMOJI_CATEGORIES[0]?.emojis.slice(0, 32) ?? [];
    }
    const cat = EMOJI_CATEGORIES.find((c) => c.id === activeCatId);
    return cat?.emojis ?? EMOJI_CATEGORIES[0]?.emojis ?? [];
  }, [searching, searchHits, activeCatId, recent]);

  const sectionLabel = useMemo(() => {
    if (searching) return 'Results';
    if (activeCatId === 'recent') return recent.length ? 'Recently used' : 'Smileys & People';
    return EMOJI_CATEGORIES.find((c) => c.id === activeCatId)?.label ?? 'Emoji';
  }, [searching, activeCatId, recent.length]);

  const selectCategory = useCallback((id: string) => {
    setActiveCatId(id);
    if (id !== 'recent') setLastEmojiCategoryId(id);
  }, []);

  const cell = Math.floor((width - 24) / COLS);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<string>) => (
      <Pressable
        style={({ pressed }) => [
          styles.cell,
          { width: cell, height: cell },
          pressed && styles.cellPressed,
        ]}
        onPress={() => handlePick(item)}
        accessibilityRole="button"
        accessibilityLabel={`Emoji ${item}`}
      >
        <Text style={styles.emoji} allowFontScaling={false}>
          {item}
        </Text>
      </Pressable>
    ),
    [cell, handlePick, styles],
  );

  const keyExtractor = useCallback((item: string, index: number) => `${item}-${index}`, []);

  const body = (
    <View
      style={[
        presentation === 'tray' ? styles.tray : styles.sheet,
        presentation === 'tray' && {
          height: trayHeight ?? Math.min(320, Math.round(winH * 0.42)),
        },
        presentation === 'modal' && { paddingBottom: sheetBottomPad(insets, 0) },
      ]}
    >
      {presentation === 'modal' && <View style={styles.handle} />}
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title ?? (mode === 'reaction' ? 'React' : 'Emoji')}</Text>
        {presentation === 'modal' ? (
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        ) : (
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Show keyboard">
            <Ionicons name="keypad-outline" size={22} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search emoji"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      <Text style={styles.sectionLabel}>{sectionLabel}</Text>

      {/* Always show grid shell — never a blank panel while hydrating */}
      {activeEmojis.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>{searching ? 'No emoji found' : ready ? 'No recent emoji yet' : '…'}</Text>
        </View>
      ) : (
        <FlatList
          data={activeEmojis}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          numColumns={COLS}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          initialNumToRender={40}
          maxToRenderPerBatch={48}
          windowSize={5}
          removeClippedSubviews
          getItemLayout={(_, index) => ({
            length: cell,
            offset: cell * Math.floor(index / COLS),
            index,
          })}
        />
      )}

      {!searching && (
        <View style={styles.tabs}>
          {tabs.map((t) => {
            const on = t.id === activeCatId;
            return (
              <Pressable
                key={t.id}
                style={[styles.tab, on && styles.tabOn]}
                onPress={() => selectCategory(t.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={styles.tabIcon} allowFontScaling={false}>
                  {t.icon}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );

  // Tray: parent controls mount/visibility; no Modal (seamless keyboard swap).
  if (presentation === 'tray') {
    if (!visible) return null;
    return body;
  }

  // Modal always mounted while parent is alive — only `visible` toggles.
  // Never unmount via early return when hidden (that caused blank/slow reopens).
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      presentationStyle="overFullScreen"
    >
      <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        {body}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette, _width: number) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.isLight ? 'rgba(12,18,22,0.4)' : 'rgba(0,0,0,0.5)',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      maxHeight: '72%',
      minHeight: '48%',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
      shadowColor: '#000',
      shadowOpacity: colors.isLight ? 0.14 : 0.4,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: -4 },
      elevation: 16,
    },
    tray: {
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      width: '100%',
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.textFaint,
      opacity: 0.4,
      marginTop: 8,
      marginBottom: 4,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingBottom: 6,
      paddingTop: 4,
    },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 15.5,
      fontWeight: '700',
      letterSpacing: -0.15,
    },
    closeBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 12,
      marginBottom: 4,
      paddingHorizontal: 10,
      height: 36,
      borderRadius: 10,
      backgroundColor: colors.surfaceAlt,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: 14.5,
      paddingVertical: 0,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.2,
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: 2,
      textTransform: 'uppercase',
    },
    list: { flex: 1 },
    listContent: {
      paddingHorizontal: 6,
      paddingBottom: 8,
    },
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 120,
    },
    empty: {
      color: colors.textFaint,
      fontSize: 13,
      textAlign: 'center',
    },
    cell: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
    },
    cellPressed: {
      backgroundColor: colors.surfaceAlt,
      transform: [{ scale: 1.12 }],
    },
    emoji: {
      fontSize: 26,
      lineHeight: 32,
      textAlign: 'center',
    },
    tabs: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 4,
      paddingHorizontal: 2,
      backgroundColor: colors.surface,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      borderRadius: 8,
    },
    tabOn: {
      backgroundColor: colors.surfaceAlt,
    },
    tabIcon: {
      fontSize: 18,
      lineHeight: 22,
    },
  });

// Keep type export used by older imports (if any).
export type { EmojiCategory };
