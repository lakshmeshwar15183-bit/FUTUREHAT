// Lumixo mobile — inline voice/audio message player (expo-av).
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, type AVPlaybackStatus } from 'expo-av';

import { useColors } from '../theme';
import { useSignedUrl } from '../lib/useSignedUrl';

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
  // Media bucket is private — the raw uri returns 403. Resolve to a signed url
  // before feeding it to expo-av. Falls back to the raw uri only for non-media
  // sources (data-uri, file://, etc.) which the hook passes through unchanged.
  const { url: playableUri } = useSignedUrl(uri);
  const soundRef = useRef<Audio.Sound | null>(null);
  const barWidth = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState(0);

  // Unload on unmount AND whenever the source uri changes (FlatList recycles
  // bubbles, so a stale Sound would otherwise leak when the row is reused).
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
      soundRef.current = null;
    };
  }, [uri]);

  const onStatus = (st: AVPlaybackStatus) => {
    if (!st.isLoaded) return;
    setPosMs(st.positionMillis);
    if (st.durationMillis) setDurMs(st.durationMillis);
    if (st.didJustFinish) {
      setPlaying(false);
      setPosMs(0);
      soundRef.current?.setPositionAsync(0);
    }
  };

  async function toggle() {
    try {
      if (!soundRef.current) {
        if (!playableUri) return; // still signing / signing failed
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync(
          { uri: playableUri },
          { shouldPlay: true },
          onStatus,
        );
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
      // ignore playback errors
    }
  }

  // Tap anywhere on the bar to scrub to that position (web VoiceMessage parity).
  // Loads the sound first if the user seeks before pressing play.
  async function seekTo(locationX: number) {
    const w = barWidth.current;
    if (w <= 0) return;
    const frac = Math.max(0, Math.min(1, locationX / w));
    try {
      if (!soundRef.current) {
        if (!playableUri) return;
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync({ uri: playableUri }, { shouldPlay: false }, onStatus);
        soundRef.current = sound;
      }
      const st = await soundRef.current.getStatusAsync();
      const total = st.isLoaded && st.durationMillis ? st.durationMillis : durMs;
      if (total > 0) {
        const target = frac * total;
        await soundRef.current.setPositionAsync(target);
        setPosMs(target);
      }
    } catch {
      // ignore seek errors
    }
  }

  const progress = durMs > 0 ? posMs / durMs : 0;

  return (
    <View style={styles.row}>
      <Pressable onPress={toggle} hitSlop={8}>
        <Ionicons name={playing ? 'pause' : 'play'} size={26} color={tint} />
      </Pressable>
      <View style={styles.barWrap}>
        <Pressable
          hitSlop={{ top: 12, bottom: 12 }}
          onLayout={(e) => { barWidth.current = e.nativeEvent.layout.width; }}
          onPress={(e) => seekTo(e.nativeEvent.locationX)}
        >
          <View style={[styles.barBg, { backgroundColor: colors.border }]}>
            <View
              style={[styles.barFill, { backgroundColor: tint, width: `${progress * 100}%` }]}
            />
          </View>
        </Pressable>
        <Text style={[styles.time, { color: colors.textMuted }]}>
          {fmt(posMs || durMs)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 160 },
  barWrap: { flex: 1, marginLeft: 10 },
  barBg: { height: 4, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2 },
  time: { fontSize: 11, marginTop: 4 },
});
