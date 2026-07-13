// Lumixo mobile — full-screen media picker (WhatsApp-class), replacing the old
// bottom-sheet gallery. Loads recent photos+videos newest-first, virtualized +
// infinite-scroll, cached thumbnails (expo-image), an album switcher ("Recent ▼"),
// and ordered multi-select with yellow numbered circles. Lumixo branding/theme.
//
// Native: uses expo-media-library (added in 0030 phase; requires a native rebuild —
// see mobile/BUILD_ANDROID.md). Degrades to a clear permission state if denied.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View,
  useWindowDimensions, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors, spacing, radius, font, type Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'MediaPicker'>;
type R = RouteProp<RootStackParamList, 'MediaPicker'>;

const PAGE = 90;                 // assets fetched per infinite-scroll page
const DEFAULT_MAX = 10;          // configurable max selection (WhatsApp = 30; keep modest)

// One picked asset passed forward to the preview/editor.
export interface PickedAsset {
  id: string;
  uri: string;
  type: 'image' | 'video';
  fileName: string;
  width: number;
  height: number;
  durationMs?: number;
  fileSize?: number;
}

export default function MediaPickerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { conversationId, maxSelection = DEFAULT_MAX } = route.params;
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width } = useWindowDimensions();

  const NUM_COLS = 3;
  const GAP = 2;
  const cell = Math.floor((width - GAP * (NUM_COLS - 1)) / NUM_COLS);

  const [perm, setPerm] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([]);
  const [album, setAlbum] = useState<MediaLibrary.Album | null>(null); // null = Recent (all)
  const [albumOpen, setAlbumOpen] = useState(false);
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Selection preserves ORDER: array of asset ids, index+1 = the yellow number.
  const [selected, setSelected] = useState<string[]>([]);
  const assetById = useRef(new Map<string, MediaLibrary.Asset>());

  // ── Permissions + first page ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const res = await MediaLibrary.requestPermissionsAsync();
      if (!res.granted) { setPerm('denied'); setLoading(false); return; }
      setPerm('granted');
      // Album list for the "Recent ▼" switcher (dynamic; only non-empty ones).
      MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true })
        .then((list) => setAlbums(list.filter((a) => a.assetCount > 0)
          .sort((a, b) => b.assetCount - a.assetCount)))
        .catch(() => {});
      loadPage(null, true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPage = useCallback(async (alb: MediaLibrary.Album | null, reset: boolean) => {
    if (reset) { setLoading(true); }
    try {
      const res = await MediaLibrary.getAssetsAsync({
        first: PAGE,
        after: reset ? undefined : endCursor,
        album: alb ?? undefined,
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [MediaLibrary.SortBy.creationTime],   // newest first (default desc)
      });
      res.assets.forEach((a) => assetById.current.set(a.id, a));
      setAssets((prev) => (reset ? res.assets : [...prev, ...res.assets]));
      setEndCursor(res.endCursor);
      setHasMore(res.hasNextPage);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [endCursor]);

  const onEndReached = useCallback(() => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    loadPage(album, false);
  }, [loadingMore, loading, hasMore, album, loadPage]);

  function switchAlbum(a: MediaLibrary.Album | null) {
    setAlbumOpen(false);
    setAlbum(a);
    setAssets([]);
    setEndCursor(undefined);
    setHasMore(true);
    loadPage(a, true);
  }

  // ── Selection (ordered) ─────────────────────────────────────────────────────
  const toggle = useCallback((id: string) => {
    Haptics.selectionAsync().catch(() => {});
    setSelected((prev) => {
      const i = prev.indexOf(id);
      if (i >= 0) return prev.filter((x) => x !== id);         // deselect
      if (prev.length >= maxSelection) return prev;             // cap
      return [...prev, id];                                     // append (keeps order)
    });
  }, [maxSelection]);

  const toPicked = useCallback((a: MediaLibrary.Asset): PickedAsset => ({
    id: a.id,
    uri: a.uri,
    type: a.mediaType === MediaLibrary.MediaType.video ? 'video' : 'image',
    fileName: a.filename || `${a.mediaType === 'video' ? 'video' : 'photo'}_${a.id}.${a.mediaType === 'video' ? 'mp4' : 'jpg'}`,
    width: a.width,
    height: a.height,
    durationMs: a.duration ? Math.round(a.duration * 1000) : undefined,
  }), []);

  function proceed(ids: string[]) {
    const picked = ids
      .map((id) => assetById.current.get(id))
      .filter((a): a is MediaLibrary.Asset => !!a)
      .map(toPicked);
    if (!picked.length) return;
    navigation.navigate('MediaPreview', { conversationId, assets: picked, startIndex: 0 });
  }

  // Tapping a tile with no active selection → straight to preview for that one.
  const onTilePress = useCallback((a: MediaLibrary.Asset) => {
    if (selected.length > 0) { toggle(a.id); return; }
    proceed([a.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.length, toggle]);

  const keyExtractor = useCallback((a: MediaLibrary.Asset) => a.id, []);
  const getItemLayout = useCallback((_: unknown, index: number) => {
    const row = Math.floor(index / NUM_COLS);
    return { length: cell + GAP, offset: (cell + GAP) * row, index };
  }, [cell]);

  const renderItem = useCallback(({ item }: { item: MediaLibrary.Asset }) => {
    const order = selected.indexOf(item.id);
    const isSel = order >= 0;
    const isVideo = item.mediaType === MediaLibrary.MediaType.video;
    return (
      <Pressable
        onPress={() => onTilePress(item)}
        onLongPress={() => toggle(item.id)}
        delayLongPress={180}
        style={{ width: cell, height: cell, marginRight: GAP, marginBottom: GAP }}
      >
        <Image
          source={{ uri: item.uri }}
          style={styles.thumb}
          contentFit="cover"
          transition={120}
          recyclingKey={item.id}
          cachePolicy="memory-disk"
        />
        {isVideo && (
          <View style={styles.videoTag}>
            <Ionicons name="videocam" size={11} color="#fff" />
            <Text style={styles.videoDur}>{fmtDur(item.duration)}</Text>
          </View>
        )}
        {/* selection dim + yellow numbered circle */}
        {isSel && <View style={styles.selDim} />}
        <View style={[styles.selCircle, isSel && styles.selCircleOn]}>
          {isSel && <Text style={styles.selNum}>{order + 1}</Text>}
        </View>
      </Pressable>
    );
  }, [selected, cell, styles, onTilePress, toggle]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (perm === 'denied') {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="images-outline" size={56} color={colors.textFaint} />
        <Text style={styles.emptyTitle}>Photos access needed</Text>
        <Text style={styles.emptySub}>Allow Lumixo to access your photos and videos to share them here.</Text>
        <Pressable style={styles.permBtn} onPress={() => MediaLibrary.requestPermissionsAsync().then((r) => { if (r.granted) { setPerm('granted'); loadPage(null, true); } })}>
          <Text style={styles.permBtnText}>Allow access</Text>
        </Pressable>
      </View>
    );
  }

  const albumTitle = album?.title ?? 'Recent';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header: close · album switcher · counter */}
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
        <Pressable style={styles.albumBtn} onPress={() => setAlbumOpen(true)}>
          <Text style={styles.albumTitle} numberOfLines={1}>{albumTitle}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.text} />
        </Pressable>
        <View style={{ width: 26 }} />
      </View>

      {loading && assets.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : assets.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="images-outline" size={56} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>No media here</Text>
        </View>
      ) : (
        <FlatList
          data={assets}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          numColumns={NUM_COLS}
          getItemLayout={getItemLayout}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.6}
          initialNumToRender={PAGE / 3}
          maxToRenderPerBatch={PAGE / 3}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: spacing(4) }} color={colors.primary} /> : null}
        />
      )}

      {/* Send bar — appears while ≥1 selected */}
      {selected.length > 0 && (
        <View style={[styles.sendBar, { paddingBottom: insets.bottom + 10 }]}>
          <Text style={styles.sendCount}>{selected.length} selected</Text>
          <Pressable style={styles.sendBtn} onPress={() => proceed(selected)}>
            <Ionicons name="arrow-forward" size={22} color="#fff" />
          </Pressable>
        </View>
      )}

      {/* Album switcher sheet */}
      <Modal visible={albumOpen} transparent animationType="slide" onRequestClose={() => setAlbumOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAlbumOpen(false)}>
          <View style={[styles.albumSheet, { paddingBottom: insets.bottom + 12 }]}>
            <Text style={styles.albumSheetTitle}>Albums</Text>
            <AlbumRow label="Recent" count={null} active={!album} onPress={() => switchAlbum(null)} colors={colors} />
            {albums.map((a) => (
              <AlbumRow key={a.id} label={a.title} count={a.assetCount} active={album?.id === a.id} onPress={() => switchAlbum(a)} colors={colors} />
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function AlbumRow({ label, count, active, onPress, colors }: {
  label: string; count: number | null; active: boolean; onPress: () => void; colors: Palette;
}) {
  return (
    <Pressable style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(3), paddingHorizontal: spacing(4) }, pressed && { backgroundColor: colors.surfaceAlt }]} onPress={onPress}>
      <Ionicons name={active ? 'radio-button-on' : 'albums-outline'} size={20} color={active ? colors.primary : colors.textMuted} />
      <Text style={{ flex: 1, color: colors.text, fontSize: font.body, marginLeft: spacing(3) }} numberOfLines={1}>{label}</Text>
      {count != null && <Text style={{ color: colors.textFaint, fontSize: font.small }}>{count}</Text>}
    </Pressable>
  );
}

function fmtDur(seconds?: number): string {
  if (!seconds) return '';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(8) },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(4), height: 52 },
    albumBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '60%' },
    albumTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
    thumb: { width: '100%', height: '100%', backgroundColor: colors.surfaceAlt },
    videoTag: { position: 'absolute', left: 4, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
    videoDur: { color: '#fff', fontSize: 10, fontWeight: '600' },
    selDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 3, borderColor: '#F5C518' },
    selCircle: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
    selCircleOn: { backgroundColor: '#F5C518', borderColor: '#fff' },
    selNum: { color: '#1a1a1a', fontSize: 12, fontWeight: '800' },
    sendBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(4), paddingTop: 10, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    sendCount: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { color: colors.text, fontSize: font.heading, fontWeight: '600', marginTop: spacing(3) },
    emptySub: { color: colors.textMuted, fontSize: font.small, textAlign: 'center', marginTop: spacing(2) },
    permBtn: { marginTop: spacing(5), backgroundColor: colors.primary, paddingHorizontal: spacing(6), paddingVertical: spacing(3), borderRadius: radius.md },
    permBtnText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    albumSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing(4), maxHeight: '70%' },
    albumSheetTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', paddingHorizontal: spacing(4), paddingBottom: spacing(2) },
  });
