// Lumixo mobile — full-screen media viewer (WhatsApp / Telegram-grade).
//  • Horizontal swipe paging between images & videos (pager locks while zoomed).
//  • Pinch-zoom, double-tap-to-zoom toward the tap point, pan-while-zoomed with
//    edge clamping, all on Reanimated for 60fps.
//  • Private-bucket media flows through SignedImage → useSignedUrl (signed url,
//    stall-timeout, retry). It is NEVER a black frame: always spinner or retry.
//  • Top app bar: Close · counter · Forward · Share · Save · More. The More
//    sheet holds Info / Copy link / Delete (permission-gated) so nothing is
//    lost. Chrome fades in/out on single-tap (animated, not conditional).
//  • Modal entrance: hero-style scale-in + fade for both the backdrop and page.
//  • Info sheet: sender, date, time, resolution, size, upload quality, delivery,
//    message id. Rows with no value render "—" (never disappear silently).
//  • Videos get the same chrome / share / save / forward / info parity.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Audio, ResizeMode, Video } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withTiming, runOnJS,
  useAnimatedReaction,
} from 'react-native-reanimated';

import type { MediaMeta } from '../lib/shared';
import { signedMediaUrl } from '../lib/shared';
import { supabase } from '../lib/supabase';
import { useSignedUrl } from '../lib/useSignedUrl';
import { ensureMediaCached } from '../lib/mediaCache';
import { requestMediaDownload } from '../lib/mediaDownloadManager';
import { formatBytes } from '../media/qualityEstimate';
import {
  isValidScale,
  isValidTransform,
  safeClampScale,
  clampOffset as clamp,
  maxOffset,
} from './mediaViewerMath';
import SignedImage from './SignedImage';
import { Alert } from '../ui/dialog';

export interface ViewerItem {
  id: string;
  url: string;
  kind: 'image' | 'video';
  /** Optional metadata shown in the footer / Info sheet. */
  caption?: string | null;
  sender?: string | null;
  time?: string | null;
  /** ISO timestamp for the Info sheet. */
  createdAt?: string | null;
  /** True when the current user sent this (affects delete options). */
  mine?: boolean;
  /** Delivery status label for the Info sheet ("Read"/"Delivered"/…). */
  status?: string | null;
  /** Picker/editor metadata (quality, dims, viewOnce). */
  meta?: MediaMeta | null;
  /** View-Once items can't be saved/shared/forwarded. */
  viewOnce?: boolean;
}

interface Props {
  items: ViewerItem[];
  index: number;
  onClose: () => void;
  /** Forward this item — caller opens the ForwardSheet with a preview. */
  onForward?: (item: ViewerItem) => void;
  /** Delete this item — caller shows delete-for-me / unsend options. */
  onDelete?: (item: ViewerItem) => void;
}

