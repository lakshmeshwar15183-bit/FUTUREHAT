// Lumixo mobile — Text & Sticker overlay editor (Phase B). Hosts draggable,
// pinch-scalable, rotatable text and sticker layers over the image. Text supports
// multiple fonts, bold/italic, alignment, background, opacity and multiple layers.
// Stickers come from emoji + the Lumixo sticker pack, with recently-used and
// favorites. On done it returns the image URI + the overlay list; the preview
// flattens them into the final photo via a Skia snapshot (see mediaFlatten.ts).
//
// This screen uses only gesture-handler + reanimated (already native-linked) for the
// gestures; the flatten step uses Skia. Code-complete + typechecks; on-device render
// needs the native rebuild.
import React, { useMemo, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useColors, spacing, radius, font, type Palette } from '../../theme';
import { STICKERS } from '../../lib/stickers';
import {
  type Overlay, type TextOverlay, type StickerOverlay, overlayId,
} from './overlays';

export interface OverlayResult { overlays: Overlay[]; stageW: number; stageH: number; }

const FONTS = [
  { id: 'system', label: 'Default', family: 'System' },
  { id: 'serif', label: 'Serif', family: 'serif' },
  { id: 'mono', label: 'Mono', family: 'monospace' },
];
const TEXT_COLORS = ['#FFFFFF', '#000000', '#FF3B30', '#FFCC00', '#34C759', '#00A884', '#007AFF', '#AF52DE'];
const EMOJIS = ['😀', '😂', '😍', '🥳', '😎', '🔥', '❤️', '👍', '🙏', '🎉', '💯', '✨', '😭', '🤔', '👀', '💀', '🥺', '😅', '🤩', '🫶'];
const RECENT_KEY = 'fh:sticker:recent:v1';
const FAV_KEY = 'fh:sticker:fav:v1';

