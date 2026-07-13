// Lumixo — WhatsApp-class sticker picker (packs / recents / favorites / search).
// Instant open: packs are in-module constants; recents/favs warm from cache.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  STICKER_PACKS,
  getFavoriteStickers,
  getFavoriteStickerIds,
  getRecentStickers,
  preloadStickerCache,
  pushRecentSticker,
  searchStickers,
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
   * `tray` — inline under composer (emoji ↔ stickers swap).
   */
  presentation?: 'modal' | 'tray';
  trayHeight?: number;
  title?: string;
}

type TabId = 'recent' | 'fav' | string;

export default function StickerPicker({
  visible,
  onClose,
  onSelect,
  presentation = 'modal',
  trayHeight,
  title = 'Stickers',
}: StickerPickerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width, height: winH } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
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
    if (!visible) setQuery('');
  }, [visible]);

  const q = query.trim();
  const searching = q.length > 0;
  const searchHits = useMemo(() => (searching ? searchStickers(q, 80) : []), [q, searching]);

  const grid: Sticker[] = useMemo(() => {
    if (searching) return searchHits;
    if (activeTab === 'recent') return recent;
    if (activeTab === 'fav') return favs;
    const pack = STICKER_PACKS.find((p) => p.id === activeTab);
    return (pack?.stickers ?? []).map((s) => ({
      ...s,
      packId: pack!.id,
      packName: pack!.name,
      url: `lumixo-sticker://${s.id}`,
    }));
  }, [searching, searchHits, activeTab, recent, favs]);

  const cellSize = Math.floor((width - 40) / 4) - 6;

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

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Sticker>) => (
      <View style={[styles.cell, { width: cellSize + 6 }]}>
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
    [cellSize, favIds, handleFav, handlePick, styles],
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

  const sectionTitle = searching
    ? 'Results'
    : activeTab === 'recent'
      ? 'Recently used'
      : activeTab === 'fav'
        ? 'Favorites'
        : STICKER_PACKS.find((p) => p.id === activeTab)?.name ?? 'Stickers';

  const body = (
    <View
      style={[
        presentation === 'tray' ? styles.tray : styles.sheet,
        presentation === 'tray' && {
          height: trayHeight ?? Math.min(320, Math.round(winH * 0.42)),
        },
        presentation === 'modal' && { paddingBottom: Math.max(insets.bottom, 8), maxHeight: '78%' },
      ]}
    >
      {presentation === 'modal' && <View style={styles.handle} />}
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        {presentation === 'modal' ? (
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
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
          placeholder="Search stickers"
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

      <Text style={styles.sectionLabel}>{sectionTitle}</Text>
      <Text style={styles.hint}>Long-press to favorite</Text>

      {grid.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>
            {searching
              ? 'No stickers found'
              : activeTab === 'recent'
                ? 'Stickers you send show up here'
                : activeTab === 'fav'
                  ? 'Long-press a sticker to favorite it'
                  : 'Pack loading…'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={grid}
          keyExtractor={(s) => s.id}
          renderItem={renderItem}
          numColumns={4}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          initialNumToRender={16}
          maxToRenderPerBatch={16}
          windowSize={5}
          removeClippedSubviews
        />
      )}

      {!searching && (
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
      )}
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

// Silence unused type import warning in some TS configs
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
      minHeight: '52%',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
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
      paddingBottom: 4,
      paddingTop: 4,
    },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 15.5,
      fontWeight: '700',
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
      textTransform: 'uppercase',
    },
    hint: {
      color: colors.textFaint,
      fontSize: 11,
      paddingHorizontal: 14,
      paddingBottom: 4,
    },
    list: { flex: 1 },
    listContent: {
      paddingHorizontal: 10,
      paddingBottom: 8,
      alignItems: 'flex-start',
    },
    cell: {
      margin: 3,
      alignItems: 'center',
      justifyContent: 'center',
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
      minHeight: 120,
      paddingHorizontal: 24,
    },
    empty: {
      color: colors.textFaint,
      fontSize: 13,
      textAlign: 'center',
    },
    packStrip: {
      maxHeight: 52,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    packStripContent: {
      paddingHorizontal: 6,
      paddingVertical: 6,
      alignItems: 'center',
    },
    packTab: {
      width: 40,
      height: 40,
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
