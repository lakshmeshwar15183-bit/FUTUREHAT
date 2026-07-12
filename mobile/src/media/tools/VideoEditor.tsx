// Lumixo mobile — Video editor (Phase C). Trim (in/out handles over a thumbnail
// filmstrip), mute toggle, cover-thumbnail selection, HD/quality, duration +
// estimated-size display, and caption/View-Once (carried up to the preview).
//
// IMPORTANT — transcode is native-pending. Actually CUTTING the file (applying trim)
// and MUTING the audio track require a native transcoder (ffmpeg-kit-react-native or
// react-native-video-trim) that is NOT installed. This editor produces the trim/mute
// INTENT (start/end ms, muted) in media_meta and previews it faithfully; the real
// re-encode must be wired when that native module is added (a rebuild). We do NOT
// fake compression — the file sent is the original with the intent recorded, and the
// UI says so. Thumbnail selection + filmstrip DO work today (expo-video-thumbnails).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { ResizeMode, Video, type AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { useColors, spacing, radius, font, type Palette } from '../../theme';
import { estimateBytes, formatBytes, type Quality } from '../qualityEstimate';

export interface VideoEditResult {
  startMs: number;
  endMs: number;
  muted: boolean;
  coverUri?: string;
  quality: Quality;
}

const STRIP_COUNT = 8;

export default function VideoEditor({
  uri, width, height, durationMs = 0, onCancel, onDone,
}: {
  uri: string; width: number; height: number; durationMs?: number;
  onCancel: () => void;
  onDone: (r: VideoEditResult) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: winW } = useWindowDimensions();
  const videoRef = useRef<Video>(null);

  const [dur, setDur] = useState(durationMs);
  const [startMs, setStartMs] = useState(0);
  const [endMs, setEndMs] = useState(durationMs || 0);
  const [muted, setMuted] = useState(false);
  const [quality, setQuality] = useState<Quality>('standard');
  const [strip, setStrip] = useState<string[]>([]);
  const [cover, setCover] = useState<string | undefined>(undefined);
  const [pos, setPos] = useState(0);

  // Build the thumbnail filmstrip once we know the duration.
  useEffect(() => {
    if (!dur) return;
    let alive = true;
    (async () => {
      const shots: string[] = [];
      for (let i = 0; i < STRIP_COUNT; i++) {
        const t = Math.floor((dur / STRIP_COUNT) * i);
        try {
          // eslint-disable-next-line no-await-in-loop
          const { uri: turi } = await VideoThumbnails.getThumbnailAsync(uri, { time: t, quality: 0.4 });
          shots.push(turi);
        } catch { shots.push(''); }
      }
      if (alive) { setStrip(shots); if (!cover) setCover(shots[0]); }
    })();
    return () => { alive = false; };
  }, [dur, uri]); // eslint-disable-line react-hooks/exhaustive-deps

  const onStatus = (s: AVPlaybackStatus) => {
    if (!s.isLoaded) return;
    if (!dur && s.durationMillis) { setDur(s.durationMillis); setEndMs(s.durationMillis); }
    setPos(s.positionMillis ?? 0);
    // loop within the trim window during preview
    if (s.positionMillis != null && endMs && s.positionMillis >= endMs) {
      videoRef.current?.setPositionAsync(startMs).catch(() => {});
    }
  };

  async function pickCoverAt(ms: number) {
    try {
      const { uri: turi } = await VideoThumbnails.getThumbnailAsync(uri, { time: ms, quality: 0.7 });
      setCover(turi);
    } catch { /* ignore */ }
  }

  const trimmedMs = Math.max(0, endMs - startMs);
  const estBytes = estimateBytes({ width, height, type: 'video', durationMs: trimmedMs }, quality);
  const fmt = (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  // Handle drag: map an x within the strip to a ms position.
  const stripW = winW - spacing(8);
  const startPct = dur ? startMs / dur : 0;
  const endPct = dur ? endMs / dur : 1;

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <Pressable hitSlop={10} onPress={onCancel}><Ionicons name="close" size={26} color="#fff" /></Pressable>
        <Text style={styles.title}>Edit video</Text>
        <Pressable hitSlop={10} onPress={() => onDone({ startMs, endMs, muted, coverUri: cover, quality })}>
          <Ionicons name="checkmark" size={26} color={colors.primary} />
        </Pressable>
      </View>

      <View style={styles.stage}>
        <Video ref={videoRef} source={{ uri }} style={styles.video} resizeMode={ResizeMode.CONTAIN}
          isMuted={muted} shouldPlay isLooping={false} onPlaybackStatusUpdate={onStatus} useNativeControls={false} />
      </View>

      {/* Trim filmstrip */}
      <View style={[styles.strip, { width: stripW, alignSelf: 'center' }]}>
        {strip.map((t, i) => (
          <View key={i} style={{ flex: 1 }}>
            {t ? <Image source={{ uri: t }} style={styles.stripThumb} contentFit="cover" /> : <View style={[styles.stripThumb, { backgroundColor: '#222' }]} />}
          </View>
        ))}
        {/* dim outside the trim window */}
        <View pointerEvents="none" style={[styles.dim, { left: 0, width: `${startPct * 100}%` }]} />
        <View pointerEvents="none" style={[styles.dim, { right: 0, width: `${(1 - endPct) * 100}%` }]} />
        {/* trim handles */}
        <Pressable style={[styles.handle, { left: `${startPct * 100}%` }]}
          onPress={() => { const n = Math.min(endMs - 500, startMs + 500); setStartMs(Math.max(0, n)); }}
          onLongPress={() => setStartMs(Math.max(0, pos))}>
          <Ionicons name="chevron-back" size={16} color="#000" />
        </Pressable>
        <Pressable style={[styles.handle, styles.handleR, { left: `${endPct * 100}%` }]}
          onPress={() => { const n = Math.max(startMs + 500, endMs - 500); setEndMs(Math.min(dur, n)); }}
          onLongPress={() => setEndMs(Math.min(dur, pos))}>
          <Ionicons name="chevron-forward" size={16} color="#000" />
        </Pressable>
      </View>
      <Text style={styles.trimHint}>
        Trim {fmt(startMs)} – {fmt(endMs)} · {fmt(trimmedMs)} · tap handles to nudge, long-press to set at playhead
      </Text>

      {/* Controls */}
      <View style={styles.controls}>
        <Toggle icon={muted ? 'volume-mute' : 'volume-high'} label={muted ? 'Muted' : 'Sound'} active={muted} onPress={() => setMuted((m) => !m)} colors={colors} />
        <Toggle icon="image-outline" label="Set cover" onPress={() => pickCoverAt(pos)} colors={colors} />
      </View>

      {/* quality + size */}
      <View style={styles.qualityRow}>
        {(['standard', 'hd', 'original'] as Quality[]).map((q) => (
          <Pressable key={q} onPress={() => setQuality(q)} style={[styles.qChip, quality === q && styles.qChipOn]}>
            <Text style={[styles.qText, quality === q && styles.qTextOn]}>{q === 'hd' ? 'HD' : q[0].toUpperCase() + q.slice(1)}</Text>
          </Pressable>
        ))}
        <Text style={styles.est}>~{formatBytes(estBytes)}</Text>
      </View>

      {/* Native-pending notice — we never claim a fake transcode. */}
      <Text style={styles.note}>
        Trim & mute are recorded and previewed here. Final cutting/compression applies on a build with the video transcoder enabled.
      </Text>
    </View>
  );
}