export default function OverlayEditor({
  uri, mode, initial, onCancel, onDone,
}: {
  uri: string;
  mode: 'text' | 'sticker';
  initial?: Overlay[];
  onCancel: () => void;
  onDone: (r: OverlayResult) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: winW, height: winH } = useWindowDimensions();
  const stageW = winW;
  const stageH = winH * 0.72;

  const [overlays, setOverlays] = useState<Overlay[]>(initial ?? []);
  const [editingText, setEditingText] = useState<TextOverlay | null>(null);
  const [stickerOpen, setStickerOpen] = useState(mode === 'sticker');
  const [recent, setRecent] = useState<string[]>([]);
  const [favs, setFavs] = useState<string[]>([]);

  React.useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY).then((v) => v && setRecent(JSON.parse(v))).catch(() => {});
    AsyncStorage.getItem(FAV_KEY).then((v) => v && setFavs(JSON.parse(v))).catch(() => {});
    if (mode === 'text') addText();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addText() {
    const t: TextOverlay = {
      id: overlayId(), kind: 'text', x: stageW / 2, y: stageH / 2, scale: 1, rotation: 0, opacity: 1,
      text: '', color: '#FFFFFF', fontFamily: 'System', bold: true, italic: false, align: 'center', background: 'none',
    };
    setOverlays((o) => [...o, t]);
    setEditingText(t);
  }

  function addSticker(content: string, isEmoji: boolean) {
    const s: StickerOverlay = {
      id: overlayId(), kind: 'sticker', x: stageW / 2, y: stageH / 2, scale: 1, rotation: 0, opacity: 1,
      content, isEmoji,
    };
    setOverlays((o) => [...o, s]);
    setStickerOpen(false);
    const next = [content, ...recent.filter((r) => r !== content)].slice(0, 24);
    setRecent(next);
    AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
  }

  function toggleFav(content: string) {
    const next = favs.includes(content) ? favs.filter((f) => f !== content) : [content, ...favs].slice(0, 40);
    setFavs(next);
    AsyncStorage.setItem(FAV_KEY, JSON.stringify(next)).catch(() => {});
  }

  function updateOverlay(id: string, patch: Partial<Overlay>) {
    setOverlays((o) => o.map((v) => (v.id === id ? { ...v, ...patch } as Overlay : v)));
  }
  function removeOverlay(id: string) {
    setOverlays((o) => o.filter((v) => v.id !== id));
    setEditingText((t) => (t?.id === id ? null : t));
  }

  function commitTextEdit(text: string) {
    if (!editingText) return;
    if (!text.trim()) removeOverlay(editingText.id);
    else updateOverlay(editingText.id, { text });
    setEditingText(null);
  }

  function done() {
    // drop empty text layers
    const cleaned = overlays.filter((o) => o.kind !== 'text' || (o as TextOverlay).text.trim());
    onDone({ overlays: cleaned, stageW, stageH });
  }

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <Pressable hitSlop={10} onPress={onCancel}><Ionicons name="close" size={26} color="#fff" /></Pressable>
        <View style={styles.topMid}>
          <Pressable hitSlop={8} onPress={addText}><Ionicons name="text" size={22} color="#fff" /></Pressable>
          <Pressable hitSlop={8} onPress={() => setStickerOpen(true)}><Ionicons name="happy-outline" size={22} color="#fff" /></Pressable>
        </View>
        <Pressable hitSlop={10} onPress={done}><Ionicons name="checkmark" size={26} color={colors.primary} /></Pressable>
      </View>

      {/* Stage: image + draggable overlays */}
      <View style={[styles.stage, { width: stageW, height: stageH }]}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
        {overlays.map((o) => (
          <DraggableLayer key={o.id} overlay={o} onChange={(p) => updateOverlay(o.id, p)}
            onEditText={o.kind === 'text' ? () => setEditingText(o as TextOverlay) : undefined}
            onRemove={() => removeOverlay(o.id)} colors={colors} />
        ))}
      </View>

      {/* Text style bar — visible while a text layer is selected/being edited */}
      {editingText && (
        <TextStyleBar overlay={editingText}
          onChange={(p) => { updateOverlay(editingText.id, p); setEditingText({ ...editingText, ...p } as TextOverlay); }}
          colors={colors} styles={styles} />
      )}

      {/* Text input overlay */}
      {editingText && (
        <View style={styles.textInputWrap}>
          <TextInput
            style={[styles.textInput, {
              color: editingText.color, fontFamily: editingText.fontFamily,
              fontWeight: editingText.bold ? '800' : '400', fontStyle: editingText.italic ? 'italic' : 'normal',
              textAlign: editingText.align,
            }]}
            defaultValue={editingText.text}
            placeholder="Type…"
            placeholderTextColor="rgba(255,255,255,0.5)"
            autoFocus multiline
            onBlur={(e) => commitTextEdit(e.nativeEvent.text)}
            onSubmitEditing={(e) => commitTextEdit(e.nativeEvent.text)}
          />
        </View>
      )}

      {/* Sticker / emoji picker */}
      <Modal visible={stickerOpen} transparent animationType="slide" onRequestClose={() => setStickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setStickerOpen(false)}>
          <View style={styles.stickerSheet}>
            <ScrollView>
              {favs.length > 0 && (
                <>
                  <Text style={styles.stickHead}>Favorites</Text>
                  <View style={styles.stickGrid}>
                    {favs.map((c) => <StickerCell key={'f' + c} content={c} onPick={() => addSticker(c, isEmojiContent(c))} onFav={() => toggleFav(c)} faved colors={colors} />)}
                  </View>
                </>
              )}
              {recent.length > 0 && (
                <>
                  <Text style={styles.stickHead}>Recent</Text>
                  <View style={styles.stickGrid}>
                    {recent.map((c) => <StickerCell key={'r' + c} content={c} onPick={() => addSticker(c, isEmojiContent(c))} onFav={() => toggleFav(c)} faved={favs.includes(c)} colors={colors} />)}
                  </View>
                </>
              )}
              <Text style={styles.stickHead}>Emoji</Text>
              <View style={styles.stickGrid}>
                {EMOJIS.map((e) => <StickerCell key={e} content={e} onPick={() => addSticker(e, true)} onFav={() => toggleFav(e)} faved={favs.includes(e)} colors={colors} />)}
              </View>
              <Text style={styles.stickHead}>Lumixo stickers</Text>
              <View style={styles.stickGrid}>
                {STICKERS.map((s) => <StickerCell key={s.id} content={s.url} emoji={s.emoji} onPick={() => addSticker(s.url, false)} onFav={() => toggleFav(s.url)} faved={favs.includes(s.url)} colors={colors} />)}
              </View>
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function isEmojiContent(c: string): boolean { return !c.startsWith('data:') && !c.startsWith('http'); }

