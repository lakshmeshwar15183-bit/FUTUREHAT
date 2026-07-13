// Lumixo — chat bubble media tile (WhatsApp/Telegram on-demand).
// Cached → show immediately. Not cached → placeholder + download / open.
// Never mass-downloads on scroll; full file only on user action or policy.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Message } from '../lib/shared';
import {
  getCachedMediaUri,
  peekCachedMediaUri,
} from '../lib/mediaCache';
import {
  requestMediaDownload,
  getDownloadJob,
  subscribeDownloads,
  cancelDownload,
} from '../lib/mediaDownloadManager';
import {
  formatDurationMs,
  shouldAutoDownload,
  hydrateMediaStorageSettings,
  subscribeMediaStorage,
  type MediaKind,
} from '../lib/mediaPolicy';
import { getNetworkClass, isRoamingLike } from '../lib/mediaNetwork';
import SignedImage from './SignedImage';
import { useColors, font, type Palette } from '../theme';

type Props = {
  message: Message;
  kind: 'image' | 'video' | 'gif';
  onOpen: (url: string) => void;
  tint?: string;
};

function kindFor(k: Props['kind']): MediaKind {
  if (k === 'gif') return 'gif';
  if (k === 'video') return 'video';
  return 'image';
}

export default function ChatMediaTile({ message, kind, onOpen, tint }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const url = message.media_url!;
  const meta = message.media_meta;
  const [local, setLocal] = useState<string | null>(() => peekCachedMediaUri(url));
  const [auto, setAuto] = useState(() =>
    shouldAutoDownload(kindFor(kind), getNetworkClass(), isRoamingLike()),
  );
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const refresh = () =>
      setAuto(shouldAutoDownload(kindFor(kind), getNetworkClass(), isRoamingLike()));
    void hydrateMediaStorageSettings().then(refresh);
    return subscribeMediaStorage(refresh);
  }, [kind]);

  useEffect(() => {
    let alive = true;
    void getCachedMediaUri(url).then((u) => {
      if (alive && u) setLocal(u);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  useEffect(() => {
    return subscribeDownloads((map) => {
      const key = url;
      const job = [...map.values()].find((j) => j.url === key || j.id.includes(key.slice(-20)));
      const j = getDownloadJob(url) ?? job;
      if (!j) return;
      setProgress(j.progress);
      if (j.status === 'done' && j.localUri) {
        setLocal(j.localUri);
        setBusy(false);
      }
      if (j.status === 'running' || j.status === 'queued') setBusy(true);
      if (j.status === 'error' || j.status === 'cancelled') setBusy(false);
    });
  }, [url]);

  const sizeLabel = typeof meta?.width === 'number' && typeof meta?.height === 'number'
    ? `${meta.width}×${meta.height}`
    : '';
  // No size field on MediaMeta for file bytes — optional future; duration for video
  const duration = formatDurationMs(meta?.durationMs);
  const showPreview = !!local || auto;

  const startDownload = useCallback(async () => {
    setBusy(true);
    const uri = await requestMediaDownload(url);
    if (uri) setLocal(uri);
    setBusy(false);
  }, [url]);

  const handlePress = useCallback(async () => {
    if (local) {
      onOpen(url);
      return;
    }
    // Open path: download then open (user request)
    setBusy(true);
    const uri = await requestMediaDownload(url);
    setBusy(false);
    if (uri) {
      setLocal(uri);
      onOpen(url);
    } else {
      // Still allow open via signed stream in viewer
      onOpen(url);
    }
  }, [local, onOpen, url]);

  if (kind === 'video' && !showPreview) {
    return (
      <Pressable style={styles.videoTile} onPress={handlePress}>
        <Ionicons name="play-circle" size={48} color="#fff" />
        <Text style={styles.metaLine}>
          {duration ? `${duration}` : 'Video'}
          {sizeLabel ? ` · ${sizeLabel}` : ''}
        </Text>
        {busy ? (
          <View style={styles.progressWrap}>
            <ActivityIndicator color="#fff" />
            {progress > 0 && progress < 1 && (
              <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
            )}
            <Pressable
              hitSlop={8}
              onPress={(e) => {
                e.stopPropagation?.();
                void cancelDownload(url);
                setBusy(false);
              }}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.downloadPill}>
            <Ionicons name="download-outline" size={14} color="#fff" />
            <Text style={styles.downloadPillText}>Tap to download</Text>
          </View>
        )}
      </Pressable>
    );
  }

  if (kind === 'video' && showPreview) {
    return (
      <Pressable style={styles.videoTile} onPress={handlePress}>
        {local ? (
          <SignedImage
            source={url}
            containerStyle={styles.videoBg}
            contentFit="cover"
            tint="#fff"
            persist
            kind="video"
          />
        ) : null}
        <View style={styles.videoOverlay}>
          <Ionicons name="play-circle" size={48} color="#fff" />
          <Text style={styles.metaLine}>
            {duration || 'Video'}
          </Text>
        </View>
      </Pressable>
    );
  }

  // Image / GIF
  if (showPreview) {
    return (
      <Pressable onPress={handlePress}>
        <SignedImage
          source={url}
          containerStyle={styles.image}
          contentFit="cover"
          tint={tint ?? colors.primary}
          persist={!!local || auto}
          kind={kindFor(kind)}
        />
        {!local && auto && (
          <View style={styles.streamBadge} pointerEvents="none">
            <Text style={styles.streamBadgeText}>Preview</Text>
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <Pressable style={[styles.image, styles.placeholder]} onPress={handlePress}>
      <Ionicons
        name={kind === 'gif' ? 'gift-outline' : 'image-outline'}
        size={36}
        color={colors.primary}
      />
      <Text style={[styles.placeholderTitle, { color: colors.text }]}>
        {kind === 'gif' ? 'GIF' : 'Photo'}
      </Text>
      {(sizeLabel || duration) ? (
        <Text style={[styles.placeholderSub, { color: colors.textMuted }]}>
          {[sizeLabel, duration].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      {busy ? (
        <>
          <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          {progress > 0 && progress < 1 && (
            <Text style={[styles.placeholderSub, { color: colors.textMuted }]}>
              {Math.round(progress * 100)}%
            </Text>
          )}
        </>
      ) : (
        <Pressable style={styles.downloadBtn} onPress={startDownload}>
          <Ionicons name="download-outline" size={16} color="#fff" />
          <Text style={styles.downloadBtnText}>Download</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    image: { width: 210, height: 210, borderRadius: 10, marginBottom: 2 },
    placeholder: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: 4,
      padding: 12,
    },
    placeholderTitle: { fontSize: font.body, fontWeight: '700', marginTop: 4 },
    placeholderSub: { fontSize: font.tiny },
    downloadBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
    },
    downloadBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    videoTile: {
      width: 210,
      height: 128,
      borderRadius: 10,
      marginBottom: 2,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    videoBg: {
      ...StyleSheet.absoluteFillObject,
      width: 210,
      height: 128,
    },
    videoOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.25)',
    },
    metaLine: { color: '#fff', fontSize: font.small, marginTop: 4, fontWeight: '600' },
    downloadPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 8,
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
    },
    downloadPillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
    progressWrap: { alignItems: 'center', marginTop: 8, gap: 4 },
    progressText: { color: '#fff', fontSize: 12 },
    cancelText: { color: '#fff', fontSize: 12, textDecorationLine: 'underline' },
    streamBadge: {
      position: 'absolute',
      left: 8,
      bottom: 8,
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    streamBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  });