// ── Zoomable image page ───────────────────────────────────────────────────────
function ZoomableImage({
  item, onZoomChange, onSingleTap, onSwipeDown, onNaturalSize,
  screenW, screenH,
}: {
  item: ViewerItem;
  onZoomChange: (zoomed: boolean) => void;
  onSingleTap: () => void;
  /** WhatsApp-style swipe-down to dismiss when not zoomed. */
  onSwipeDown?: () => void;
  onNaturalSize?: (w: number, h: number) => void;
  /** Live window size — never freeze Dimensions at module load (rotation crash). */
  screenW: number;
  screenH: number;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const isGesturing = useSharedValue(false);
  // Shared dimensions so worklets always use current orientation.
  const dimW = useSharedValue(screenW);
  const dimH = useSharedValue(screenH);
  useEffect(() => {
    dimW.value = screenW;
    dimH.value = screenH;
    // Reset zoom on rotate — pan bounds otherwise become invalid.
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedScale.value = 1;
    savedTx.value = 0;
    savedTy.value = 0;
    onZoomChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenW, screenH]);

  const reset = () => {
    scale.value = withTiming(1);
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedScale.value = 1;
    savedTx.value = 0;
    savedTy.value = 0;
    isGesturing.value = false;
    onZoomChange(false);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      if (isGesturing.value === false) isGesturing.value = true;
      if (!isFinite(e.scale) || e.scale <= 0) return;
      if (!isFinite(savedScale.value) || savedScale.value < 1) savedScale.value = 1;
      const newScale = safeClampScale(savedScale.value * e.scale);
      if (isValidScale(newScale)) scale.value = newScale;
    })
    .onEnd(() => {
      isGesturing.value = false;
      const finalScale = scale.value;
      if (!isFinite(finalScale)) {
        runOnJS(reset)();
        return;
      }
      savedScale.value = finalScale;
      if (finalScale <= 1.02) {
        runOnJS(reset)();
      } else if (isValidScale(finalScale)) {
        const maxX = maxOffset(dimW.value, finalScale);
        const maxY = maxOffset(dimH.value, finalScale);
        tx.value = clamp(tx.value, maxX);
        ty.value = clamp(ty.value, maxY);
        savedTx.value = tx.value;
        savedTy.value = ty.value;
        runOnJS(onZoomChange)(true);
      }
    });

  // When zoomed: free pan. When not: vertical-dominant drag dismisses (fails to
  // horizontal pager so left/right swipe between photos still works).
  const pan = Gesture.Pan()
    .minPointers(1)
    .activeOffsetY([-18, 18])
    .failOffsetX([-28, 28])
    .onUpdate((e) => {
      const currentScale = scale.value;
      // Swipe-down dismiss when not zoomed (WhatsApp).
      if (currentScale <= 1.02) {
        if (!isFinite(e.translationY)) return;
        ty.value = Math.max(0, e.translationY * 0.85);
        return;
      }
      if (!isValidScale(currentScale)) return;
      if (!isFinite(e.translationX) || !isFinite(e.translationY)) return;
      const maxX = maxOffset(dimW.value, currentScale);
      const maxY = maxOffset(dimH.value, currentScale);
      const newTx = clamp(savedTx.value + e.translationX, maxX);
      const newTy = clamp(savedTy.value + e.translationY, maxY);
      if (isValidTransform(newTx) && isValidTransform(newTy)) {
        tx.value = newTx;
        ty.value = newTy;
      }
    })
    .onEnd((e) => {
      if (scale.value <= 1.02) {
        if ((e.translationY > 110 || e.velocityY > 800) && onSwipeDown) {
          runOnJS(onSwipeDown)();
          return;
        }
        ty.value = withTiming(0);
        savedTy.value = 0;
        return;
      }
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1) {
        runOnJS(reset)();
        return;
      }
      const target = 2.6;
      if (!isFinite(e.x) || !isFinite(e.y)) return;
      const offX = e.x - dimW.value / 2;
      const offY = e.y - dimH.value / 2;
      const maxX = maxOffset(dimW.value, target);
      const maxY = maxOffset(dimH.value, target);
      const dstX = clamp(offX * (1 - target), maxX);
      const dstY = clamp(offY * (1 - target), maxY);
      if (isValidTransform(dstX) && isValidTransform(dstY)) {
        tx.value = withTiming(dstX);
        ty.value = withTiming(dstY);
        scale.value = withTiming(target);
        savedScale.value = target;
        savedTx.value = dstX;
        savedTy.value = dstY;
        runOnJS(onZoomChange)(true);
      }
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => { runOnJS(onSingleTap)(); });

  // Double-tap wins over single-tap; pinch/pan run alongside.
  const taps = Gesture.Exclusive(doubleTap, singleTap);
  const composed = Gesture.Simultaneous(pinch, pan, taps);

  const style = useAnimatedStyle(() => {
    const s = scale.value;
    const x = tx.value;
    const y = ty.value;
    if (!isValidScale(s) || !isValidTransform(x) || !isValidTransform(y)) {
      return { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    }
    return { transform: [{ translateX: x }, { translateY: y }, { scale: s }] };
  });

  useAnimatedReaction(
    () => scale.value,
    (s) => {
      if (!isFinite(s) || s < 1 || s > 6) {
        scale.value = 1;
        tx.value = 0;
        ty.value = 0;
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
        isGesturing.value = false;
        runOnJS(onZoomChange)(false);
      }
    },
  );

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={styles.page}>
        <Animated.View style={[styles.fill, style]}>
          <SignedImage
            source={item.url}
            containerStyle={styles.fill}
            contentFit="contain"
            transition={120}
            placeholderBackground="#000"
            onNaturalSize={onNaturalSize}
          />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

// ── Video page ────────────────────────────────────────────────────────────────
// CRITICAL: FlatList keeps adjacent pages mounted. A video must NEVER mount or
// autoplay unless it is the *active* page — otherwise opening a photo starts
// audio from a neighbouring video (the reported WhatsApp-parity bug).
//
// Contract:
//  • isActive=false → no <Video> instance, no audio, no buffering.
//  • isActive=true  → create player; autoplay like WhatsApp when user lands on it.
//  • leaving page / background / unmount → pause + unload immediately.
function VideoPage({
  item,
  isActive,
  onSingleTap,
}: {
  item: ViewerItem;
  isActive: boolean;
  onSingleTap: () => void;
}) {
  // Only resolve signed/local URL while active — inactive pages stay inert.
  const { url, loading, error, retry } = useSignedUrl(isActive ? item.url : null);
  const [buffering, setBuffering] = useState(true);
  const [playError, setPlayError] = useState(false);
  // When app backgrounds we unmount Video (no ghost audio). Remount on resume
  // so expo-av reloads after unloadAsync — otherwise play stays dead.
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');
  const videoRef = useRef<Video | null>(null);
  const tap = Gesture.Tap().numberOfTaps(1).onEnd(() => {
    runOnJS(onSingleTap)();
  });

  const releasePlayer = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      await v.pauseAsync();
    } catch { /* ignore */ }
    try {
      await v.unloadAsync();
    } catch { /* ignore */ }
  }, []);

  // Become inactive → tear down player immediately (swipe video → photo).
  useEffect(() => {
    if (!isActive) {
      setBuffering(true);
      setPlayError(false);
      void releasePlayer();
    } else if (appActive) {
      // Configure session so playback does not keep running in the background.
      void Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      }).catch(() => {});
    }
  }, [isActive, appActive, releasePlayer]);

  // App backgrounded → unmount player (no ghost audio); foreground → remount.
  useEffect(() => {
    const onApp = (state: AppStateStatus) => {
      if (state !== 'active') {
        setAppActive(false);
        void releasePlayer();
      } else {
        setAppActive(true);
        setBuffering(true);
      }
    };
    const sub = AppState.addEventListener('change', onApp);
    return () => sub.remove();
  }, [releasePlayer]);

  // Unmount cleanup.
  useEffect(() => () => {
    void releasePlayer();
  }, [releasePlayer]);

  const failed = error || playError;
  const onRetry = () => {
    setPlayError(false);
    setBuffering(true);
    retry();
  };

  // Inactive page OR app backgrounded: silent poster only — never instantiate Video.
  if (!isActive || !appActive) {
    return (
      <GestureDetector gesture={tap}>
        <View style={styles.page}>
          <View style={styles.centerOverlay} pointerEvents="none">
            <Ionicons name="play-circle" size={72} color="rgba(255,255,255,0.92)" />
          </View>
        </View>
      </GestureDetector>
    );
  }

  return (
    <GestureDetector gesture={tap}>
      <View style={styles.page}>
        {!!url && !failed && (
          <Video
            ref={videoRef}
            key={`vid-${item.id}-${url}`}
            source={{ uri: url }}
            style={styles.fill}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            // Autoplay only for the active page (user explicitly opened/swiped to this video).
            shouldPlay
            isLooping={false}
            isMuted={false}
            onLoad={() => setBuffering(false)}
            onError={() => {
              setBuffering(false);
              setPlayError(true);
            }}
          />
        )}
        {(loading || (buffering && !failed)) && (
          <View style={styles.centerOverlay} pointerEvents="none">
            <ActivityIndicator color="#fff" size="large" />
          </View>
        )}
        {failed && (
          <Pressable style={styles.centerOverlay} onPress={onRetry} accessibilityRole="button">
            <Ionicons name="reload" size={30} color="#fff" />
            <Text style={styles.retryText}>Tap to retry</Text>
          </Pressable>
        )}
      </View>
    </GestureDetector>
  );
}

