// Lumixo — WhatsApp-class emoji picker.
//
// Instant open: recents/category preloaded via emojiCache.
// One category at a time (FlatList). Dense grid + category strip at bottom.
// Modes:
//   • modal (reaction) — bottom sheet Modal
//   • tray (composer)  — fills parent under composer (keyboard replacement)
//
// No search bar in the UI — search APIs remain for tests / future use; unfinished
// search chrome is not shown (WhatsApp polish: only ship working chrome).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sheetBottomPad } from '../lib/safeLayout';

import { EMOJI_CATEGORIES, type EmojiCategory } from '../lib/emojiData';
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
   * `tray` — fills parent height (composer, WhatsApp keyboard replacement).
   */
  presentation?: 'modal' | 'tray';
  title?: string;
  /** Fixed tray height when presentation is tray (parent usually owns height). */
  trayHeight?: number;
  /** Hide the top chrome (title / keyboard) — parent tray already has tabs. */
  compact?: boolean;
}

const COLS = 8;
/** Persist last scroll offset per category (session). */
const scrollOffsets = new Map<string, number>();

export default function EmojiPicker({
  visible,
  onClose,
  onSelect,
  mode = 'composer',
  presentation = 'modal',
  title,
  trayHeight,
  compact = false,
}: EmojiPickerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width, height: winH } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const listRef = useRef<FlatList<string>>(null);

  const [recent, setRecent] = useState<string[]>(() => getRecentEmojis());
  const [activeCatId, setActiveCatId] = useState(() => getLastEmojiCategoryId());

  useEffect(() => {
    void preloadEmojiCache();
    const unsub = subscribeEmojiCache(() => {
      setRecent(getRecentEmojis());
      setActiveCatId(getLastEmojiCategoryId());
    });
    setRecent(getRecentEmojis());
    setActiveCatId(getLastEmojiCategoryId());
    return unsub;
  }, []);

  // Restore scroll for the active category when shown / tab changes.
  useEffect(() => {
    if (!visible) return;
    const y = scrollOffsets.get(activeCatId) ?? 0;
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToOffset({ offset: y, animated: false });
      } catch {
        /* ignore */
      }
    });
  }, [visible, activeCatId]);

  const handlePick = useCallback(
    (emoji: string) => {
      pushRecentEmoji(emoji);
      onSelect(emoji);
      if (mode === 'reaction') onClose();
    },
    [mode, onClose, onSelect],
  );

  const tabs = useMemo(() => {
    const list: { id: string; icon: string }[] = [{ id: 'recent', icon: '🕒' }];
    for (const c of EMOJI_CATEGORIES) {
      list.push({ id: c.id, icon: c.icon });
    }
    return list;
  }, []);

  const activeEmojis = useMemo(() => {
    if (activeCatId === 'recent') {
      return recent.length ? recent : EMOJI_CATEGORIES[0]?.emojis.slice(0, 40) ?? [];
    }
    const cat = EMOJI_CATEGORIES.find((c) => c.id === activeCatId);
    return cat?.emojis ?? EMOJI_CATEGORIES[0]?.emojis ?? [];
  }, [activeCatId, recent]);

  const selectCategory = useCallback((id: string) => {
    setActiveCatId(id);
    if (id !== 'recent') setLastEmojiCategoryId(id);
  }, []);

  const padH = 4;
  const cell = Math.floor((width - padH * 2) / COLS);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollOffsets.set(activeCatId, e.nativeEvent.contentOffset.y);
    },
    [activeCatId],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<string>) => (
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

  const showChrome = presentation === 'modal' || !compact;

  const body = (
    <View
      style={[
        presentation === 'tray' ? styles.tray : styles.sheet,
        presentation === 'tray' && trayHeight != null ? { height: trayHeight } : null,
        presentation === 'tray' && trayHeight == null ? { flex: 1 } : null,
        presentation === 'modal' && {
          paddingBottom: sheetBottomPad(insets, 0),
          maxHeight: Math.round(winH * 0.72),
          minHeight: Math.round(winH * 0.48),
        },
      ]}
    >
      {presentation === 'modal' && <View style={styles.handle} />}
      {showChrome && (
        <View style={styles.headerRow}>
          {presentation === 'modal' ? (
            <>
              <Text style={styles.title}>{title ?? (mode === 'reaction' ? 'React' : 'Emoji')}</Text>
              <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </>
          ) : (
            <>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={onClose}
                hitSlop={10}
                style={styles.closeBtn}
                accessibilityLabel="Show keyboard"
              >
                <Ionicons name="keypad-outline" size={22} color={colors.textMuted} />
              </Pressable>
            </>
          )}
        </View>
      )}

      {activeEmojis.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>No emoji yet</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={activeEmojis}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          numColumns={COLS}
          style={styles.list}
          contentContainerStyle={[styles.listContent, { paddingHorizontal: padH }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          initialNumToRender={48}
          maxToRenderPerBatch={56}
          windowSize={6}
          removeClippedSubviews
          onScroll={onScroll}
          scrollEventThrottle={32}
          getItemLayout={(_, index) => ({
            length: cell,
            offset: cell * Math.floor(index / COLS),
            index,
          })}
        />
      )}

      <View style={[styles.tabs, presentation === 'modal' && { paddingBottom: 4 }]}>
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
    </View>
  );

  if (presentation === 'tray') {
    if (!visible) return null;
    return body;
  }

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

const makeStyles = (colors: Palette) =>
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
      width: '100%',
      flex: 1,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.textFaint,
      opacity: 0.4,
      marginTop: 8,
      marginBottom: 2,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingBottom: 2,
      paddingTop: 2,
      minHeight: 36,
    },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 15.5,
      fontWeight: '700',
      letterSpacing: -0.15,
    },
    closeBtn: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    list: { flex: 1 },
    listContent: {
      paddingBottom: 4,
    },
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 80,
    },
    empty: {
      color: colors.textFaint,
      fontSize: 13,
      textAlign: 'center',
    },
    cell: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
    },
    cellPressed: {
      backgroundColor: colors.surfaceAlt,
      transform: [{ scale: 1.1 }],
    },
    emoji: {
      fontSize: 26,
      lineHeight: 30,
      textAlign: 'center',
    },
    tabs: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 2,
      paddingHorizontal: 1,
      backgroundColor: colors.surface,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 7,
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

export type { EmojiCategory };
