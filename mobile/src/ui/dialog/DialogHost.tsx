// Lumixo — global premium dialog / sheet host (Telegram-level polish).
// Mount once near the app root. Imperative API lives in `controller.ts`.
//
// Performance contract for action sheets (WhatsApp parity):
//  • Sheet shell is always mounted (never cold-start a Modal).
//  • Open is a Reanimated translate/opacity only — target <100 ms to first paint.
//  • enqueue() presents on the same JS turn (no requestAnimationFrame deferral).
//  • No network / no list work here — content is already in the request payload.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
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
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
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
// Snappy open/close — WhatsApp-class, not a slow spring from off-screen.
const OPEN_MS = 160;
const CLOSE_MS = 130;
const OPEN_EASING = Easing.out(Easing.cubic);
const CLOSE_EASING = Easing.in(Easing.cubic);

export default function DialogHost() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, width), [colors, width]);

  const [req, setReq] = useState<HostRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<HostRequest[]>([]);
  const reqRef = useRef<HostRequest | null>(null);
  const promptValues = useRef<Record<string, string>>({});
  const [, bump] = useState(0);
  // Last sheet payload kept so the pre-mounted shell can re-render content
  // without waiting for a cold mount of action rows.
  const [sheetOpts, setSheetOpts] = useState<SheetOptions | null>(null);
  const [alertOpts, setAlertOpts] = useState<DialogOptions | null>(null);
  const [promptOpts, setPromptOpts] = useState<PromptOptions | null>(null);

  // Separate progress so the pre-mounted sheet never slides up for alerts/prompts.
  const sheetProgress = useSharedValue(0);
  const cardProgress = useSharedValue(0);
  const backdropProgress = useSharedValue(0);
  // Full-screen travel so a tall action list never peeks while closed.
  const sheetTravel = height;

  const clearAfterClose = useCallback(() => {
    const finished = reqRef.current;
    reqRef.current = null;
    setReq(null);
    setBusy(false);
    setAlertOpts(null);
    setPromptOpts(null);
    // Keep sheetOpts so the next open only swaps labels (no empty flash).
    finished?.resolve();
    // Drain queue on next tick of the JS loop (not rAF — lower latency).
    queueMicrotask(() => {
      if (!reqRef.current) presentNextRef.current();
    });
  }, []);

  const presentNextRef = useRef<() => void>(() => {});

  const presentNext = useCallback(() => {
    if (reqRef.current) return;
    const next = queue.current.shift();
    if (!next) return;

    reqRef.current = next;
    if (next.kind === 'prompt') {
      const init: Record<string, string> = {};
      next.opts.fields.forEach((f) => {
        init[f.key] = f.initial ?? '';
      });
      promptValues.current = init;
      setPromptOpts(next.opts);
      setAlertOpts(null);
    } else if (next.kind === 'sheet') {
      // Stage content before animation so first paint already has the right rows.
      setSheetOpts(next.opts);
      setAlertOpts(null);
      setPromptOpts(null);
    } else {
      setAlertOpts(next.opts);
      setPromptOpts(null);
    }

    setReq(next);
    backdropProgress.value = withTiming(1, { duration: OPEN_MS, easing: OPEN_EASING });
    if (next.kind === 'sheet') {
      sheetProgress.value = withTiming(1, { duration: OPEN_MS, easing: OPEN_EASING });
      cardProgress.value = 0;
    } else {
      cardProgress.value = withTiming(1, { duration: OPEN_MS, easing: OPEN_EASING });
      sheetProgress.value = 0;
    }
  }, [backdropProgress, sheetProgress, cardProgress]);

  presentNextRef.current = presentNext;

  useEffect(() => {
    bindDialogHost({
      enqueue: (r) => {
        queue.current.push(r);
        // Same JS turn when idle — critical for <100 ms menu open.
        presentNextRef.current();
      },
    });
    return () => bindDialogHost(null);
  }, []);

  const dismiss = useCallback(() => {
    if (!reqRef.current) return;
    const kind = reqRef.current.kind;
    backdropProgress.value = withTiming(0, { duration: CLOSE_MS, easing: CLOSE_EASING });
    if (kind === 'sheet') {
      sheetProgress.value = withTiming(0, { duration: CLOSE_MS, easing: CLOSE_EASING }, (finished) => {
        if (finished) runOnJS(clearAfterClose)();
      });
    } else {
      cardProgress.value = withTiming(0, { duration: CLOSE_MS, easing: CLOSE_EASING }, (finished) => {
        if (finished) runOnJS(clearAfterClose)();
      });
    }
  }, [backdropProgress, sheetProgress, cardProgress, clearAfterClose]);

  // Android hardware back closes the active dialog/sheet.
  useEffect(() => {
    if (!req) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [req, dismiss]);

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

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - sheetProgress.value) * sheetTravel }],
    // Fully hide when closed so it never intercepts layout/compositing cost on lists.
    opacity: sheetProgress.value === 0 ? 0 : 1,
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropProgress.value * (colors.isLight ? 0.45 : 0.62),
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardProgress.value,
    transform: [{ scale: 0.94 + cardProgress.value * 0.06 }],
  }));

  const open = !!req;
  const kind = req?.kind ?? null;

  // Always-mounted host: pointer-events off when idle so the list stays fully interactive.
  return (
    <View
      style={styles.host}
      pointerEvents={open ? 'auto' : 'none'}
      collapsable={false}
    >
      <Animated.View
        style={[styles.backdropFill, backdropStyle]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (!req) return;
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
      </Animated.View>

      {/* ── Pre-mounted action sheet (chat long-press path) ───────────────── */}
      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, 16) + 8 },
          sheetStyle,
        ]}
        pointerEvents={kind === 'sheet' && open ? 'auto' : 'none'}
      >
        <View style={styles.handle} />
        {!!sheetOpts?.title && <Text style={styles.sheetTitle}>{sheetOpts.title}</Text>}
        {!!sheetOpts?.message && <Text style={styles.sheetMsg}>{sheetOpts.message}</Text>}
        <View style={styles.sheetActions}>
          {(sheetOpts?.actions ?? []).map((a, i) => {
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
                disabled={busy || kind !== 'sheet'}
              >
                {icon && (
                  <View
                    style={[
                      styles.sheetIconWrap,
                      role === 'destructive' && { backgroundColor: colors.danger + '22' },
                    ]}
                  >
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
          disabled={kind !== 'sheet'}
        >
          <Text style={styles.sheetCancelText}>{sheetOpts?.cancelText ?? 'Cancel'}</Text>
        </Pressable>
      </Animated.View>

      {/* ── Alert / confirm card ──────────────────────────────────────────── */}
      {kind === 'alert' && alertOpts && (
        <View style={styles.centerWrap} pointerEvents="box-none">
          <Animated.View style={[styles.card, cardStyle]}>
            <AlertBody
              styles={styles}
              colors={colors}
              opts={alertOpts}
              busy={busy}
              onPress={(b) => void runButton(b)}
            />
          </Animated.View>
        </View>
      )}

      {/* ── Prompt card ───────────────────────────────────────────────────── */}
      {kind === 'prompt' && promptOpts && (
        <KeyboardAvoidingView
          style={styles.centerWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
        >
          <Animated.View style={[styles.card, cardStyle]}>
            <PromptBody
              styles={styles}
              colors={colors}
              opts={promptOpts}
              busy={busy}
              promptValues={promptValues}
              bump={() => bump((n) => n + 1)}
              onSubmit={async () => {
                setBusy(true);
                try {
                  await promptOpts.onSubmit({ ...promptValues.current });
                } finally {
                  dismiss();
                }
              }}
              onCancel={() => {
                promptOpts.onCancel?.();
                dismiss();
              }}
            />
          </Animated.View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

function AlertBody({
  styles,
  colors,
  opts,
  busy,
  onPress,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: Palette;
  opts: DialogOptions;
  busy: boolean;
  onPress: (b: DialogButton) => void;
}) {
  const buttons =
    opts.buttons && opts.buttons.length
      ? opts.buttons
      : [{ text: 'OK', style: 'primary' as const }];
  const tone =
    opts.tone ??
    (buttons.some((b) => b.style === 'destructive' || b.role === 'destructive')
      ? 'danger'
      : 'default');
  const iconName = ioniconFor(opts.icon ?? inferIcon(opts.title, tone));

  const ordered = [...buttons].sort((a, b) => {
    const rank = (x: DialogButton) => {
      const r = x.role ?? x.style ?? 'default';
      if (r === 'destructive' || r === 'primary') return 0;
      if (r === 'default') return 1;
      return 2;
    };
    return rank(a) - rank(b);
  });

  return (
    <>
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
            role={
              (b.role ??
                b.style ??
                (i === 0 && ordered.length === 1 ? 'primary' : 'default')) as any
            }
            busy={busy}
            onPress={() => onPress(b)}
          />
        ))}
      </View>
      {busy && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
    </>
  );
}

function PromptBody({
  styles,
  colors,
  opts,
  busy,
  promptValues,
  bump,
  onSubmit,
  onCancel,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: Palette;
  opts: PromptOptions;
  busy: boolean;
  promptValues: React.MutableRefObject<Record<string, string>>;
  bump: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const iconName = ioniconFor(opts.icon ?? inferIcon(opts.title, opts.tone));
  return (
    <>
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
            bump();
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
          onPress={onSubmit}
        />
        <DialogBtn
          styles={styles}
          colors={colors}
          label={opts.cancelLabel ?? 'Cancel'}
          role="cancel"
          onPress={onCancel}
        />
      </View>
    </>
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
    host: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 100000,
      elevation: 100000,
    },
    backdropFill: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.isLight ? 'rgb(15, 23, 28)' : 'rgb(0, 0, 0)',
    },
    centerWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: spacing(5),
    },
    card: {
      width: Math.min(width - 40, 360),
      backgroundColor: colors.surface,
      borderRadius: RADIUS,
      paddingTop: spacing(6),
      paddingBottom: spacing(4),
      paddingHorizontal: spacing(4),
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
