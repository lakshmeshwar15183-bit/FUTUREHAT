// Lumixo mobile — the recovery-link landing page. The user tapped
// "Reset password" in their email → the app opened via a deep link with the
// recovery tokens in the fragment. App.tsx has already:
//   • parsed the tokens out of the URL,
//   • called supabase.auth.setSession() to install a short-lived recovery session,
//   • navigated us here.
// This screen collects a new password and calls updateUser({ password }). On
// success we sign the user out so they have to log in again with the new
// credential (Supabase best practice — invalidates any old refresh tokens).
//
// Errors we surface:
//   • recoveryError param from App.tsx (link malformed / setSession failed)
//   • password too short / mismatch
//   • updateUser failed (expired token → "Link expired, request a new one")
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME } from '../branding';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ResetPassword'>;

export default function ResetPasswordScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(route.params?.recoveryError ?? null);
  const [done, setDone] = useState(false);

  // If we landed here without a recovery session, we can't call updateUser —
  // fail loudly instead of showing a form that will silently no-op. React
  // Navigation's linking listener may deliver us here BEFORE the App-level
  // handler finished setSession(), so we also subscribe to auth changes and
  // flip `hasSession` when the session appears.
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setHasSession(!!data.session);
    });
    const { data: authSub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (alive) setHasSession(!!session);
    });
    return () => {
      alive = false;
      authSub.subscription.unsubscribe();
    };
  }, []);

  async function submit() {
    setError(null);
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setDone(true);
      // Force a fresh sign-in with the new password. This invalidates any old
      // refresh tokens (recommended by Supabase for post-reset flows) and gets
      // the user out of the temporary recovery session.
      await supabase.auth.signOut();
      Alert.alert(
        'Password updated',
        'Sign in with your new password to continue.',
        [{ text: 'OK', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Auth' }] }) }],
      );
    } catch (e: any) {
      // The most common failure here is a stale recovery session (link expired
      // or already used). Give the user a clear next step.
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('expired') || msg.includes('invalid') || msg.includes('token')) {
        setError('This reset link has expired or already been used. Request a new one from the sign-in screen.');
      } else {
        setError(e?.message ?? 'Could not update password. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  function backToAuth() {
    navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
  }

  const brokenLink = hasSession === false && !done;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing(12), paddingBottom: insets.bottom + spacing(6) }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>{APP_NAME}</Text>
        <Text style={styles.tagline}>Choose a new password</Text>

        <View style={styles.card}>
          {brokenLink ? (
            <>
              <Text style={styles.error}>
                {error ?? 'This reset link is missing or has expired. Request a new one from the sign-in screen.'}
              </Text>
              <Pressable style={styles.button} onPress={backToAuth}>
                <Text style={styles.buttonText}>Back to sign in</Text>
              </Pressable>
            </>
          ) : (
            <>
              <TextInput
                style={styles.input}
                placeholder="New password"
                placeholderTextColor={colors.textFaint}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                editable={!busy && !done}
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor={colors.textFaint}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                editable={!busy && !done}
              />

              {error && <Text style={styles.error}>{error}</Text>}

              <Pressable
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                onPress={submit}
                disabled={busy || done}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Update password</Text>}
              </Pressable>

              <Pressable onPress={backToAuth} hitSlop={8}>
                <Text style={styles.minor}>Back to sign in</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.bg },
    container: { flexGrow: 1, paddingHorizontal: spacing(6), alignItems: 'center' },
    brand: { color: colors.primary, fontSize: 38, fontWeight: '800', letterSpacing: 2 },
    tagline: { color: colors.textMuted, fontSize: font.body, marginTop: spacing(2), marginBottom: spacing(8) },
    card: {
      width: '100%', backgroundColor: colors.surface, borderRadius: radius.lg,
      padding: spacing(5), borderWidth: 1, borderColor: colors.border,
    },
    input: {
      backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radius.md,
      paddingHorizontal: spacing(4), paddingVertical: spacing(3.5), fontSize: font.body, marginBottom: spacing(3),
    },
    error: { color: colors.danger, fontSize: font.small, marginBottom: spacing(2) },
    button: {
      backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing(3.5),
      alignItems: 'center', marginTop: spacing(1),
    },
    buttonPressed: { backgroundColor: colors.primaryDark },
    buttonText: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
    minor: { color: colors.textFaint, textAlign: 'center', marginTop: spacing(4), fontSize: font.small },
  });
