// Non-blocking toast: "Activating Premium…" / error retry.
// pointerEvents box-none so chats/drafts remain fully interactive underneath.
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePremium } from './PremiumContext';
import { useColors, spacing, radius, font, type Palette } from '../theme';

export function ActivatingPremiumBanner() {
  const { isActivating, activationPhase, activationError, clearActivationError, refresh } =
    usePremium();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;

  const [showSuccess, setShowSuccess] = React.useState(false);
  const prevPhase = useRef(activationPhase);

  useEffect(() => {
    if (prevPhase.current === 'activating' && activationPhase === 'active') {
      setShowSuccess(true);
      const t = setTimeout(() => setShowSuccess(false), 1800);
      prevPhase.current = activationPhase;
      return () => clearTimeout(t);
    }
    prevPhase.current = activationPhase;
  }, [activationPhase]);

  const show = isActivating || (activationPhase === 'failed' && !!activationError) || showSuccess;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: show ? 1 : 0,
        duration: show ? 180 : 220,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: show ? 0 : -8,
        duration: show ? 180 : 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [show, opacity, translateY]);

  if (!show) return null;

  const failed = activationPhase === 'failed' && !!activationError;
  const label = failed
    ? activationError
    : showSuccess
      ? 'Lumixo+ is active'
      : 'Activating Premium…';

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      <Animated.View
        pointerEvents={failed ? 'auto' : 'none'}
        style={[
          styles.pill,
          failed && styles.pillError,
          showSuccess && styles.pillOk,
          { opacity, transform: [{ translateY }] },
        ]}
      >
        <Text style={[styles.text, failed && styles.textError, showSuccess && styles.textOk]} numberOfLines={2}>
          {label}
        </Text>
        {failed ? (
          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                clearActivationError();
                void refresh({ force: true });
              }}
              hitSlop={8}
              style={styles.retry}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
            <Pressable onPress={clearActivationError} hitSlop={8}>
              <Text style={styles.dismiss}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    host: {
      position: 'absolute',
      left: spacing(4),
      right: spacing(4),
      zIndex: 9999,
      elevation: 20,
      alignItems: 'center',
    },
    pill: {
      maxWidth: 420,
      width: '100%',
      backgroundColor: colors.isLight ? 'rgba(17,27,33,0.92)' : 'rgba(32,44,51,0.96)',
      borderRadius: radius.pill,
      paddingVertical: spacing(2.5),
      paddingHorizontal: spacing(4),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    pillError: {
      backgroundColor: 'rgba(239,68,68,0.14)',
      borderColor: 'rgba(239,68,68,0.45)',
    },
    pillOk: {
      borderColor: colors.primary,
    },
    text: {
      color: '#fff',
      fontSize: font.small,
      fontWeight: '600',
      textAlign: 'center',
    },
    textError: { color: colors.danger },
    textOk: { color: colors.primary },
    actions: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing(4),
      marginTop: spacing(2),
    },
    retry: { paddingHorizontal: spacing(2) },
    retryText: { color: colors.primary, fontWeight: '700', fontSize: font.small },
    dismiss: { color: colors.textMuted, fontSize: font.small, fontWeight: '600' },
  });
