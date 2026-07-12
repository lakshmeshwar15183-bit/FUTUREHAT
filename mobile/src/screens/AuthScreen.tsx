// Lumixo mobile — sign in / sign up / forgot password + Lumi cat mascot.
// Reuses shared auth helpers; onAuthChange drives navigation on success.
// Auth APIs/Supabase unchanged — UI/animation only.
import React, { useEffect, useMemo, useState } from 'react';
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
import {
  signInWithEmail,
  signUpWithEmail,
  catMoodFromAuth,
  catGazeFromEmail,
  type CatMood,
} from '../lib/shared';
import { resetPasswordRedirectUrl } from '../lib/authLinks';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME, CREDIT } from '../branding';
import { LumixoCat } from '../components/LumixoCat';

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
  const [lastResetAt, setLastResetAt] = useState(0);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showConfused, setShowConfused] = useState(false);

  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';

  // Confused mood for ~2s on wrong password / auth error.
  useEffect(() => {
    if (!error) return;
    setShowConfused(true);
    const t = setTimeout(() => setShowConfused(false), 2000);
    return () => clearTimeout(t);
  }, [error]);

  const mood: CatMood = catMoodFromAuth({
    passwordFocused,
    emailFocused: emailFocused || (!passwordFocused && email.length > 0 && !success),
    error: showConfused ? error : null,
    success,
  });
  const gaze = catGazeFromEmail(email);

  function reset() {
    setError(null);
    setNotice(null);
    setSuccess(false);
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
        const now = Date.now();
        if (now - lastResetAt < 45_000) {
          setError('Please wait a moment before requesting another reset email.');
          return;
        }
        const { error: err } = await supabase.auth.resetPasswordForEmail(mail, {
          redirectTo: resetPasswordRedirectUrl(),
        });
        if (err) throw err;
        setLastResetAt(now);
        setNotice('Password reset link sent. Check your email.');
        setMode('signin');
      } else if (isSignup) {
        const { user, error: err } = await signUpWithEmail(
          supabase,
          mail,
          password,
          displayName.trim(),
        );
        if (err) throw err;
        setSuccess(true);
        if (!user?.confirmed_at && !(user as any)?.email_confirmed_at) {
          setTimeout(() => {
            setNotice('Account created. Check your email to confirm, then sign in.');
            setMode('signin');
            setSuccess(false);
          }, 900);
        }
      } else {
        const { error: err } = await signInWithEmail(supabase, mail, password);
        if (err) throw err;
        setSuccess(true);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
      setSuccess(false);
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
          { paddingTop: insets.top + spacing(8), paddingBottom: insets.bottom + spacing(6) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>{APP_NAME}</Text>
        <Text style={styles.tagline}>{tagline}</Text>

        <View style={styles.cardWrap}>
          <View style={styles.mascot}>
            <LumixoCat mood={mood} gaze={gaze} size="hero" decorative />
          </View>

          <View style={styles.card}>
            {isSignup && (
              <TextInput
                style={styles.input}
                placeholder="Display name"
                placeholderTextColor={colors.textFaint}
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                editable={!busy && !success}
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
              onFocus={() => {
                setEmailFocused(true);
                setPasswordFocused(false);
              }}
              onBlur={() => setEmailFocused(false)}
              editable={!busy && !success}
            />
            {!isForgot && (
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={colors.textFaint}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                onFocus={() => {
                  setPasswordFocused(true);
                  setEmailFocused(false);
                }}
                onBlur={() => setPasswordFocused(false)}
                editable={!busy && !success}
              />
            )}

            {error && <Text style={styles.error}>{error}</Text>}
            {notice && <Text style={styles.notice}>{notice}</Text>}

            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={submit}
              disabled={busy || success}
              accessibilityRole="button"
              accessibilityLabel={cta}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{success ? 'Welcome!' : cta}</Text>
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
      fontSize: 34,
      fontWeight: '800',
      letterSpacing: 1.2,
    },
    tagline: {
      color: colors.textMuted,
      fontSize: font.small,
      marginTop: spacing(2),
      marginBottom: spacing(2),
      letterSpacing: -0.1,
    },
    cardWrap: {
      width: '100%',
      maxWidth: 400,
      marginTop: spacing(4),
    },
    mascot: {
      alignItems: 'center',
      marginBottom: -spacing(4),
      zIndex: 2,
    },
    card: {
      width: '100%',
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing(4.5),
      paddingTop: spacing(7),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.isLight ? 'rgba(0,0,0,0.06)' : colors.border,
    },
    input: {
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      borderRadius: radius.md,
      paddingHorizontal: spacing(3.5),
      paddingVertical: Platform.OS === 'ios' ? 12 : 10,
      fontSize: font.body,
      marginBottom: spacing(2.5),
      minHeight: 44,
    },
    error: { color: colors.danger, fontSize: font.small, marginBottom: spacing(2), lineHeight: 17 },
    notice: { color: colors.primary, fontSize: font.small, marginBottom: spacing(2), lineHeight: 17 },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing(1),
    },
    buttonPressed: { backgroundColor: colors.primaryDark, opacity: 0.94 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: -0.15 },
    switch: {
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: spacing(3.5),
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
