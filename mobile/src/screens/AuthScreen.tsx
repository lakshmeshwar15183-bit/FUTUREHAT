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
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  signInWithEmail,
  signUpWithEmail,
  requestPasswordReset,
  friendlyAuthError,
  catMoodFromAuth,
  catGazeFromEmail,
  CAT_MOTION,
  type CatMood,
} from '../lib/shared';
import { resetPasswordRedirectUrl } from '../lib/authLinks';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME } from '../branding';
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
  const [phone, setPhone] = useState('');
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

  // Confused mood: brief shake + ~1s sad eyes, then back to idle/watching.
  useEffect(() => {
    if (!error) return;
    setShowConfused(true);
    const t = setTimeout(() => setShowConfused(false), CAT_MOTION.confuseHoldMs + 600);
    return () => clearTimeout(t);
  }, [error]);

  const baseMood: CatMood = catMoodFromAuth({
    passwordFocused,
    emailFocused: emailFocused || (!passwordFocused && email.length > 0 && !success),
    error: showConfused ? error : null,
    success,
  });
  // Welcome wave on signup when not typing / celebrating.
  const mood: CatMood = baseMood === 'idle' && isSignup ? 'wave' : baseMood;
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
    if (!isForgot && isSignup && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!isForgot && !isSignup && password.length < 1) {
      setError('Password is required.');
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
        const { error: err } = await requestPasswordReset(
          supabase,
          mail,
          resetPasswordRedirectUrl(),
        );
        if (err) throw err;
        setLastResetAt(now);
        // Always the same copy — no account enumeration.
        setNotice('If an account exists for that email, you will receive a reset link shortly.');
        setMode('signin');
      } else if (isSignup) {
        const { user, error: err, needsEmailVerification } = await signUpWithEmail(
          supabase,
          mail,
          password,
          displayName.trim(),
          { phone: phone.trim() || null },
        );
        if (err) throw err;
        setSuccess(true);
        if (needsEmailVerification || (!user?.email_confirmed_at && !(user as any)?.confirmed_at)) {
          setTimeout(() => {
            setNotice('Account created. Check your email to verify, then sign in.');
            setMode('signin');
            setSuccess(false);
          }, 900);
        }
      } else {
        const { user, error: err } = await signInWithEmail(supabase, mail, password);
        if (err) throw err;
        // Immediately ack force_logout_at so AdminGate never signs us out on
        // the first successful login after "sign out everywhere".
        if (user?.id) {
          try {
            const { data: row } = await supabase
              .from('profiles')
              .select('force_logout_at')
              .eq('id', user.id)
              .maybeSingle();
            const stamp = (row as { force_logout_at?: string } | null)?.force_logout_at;
            if (stamp) await AsyncStorage.setItem('fh:forceLogoutAck', stamp);
          } catch { /* ignore */ }
        }
        setSuccess(true);
      }
    } catch (e: any) {
      setError(friendlyAuthError(e, 'Something went wrong. Please try again.'));
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
                textContentType="name"
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
              autoComplete="email"
              textContentType="emailAddress"
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
                placeholder={isSignup ? 'Password (min 8 characters)' : 'Password'}
                placeholderTextColor={colors.textFaint}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={isSignup ? 'new-password' : 'password'}
                textContentType={isSignup ? 'newPassword' : 'password'}
                onFocus={() => {
                  setPasswordFocused(true);
                  setEmailFocused(false);
                }}
                onBlur={() => setPasswordFocused(false)}
                editable={!busy && !success}
              />
            )}
            {isSignup && (
              <TextInput
                style={styles.input}
                placeholder="Phone (optional, +91…)"
                placeholderTextColor={colors.textFaint}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
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
  });
