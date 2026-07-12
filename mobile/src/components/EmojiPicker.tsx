// Lumixo — WhatsApp-class emoji picker.
//
// • Category tabs (bottom) like WhatsApp
// • Recent section (persisted)
// • Search filter
// • Dense 8-column grid, system emoji glyphs
// • Keeps open while inserting (composer mode) or closes on pick (reaction mode)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  EMOJI_CATEGORIES,
  RECENT_EMOJI_KEY,
  RECENT_EMOJI_MAX,
  searchEmojis,
  type EmojiCategory,
} from '../lib/emojiData';
import { useColors, type Palette } from '../theme';

export interface EmojiPickerProps {
  visible: boolean;
  onClose: () => void;
  /** Called when user taps an emoji. */
  onSelect: (emoji: string) => void;
  /**
   * `composer` — stay open after pick (insert into draft).
   * `reaction` — close after pick (WhatsApp reaction sheet).
   */
  mode?: 'composer' | 'reaction';
  title?: string;
}

export default function EmojiPicker({
  visible,
  onClose,
  onSelect,
  mode = 'composer',
  title,
}: EmojiPickerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, width), [colors, width]);

  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [activeCat, setActiveCat] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<string, number>>({});

  // Load recents when opened.
  useEffect(() => {
    if (!visible) {
      setQuery('');
      return;
    }
    void AsyncStorage.getItem(RECENT_EMOJI_KEY).then((raw) => {
      try {
        const arr = raw ? (JSON.parse(raw) as string[]) : [];
        if (Array.isArray(arr)) setRecent(arr.filter((x) => typeof x === 'string').slice(0, RECENT_EMOJI_MAX));
      } catch {
        setRecent([]);
      }
    });
  }, [visible]);

  const pushRecent = useCallback(async (emoji: string) => {
    setRecent((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, RECENT_EMOJI_MAX);
      void AsyncStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handlePick = useCallback(
    (emoji: string) => {
      void pushRecent(emoji);
      onSelect(emoji);
      if (mode === 'reaction') onClose();
    },
    [mode, onClose, onSelect, pushRecent],
  );

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const searchHits = useMemo(() => {
    if (!searching) return [];
    return searchEmojis(q, 120);
  }, [q, searching]);

  // When not searching, show Recent + all categories.
  const sections = useMemo(() => {
    if (searching) {
      return [{ id: 'search', icon: '🔎', label: 'Results', emojis: searchHits }] as EmojiCategory[];
    }
    const list: EmojiCategory[] = [];
    if (recent.length) {
      list.push({ id: 'recent', icon: '🕒', label: 'Recently used', emojis: recent });
    }
    list.push(...EMOJI_CATEGORIES);
    return list;
  }, [searching, searchHits, recent]);

  const tabCats = useMemo(() => {
    // Bottom tabs: Recent + category icons (WhatsApp).
    const tabs: { id: string; icon: string; index: number }[] = [];
    let i = 0;
    if (!searching && recent.length) {
      tabs.push({ id: 'recent', icon: '🕒', index: i++ });
    }
    for (const c of EMOJI_CATEGORIES) {
      tabs.push({ id: c.id, icon: c.icon, index: i++ });
    }
    return tabs;
  }, [searching, recent.length]);

  const jumpToCategory = (tabIndex: number) => {
    setActiveCat(tabIndex);
    const tab = tabCats[tabIndex];
    if (!tab) return;
    const y = sectionY.current[tab.id];
    if (y != null && scrollRef.current) {
      scrollRef.current.scrollTo({ y: Math.max(0, y - 8), animated: true });
    }
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (searching || tabCats.length === 0) return;
    const y = e.nativeEvent.contentOffset.y + 24;
    let current = 0;
    for (let i = 0; i < tabCats.length; i++) {
      const sy = sectionY.current[tabCats[i].id] ?? 0;
      if (sy <= y) current = i;
    }
    if (current !== activeCat) setActiveCat(current);
  };

  if (!visible) return null;

  const cols = 8;
  const cell = Math.floor((width - 24) / cols);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {/* Header */}
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title ?? (mode === 'reaction' ? 'React' : 'Emoji')}</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          {/* Search */}
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

          {/* Grid */}
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={32}
          >
            {sections.map((sec) => (
              <View
                key={sec.id}
                onLayout={(ev) => {
                  sectionY.current[sec.id] = ev.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.sectionLabel}>{sec.label}</Text>
                {sec.emojis.length === 0 ? (
                  <Text style={styles.empty}>No emoji found</Text>
                ) : (
                  <View style={styles.grid}>
                    {sec.emojis.map((e, i) => (
                      <Pressable
                        key={`${sec.id}-${e}-${i}`}
                        style={({ pressed }) => [
                          styles.cell,
                          { width: cell, height: cell },
                          pressed && styles.cellPressed,
                        ]}
                        onPress={() => handlePick(e)}
                      >
                        <Text style={styles.emoji} allowFontScaling={false}>
                          {e}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ))}
            <View style={{ height: 12 }} />
          </ScrollView>

          {/* Category tabs — WhatsApp bottom strip */}
          {!searching && (
            <View style={styles.tabs}>
              {tabCats.map((t, i) => {
                const on = i === activeCat;
                return (
                  <Pressable
                    key={t.id}
                    style={[styles.tab, on && styles.tabOn]}
                    onPress={() => jumpToCategory(i)}
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
      minHeight: '52%',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
      shadowColor: '#000',
      shadowOpacity: colors.isLight ? 0.14 : 0.4,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: -4 },
      elevation: 16,
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
      marginBottom: 8,
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
    scroll: { flexGrow: 0, flexShrink: 1 },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.2,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 4,
      textTransform: 'uppercase',
    },
    empty: {
      color: colors.textFaint,
      fontSize: 13,
      paddingHorizontal: 14,
      paddingVertical: 16,
      textAlign: 'center',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 6,
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
