// Lumixo — global premium dialog / sheet host (Telegram-level polish).
// Mount once near the app root. Imperative API lives in `controller.ts`.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors, spacing, font, type Palette } from '../../theme';
import { bindDialogHost } from './controller';
import { ioniconFor, inferIcon } from './icons';
import type {
  DialogButton,
  DialogOptions,
  HostRequest,
  PromptOptions,
  SheetOptions,
  DialogTone,
} from './types';

const RADIUS = 26;

export default function DialogHost() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, width), [colors, width]);
  const [req, setReq] = useState<HostRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<HostRequest[]>([]);
  const promptValues = useRef<Record<string, string>>({});
  const [, bump] = useState(0);

  const presentNext = useCallback(() => {
    if (req) return;
    const next = queue.current.shift();
    if (next) {
      if (next.kind === 'prompt') {
        const init: Record<string, string> = {};
        next.opts.fields.forEach((f) => {
          init[f.key] = f.initial ?? '';
        });
        promptValues.current = init;
      }
      setReq(next);
    }
  }, [req]);

  useEffect(() => {
    bindDialogHost({
      enqueue: (r) => {
        queue.current.push(r);
        // Defer so we don't setState during another component's render.
        requestAnimationFrame(() => presentNext());
      },
    });
    return () => bindDialogHost(null);
  }, [presentNext]);

  useEffect(() => {
    if (!req) presentNext();
  }, [req, presentNext]);

  const dismiss = useCallback(() => {
    const current = req;
    setReq(null);
    setBusy(false);
    current?.resolve();
    requestAnimationFrame(() => presentNext());
  }, [req, presentNext]);

  const runButton = async (btn?: DialogButton | { onPress?: () => void | Promise<void> }) => {
    if (busy) return;
    try {
      if (btn?.onPress) {
        setBusy(true);
        await btn.onPress();
      }
    } finally {
      dismiss();
    }
  };

  if (!req) return null;

  const backdrop = (
    <Pressable
      style={styles.backdrop}
      onPress={() => {
        if (req.kind === 'alert' && req.opts.dismissible !== false) {
          const cancel = req.opts.buttons?.find(
            (b) => b.style === 'cancel' || b.role === 'cancel',
          );
          void runButton(cancel ?? { onPress: undefined });
        } else if (req.kind === 'sheet') {
          dismiss();
        } else if (req.kind === 'prompt') {
          req.opts.onCancel?.();
          dismiss();
        }
      }}
    />
  );

  if (req.kind === 'sheet') {
    return (
      <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
        <View style={styles.root}>
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={StyleSheet.absoluteFill}>
            {backdrop}
          </Animated.View>
          <Animated.View
            entering={SlideInDown.springify().damping(18).stiffness(180)}
            exiting={SlideOutDown.duration(180)}
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
          >
            <View style={styles.handle} />
            {!!req.opts.title && <Text style={styles.sheetTitle}>{req.opts.title}</Text>}
            {!!req.opts.message && <Text style={styles.sheetMsg}>{req.opts.message}</Text>}
            <View style={styles.sheetActions}>
              {req.opts.actions.map((a, i) => {
                const role = a.style ?? 'default';
                const icon = ioniconFor(a.icon);
                const color =
                  role === 'destructive'
                    ? colors.danger
                    : role === 'primary'
                      ? colors.primary
                      : colors.text;
                return (
                  <Pressable
                    key={`${a.text}-${i}`}
                    style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
                    onPress={() => void runButton(a)}
                    disabled={busy}
                  >
                    {icon && (
                      <View style={[styles.sheetIconWrap, role === 'destructive' && { backgroundColor: colors.danger + '22' }]}>
                        <Ionicons name={icon} size={20} color={color} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sheetActionText, { color }]}>{a.text}</Text>
                      {!!a.subtitle && <Text style={styles.sheetSub}>{a.subtitle}</Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]}
              onPress={dismiss}
            >
              <Text style={styles.sheetCancelText}>{req.opts.cancelText ?? 'Cancel'}</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
    );
  }

  if (req.kind === 'prompt') {
    const opts = req.opts;
    const iconName = ioniconFor(opts.icon ?? inferIcon(opts.title, opts.tone));
    return (
      <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => { opts.onCancel?.(); dismiss(); }}>
        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Animated.View entering={FadeIn.duration(180)} style={StyleSheet.absoluteFill}>
            {backdrop}
          </Animated.View>
          <Animated.View
            entering={ZoomIn.duration(220).easing(Easing.out(Easing.cubic))}
            exiting={ZoomOut.duration(140)}
            style={styles.card}
          >
            <DialogHeader
              styles={styles}
              colors={colors}
              title={opts.title}
              message={opts.message}
              tone={opts.tone}
              iconName={iconName}
            />
            {opts.fields.map((f) => (
              <TextInput
                key={f.key}
                style={[styles.input, f.multiline && styles.inputMulti]}
                placeholder={f.placeholder}
                placeholderTextColor={colors.textFaint}
                defaultValue={f.initial ?? ''}
                secureTextEntry={f.secure}
                keyboardType={f.keyboardType}
                multiline={f.multiline}
                onChangeText={(t) => {
                  promptValues.current[f.key] = t;
                  bump((n) => n + 1);
                }}
              />
            ))}
            <View style={styles.btnCol}>
              <DialogBtn
                styles={styles}
                colors={colors}
                label={opts.submitLabel ?? 'Save'}
                role="primary"
                busy={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await opts.onSubmit({ ...promptValues.current });
                  } finally {
                    dismiss();
                  }
                }}
              />
              <DialogBtn
                styles={styles}
                colors={colors}
                label={opts.cancelLabel ?? 'Cancel'}
                role="cancel"
                onPress={() => {
                  opts.onCancel?.();
                  dismiss();
                }}
              />
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  // alert / confirm
  const opts = req.opts;
  const buttons =
    opts.buttons && opts.buttons.length
      ? opts.buttons
      : [{ text: 'OK', style: 'primary' as const }];
  const tone = opts.tone ?? (buttons.some((b) => b.style === 'destructive' || b.role === 'destructive') ? 'danger' : 'default');
  const iconName = ioniconFor(opts.icon ?? inferIcon(opts.title, tone));

  // Order: primary/destructive first (Telegram-style stacked), cancel last
  const ordered = [...buttons].sort((a, b) => {
    const rank = (x: DialogButton) => {
      const r = x.role ?? x.style ?? 'default';
      if (r === 'destructive' || r === 'primary') return 0;
      if (r === 'default') return 1;
      return 2; // cancel
    };
    return rank(a) - rank(b);
  });

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => void runButton(buttons.find((b) => b.style === 'cancel' || b.role === 'cancel'))}>
      <View style={styles.root}>
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={StyleSheet.absoluteFill}>
          {backdrop}
        </Animated.View>
        <Animated.View
          entering={ZoomIn.duration(240).easing(Easing.out(Easing.cubic))}
          exiting={ZoomOut.duration(140)}
          style={styles.card}
        >
          <DialogHeader
            styles={styles}
            colors={colors}
            title={opts.title}
            message={opts.message}
            tone={tone}
            iconName={iconName}
          />
          <View style={styles.btnCol}>
            {ordered.map((b, i) => (
              <DialogBtn
                key={`${b.text}-${i}`}
                styles={styles}
                colors={colors}
                label={b.text}
                role={(b.role ?? b.style ?? (i === 0 && ordered.length === 1 ? 'primary' : 'default')) as any}
                busy={busy}
                onPress={() => void runButton(b)}
              />
            ))}
          </View>
          {busy && (
            <View style={styles.busyOverlay}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function DialogHeader({
  styles,
  colors,
  title,
  message,
  tone,
  iconName,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: Palette;
  title: string;
  message?: string;
  tone?: DialogTone | string;
  iconName: ReturnType<typeof ioniconFor>;
}) {
  const iconBg =
    tone === 'danger'
      ? colors.danger + '1F'
      : tone === 'success'
        ? colors.primary + '1F'
        : tone === 'warning'
          ? '#F5B94222'
          : colors.primary + '18';
  const iconColor =
    tone === 'danger'
      ? colors.danger
      : tone === 'success'
        ? colors.primary
        : tone === 'warning'
          ? '#E5A400'
          : colors.primary;

  return (
    <View style={styles.header}>
      {iconName && (
        <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
          <Ionicons name={iconName} size={28} color={iconColor} />
        </View>
      )}
      <Text style={styles.title}>{title}</Text>
      {!!message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

function DialogBtn({
  styles,
  colors,
  label,
  role,
  onPress,
  busy,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: Palette;
  label: string;
  role: 'default' | 'cancel' | 'destructive' | 'primary';
  onPress: () => void;
  busy?: boolean;
}) {
  const isPrimary = role === 'primary';
  const isDanger = role === 'destructive';
  const isCancel = role === 'cancel';
  return (
    <Pressable
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        isPrimary && { backgroundColor: colors.primary },
        isDanger && { backgroundColor: colors.danger },
        isCancel && styles.btnCancel,
        !isPrimary && !isDanger && !isCancel && styles.btnSecondary,
        pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
      ]}
    >
      <Text
        style={[
          styles.btnText,
          (isPrimary || isDanger) && { color: '#fff' },
          isCancel && { color: colors.textMuted },
          !isPrimary && !isDanger && !isCancel && { color: colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette, width: number) =>
  StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: spacing(5),
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.isLight ? 'rgba(15, 23, 28, 0.45)' : 'rgba(0, 0, 0, 0.62)',
    },
    card: {
      width: Math.min(width - 40, 360),
      backgroundColor: colors.surface,
      borderRadius: RADIUS,
      paddingTop: spacing(6),
      paddingBottom: spacing(4),
      paddingHorizontal: spacing(4),
      // Premium elevation
      shadowColor: '#000',
      shadowOpacity: colors.isLight ? 0.18 : 0.45,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 14 },
      elevation: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    header: { alignItems: 'center', paddingHorizontal: spacing(2), marginBottom: spacing(4) },
    iconCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing(3),
    },
    title: {
      color: colors.text,
      fontSize: 19,
      fontWeight: '700',
      textAlign: 'center',
      letterSpacing: -0.2,
    },
    message: {
      color: colors.textMuted,
      fontSize: font.body,
      lineHeight: 21,
      textAlign: 'center',
      marginTop: spacing(2),
      paddingHorizontal: spacing(1),
    },
    btnCol: { gap: spacing(2), marginTop: spacing(1) },
    btn: {
      minHeight: 50,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing(4),
    },
    btnSecondary: {
      backgroundColor: colors.surfaceAlt,
    },
    btnCancel: {
      backgroundColor: 'transparent',
      minHeight: 44,
    },
    btnText: {
      fontSize: 16,
      fontWeight: '600',
    },
    input: {
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      borderRadius: 14,
      paddingHorizontal: spacing(3.5),
      paddingVertical: spacing(3),
      fontSize: font.body,
      marginBottom: spacing(2),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    inputMulti: { minHeight: 88, textAlignVertical: 'top' },
    busyOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.isLight ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.35)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Sheet
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.surface,
      borderTopLeftRadius: RADIUS,
      borderTopRightRadius: RADIUS,
      paddingTop: spacing(2),
      paddingHorizontal: spacing(4),
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: -6 },
      elevation: 24,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.textFaint,
      marginBottom: spacing(3),
      opacity: 0.55,
    },
    sheetTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: spacing(1),
    },
    sheetMsg: {
      color: colors.textMuted,
      fontSize: font.small,
      textAlign: 'center',
      marginBottom: spacing(3),
      lineHeight: 18,
    },
    sheetActions: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 18,
      overflow: 'hidden',
      marginBottom: spacing(2),
    },
    sheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing(3.5),
      paddingHorizontal: spacing(3.5),
      gap: spacing(3),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    sheetIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetActionText: { fontSize: 16, fontWeight: '600' },
    sheetSub: { color: colors.textMuted, fontSize: font.tiny, marginTop: 2 },
    sheetCancel: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 16,
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing(1),
    },
    sheetCancelText: { color: colors.text, fontSize: 16, fontWeight: '700' },
    pressed: { opacity: 0.85 },
  });
