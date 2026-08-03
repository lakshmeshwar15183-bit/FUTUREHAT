// Lumixo mobile — inline voice/audio message player (expo-av).
// Full file downloads only when the user presses Play (then caches locally).
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, type AVPlaybackStatus } from 'expo-av';

import { useColors } from '../theme';
import { getCachedMediaUri, peekCachedMediaUri } from '../lib/mediaCache';
import { requestMediaDownload } from '../lib/mediaDownloadManager';
import { signedMediaUrl } from '../lib/shared';
import { supabase } from '../lib/supabase';

interface Props {
  uri: string;
  tint: string;
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export default function AudioMessage({ uri, tint }: Props) {
  const colors = useColors();
  const soundRef = useRef<Audio.Sound | null>(null);
  const barWidth = useRef(0);
  const mountedRef = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [cached, setCached] = useState(() => !!peekCachedMediaUri(uri));

  useEffect(() => {
    mountedRef.current = true;
    void getCachedMediaUri(uri).then((u) => {
      if (mountedRef.current && u) setCached(true);
    });
    return () => {
      mountedRef.current = false;
      soundRef.current?.unloadAsync();
      soundRef.current = null;
    };
  }, [uri]);

  const onStatus = (st: AVPlaybackStatus) => {
    if (!st.isLoaded || !mountedRef.current) return;
    setPosMs(st.positionMillis);
    if (st.durationMillis) setDurMs(st.durationMillis);
    if (st.didJustFinish) {
      setPlaying(false);
      setPosMs(0);
      soundRef.current?.setPositionAsync(0);
    }
  };

  async function resolvePlayable(): Promise<string | null> {
    const local = await getCachedMediaUri(uri);
    if (local) {
      setCached(true);
      return local;
    }
    // User pressed play → download + cache, then play
    const downloaded = await requestMediaDownload(uri);
    if (downloaded) {
      setCached(true);
      return downloaded;
    }
    // Fallback: stream signed URL without permanent cache
    return (await signedMediaUrl(supabase, uri)) ?? uri;
  }

  async function toggle() {
    try {
      if (!soundRef.current) {
        setLoading(true);
        const playableUri = await resolvePlayable();
        setLoading(false);
        if (!playableUri || !mountedRef.current) return;
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync(
          { uri: playableUri },
          { shouldPlay: true },
          onStatus,
        );
        if (!mountedRef.current) {
          void sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
        setPlaying(true);
        return;
      }
      if (playing) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
      } else {
        await soundRef.current.playAsync();
        setPlaying(true);
      }
    } catch {
      setLoading(false);
    }
  }

  return (
    <View style={styles.row}>
      <Pressable
        onPress={toggle}
        style={[styles.btn, { backgroundColor: tint + '22' }]}
        accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {loading ? (
          <ActivityIndicator color={tint} size="small" />
        ) : (
          <Ionicons name={playing ? 'pause' : 'play'} size={18} color={tint} />
        )}
      </Pressable>
      <View
        style={styles.barTrack}
        onLayout={(e) => {
          barWidth.current = e.nativeEvent.layout.width;
        }}
      >
        <View
          style={[
            styles.barFill,
            {
              backgroundColor: tint,
              width: `${durMs > 0 ? Math.min(100, (posMs / durMs) * 100) : 0}%`,
            },
          ]}
        />
      </View>
      <Text style={[styles.time, { color: tint }]}>
        {fmt(playing || posMs > 0 ? posMs : durMs)}
      </Text>
      {!cached && !loading && (
        <Ionicons name="cloud-download-outline" size={14} color={tint} style={{ marginLeft: 2, opacity: 0.7 }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 180, paddingVertical: 2 },
  btn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.35)',
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 2 },
  time: { fontSize: 11, fontVariant: ['tabular-nums'], minWidth: 32 },
});