function Toggle({ icon, label, active, onPress, colors }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; active?: boolean; onPress: () => void; colors: Palette;
}) {
  return (
    <Pressable style={{ alignItems: 'center', gap: 4 }} onPress={onPress}>
      <Ionicons name={icon} size={24} color={active ? colors.primary : '#fff'} />
      <Text style={{ color: active ? colors.primary : '#ddd', fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 20 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(4), paddingTop: spacing(10), paddingBottom: spacing(2) },
    title: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    video: { width: '100%', height: '100%' },
    strip: { flexDirection: 'row', height: 52, borderRadius: 8, overflow: 'hidden', marginTop: spacing(2) },
    stripThumb: { width: '100%', height: '100%' },
    dim: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
    handle: { position: 'absolute', top: -2, bottom: -2, width: 20, marginLeft: -10, backgroundColor: '#F5C518', borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
    handleR: {},
    trimHint: { color: '#aaa', fontSize: font.tiny, textAlign: 'center', marginTop: spacing(2), paddingHorizontal: spacing(4) },
    controls: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing(4), paddingHorizontal: spacing(8) },
    qualityRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing(4), paddingBottom: spacing(2) },
    qChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.12)' },
    qChipOn: { backgroundColor: colors.primary },
    qText: { color: '#ddd', fontSize: font.small, fontWeight: '600' },
    qTextOn: { color: '#fff' },
    est: { marginLeft: 'auto', color: '#bbb', fontSize: font.small },
    note: { color: '#888', fontSize: font.tiny, textAlign: 'center', paddingHorizontal: spacing(6), paddingBottom: spacing(8), lineHeight: 16 },
  });
