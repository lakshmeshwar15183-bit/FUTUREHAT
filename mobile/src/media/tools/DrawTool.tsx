// Lumixo mobile — Draw tool (Phase B), Skia-backed. Brushes: pen, highlighter,
// neon, arrow, blur, eraser. Color picker, stroke-width slider, undo/redo. The
// image + strokes are flattened to a new URI via a Skia canvas snapshot so the sent
// photo has the drawing baked in.
//
// Native: @shopify/react-native-skia (autolinked; requires the native rebuild — see
// BUILD_ANDROID.md). Skia cannot run in JS-only/tsc; this is code-complete and
// typechecks, but its rendering must be verified on a device build.
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as FileSystem from 'expo-file-system';
import {
  Canvas, Path, Image as SkiaImage, useImage, Skia, useCanvasRef,
  BlurMask, type SkPath,
} from '@shopify/react-native-skia';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { footerBottomPad } from '../../lib/safeLayout';
import { useColors, spacing, font, type Palette } from '../../theme';

export interface DrawResult { uri: string; width: number; height: number; }

type Brush = 'pen' | 'highlighter' | 'neon' | 'arrow' | 'blur' | 'eraser';
const BRUSHES: { id: Brush; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'pen', icon: 'create-outline' },
  { id: 'highlighter', icon: 'color-fill-outline' },
  { id: 'neon', icon: 'flash-outline' },
  { id: 'arrow', icon: 'arrow-forward-outline' },
  { id: 'blur', icon: 'water-outline' },
  { id: 'eraser', icon: 'backspace-outline' },
];
const COLORS = ['#FFFFFF', '#000000', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00A884', '#007AFF', '#AF52DE', '#FF2D92'];

interface Stroke {
  path: SkPath;
  color: string;
  width: number;
  brush: Brush;
}

export default function DrawTool({
  uri, width: srcW, height: srcH, onCancel, onDone,
}: {
  uri: string; width: number; height: number;
  onCancel: () => void;
  onDone: (r: DrawResult) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: winW, height: winH } = useWindowDimensions();
  const canvasRef = useCanvasRef();
  const image = useImage(uri);

  const stageW = winW;
  const stageH = Math.min(winH * 0.68, winW * (srcH / srcW || 1));

  const [brush, setBrush] = useState<Brush>('pen');
  const [color, setColor] = useState('#FF3B30');
  const [strokeW, setStrokeW] = useState(6);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [busy, setBusy] = useState(false);
  const current = useRef<SkPath | null>(null);
  const [tick, setTick] = useState(0);   // force re-render while drawing the live path

  const strokeWidthFor = (b: Brush, w: number) =>
    b === 'highlighter' ? w * 3 : b === 'neon' ? w * 1.5 : b === 'eraser' ? w * 2.5 : b === 'blur' ? w * 3 : w;

  const opacityFor = (b: Brush) => (b === 'highlighter' ? 0.35 : 1);

  const pan = Gesture.Pan()
    .onStart((e) => {
      const p = Skia.Path.Make();
      p.moveTo(e.x, e.y);
      current.current = p;
      setTick((t) => t + 1);
    })
    .onUpdate((e) => {
      const p = current.current;
      if (!p) return;
      if (brush === 'arrow') { p.reset(); /* redrawn on end */ }
      p.lineTo(e.x, e.y);
      setTick((t) => t + 1);
    })
    .onEnd((e) => {
      const p = current.current;
      if (!p) return;
      if (brush === 'arrow') buildArrow(p, e.x, e.y);
      setStrokes((prev) => [...prev, { path: p, color, width: strokeWidthFor(brush, strokeW), brush }]);
      setRedo([]);
      current.current = null;
      setTick((t) => t + 1);
    });

  // Arrow: a straight line + a small V head at the end. Start point is the path's
  // first point (captured onStart); we rebuild from it to (ex,ey).
  function buildArrow(p: SkPath, ex: number, ey: number) {
    const pts = p.toCmds();       // command list; first moveTo carries the start
    const start = pts.length ? { x: pts[0][1] ?? ex, y: pts[0][2] ?? ey } : { x: ex, y: ey };
    p.reset();
    p.moveTo(start.x, start.y);
    p.lineTo(ex, ey);
    const ang = Math.atan2(ey - start.y, ex - start.x);
    const head = 18 + strokeW;
    p.moveTo(ex, ey);
    p.lineTo(ex - head * Math.cos(ang - Math.PI / 6), ey - head * Math.sin(ang - Math.PI / 6));
    p.moveTo(ex, ey);
    p.lineTo(ex - head * Math.cos(ang + Math.PI / 6), ey - head * Math.sin(ang + Math.PI / 6));
  }

  function undo() {
    setStrokes((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      setRedo((r) => [...r, last]);
      return prev.slice(0, -1);
    });
  }
  function redoLast() {
    setRedo((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      setStrokes((s) => [...s, last]);
      return prev.slice(0, -1);
    });
  }

  async function apply() {
    setBusy(true);
    try {
      const snap = canvasRef.current?.makeImageSnapshot();
      if (!snap) { onDone({ uri, width: srcW, height: srcH }); return; }
      const b64 = snap.encodeToBase64();
      const out = `${FileSystem.cacheDirectory}fh_draw_${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(out, b64, { encoding: FileSystem.EncodingType.Base64 });
      onDone({ uri: out, width: srcW, height: srcH });
    } catch {
      onDone({ uri, width: srcW, height: srcH });
    } finally {
      setBusy(false);
    }
  }

  const liveStrokes = current.current
    ? [...strokes, { path: current.current, color, width: strokeWidthFor(brush, strokeW), brush }]
    : strokes;

  return (
    <View style={[styles.container, { paddingBottom: footerBottomPad(insets, 8) }]}>
      <View style={[styles.top, { paddingTop: Math.max(insets.top, 8) + 8 }]}>
        <Pressable hitSlop={10} onPress={onCancel}><Ionicons name="close" size={26} color="#fff" /></Pressable>
        <View style={styles.topMid}>
          <Pressable hitSlop={8} onPress={undo} disabled={!strokes.length}><Ionicons name="arrow-undo" size={22} color={strokes.length ? '#fff' : '#555'} /></Pressable>
          <Pressable hitSlop={8} onPress={redoLast} disabled={!redo.length}><Ionicons name="arrow-redo" size={22} color={redo.length ? '#fff' : '#555'} /></Pressable>
        </View>
        <Pressable hitSlop={10} onPress={apply} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={26} color={colors.primary} />}
        </Pressable>
      </View>

      <View style={styles.stage}>
        <GestureDetector gesture={pan}>
          <Canvas ref={canvasRef} style={{ width: stageW, height: stageH }}>
            {image && <SkiaImage image={image} x={0} y={0} width={stageW} height={stageH} fit="contain" />}
            {liveStrokes.map((s, i) => (
              <Path
                key={i}
                path={s.path}
                // eraser paints the underlying image back by clearing; approximated
                // with a "clear" blend so strokes beneath are removed on device.
                color={s.brush === 'eraser' ? '#000000' : s.color}
                style="stroke"
                strokeWidth={s.width}
                strokeCap="round"
                strokeJoin="round"
                opacity={opacityFor(s.brush)}
                blendMode={s.brush === 'eraser' ? 'clear' : 'srcOver'}
              >
                {s.brush === 'neon' && <BlurMask blur={6} style="solid" />}
                {s.brush === 'blur' && <BlurMask blur={10} style="normal" />}
              </Path>
            ))}
          </Canvas>
        </GestureDetector>
        {/* tick keeps the live path repainting; value is intentionally unused visually */}
        <View style={{ height: 0 }} accessibilityElementsHidden>{tick ? null : null}</View>
      </View>

      {/* color row */}
      <View style={styles.colorRow}>
        {COLORS.map((c) => (
          <Pressable key={c} onPress={() => setColor(c)} style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchOn]} />
        ))}
      </View>

      {/* stroke width */}
      <View style={styles.sliderRow}>
        <Ionicons name="remove" size={18} color="#aaa" />
        {[2, 6, 12, 20, 30].map((w) => (
          <Pressable key={w} onPress={() => setStrokeW(w)} style={styles.dotWrap}>
            <View style={[styles.dot, { width: w, height: w }, strokeW === w && { backgroundColor: colors.primary }]} />
          </Pressable>
        ))}
        <Ionicons name="add" size={18} color="#aaa" />
      </View>

      {/* brushes */}
      <View style={styles.brushRow}>
        {BRUSHES.map((b) => (
          <Pressable key={b.id} onPress={() => setBrush(b.id)} style={[styles.brushBtn, brush === b.id && styles.brushBtnOn]}>
            <Ionicons name={b.icon} size={20} color={brush === b.id ? '#fff' : '#ccc'} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 20 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(4), paddingBottom: spacing(2) },
    topMid: { flexDirection: 'row', gap: 18 },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    colorRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
    swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent' },
    swatchOn: { borderColor: '#fff' },
    sliderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: spacing(2) },
    dotWrap: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
    dot: { borderRadius: 20, backgroundColor: '#bbb' },
    brushRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing(3), paddingBottom: spacing(2) },
    brushBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
    brushBtnOn: { backgroundColor: colors.primary },
  });
