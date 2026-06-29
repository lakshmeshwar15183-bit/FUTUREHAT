// FUTUREHAT mobile — the lock overlay shown while the app is locked.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppLock } from './AppLock';
import { useColors, spacing, font, type Palette } from '../theme';
import { APP_NAME } from '../branding';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'];

export default function LockScreen() {
  const { unlockWithPin, unlockWithBiometric, biometricEnabled, biometricAvailable } = useAppLock();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (biometricEnabled && biometricAvailable) unlockWithBiometric();
  }, [biometricEnabled, biometricAvailable]);

  async function onKey(k: string) {
    setError(false);
    if (k === 'del') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (k === 'bio') {
      if (biometricEnabled && biometricAvailable) await unlockWithBiometric();
      return;
    }
    const next = (pin + k).slice(0, 6);
    setPin(next);
    if (next.length >= 4) {
      const ok = await unlockWithPin(next);
      if (!ok && next.length === 6) {
        setError(true);
        setPin('');
      } else if (!ok) {
        // wait for more digits
      } else {
        setPin('');
      }
    }
  }

  return (
    <View style={styles.container}>
      <Ionicons name="lock-closed" size={40} color={colors.primary} />
      <Text style={styles.title}>{APP_NAME} is locked</Text>
      <Text style={styles.sub}>Enter your PIN to continue</Text>

      <View style={styles.dots}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { borderColor: error ? colors.danger : colors.textMuted },
              i < pin.length && { backgroundColor: error ? colors.danger : colors.primary },
            ]}
          />
        ))}
      </View>
      {error && <Text style={styles.err}>Incorrect PIN. Try again.</Text>}

      <View style={styles.pad}>
        {KEYS.map((k) => (
          <Pressable
            key={k}
            style={styles.key}
            onPress={() => onKey(k)}
            disabled={k === 'bio' && !(biometricEnabled && biometricAvailable)}
          >
            {k === 'del' ? (
              <Ionicons name="backspace-outline" size={26} color={colors.text} />
            ) : k === 'bio' ? (
              biometricEnabled && biometricAvailable ? (
                <Ionicons name="finger-print" size={28} color={colors.primary} />
              ) : (
                <View />
              )
            ) : (
              <Text style={styles.keyText}>{k}</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing(8) },
    title: { color: colors.text, fontSize: font.title, fontWeight: '700', marginTop: spacing(4) },
    sub: { color: colors.textMuted, fontSize: font.body, marginTop: spacing(2) },
    dots: { flexDirection: 'row', gap: spacing(3), marginTop: spacing(8) },
    dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
    err: { color: colors.danger, marginTop: spacing(3), fontSize: font.small },
    pad: { flexDirection: 'row', flexWrap: 'wrap', width: 300, marginTop: spacing(8), justifyContent: 'center' },
    key: { width: 90, height: 80, alignItems: 'center', justifyContent: 'center' },
    keyText: { color: colors.text, fontSize: 30, fontWeight: '500' },
  });