// A single draggable/scalable/rotatable overlay.
function DraggableLayer({ overlay, onChange, onEditText, onRemove, colors }: {
  overlay: Overlay;
  onChange: (p: Partial<Overlay>) => void;
  onEditText?: () => void;
  onRemove: () => void;
  colors: Palette;
}) {
  const tx = useSharedValue(overlay.x);
  const ty = useSharedValue(overlay.y);
  const sc = useSharedValue(overlay.scale);
  const rot = useSharedValue(overlay.rotation);
  const startX = useSharedValue(0), startY = useSharedValue(0), startSc = useSharedValue(1), startRot = useSharedValue(0);

  const pan = Gesture.Pan()
    .onStart(() => { startX.value = tx.value; startY.value = ty.value; })
    .onUpdate((e) => { tx.value = startX.value + e.translationX; ty.value = startY.value + e.translationY; })
    .onEnd(() => onChange({ x: tx.value, y: ty.value }));
  const pinch = Gesture.Pinch()
    .onStart(() => { startSc.value = sc.value; })
    .onUpdate((e) => { sc.value = Math.max(0.3, Math.min(6, startSc.value * e.scale)); })
    .onEnd(() => onChange({ scale: sc.value }));
  const rotate = Gesture.Rotation()
    .onStart(() => { startRot.value = rot.value; })
    .onUpdate((e) => { rot.value = startRot.value + e.rotation; })
    .onEnd(() => onChange({ rotation: rot.value }));
  const g = Gesture.Simultaneous(pan, Gesture.Simultaneous(pinch, rotate));

  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    left: tx.value, top: ty.value,
    transform: [{ translateX: -60 }, { translateY: -30 }, { scale: sc.value }, { rotate: `${rot.value}rad` }],
    opacity: overlay.opacity,
  }));

  return (
    <GestureDetector gesture={g}>
      <Animated.View style={style}>
        <Pressable onPress={onEditText} onLongPress={onRemove} delayLongPress={350}>
          {overlay.kind === 'text' ? (
            <View style={bgStyle(overlay)}>
              <Text style={{
                color: overlay.color, fontFamily: overlay.fontFamily, fontSize: 30,
                fontWeight: overlay.bold ? '800' : '400', fontStyle: overlay.italic ? 'italic' : 'normal',
                textAlign: overlay.align, minWidth: 40, paddingHorizontal: 6,
              }}>{overlay.text || ' '}</Text>
            </View>
          ) : overlay.isEmoji ? (
            <Text style={{ fontSize: 60 }}>{overlay.content}</Text>
          ) : (
            <Image source={{ uri: overlay.content }} style={{ width: 90, height: 90 }} contentFit="contain" />
          )}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

function bgStyle(o: TextOverlay) {
  if (o.background === 'none') return undefined;
  return { backgroundColor: o.background === 'solid' ? o.color === '#FFFFFF' ? '#000' : o.color : 'rgba(0,0,0,0.4)', borderRadius: 8, paddingVertical: 2 };
}

function TextStyleBar({ overlay, onChange, colors, styles }: {
  overlay: TextOverlay; onChange: (p: Partial<TextOverlay>) => void; colors: Palette; styles: any;
}) {
  return (
    <View style={styles.styleBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 10, paddingHorizontal: spacing(4) }}>
        <Pressable onPress={() => onChange({ bold: !overlay.bold })}><Text style={[styles.sbBtn, overlay.bold && styles.sbOn]}>B</Text></Pressable>
        <Pressable onPress={() => onChange({ italic: !overlay.italic })}><Text style={[styles.sbBtn, { fontStyle: 'italic' }, overlay.italic && styles.sbOn]}>i</Text></Pressable>
        <Pressable onPress={() => onChange({ align: overlay.align === 'left' ? 'center' : overlay.align === 'center' ? 'right' : 'left' })}>
          <Ionicons name={overlay.align === 'left' ? 'menu-outline' : overlay.align === 'right' ? 'reorder-three-outline' : 'reorder-two-outline'} size={20} color="#fff" />
        </Pressable>
        <Pressable onPress={() => onChange({ background: overlay.background === 'none' ? 'translucent' : overlay.background === 'translucent' ? 'solid' : 'none' })}>
          <Ionicons name="albums-outline" size={18} color={overlay.background !== 'none' ? colors.primary : '#fff'} />
        </Pressable>
        {FONTS.map((f) => (
          <Pressable key={f.id} onPress={() => onChange({ fontFamily: f.family })}><Text style={[styles.sbFont, overlay.fontFamily === f.family && styles.sbOn]}>{f.label}</Text></Pressable>
        ))}
        {TEXT_COLORS.map((c) => (
          <Pressable key={c} onPress={() => onChange({ color: c })}><View style={[styles.sbSwatch, { backgroundColor: c }, overlay.color === c && styles.sbSwatchOn]} /></Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function StickerCell({ content, emoji, onPick, onFav, faved, colors }: {
  content: string; emoji?: string; onPick: () => void; onFav: () => void; faved?: boolean; colors: Palette;
}) {
  const isImg = content.startsWith('data:') || content.startsWith('http');
  return (
    <Pressable style={stickStyles.cell} onPress={onPick} onLongPress={onFav} delayLongPress={300}>
      {isImg ? <Image source={{ uri: content }} style={{ width: 40, height: 40 }} contentFit="contain" /> : <Text style={{ fontSize: 30 }}>{content}</Text>}
      {faved && <Ionicons name="star" size={10} color="#F5C518" style={{ position: 'absolute', top: 2, right: 2 }} />}
    </Pressable>
  );
}

const stickStyles = StyleSheet.create({
  cell: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
});

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 20 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(4), paddingTop: spacing(10), paddingBottom: spacing(2) },
    topMid: { flexDirection: 'row', gap: 20 },
    stage: { alignSelf: 'center', overflow: 'hidden' },
    styleBar: { position: 'absolute', bottom: 120, left: 0, right: 0, height: 44, justifyContent: 'center' },
    sbBtn: { color: '#fff', fontSize: 20, fontWeight: '800', width: 28, textAlign: 'center' },
    sbOn: { color: colors.primary },
    sbFont: { color: '#fff', fontSize: font.small, paddingHorizontal: 6 },
    sbSwatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
    sbSwatchOn: { borderColor: '#fff' },
    textInputWrap: { position: 'absolute', top: '35%', left: spacing(6), right: spacing(6) },
    textInput: { fontSize: 30, minHeight: 44 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    stickerSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing(3), maxHeight: '65%' },
    stickHead: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: spacing(4), paddingTop: spacing(3), paddingBottom: spacing(1) },
    stickGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing(3) },
  });
