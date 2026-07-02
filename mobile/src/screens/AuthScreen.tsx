// FUTUREHAT mobile — sign in / sign up / forgot password. Reuses the shared
// auth helpers; the App-level onAuthChange listener drives navigation on success.
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';
import { signInWithEmail, signUpWithEmail } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME, CREDIT } from '../branding';

type Mode = 'signin' | 'signup' | 'forgot';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<Mode>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';

  function reset() {
    setError(null);
    setNotice(null);
  }

  async function submit() {
    reset();
    const mail = email.trim().toLowerCase();
    if (!mail) {
      setError('Email is required.');
      return;
    }
    if (!isForgot && !password) {
      setError('Password is required.');
      return;
    }
    // Match web's minLength={6} on the password field (Auth.tsx:100) — same rule in
    // both sign-in and sign-up; skip only the forgot-password (email-only) flow.
    if (!isForgot && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (isSignup && !displayName.trim()) {
      setError('Please enter a display name.');
      return;
    }

    setBusy(true);
    try {
      if (isForgot) {
        const { error } = await supabase.auth.resetPasswordForEmail(mail, {
          redirectTo: 'futurehat://reset-password',
        });
        if (error) throw error;
        setNotice('Password reset link sent. Check your email.');
        setMode('signin');
      } else if (isSignup) {
        const { user, error } = await signUpWithEmail(
          supabase,
          mail,
          password,
          displayName.trim(),
        );
        if (error) throw error;
        if (!user?.confirmed_at && !(user as any)?.email_confirmed_at) {
          setNotice('Account created. Check your email to confirm, then sign in.');
          setMode('signin');
        }
      } else {
        const { error } = await signInWithEmail(supabase, mail, password);
        if (error) throw error;
      }
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const cta = isForgot ? 'Send reset link' : isSignup ? 'Sign up' : 'Sign in';
  const tagline = isForgot
    ? 'Reset your password'
    : isSignup
      ? 'Create your account'
      : 'Welcome back';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + spacing(12), paddingBottom: insets.bottom + spacing(6) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>{APP_NAME}</Text>
        <Text style={styles.tagline}>{tagline}</Text>

        <View style={styles.card}>
          {isSignup && (
            <TextInput
              style={styles.input}
              placeholder="Display name"
              placeholderTextColor={colors.textFaint}
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.textFaint}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
          />
          {!isForgot && (
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textFaint}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          )}

          {error && <Text style={styles.error}>{error}</Text>}
          {notice && <Text style={styles.notice}>{notice}</Text>}

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={submit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{cta}</Text>
            )}
          </Pressable>

          {!isForgot && (
            <Pressable
              onPress={() => {
                setMode(isSignup ? 'signin' : 'signup');
                reset();
              }}
              hitSlop={8}
            >
              <Text style={styles.switch}>
                {isSignup
                  ? 'Already have an account? Sign in'
                  : "Don't have an account? Sign up"}
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => {
              setMode(isForgot ? 'signin' : 'forgot');
              reset();
            }}
            hitSlop={8}
          >
            <Text style={styles.minor}>
              {isForgot ? 'Back to sign in' : 'Forgot password?'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.credit}>{CREDIT}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.bg },
    container: {
      flexGrow: 1,
      paddingHorizontal: spacing(6),
      alignItems: 'center',
    },
    brand: {
      color: colors.primary,
      fontSize: 38,
      fontWeight: '800',
      letterSpacing: 2,
    },
    tagline: {
      color: colors.textMuted,
      fontSize: font.body,
      marginTop: spacing(2),
      marginBottom: spacing(8),
    },
    card: {
      width: '100%',
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing(5),
      borderWidth: 1,
      borderColor: colors.border,
    },
    input: {
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      borderRadius: radius.md,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3.5),
      fontSize: font.body,
      marginBottom: spacing(3),
    },
    error: { color: colors.danger, fontSize: font.small, marginBottom: spacing(2) },
    notice: { color: colors.primary, fontSize: font.small, marginBottom: spacing(2) },
    button: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing(3.5),
      alignItems: 'center',
      marginTop: spacing(1),
    },
    buttonPressed: { backgroundColor: colors.primaryDark },
    buttonText: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
    switch: {
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: spacing(4),
      fontSize: font.small,
    },
    minor: {
      color: colors.textFaint,
      textAlign: 'center',
      marginTop: spacing(3),
      fontSize: font.small,
    },
    credit: {
      color: colors.textFaint,
      fontSize: font.tiny,
      marginTop: spacing(10),
    },
  });
