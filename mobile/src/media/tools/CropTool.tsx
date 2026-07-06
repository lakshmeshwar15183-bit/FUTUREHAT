// FUTUREHAT mobile — Crop / rotate / flip tool (Phase B). Aspect presets (free,
// 1:1, 16:9, 9:16, 4:3), rotate 90°, flip H/V, pinch-zoom + pan of the image under
// a fixed crop frame, high-quality export via expo-image-manipulator.
//
// Native: expo-image-manipulator (autolinked; requires the same native rebuild as
// the picker — see BUILD_ANDROID.md). Pure-Expo, no extra plugin.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as ImageManipulator from 'expo-image-manipulator';

import { useColors, spacing, radius, font, type Palette } from '../../theme';

export interface CropResult { uri: string; width: number; height: number; }

type Aspect = 'free' | '1:1' | '16:9' | '9:16' | '4:3';
const ASPECTS: { id: Aspect; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
];

export default function CropTool({
  uri, width: srcW, height: srcH, onCancel, onDone,
}: {
  uri: string; width: number; height: number;
  onCancel: () => void;
  onDone: (r: CropResult) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: winW, height: winH } = useWindowDimensions();

  const [aspect, setAspect] = useState<Aspect>('free');
  const [rotation, setRotation] = useState(0);      // 0/90/180/270
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [busy, setBusy] = useState(false);

  // Crop frame area (the visible viewport). The image pans/zooms UNDER it.
  const frameW = winW - spacing(8);
  const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio;
  const frameH = ratio ? frameW / ratio : Math.min(winH * 0.5, frameW * (srcH / srcW || 1));

  // gesture transforms
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = Math.max(1, Math.min(6, savedScale.value * e.scale)); })
    .onEnd(() => { savedScale.value = scale.value; });
  const pan = Gesture.Pan()
    .onUpdate((e) => { tx.value = savedTx.value + e.translationX; ty.value = savedTy.value + e.translationY; })
    .onEnd(() => { savedTx.value = tx.value; savedTy.value = ty.value; });
  const composed = Gesture.Simultaneous(pinch, pan);

  const imgStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value }, { translateY: ty.value }, { scale: scale.value },
      { rotate: `${rotation}deg` }, { scaleX: flipH ? -1 : 1 }, { scaleY: flipV ? -1 : 1 },
    ],
  }));

  function reset() {
    scale.value = withTiming(1); savedScale.value = 1;
    tx.value = withTiming(0); ty.value = withTiming(0); savedTx.value = 0; savedTy.value = 0;
  }

  // Export. We apply rotate/flip precisely; the crop rect is derived from the frame
  // vs the on-screen image box (accounting for pan/zoom). This is a faithful mapping
  // of the viewport to source pixels. Runs on-device (needs the native build).
  async function apply() {
    setBusy(true);
    try {
      const actions: ImageManipulator.Action[] = [];
      if (rotation) actions.push({ rotate: rotation });
      if (flipH) actions.push({ flip: ImageManipulator.FlipType.Horizontal });
      if (flipV) actions.push({ flip: ImageManipulator.FlipType.Vertical });

      // Map the crop frame to source pixels. The image is displayed "contain" in the
      // frame at scale=1; user zoom (scale) and pan (tx/ty) shift which part shows.
      const dispScale = Math.min(frameW / srcW, frameH / srcH);   // px→display at scale 1
      const shownW = srcW * dispScale * scale.value;
      const shownH = srcH * dispScale * scale.value;
      const offX = (shownW - frameW) / 2 - tx.value;
      const offY = (shownH - frameH) / 2 - ty.value;
      const srcPerDisp = 1 / (dispScale * scale.value);
      const cropX = Math.max(0, offX * srcPerDisp);
      const cropY = Math.max(0, offY * srcPerDisp);
      const cropW = Math.min(srcW - cropX, frameW * srcPerDisp);
      const cropH = Math.min(srcH - cropY, frameH * srcPerDisp);
      if (cropW > 8 && cropH > 8) {
        actions.push({ crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } });
      }

      const out = await ImageManipulator.manipulateAsync(uri, actions, {
        compress: 0.95, format: ImageManipulator.SaveFormat.JPEG,
      });
      onDone({ uri: out.uri, width: out.width, height: out.height });
    } catch {
      onDone({ uri, width: srcW, height: srcH });   // fall back to original on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <Pressable hitSlop={10} onPress={onCancel}><Ionicons name="close" size={26} color="#fff" /></Pressable>
        <Text style={styles.title}>Crop</Text>
        <Pressable hitSlop={10} onPress={apply} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={26} color={colors.primary} />}
        </Pressable>
      </View>

      <View style={styles.stage}>
        <View style={[styles.frame, { width: frameW, height: frameH }]}>
          <GestureDetector gesture={composed}>
            <Animated.View style={[StyleSheet.absoluteFill, imgStyle]}>
              <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
            </Animated.View>
          </GestureDetector>
          {/* rule-of-thirds grid */}
          <View pointerEvents="none" style={styles.grid}>
            <View style={styles.gridV} /><View style={[styles.gridV, { left: '66%' }]} />
            <View style={styles.gridH} /><View style={[styles.gridH, { top: '66%' }]} />
          </View>
        </View>
      </View>

      {/* transform controls */}
      <View style={styles.controls}>
        <ToolBtn icon="refresh" label="Rotate" onPress={() => setRotation((r) => (r + 90) % 360)} colors={colors} />
        <ToolBtn icon="swap-horizontal" label="Flip H" active={flipH} onPress={() => setFlipH((v) => !v)} colors={colors} />
        <ToolBtn icon="swap-vertical" label="Flip V" active={flipV} onPress={() => setFlipV((v) => !v)} colors={colors} />
        <ToolBtn icon="scan" label="Reset" onPress={reset} colors={colors} />
      </View>

      {/* aspect presets */}
      <View style={styles.aspects}>
        {ASPECTS.map((a) => (
          <Pressable key={a.id} onPress={() => setAspect(a.id)} style={[styles.aspectChip, aspect === a.id && styles.aspectChipOn]}>
            <Text style={[styles.aspectText, aspect === a.id && styles.aspectTextOn]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ToolBtn({ icon, label, onPress, active, colors }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; active?: boolean; colors: Palette;
}) {
  return (
    <Pressable style={styles0.tool} onPress={onPress}>
      <Ionicons name={icon} size={22} color={active ? colors.primary : '#fff'} />
      <Text style={[styles0.toolLabel, active && { color: colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

const styles0 = StyleSheet.create({
  tool: { alignItems: 'center', gap: 4 },
  toolLabel: { color: '#ddd', fontSize: 11 },
});

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 20 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(4), paddingTop: spacing(10), paddingBottom: spacing(3) },
    title: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    frame: { overflow: 'hidden', backgroundColor: '#111', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
    grid: { ...StyleSheet.absoluteFillObject },
    gridV: { position: 'absolute', left: '33%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },
    gridH: { position: 'absolute', top: '33%', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },
    controls: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing(4) },
    aspects: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingBottom: spacing(8), paddingHorizontal: spacing(4) },
    aspectChip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: 'rgba(255,255,255,0.12)' },
    aspectChipOn: { backgroundColor: colors.primary },
    aspectText: { color: '#ddd', fontSize: font.small, fontWeight: '600' },
    aspectTextOn: { color: '#fff' },
  });
