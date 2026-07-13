// Lumixo — WhatsApp-class sticker picker (packs / recents / favorites).
// Instant open: packs are in-module constants; recents/favs warm from cache.
// Dense grid + pack strip at bottom. No unfinished search chrome.
// Tap sends; long-press favorites (preview/heart).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
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

import {
  STICKER_PACKS,
  getFavoriteStickers,
  getFavoriteStickerIds,
  getRecentStickers,
  preloadStickerCache,
  pushRecentSticker,
  subscribeStickerCache,
  toggleFavoriteSticker,
  type Sticker,
  type StickerPack,
} from '../lib/stickers';
import StickerView from './StickerView';
import { useColors, type Palette } from '../theme';

export interface StickerPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (sticker: Sticker) => void;
  /**
   * `modal` — bottom sheet from attach menu.
   * `tray` — fills parent under composer (emoji ↔ stickers swap).
   */
  presentation?: 'modal' | 'tray';
  trayHeight?: number;
  title?: string;
  /** Hide title row — parent tray owns Emoji/Stickers tabs. */
  compact?: boolean;
}

type TabId = 'recent' | 'fav' | string;

const scrollOffsets = new Map<string, number>();

export default function StickerPicker({
  visible,
  onClose,
  onSelect,
  presentation = 'modal',
  trayHeight,
  title = 'Stickers',
  compact = false,
}: StickerPickerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width, height: winH } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const listRef = useRef<FlatList<Sticker>>(null);

  const [activeTab, setActiveTab] = useState<TabId>(() => STICKER_PACKS[0]?.id ?? 'cats');
  const [recent, setRecent] = useState<Sticker[]>(() => getRecentStickers());
  const [favs, setFavs] = useState<Sticker[]>(() => getFavoriteStickers());
  const [favIds, setFavIds] = useState<string[]>(() => getFavoriteStickerIds());

  useEffect(() => {
    void preloadStickerCache();
    const unsub = subscribeStickerCache(() => {
      setRecent(getRecentStickers());
      setFavs(getFavoriteStickers());
      setFavIds(getFavoriteStickerIds());
    });
    setRecent(getRecentStickers());
    setFavs(getFavoriteStickers());
    setFavIds(getFavoriteStickerIds());
    return unsub;
  }, []);

  useEffect(() => {
    if (!visible) return;
    const y = scrollOffsets.get(String(activeTab)) ?? 0;
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToOffset({ offset: y, animated: false });
      } catch {
        /* ignore */
      }
    });
  }, [visible, activeTab]);

  const grid: Sticker[] = useMemo(() => {
    if (activeTab === 'recent') return recent;
    if (activeTab === 'fav') return favs;
    const pack = STICKER_PACKS.find((p) => p.id === activeTab);
    return (pack?.stickers ?? []).map((s) => ({
      ...s,
      packId: pack!.id,
      packName: pack!.name,
      url: `lumixo-sticker://${s.id}`,
    }));
  }, [activeTab, recent, favs]);

  // Dense 4-column pack like WhatsApp stickers
  const cols = 4;
  const gap = 6;
  const side = 12;
  const cellSize = Math.floor((width - side * 2 - gap * (cols - 1)) / cols);

  const handlePick = useCallback(
    (s: Sticker) => {
      pushRecentSticker(s.id);
      onSelect(s);
    },
    [onSelect],
  );

  const handleFav = useCallback((s: Sticker) => {
    toggleFavoriteSticker(s.id);
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollOffsets.set(String(activeTab), e.nativeEvent.contentOffset.y);
    },
    [activeTab],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Sticker>) => (
      <View style={[styles.cell, { width: cellSize, marginBottom: gap, marginRight: gap }]}>
        <StickerView
          emoji={item.emoji}
          bg={item.bg}
          animated={item.animated}
          size={cellSize}
          onPress={() => handlePick(item)}
          onLongPress={() => handleFav(item)}
        />
        {favIds.includes(item.id) && (
          <View style={styles.favBadge} pointerEvents="none">
            <Ionicons name="heart" size={10} color="#ff5c7a" />
          </View>
        )}
      </View>
    ),
    [cellSize, favIds, handleFav, handlePick, styles, gap],
  );

  const packTabs: { id: TabId; icon: string; label: string }[] = useMemo(() => {
    const tabs: { id: TabId; icon: string; label: string }[] = [
      { id: 'recent', icon: '🕒', label: 'Recent' },
      { id: 'fav', icon: '❤️', label: 'Favorites' },
    ];
    for (const p of STICKER_PACKS) {
      tabs.push({ id: p.id, icon: p.icon, label: p.name });
    }
    return tabs;
  }, []);

  const showChrome = presentation === 'modal' || !compact;

  const emptyCopy =
    activeTab === 'recent'
      ? 'Stickers you send show up here'
      : activeTab === 'fav'
        ? 'Long-press a sticker to favorite it'
        : 'Pack loading…';

  const body = (
    <View
      style={[
        presentation === 'tray' ? styles.tray : styles.sheet,
        presentation === 'tray' && trayHeight != null ? { height: trayHeight } : null,
        presentation === 'tray' && trayHeight == null ? { flex: 1 } : null,
        presentation === 'modal' && {
          paddingBottom: sheetBottomPad(insets, 0),
          maxHeight: Math.round(winH * 0.72),
          minHeight: Math.round(winH * 0.5),
        },
      ]}
    >
      {presentation === 'modal' && <View style={styles.handle} />}
      {showChrome && (
        <View style={styles.headerRow}>
          {presentation === 'modal' ? (
            <>
              <Text style={styles.title}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </>
          ) : (
            <>
              <View style={{ flex: 1 }} />
              <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Show keyboard">
                <Ionicons name="keypad-outline" size={22} color={colors.textMuted} />
              </Pressable>
            </>
          )}
        </View>
      )}

      {grid.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>{emptyCopy}</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={grid}
          keyExtractor={(s) => s.id}
          renderItem={renderItem}
          numColumns={cols}
          style={styles.list}
          contentContainerStyle={[styles.listContent, { paddingHorizontal: side }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          initialNumToRender={16}
          maxToRenderPerBatch={16}
          windowSize={5}
          removeClippedSubviews
          onScroll={onScroll}
          scrollEventThrottle={32}
        />
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.packStrip}
        contentContainerStyle={styles.packStripContent}
        keyboardShouldPersistTaps="handled"
      >
        {packTabs.map((t) => {
          const on = t.id === activeTab;
          return (
            <Pressable
              key={t.id}
              style={[styles.packTab, on && styles.packTabOn]}
              onPress={() => setActiveTab(t.id)}
              accessibilityLabel={t.label}
            >
              <Text style={styles.packIcon} allowFontScaling={false}>
                {t.icon}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
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

export type { StickerPack };

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
    },
    closeBtn: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    list: { flex: 1 },
    listContent: {
      paddingTop: 6,
      paddingBottom: 6,
    },
    cell: {
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    favBadge: {
      position: 'absolute',
      top: 4,
      right: 4,
      backgroundColor: colors.surface,
      borderRadius: 8,
      padding: 2,
    },
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 80,
      paddingHorizontal: 24,
    },
    empty: {
      color: colors.textFaint,
      fontSize: 13,
      textAlign: 'center',
    },
    packStrip: {
      maxHeight: 48,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    packStripContent: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      alignItems: 'center',
      gap: 4,
    },
    packTab: {
      width: 40,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      marginHorizontal: 2,
    },
    packTabOn: {
      backgroundColor: colors.surfaceAlt,
    },
    packIcon: {
      fontSize: 20,
      lineHeight: 24,
    },
  });