export default function MediaViewer({ items, index, onClose, onForward, onDelete }: Props) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(index);
  const [zoomed, setZoomed] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [natural, setNatural] = useState<Record<string, { w: number; h: number }>>({});
  const listRef = useRef<FlatList<ViewerItem>>(null);

  const item = items[current];

  // ── Entrance / chrome animations ───────────────────────────────────────────
  // Hero-style entry: backdrop fades, page scales up subtly. On close we play
  // the reverse and then call onClose so the user sees the animation finish.
  const openProgress = useSharedValue(0);
  const chromeOpacity = useSharedValue(1);

  useEffect(() => {
    openProgress.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chromeOpacity.value = withTiming(chrome ? 1 : 0, { duration: 180 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chrome]);

  const requestClose = useCallback(() => {
    openProgress.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  }, [onClose, openProgress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: openProgress.value }));
  const pageStyle = useAnimatedStyle(() => ({
    opacity: openProgress.value,
    transform: [{ scale: 0.94 + 0.06 * openProgress.value }],
  }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chromeOpacity.value }));

  // Update active index during the swipe (not only at momentum end) so video
  // audio stops as soon as the page is no longer the nearest centre page.
  const applyPageIndex = useCallback((offsetX: number, haptic: boolean) => {
    const i = Math.round(offsetX / Math.max(1, screenW));
    if (i < 0 || i >= items.length) return;
    setCurrent((prev) => {
      if (prev === i) return prev;
      if (haptic) Haptics.selectionAsync().catch(() => {});
      if (!chrome) setChrome(true);
      return i;
    });
  }, [screenW, items.length, chrome]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    applyPageIndex(e.nativeEvent.contentOffset.x, false);
  }, [applyPageIndex]);

  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    applyPageIndex(e.nativeEvent.contentOffset.x, true);
  }, [applyPageIndex]);

  const jumpTo = useCallback((i: number) => {
    setCurrent(i);
    listRef.current?.scrollToIndex({ index: i, animated: true });
  }, []);

  const toggleChrome = useCallback(() => setChrome((v) => !v), []);

  // On open: permanently cache the CURRENT item only (user requested).
  // Neighbours are not bulk-downloaded (saves storage after reinstall).
  useEffect(() => {
    const it = items[current];
    if (it?.url) void requestMediaDownload(it.url);
  }, [current, items]);

  // Resolve the current item's signed url for file operations (download/share).
  const resolveUrl = useCallback(async (it: ViewerItem) => {
    const cached = await requestMediaDownload(it.url);
    if (cached) return cached;
    const signed = await signedMediaUrl(supabase, it.url);
    return signed ?? it.url;
  }, []);

  // Prefer permanent offline cache after user open; fall back to one-shot download.
  const downloadToCache = useCallback(async (it: ViewerItem): Promise<string> => {
    const cached = await requestMediaDownload(it.url);
    if (cached) return cached;
    const src = await resolveUrl(it);
    const clean = it.url.split('?')[0];
    const ext = clean.split('.').pop()?.slice(0, 5) || (it.kind === 'video' ? 'mp4' : 'jpg');
    const target = `${FileSystem.cacheDirectory}lumixo-${it.id}.${ext}`;
    const { uri } = await FileSystem.downloadAsync(src, target);
    return uri;
  }, [resolveUrl]);

  // Save to the device gallery (proper permissions; blocked for View-Once).
  const save = useCallback(async () => {
    if (!item || saving) return;
    if (item.viewOnce) { Alert.alert('View once', 'View-once media can’t be saved.'); return; }
    setSaving(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow photo access to save media to your gallery.');
        return;
      }
      const uri = await downloadToCache(item);
      await MediaLibrary.saveToLibraryAsync(uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Saved', `${item.kind === 'video' ? 'Video' : 'Photo'} saved to your gallery.`);
    } catch {
      Alert.alert('Could not save', 'The file could not be saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [item, saving, downloadToCache]);

  // Android/iOS native share sheet — shares the actual file, not just a link.
  const share = useCallback(async () => {
    if (!item || busy) return;
    if (item.viewOnce) { Alert.alert('View once', 'View-once media can’t be shared.'); return; }
    setBusy(true);
    try {
      const uri = await downloadToCache(item);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: item.kind === 'video' ? 'video/mp4' : 'image/jpeg',
          dialogTitle: 'Share media',
        });
      } else {
        await Share.share({ url: uri });
      }
    } catch {
      // Offline / download failed — fall back to sharing the raw link.
      try { const src = await resolveUrl(item); await Share.share({ message: src, url: src }); } catch { /* cancelled */ }
    } finally {
      setBusy(false);
    }
  }, [item, busy, downloadToCache, resolveUrl]);

  const copyLink = useCallback(async () => {
    setMoreOpen(false);
    if (!item) return;
    const src = await resolveUrl(item);
    await Clipboard.setStringAsync(src);
    Alert.alert('Link copied', 'A temporary link to this media was copied.');
  }, [item, resolveUrl]);

  const doForward = useCallback(() => {
    if (!item) return;
    if (item.viewOnce) { Alert.alert('View once', 'View-once media can’t be forwarded.'); return; }
    onForward?.(item);
  }, [item, onForward]);

  const doDelete = useCallback(() => {
    setMoreOpen(false);
    if (item) onDelete?.(item);
  }, [item, onDelete]);

  // When the user zooms in we hide the footer's thumbnail strip (via
  // pointerEvents/opacity below); the top bar stays available so they can still
  // exit. The chrome state itself is left alone so an intentional tap-to-hide
  // survives a subsequent pinch.

  const renderItem = useCallback(({ item: it, index: i }: ListRenderItemInfo<ViewerItem>) => {
    const pageStyle = { width: screenW, height: screenH };
    // Only the *current* page is active — adjacent FlatList windows must not play.
    const isActive = i === current;
    return it.kind === 'video' ? (
      <View style={pageStyle}>
        <VideoPage item={it} isActive={isActive} onSingleTap={toggleChrome} />
      </View>
    ) : (
      <View style={pageStyle}>
        <ZoomableImage
          item={it}
          screenW={screenW}
          screenH={screenH}
          onZoomChange={setZoomed}
          onSingleTap={toggleChrome}
          onSwipeDown={requestClose}
          onNaturalSize={(w, h) => setNatural((prev) => (prev[it.id] ? prev : { ...prev, [it.id]: { w, h } }))}
        />
      </View>
    );
  }, [screenW, screenH, toggleChrome, requestClose, current]);

  const canDownload = !!item && !item.viewOnce;
  const canShare = !!item && !item.viewOnce;
  const canForward = !!item && !item.viewOnce && !!onForward;
  const canDelete = !!item && !!onDelete;

  return (
    <Modal visible transparent animationType="none" onRequestClose={requestClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} pointerEvents="none" />
        <Animated.View style={[styles.rootInner, pageStyle]}>
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(it) => it.id}
            renderItem={renderItem}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: screenW, offset: screenW * i, index: i })}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onMomentumScrollEnd={onMomentumEnd}
            // Keep neighbours mounted for swipe feel, but VideoPage only plays when active.
            windowSize={3}
            maxToRenderPerBatch={2}
            initialNumToRender={1}
            extraData={current}
            removeClippedSubviews
          />
        </Animated.View>

        {/* ── Top app bar ── The requirement lists 7 actions; that overflows a
           * 360dp screen. We surface the four most-used (Forward · Share · Save
           * · More) directly and put Info + Delete in the More sheet — the
           * pattern every modern messaging app uses. */}
        <Animated.View
          style={[styles.header, chromeStyle, { paddingTop: Math.max(insets.top, 12) + 8 }]}
          pointerEvents={chrome ? 'auto' : 'none'}
        >
          <Pressable onPress={requestClose} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          <Text style={styles.counter} numberOfLines={1}>
            {items.length > 1 ? `${current + 1} / ${items.length}` : ''}
          </Text>
          <View style={styles.headerRight}>
            {canForward && (
              <HeaderBtn icon="arrow-redo-outline" label="Forward" onPress={doForward} />
            )}
            {canShare && (
              <HeaderBtn icon={busy ? 'hourglass-outline' : 'share-social-outline'} label="Share" onPress={share} disabled={busy} />
            )}
            {canDownload && (
              <HeaderBtn icon={saving ? 'hourglass-outline' : 'download-outline'} label="Save" onPress={save} disabled={saving} />
            )}
            <HeaderBtn icon="ellipsis-vertical" label="More" size={20} onPress={() => setMoreOpen(true)} />
          </View>
        </Animated.View>

        {/* ── Footer: caption + meta + thumbnail strip ── */}
        <Animated.View
          style={[styles.footer, chromeStyle, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}
          pointerEvents={chrome && !zoomed ? 'auto' : 'none'}
        >
          {(!!item?.sender || !!item?.time) && (
            <Text style={styles.meta} numberOfLines={1}>
              {item?.sender ?? ''}
              {item?.sender && item?.time ? '  ·  ' : ''}
              {item?.time ?? ''}
            </Text>
          )}
          {!!item?.caption && <Text style={styles.caption} numberOfLines={3}>{item?.caption}</Text>}
          {items.length > 1 && (
            <FlatList
              data={items}
              keyExtractor={(it) => `t-${it.id}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.strip}
              contentContainerStyle={styles.stripContent}
              renderItem={({ item: it, index: i }) => (
                <Pressable onPress={() => jumpTo(i)} style={[styles.thumb, i === current && styles.thumbActive]}>
                  <SignedImage source={it.url} containerStyle={styles.thumbImg} contentFit="cover" showRetry={false} />
                  {it.kind === 'video' && (
                    <View style={styles.thumbPlay}><Ionicons name="play" size={12} color="#fff" /></View>
                  )}
                </Pressable>
              )}
            />
          )}
        </Animated.View>

        {/* ── More menu ── */}
        <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
          <Pressable style={styles.menuBackdrop} onPress={() => setMoreOpen(false)}>
            <Pressable style={styles.menu} onPress={(e) => e.stopPropagation()}>
              <MenuRow icon="information-circle-outline" label="Info" onPress={() => { setMoreOpen(false); setInfoOpen(true); }} />
              {!item?.viewOnce && <MenuRow icon="copy-outline" label="Copy link" onPress={copyLink} />}
              {canForward && <MenuRow icon="arrow-redo-outline" label="Forward" onPress={() => { setMoreOpen(false); doForward(); }} />}
              {canShare && <MenuRow icon="share-social-outline" label="Share" onPress={() => { setMoreOpen(false); share(); }} />}
              {canDownload && <MenuRow icon="download-outline" label="Save to gallery" onPress={() => { setMoreOpen(false); save(); }} />}
              {canDelete && <MenuRow icon="trash-outline" label="Delete" danger onPress={doDelete} />}
            </Pressable>
          </Pressable>
        </Modal>

        {/* ── Info sheet ── */}
        {infoOpen && item && (
          <InfoSheet
            item={item}
            natural={natural[item.id]}
            onClose={() => setInfoOpen(false)}
            bottomInset={insets.bottom}
          />
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

function HeaderBtn({
  icon, label, onPress, disabled, size = 22,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.headerBtn, pressed && !disabled && styles.headerBtnPressed]}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={size} color={disabled ? 'rgba(255,255,255,0.4)' : '#fff'} />
    </Pressable>
  );
}

function MenuRow({ icon, label, onPress, danger }: { icon: any; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]} onPress={onPress}>
      <Ionicons name={icon} size={20} color={danger ? '#F15C6D' : '#fff'} />
      <Text style={[styles.menuLabel, danger && { color: '#F15C6D' }]}>{label}</Text>
    </Pressable>
  );
}

// ── Info sheet ────────────────────────────────────────────────────────────────
function InfoSheet({
  item,
  natural,
  onClose,
  bottomInset = 0,
}: {
  item: ViewerItem;
  natural?: { w: number; h: number };
  onClose: () => void;
  bottomInset?: number;
}) {
  const [bytes, setBytes] = useState<number | null>(null);
  const dims = natural ?? (item.meta?.width && item.meta?.height ? { w: item.meta.width, h: item.meta.height } : null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const src = await signedMediaUrl(supabase, item.url);
        if (!src) return;
        const res = await fetch(src, { method: 'HEAD' });
        const len = res.headers.get('content-length');
        if (alive && len) setBytes(parseInt(len, 10));
      } catch { /* size stays unknown */ }
    })();
    return () => { alive = false; };
  }, [item.url]);

  const created = item.createdAt ? new Date(item.createdAt) : null;
  const quality = item.meta?.quality
    ? item.meta.quality.charAt(0).toUpperCase() + item.meta.quality.slice(1)
    : item.meta?.hd ? 'HD' : 'Standard';

  // Every requested field renders — a missing value shows an em-dash so the
  // user isn't left guessing whether we forgot to display it.
  const rows: Array<[string, string]> = [
    ['Sender', item.sender ?? '—'],
    ['Date', created ? created.toLocaleDateString() : '—'],
    ['Time', created
      ? created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : (item.time ?? '—')],
    ['Type', item.kind === 'video' ? 'Video' : 'Photo'],
    ['Resolution', dims ? `${dims.w} × ${dims.h}` : '—'],
    ['File size', bytes != null ? formatBytes(bytes) : '—'],
    ['Upload quality', quality],
    ['Delivery', item.status ?? '—'],
    ['Message ID', item.id],
  ];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.infoBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.infoSheet, { paddingBottom: Math.max(bottomInset, 12) + 18 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.infoHandle} />
          <Text style={styles.infoTitle}>Media info</Text>
          {rows.map(([k, v]) => (
            <View key={k} style={styles.infoRow}>
              <Text style={styles.infoKey}>{k}</Text>
              <Text style={styles.infoVal} numberOfLines={1}>{v}</Text>
            </View>
          ))}
          <Pressable style={styles.infoClose} onPress={onClose}>
            <Text style={styles.infoCloseText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootInner: { flex: 1, backgroundColor: '#000' },
  backdrop: { backgroundColor: '#000' },
  fill: { width: '100%', height: '100%' },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    // paddingTop set dynamically from safe-area top inset
    paddingHorizontal: 8, paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  headerBtnPressed: { backgroundColor: 'rgba(255,255,255,0.10)' },
  counter: { color: '#fff', fontSize: 15, fontWeight: '600' },
  page: { flex: 1, width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  centerOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 8 },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
    // paddingBottom set dynamically from safe-area bottom inset
    paddingTop: 10, paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.50)',
  },
  meta: { color: '#e9edef', fontSize: 12, fontWeight: '600', marginBottom: 2 },
  caption: { color: '#fff', fontSize: 14, marginBottom: 8 },
  strip: { flexGrow: 0 },
  stripContent: { gap: 6, paddingVertical: 4 },
  thumb: { width: 46, height: 46, borderRadius: 6, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbActive: { borderColor: '#fff' },
  thumbImg: { width: 46, height: 46 },
  thumbPlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  // More menu
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', paddingTop: 96, paddingRight: 12, alignItems: 'flex-end' },
  menu: { backgroundColor: '#1F272C', borderRadius: 12, paddingVertical: 6, minWidth: 200, elevation: 8 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  menuRowPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  menuLabel: { color: '#fff', fontSize: 15, fontWeight: '500' },
  // Info sheet
  infoBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  infoSheet: { backgroundColor: '#151E24', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18 },
  infoHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#3A464E', marginBottom: 12 },
  infoTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2A363E', gap: 16 },
  infoKey: { color: '#8696A0', fontSize: 14 },
  infoVal: { color: '#E9EDEF', fontSize: 14, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  infoClose: { marginTop: 16, height: 46, borderRadius: 12, backgroundColor: '#24313A', alignItems: 'center', justifyContent: 'center' },
  infoCloseText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

