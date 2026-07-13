// Lumixo mobile — media preview & editor shell. Opens after picking; the user
// reviews each attachment, adds a caption, picks quality (Standard/HD/Original)
// with a live size estimate (and real JPEG resize for images), optionally enables
// View Once, then Sends. Image tools: crop/rotate/flip, draw (incl. blur + undo),
// text, stickers. Video trim/mute is preview-intent only until a native transcoder
// is added (metadata is recorded; original file is uploaded).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { ResizeMode, Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { footerBottomPad } from '../lib/safeLayout';

import { useColors, spacing, radius, font, type Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import type { PickedAsset } from './MediaPickerScreen';
import { submitMedia, type OutgoingMedia } from '../media/mediaSendBridge';
import { estimateBytes, formatBytes, type Quality } from '../media/qualityEstimate';
import CropTool from '../media/tools/CropTool';
import DrawTool from '../media/tools/DrawTool';
import OverlayEditor, { type OverlayResult } from '../media/tools/OverlayEditor';
import VideoEditor, { type VideoEditResult } from '../media/tools/VideoEditor';
import { flattenOverlays } from '../media/tools/mediaFlatten';
import type { Overlay } from '../media/tools/overlays';
import { prepareImageForSend } from '../media/prepareImage';
import PreviewImage from '../media/PreviewImage';
import { resolvePickedUri } from '../media/resolveLocalMedia';
import type { MediaMeta } from '../lib/shared';
import { Alert } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList, 'MediaPreview'>;
type R = RouteProp<RootStackParamList, 'MediaPreview'>;

const VIEWONCE_ACK = 'fh:viewonce:ack:v1';

// Per-asset edit state kept while the user flips between attachments.
interface EditState {
  caption: string;
  quality: Quality;
  viewOnce: boolean;
  /** Working image URI after crop/draw (baked); undefined = use the original. */
  editedUri?: string;
  editedW?: number;
  editedH?: number;
  /** Text/sticker overlays flattened at send time. */
  overlays?: Overlay[];
  overlayStage?: { w: number; h: number };
  edited?: boolean;
  /** Video edit intent (Phase C). */
  video?: VideoEditResult;
}

type ActiveTool = null | 'crop' | 'draw' | 'text' | 'sticker' | 'video';

export default function MediaPreviewScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { conversationId, assets, startIndex = 0 } = route.params;
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width, height: winH } = useWindowDimensions();

  // Local working copy of assets so we can re-resolve URIs if still content://.
  const [workAssets, setWorkAssets] = useState<PickedAsset[]>(() => assets);
  const [index, setIndex] = useState(startIndex);
  const [edits, setEdits] = useState<EditState[]>(
    () => assets.map(() => ({ caption: '', quality: 'standard' as Quality, viewOnce: false })),
  );
  const [sending, setSending] = useState(false);
  const [showVO, setShowVO] = useState(false);   // View-Once onboarding dialog
  const [tool, setTool] = useState<ActiveTool>(null);
  const pagerRef = useRef<FlatList<PickedAsset>>(null);
  // Measured pager height — critical: Image height:'100%' needs a real parent height
  // (horizontal FlatList items otherwise collapse → pure black canvas).
  const [pagerH, setPagerH] = useState(0);

  // Safety net: if picker handed us content:// / opaque URIs, materialize here too.
  useEffect(() => {
    let alive = true;
    (async () => {
      const next = await Promise.all(
        assets.map(async (a) => {
          if (a.uri.startsWith('file://') || a.uri.startsWith('data:')) return a;
          try {
            const r = await resolvePickedUri(a.uri, {
              id: a.id,
              fileName: a.fileName,
              mediaType: a.type,
              width: a.width,
              height: a.height,
            });
            return {
              ...a,
              uri: r.uri,
              width: r.width || a.width,
              height: r.height || a.height,
            };
          } catch {
            return a;
          }
        }),
      );
      if (alive) setWorkAssets(next);
    })();
    return () => {
      alive = false;
    };
  }, [assets]);

  const cur = workAssets[index] ?? workAssets[0];
  const curEdit = edits[index] ?? edits[0];
  // Current working image for the active asset (edited if crop/draw applied).
  const curUri = curEdit?.editedUri ?? cur?.uri ?? '';
  const curW = curEdit?.editedW ?? cur?.width ?? 0;
  const curH = curEdit?.editedH ?? cur?.height ?? 0;
  const isVideo = cur?.type === 'video';

  function patch(p: Partial<EditState>) {
    setEdits((prev) => prev.map((e, i) => (i === index ? { ...e, ...p } : e)));
  }

  const estBytes = useMemo(() => {
    if (!cur || !curEdit) return 0;
    return estimateBytes(
      {
        width: cur.width,
        height: cur.height,
        type: cur.type,
        durationMs: cur.durationMs,
        originalBytes: cur.fileSize,
      },
      curEdit.quality,
    );
  }, [cur, curEdit]);

  // ── View Once toggle (with one-time onboarding) ─────────────────────────────
  async function toggleViewOnce() {
    if (!curEdit.viewOnce) {
      const ack = await AsyncStorage.getItem(VIEWONCE_ACK).catch(() => null);
      if (!ack) { setShowVO(true); return; }   // show onboarding first time
    }
    patch({ viewOnce: !curEdit.viewOnce });
  }
  async function ackViewOnce() {
    await AsyncStorage.setItem(VIEWONCE_ACK, '1').catch(() => {});
    setShowVO(false);
    patch({ viewOnce: true });
  }

  // ── Download the current asset to the gallery ───────────────────────────────
  async function download() {
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) return;
      await MediaLibrary.saveToLibraryAsync(cur.uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Saved', 'Saved to your gallery.');
    } catch {
      Alert.alert('Could not save', 'The file could not be saved to your gallery.');
    }
  }

  // ── Send everything ─────────────────────────────────────────────────────────
  async function send() {
    if (sending) return;
    setSending(true);
    try {
      const items: OutgoingMedia[] = [];
      for (let i = 0; i < workAssets.length; i++) {
        const a = workAssets[i];
        const e = edits[i];
        if (!a || !e) continue;
        let uri = e.editedUri ?? a.uri;
        let w = e.editedW ?? a.width;
        let h = e.editedH ?? a.height;
        const q = e.video?.quality ?? e.quality;

        // Bake text/sticker overlays into the image (images only).
        if (a.type !== 'video' && e.overlays && e.overlays.length && e.overlayStage) {
          // eslint-disable-next-line no-await-in-loop
          uri = await flattenOverlays(uri, e.overlays, e.overlayStage.w, e.overlayStage.h, w, h);
        }

        // Real quality tier: resize + JPEG compress before upload (not estimate-only).
        if (a.type === 'image') {
          // eslint-disable-next-line no-await-in-loop
          const prepared = await prepareImageForSend(uri, w, h, q);
          uri = prepared.uri;
          w = prepared.width;
          h = prepared.height;
        }

        // Prefer .jpg after JPEG bake so MIME guess is correct.
        let fileName = a.fileName;
        if (a.type === 'image' && q !== 'original' && !/\.jpe?g$/i.test(fileName)) {
          fileName = fileName.replace(/\.[^.]+$/, '') + '.jpg';
        }

        const meta: MediaMeta = {
          quality: q,
          hd: q !== 'standard',
          viewOnce: e.viewOnce || undefined,
          width: w,
          height: h,
          durationMs: a.durationMs,
          edited: e.edited || (e.video ? true : undefined),
          // Video trim/mute intent (native transcoder not shipped — metadata only).
          trimStartMs: e.video && e.video.startMs > 0 ? e.video.startMs : undefined,
          trimEndMs: e.video && a.durationMs && e.video.endMs < a.durationMs ? e.video.endMs : undefined,
          muted: e.video?.muted || undefined,
        };
        items.push({
          uri,
          fileName,
          type: a.type === 'video' ? 'video' : 'image',
          caption: e.caption || undefined,
          mediaMeta: meta,
        });
      }
      const ok = submitMedia({ conversationId, items });
      if (!ok) {
        Alert.alert('Could not send', 'Please reopen the chat and try again.');
        return;
      }
      // Pop preview + picker back to chat.
      const st = navigation.getState();
      const backCount = Math.min(2, st.routes.length - 1);
      if (backCount >= 2) navigation.pop(2);
      else navigation.goBack();
    } finally {
      setSending(false);
    }
  }

  // Editor tools are for images only (video editing is the VideoEditor / Phase C).
  const tools: { icon: keyof typeof Ionicons.glyphMap; label: string; enabled: boolean; onPress?: () => void }[] = [
    { icon: 'crop-outline', label: 'Crop', enabled: !isVideo, onPress: () => setTool('crop') },
    { icon: 'happy-outline', label: 'Sticker', enabled: !isVideo, onPress: () => setTool('sticker') },
    { icon: 'text-outline', label: 'Text', enabled: !isVideo, onPress: () => setTool('text') },
    { icon: 'brush-outline', label: 'Draw', enabled: !isVideo, onPress: () => setTool('draw') },
  ];

  // Apply a crop/draw result: replaces the working image for this asset.
  function applyImageEdit(uri: string, w: number, h: number) {
    patch({ editedUri: uri, editedW: w, editedH: h, edited: true });
    setTool(null);
  }
  // Apply overlay (text/sticker) result: stored, flattened at send.
  function applyOverlays(r: OverlayResult) {
    patch({ overlays: r.overlays, overlayStage: { w: r.stageW, h: r.stageH }, edited: r.overlays.length > 0 || curEdit.edited });
    setTool(null);
  }

  // Prefer measured pager height; fall back so first paint is still non-zero.
  const pageH = pagerH > 0 ? pagerH : Math.max(240, winH * 0.55);

  if (!cur || !curEdit) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' },
        ]}
      >
        <ActivityIndicator color="#fff" />
        <Text style={{ color: '#fff', marginTop: 12 }}>Loading media…</Text>
      </View>
    );
  }

  const renderPage = ({ item, index: i }: { item: PickedAsset; index: number }) => {
    const shownUri = edits[i]?.editedUri ?? item.uri; // reflect crop/draw edits
    return (
      <View style={{ width, height: pageH, backgroundColor: '#000' }}>
        {item.type === 'video' ? (
          <Video
            source={{ uri: item.uri }}
            style={styles.media}
            resizeMode={ResizeMode.CONTAIN}
            useNativeControls
            shouldPlay={false}
            isLooping
          />
        ) : (
          <PreviewImage
            uri={shownUri}
            width={edits[i]?.editedW ?? item.width}
            height={edits[i]?.editedH ?? item.height}
            style={styles.media}
            zoomable={tool === null}
          />
        )}
        {edits[i]?.overlays && edits[i].overlays!.length > 0 && (
          <View style={styles.editBadge}>
            <Ionicons name="layers" size={12} color="#fff" />
            <Text style={styles.editBadgeText}>{edits[i].overlays!.length}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable hitSlop={10} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <View style={styles.topRight}>
          <TopIcon name="download-outline" onPress={download} />
          <Pressable style={[styles.hdChip, curEdit.quality !== 'standard' && styles.hdChipOn]} onPress={() => patch({ quality: curEdit.quality === 'standard' ? 'hd' : 'standard' })}>
            <Text style={[styles.hdText, curEdit.quality !== 'standard' && styles.hdTextOn]}>HD</Text>
          </Pressable>
          {isVideo ? (
            <TopIcon name="cut-outline" onPress={() => setTool('video')} />
          ) : (
            tools.map((t) => (
              <TopIcon key={t.label} name={t.icon} disabled={!t.enabled}
                onPress={t.enabled ? t.onPress : undefined} />
            ))
          )}
        </View>
      </View>

      {/* Pager — onLayout gives items a real height so images fill the canvas */}
      <View
        style={{ flex: 1, backgroundColor: '#000' }}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h > 0 && h !== pagerH) setPagerH(h);
        }}
      >
        <FlatList
          ref={pagerRef}
          data={workAssets}
          keyExtractor={(a) => a.id}
          renderItem={renderPage}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={Math.min(startIndex, Math.max(0, workAssets.length - 1))}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) =>
            setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))
          }
          style={{ flex: 1 }}
          // Avoid blank first frame when initialScrollIndex is set.
          initialNumToRender={Math.min(3, workAssets.length)}
          windowSize={3}
          removeClippedSubviews={false}
        />
      </View>

      {/* Quality + size line */}
      <View style={styles.qualityRow}>
        {(['standard', 'hd', 'original'] as Quality[]).map((q) => (
          <Pressable key={q} onPress={() => patch({ quality: q })} style={[styles.qChip, curEdit.quality === q && styles.qChipOn]}>
            <Text style={[styles.qText, curEdit.quality === q && styles.qTextOn]}>{q === 'hd' ? 'HD' : q[0].toUpperCase() + q.slice(1)}</Text>
          </Pressable>
        ))}
        <Text style={styles.estText}>~{formatBytes(estBytes)}</Text>
      </View>

      {/* Thumbnail strip (multi-asset) */}
      {workAssets.length > 1 && (
        <FlatList
          data={workAssets}
          keyExtractor={(a) => 'strip_' + a.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing(3), gap: 6 }}
          style={styles.strip}
          renderItem={({ item, index: i }) => (
            <Pressable
              onPress={() => {
                setIndex(i);
                pagerRef.current?.scrollToIndex({ index: i, animated: true });
              }}
            >
              <Image
                source={{ uri: edits[i]?.editedUri ?? item.uri }}
                style={[styles.stripThumb, i === index && styles.stripThumbOn]}
                contentFit="cover"
              />
            </Pressable>
          )}
        />
      )}

      {/* Caption + send */}
      <View style={[styles.bottomBar, { paddingBottom: footerBottomPad(insets, 8) }]}>
        <View style={styles.captionWrap}>
          <TextInput
            style={styles.caption}
            placeholder="Add a caption…"
            placeholderTextColor={colors.textFaint}
            value={curEdit.caption}
            onChangeText={(t) => patch({ caption: t })}
            multiline
            maxLength={1024}
          />
          {curEdit.caption.length > 0 && <Text style={styles.counter}>{curEdit.caption.length}/1024</Text>}
        </View>
        {/* View Once control replaces nothing — it toggles a mode; Send stays. */}
        <Pressable style={[styles.voBtn, curEdit.viewOnce && styles.voBtnOn]} onPress={toggleViewOnce} hitSlop={6}>
          <Ionicons name={curEdit.viewOnce ? 'eye' : 'eye-outline'} size={20} color={curEdit.viewOnce ? '#1a1a1a' : '#fff'} />
        </Pressable>
        <Pressable style={styles.sendBtn} onPress={send} disabled={sending}>
          {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={20} color="#fff" />}
        </Pressable>
      </View>

      {/* View-Once onboarding (shown once) */}
      {showVO && (
        <View style={styles.voOverlay}>
          <View style={styles.voCard}>
            <Text style={styles.voEmoji}>👁️</Text>
            <Text style={styles.voTitle}>View Once</Text>
            <Text style={styles.voBody}>When enabled, this media:</Text>
            {['Can be opened only once', 'Cannot be forwarded', 'Cannot be saved or exported', 'Screenshot protection where supported'].map((l) => (
              <View key={l} style={styles.voLine}><Ionicons name="checkmark-circle" size={16} color={colors.primary} /><Text style={styles.voLineText}>{l}</Text></View>
            ))}
            <View style={styles.voActions}>
              <Pressable style={styles.voCancel} onPress={() => setShowVO(false)}><Text style={styles.voCancelText}>Not now</Text></Pressable>
              <Pressable style={styles.voOk} onPress={ackViewOnce}><Text style={styles.voOkText}>Enable View Once</Text></Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Editor tools (Phase B) — full-screen layers over the preview. Images only. */}
      {tool === 'crop' && (
        <CropTool uri={curUri} width={curW} height={curH}
          onCancel={() => setTool(null)}
          onDone={(r) => applyImageEdit(r.uri, r.width, r.height)} />
      )}
      {tool === 'draw' && (
        <DrawTool uri={curUri} width={curW} height={curH}
          onCancel={() => setTool(null)}
          onDone={(r) => applyImageEdit(r.uri, r.width, r.height)} />
      )}
      {(tool === 'text' || tool === 'sticker') && (
        <OverlayEditor uri={curUri} mode={tool} initial={curEdit.overlays}
          onCancel={() => setTool(null)}
          onDone={applyOverlays} />
      )}
      {tool === 'video' && (
        <VideoEditor uri={cur.uri} width={cur.width} height={cur.height} durationMs={cur.durationMs}
          onCancel={() => setTool(null)}
          onDone={(r) => { patch({ video: r }); setTool(null); }} />
      )}
    </View>
  );
}

