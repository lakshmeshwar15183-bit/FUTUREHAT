// FUTUREHAT mobile — full-screen media viewer (WhatsApp-grade). Horizontal
// swipe between images & videos, pinch + double-tap zoom with pan, a media
// counter, share (native sheet), and video playback (expo-av). Self-contained.
import React, { useCallback, useRef, useState } from 'react';
import {
  Dimensions, FlatList, Modal, Pressable, Share, StyleSheet, Text, View,
  type ListRenderItemInfo, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, runOnJS } from 'react-native-reanimated';

export interface ViewerItem {
  id: string;
  url: string;
  kind: 'image' | 'video';
}

interface Props {
  items: ViewerItem[];
  index: number;
  onClose: () => void;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function ZoomableImage({ url, onZoomChange }: { url: string; onZoomChange: (zoomed: boolean) => void }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const reset = () => {
    scale.value = withTiming(1);
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedScale.value = 1; savedTx.value = 0; savedTy.value = 0;
    onZoomChange(false);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 6)); })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) runOnJS(reset)();
      else runOnJS(onZoomChange)(true);
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .onUpdate((e) => {
      if (scale.value <= 1) return;
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => { savedTx.value = tx.value; savedTy.value = ty.value; });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) { runOnJS(reset)(); }
      else { scale.value = withTiming(2.5); savedScale.value = 2.5; runOnJS(onZoomChange)(true); }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={styles.page}>
        <Animated.View style={style}>
          <Image source={{ uri: url }} style={styles.media} contentFit="contain" cachePolicy="memory-disk" />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

export default function MediaViewer({ items, index, onClose }: Props) {
  const [current, setCurrent] = useState(index);
  const [zoomed, setZoomed] = useState(false);
  const listRef = useRef<FlatList<ViewerItem>>(null);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (i !== current) setCurrent(i);
  }, [current]);

  const [saving, setSaving] = useState(false);

  const share = useCallback(async () => {
    const item = items[current];
    if (!item) return;
    try { await Share.share({ message: item.url, url: item.url }); } catch { /* cancelled */ }
  }, [items, current]);

  // Download the media to a local file and open the OS save/share sheet, which
  // offers "Save to Photos"/"Save to Files" (web parity: MediaLightbox download).
  const download = useCallback(async () => {
    const item = items[current];
    if (!item || saving) return;
    setSaving(true);
    try {
      const clean = item.url.split('?')[0];
      const ext = clean.split('.').pop()?.slice(0, 5) || (item.kind === 'video' ? 'mp4' : 'jpg');
      const target = `${FileSystem.cacheDirectory}futurehat-${item.id}.${ext}`;
      const { uri } = await FileSystem.downloadAsync(item.url, target);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        await Share.share({ url: uri, message: item.url });
      }
    } catch {
      // Fall back to sharing the raw link if the download fails (offline etc.)
      try { await Share.share({ message: item.url, url: item.url }); } catch { /* cancelled */ }
    } finally {
      setSaving(false);
    }
  }, [items, current, saving]);

  const renderItem = ({ item }: ListRenderItemInfo<ViewerItem>) =>
    item.kind === 'video' ? (
      <View style={styles.page}>
        <Video
          source={{ uri: item.url }}
          style={styles.media}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay
        />
      </View>
    ) : (
      <ZoomableImage url={item.url} onZoomChange={setZoomed} />
    );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.headerBtn}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          <Text style={styles.counter}>{current + 1} / {items.length}</Text>
          <View style={styles.headerRight}>
            <Pressable onPress={download} hitSlop={12} style={styles.headerBtn} disabled={saving}>
              <Ionicons name={saving ? 'hourglass-outline' : 'download-outline'} size={22} color="#fff" />
            </Pressable>
            <Pressable onPress={share} hitSlop={12} style={styles.headerBtn}>
              <Ionicons name="share-social-outline" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>

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
          getItemLayout={(_, i) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i })}
          onMomentumScrollEnd={onScroll}
          windowSize={3}
        />
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.97)' },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 44, paddingHorizontal: 14, paddingBottom: 10,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  counter: { color: '#fff', fontSize: 15, fontWeight: '600' },
  page: { width: SCREEN_W, height: SCREEN_H, alignItems: 'center', justifyContent: 'center' },
  media: { width: SCREEN_W, height: SCREEN_H * 0.86 },
});
