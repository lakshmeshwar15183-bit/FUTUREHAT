// Lumixo mobile — configure app lock: enable with a PIN, toggle biometrics,
// or turn it off.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { useAppLock } from '../security/AppLock';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { Alert } from '../ui/dialog';

export default function AppLockSetupScreen() {
  const navigation = useNavigation();
  const { enabled, disable, enable, biometricAvailable, biometricEnabled } = useAppLock();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [useBio, setUseBio] = useState(biometricAvailable);
  const [settingUp, setSettingUp] = useState(false);

  async function save() {
    if (pin.length < 4) {
      Alert.alert('PIN too short', 'Use at least 4 digits.');
      return;
    }
    if (pin !== confirm) {
      Alert.alert('PINs do not match', 'Please re-enter the same PIN.');
      return;
    }
    await enable(pin, useBio && biometricAvailable);
    Alert.alert('App lock enabled', 'Lumixo will lock when you leave the app.');
    navigation.goBack();
  }

  async function turnOff() {
    await disable();
    navigation.goBack();
  }

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Ionicons name="shield-checkmark" size={44} color={colors.primary} />
        <Text style={styles.title}>App lock</Text>
        <Text style={styles.sub}>
          Require a PIN{biometricAvailable ? ' or biometrics' : ''} to open Lumixo.
        </Text>
      </View>

      {enabled && !settingUp ? (
        <>
          <View style={styles.statusRow}>
            <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
            <Text style={styles.statusText}>App lock is on{biometricEnabled ? ' · biometrics enabled' : ''}</Text>
          </View>
          <Pressable style={styles.secondary} onPress={() => setSettingUp(true)}>
            <Text style={styles.secondaryText}>Change PIN</Text>
          </Pressable>
          <Pressable style={styles.danger} onPress={turnOff}>
            <Text style={styles.dangerText}>Turn off app lock</Text>
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Enter PIN (4–6 digits)"
            placeholderTextColor={colors.textFaint}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm PIN"
            placeholderTextColor={colors.textFaint}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={confirm}
            onChangeText={(t) => setConfirm(t.replace(/\D/g, ''))}
          />
          {biometricAvailable && (
            <View style={styles.bioRow}>
              <Text style={styles.bioLabel}>Unlock with biometrics</Text>
              <Switch value={useBio} onValueChange={setUseBio} trackColor={{ true: colors.primary }} />
            </View>
          )}
          <Pressable style={styles.primary} onPress={save}>
            <Text style={styles.primaryText}>Enable app lock</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: spacing(5) },
    hero: { alignItems: 'center', paddingVertical: spacing(6) },
    title: { color: colors.text, fontSize: font.title, fontWeight: '700', marginTop: spacing(3) },
    sub: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', marginTop: spacing(2) },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', marginVertical: spacing(5) },
    statusText: { color: colors.text, fontSize: font.body },
    input: {
      backgroundColor: colors.surface,
      color: colors.text,
      borderRadius: radius.md,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3.5),
      fontSize: font.heading,
      marginBottom: spacing(3),
      letterSpacing: 4,
    },
    bioRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing(3) },
    bioLabel: { color: colors.text, fontSize: font.body },
    primary: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing(3.5), alignItems: 'center', marginTop: spacing(3) },
    primaryText: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
    secondary: { borderRadius: radius.md, paddingVertical: spacing(3.5), alignItems: 'center', borderWidth: 1, borderColor: colors.border, marginBottom: spacing(3) },
    secondaryText: { color: colors.text, fontSize: font.body },
    danger: { alignItems: 'center', paddingVertical: spacing(3) },
    dangerText: { color: colors.danger, fontSize: font.body },
  });