function TopIcon({ name, onPress, disabled }: { name: keyof typeof Ionicons.glyphMap; onPress?: () => void; disabled?: boolean }) {
  return (
    <Pressable hitSlop={6} onPress={onPress} style={({ pressed }) => [{ padding: 6, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Ionicons name={name} size={22} color="#fff" />
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(4), height: 48 },
    topRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    hdChip: { borderWidth: 1.5, borderColor: '#fff', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginHorizontal: 4 },
    hdChipOn: { backgroundColor: '#F5C518', borderColor: '#F5C518' },
    hdText: { color: '#fff', fontSize: 12, fontWeight: '800' },
    hdTextOn: { color: '#1a1a1a' },
    media: { width: '100%', height: '100%', backgroundColor: '#000' },
    editBadge: { position: 'absolute', top: 10, left: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
    editBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    qualityRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
    qChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.12)' },
    qChipOn: { backgroundColor: colors.primary },
    qText: { color: '#ddd', fontSize: font.small, fontWeight: '600' },
    qTextOn: { color: '#fff' },
    estText: { marginLeft: 'auto', color: '#bbb', fontSize: font.small },
    strip: { maxHeight: 60, marginBottom: 4 },
    stripThumb: { width: 46, height: 46, borderRadius: 6, opacity: 0.5, backgroundColor: '#222' },
    stripThumbOn: { opacity: 1, borderWidth: 2, borderColor: colors.primary },
    bottomBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: spacing(3), paddingTop: 6, backgroundColor: 'rgba(0,0,0,0.4)' },
    captionWrap: { flex: 1, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
    caption: { color: '#fff', fontSize: font.body, maxHeight: 100 },
    counter: { color: '#999', fontSize: 10, alignSelf: 'flex-end' },
    voBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
    voBtnOn: { backgroundColor: '#F5C518' },
    sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    voOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: spacing(6) },
    voCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(6), width: '100%', maxWidth: 360 },
    voEmoji: { fontSize: 40, textAlign: 'center' },
    voTitle: { color: colors.text, fontSize: font.title, fontWeight: '800', textAlign: 'center', marginTop: spacing(2) },
    voBody: { color: colors.textMuted, fontSize: font.body, marginTop: spacing(3), marginBottom: spacing(2) },
    voLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    voLineText: { color: colors.text, fontSize: font.small, flex: 1 },
    voActions: { flexDirection: 'row', gap: 10, marginTop: spacing(5) },
    voCancel: { flex: 1, paddingVertical: spacing(3), borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
    voCancelText: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    voOk: { flex: 1.4, paddingVertical: spacing(3), borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
    voOkText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
  });
