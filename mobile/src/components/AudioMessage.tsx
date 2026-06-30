// FUTUREHAT mobile — inline voice/audio message player (expo-av).
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, type AVPlaybackStatus } from 'expo-av';

import { useColors } from '../theme';

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
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync(
          { uri },
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

  const progress = durMs > 0 ? posMs / durMs : 0;

  return (
    <View style={styles.row}>
      <Pressable onPress={toggle} hitSlop={8}>
        <Ionicons name={playing ? 'pause' : 'play'} size={26} color={tint} />
      </Pressable>
      <View style={styles.barWrap}>
        <View style={[styles.barBg, { backgroundColor: colors.border }]}>
          <View
            style={[styles.barFill, { backgroundColor: tint, width: `${progress * 100}%` }]}
          />
        </View>
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
