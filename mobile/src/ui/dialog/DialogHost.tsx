// Lumixo — global dialog / sheet host (WhatsApp / Telegram / iMessage class).
// Mount once near the app root. Imperative API lives in `controller.ts`.
//
// Design system (production messaging, not game/prototype):
//  • Compact cards (~20–30% smaller than v1): max ~300pt, tight padding
//  • Icons 44–48pt, not oversized circles
//  • Typography: title 16–17 bold · body 13 muted · buttons 15
//  • Material-height buttons (44pt) · radius 20–22
//  • Subtle shadow / hairline border · no bulky empty regions
//  • Alerts: fast fade + scale 170ms
//  • Sheets: always-mounted shell, slide up ~180ms (WhatsApp parity)
//  • enqueue() presents same JS turn (no rAF deferral)
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
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors, motion, ease, radius as sysRadius, type Palette } from '../../theme';
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

// ── Design tokens (aligned with global design system) ────────────────────────
const RADIUS = sysRadius.xl + 2; // 22
const SHEET_RADIUS = sysRadius.xl;
const ICON_SIZE = 44;
const ICON_GLYPH = 22;
const CARD_MAX_W = 300;
const OPEN_MS = motion.openMs;
const CLOSE_MS = motion.closeMs;
const SHEET_OPEN_MS = motion.sheetOpenMs;
const SHEET_CLOSE_MS = motion.sheetCloseMs;
const OPEN_EASING = ease.out;
const CLOSE_EASING = ease.in;
const SHEET_EASING = ease.sheet;

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
  const [sheetOpts, setSheetOpts] = useState<SheetOptions | null>(null);
  const [alertOpts, setAlertOpts] = useState<DialogOptions | null>(null);
  const [promptOpts, setPromptOpts] = useState<PromptOptions | null>(null);

  const sheetProgress = useSharedValue(0);
  const cardProgress = useSharedValue(0);
  const backdropProgress = useSharedValue(0);
  const sheetTravel = height;

  const clearAfterClose = useCallback(() => {
    const finished = reqRef.current;
    reqRef.current = null;
    setReq(null);
    setBusy(false);
    setAlertOpts(null);
    setPromptOpts(null);
    finished?.resolve();
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
      setSheetOpts(next.opts);
      setAlertOpts(null);
      setPromptOpts(null);
    } else {
      setAlertOpts(next.opts);
      setPromptOpts(null);
    }

    setReq(next);
    backdropProgress.value = withTiming(1, {
      duration: next.kind === 'sheet' ? SHEET_OPEN_MS : OPEN_MS,
      easing: OPEN_EASING,
    });
    if (next.kind === 'sheet') {
      sheetProgress.value = withTiming(1, { duration: SHEET_OPEN_MS, easing: SHEET_EASING });
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
        presentNextRef.current();
      },
    });
    return () => bindDialogHost(null);
  }, []);

  const dismiss = useCallback(() => {
    if (!reqRef.current) return;
    const kind = reqRef.current.kind;
    backdropProgress.value = withTiming(0, {
      duration: kind === 'sheet' ? SHEET_CLOSE_MS : CLOSE_MS,
      easing: CLOSE_EASING,
    });
    if (kind === 'sheet') {
      sheetProgress.value = withTiming(
        0,
        { duration: SHEET_CLOSE_MS, easing: CLOSE_EASING },
        (finished) => {
          if (finished) runOnJS(clearAfterClose)();
        },
      );
    } else {
      cardProgress.value = withTiming(
        0,
        { duration: CLOSE_MS, easing: CLOSE_EASING },
        (finished) => {
          if (finished) runOnJS(clearAfterClose)();
        },
      );
    }
  }, [backdropProgress, sheetProgress, cardProgress, clearAfterClose]);

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
    const press = btn?.onPress;
    const kind = reqRef.current?.kind;

    // Sheets: dismiss FIRST, then run the action after the close animation.
    // Prevents stacked UI (e.g. sheet still visible under a Delete confirm).
    if (kind === 'sheet') {
      dismiss();
      if (press) {
        setTimeout(() => {
          void Promise.resolve()
            .then(() => press())
            .catch(() => {});
        }, motion.sheetCloseMs + 24);
      }
      return;
    }

    // Alerts / prompts: run action, then dismiss (supports async work + busy spinner).
    try {
      if (press) {
        setBusy(true);
        await press();
      }
    } finally {
      dismiss();
    }
  };

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - sheetProgress.value) * sheetTravel }],
    opacity: sheetProgress.value === 0 ? 0 : 1,
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropProgress.value * (colors.isLight ? 0.4 : 0.55),
  }));

  // Fade + slight scale from 0.96 → 1 (subtle, not bouncy).
  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardProgress.value,
    transform: [{ scale: 0.96 + cardProgress.value * 0.04 }],
  }));

  const open = !!req;
  const kind = req?.kind ?? null;

  // When idle, render nothing — a full-screen host with 0-opacity backdrop was
  // still stacking over Chat on some OEMs and washing out message opacity.
  if (!open) return null;

  return (
    <View
      style={styles.host}
      pointerEvents="auto"
      collapsable={false}
    >
      <Animated.View
        style={[styles.backdropFill, backdropStyle]}
        pointerEvents="auto"
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

      {/* ── Action sheet (WhatsApp-class bottom sheet) ───────────────────── */}
      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, 10) + 6 },
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
            const last = i === (sheetOpts?.actions?.length ?? 0) - 1;
            return (
              <Pressable
                key={`${a.text}-${i}`}
                style={({ pressed }) => [
                  styles.sheetRow,
                  !last && styles.sheetRowBorder,
                  pressed && styles.pressed,
                ]}
                onPress={() => void runButton(a)}
                disabled={busy || kind !== 'sheet'}
              >
                {icon && (
                  <View
                    style={[
                      styles.sheetIconWrap,
                      role === 'destructive' && { backgroundColor: colors.danger + '18' },
                    ]}
                  >
                    <Ionicons name={icon} size={18} color={color} />
                  </View>
                )}
                <View style={styles.sheetTextCol}>
                  <Text style={[styles.sheetActionText, { color }]} numberOfLines={1}>
                    {a.text}
                  </Text>
                  {!!a.subtitle && (
                    <Text style={styles.sheetSub} numberOfLines={2}>
                      {a.subtitle}
                    </Text>
                  )}
                </View>
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

      {/* ── Alert / confirm card ─────────────────────────────────────────── */}
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

      {/* ── Prompt card ──────────────────────────────────────────────────── */}
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

  // Material / iMessage: 2-button confirms lay out horizontally (action | cancel).
  // 1 or 3+ buttons stay compact vertical stack.
  const horizontal =
    buttons.length === 2 &&
    buttons.some((b) => (b.role ?? b.style) === 'cancel') &&
    buttons.some((b) => {
      const r = b.role ?? b.style;
      return r === 'primary' || r === 'destructive' || r === 'default';
    });

  const ordered = horizontal
    ? (() => {
        // Left = cancel, right = primary/destructive (Material RTL-safe reading order).
        const cancel = buttons.find((b) => (b.role ?? b.style) === 'cancel');
        const action = buttons.find((b) => (b.role ?? b.style) !== 'cancel');
        return [cancel, action].filter(Boolean) as DialogButton[];
      })()
    : [...buttons].sort((a, b) => {
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
      <View style={horizontal ? styles.btnRow : styles.btnCol}>
        {ordered.map((b, i) => (
          <DialogBtn
            key={`${b.text}-${i}`}
            styles={styles}
            colors={colors}
            label={b.text}
            role={
              (b.role ??
                b.style ??
                (i === 0 && ordered.length === 1 ? 'primary' : 'default')) as
                | 'default'
                | 'cancel'
                | 'destructive'
                | 'primary'
            }
            busy={busy}
            flex={horizontal}
            onPress={() => onPress(b)}
          />
        ))}
      </View>
      {busy && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator color={colors.primary} size="small" />
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
      <View style={styles.btnRow}>
        <DialogBtn
          styles={styles}
          colors={colors}
          label={opts.cancelLabel ?? 'Cancel'}
          role="cancel"
          flex
          onPress={onCancel}
        />
        <DialogBtn
          styles={styles}
          colors={colors}
          label={opts.submitLabel ?? 'Save'}
          role="primary"
          busy={busy}
          flex
          onPress={onSubmit}
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
      ? colors.danger + '18'
      : tone === 'success'
        ? colors.primary + '18'
        : tone === 'warning'
          ? '#F5B94220'
          : colors.primary + '14';
  const iconColor =
    tone === 'danger'
      ? colors.danger
      : tone === 'success'
        ? colors.primary
        : tone === 'warning'
          ? '#C99200'
          : colors.primary;

  return (
    <View style={styles.header}>
      {iconName && (
        <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
          <Ionicons name={iconName} size={ICON_GLYPH} color={iconColor} />
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
  flex,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: Palette;
  label: string;
  role: 'default' | 'cancel' | 'destructive' | 'primary';
  onPress: () => void;
  busy?: boolean;
  flex?: boolean;
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
        flex && styles.btnFlex,
        isPrimary && { backgroundColor: colors.primary },
        isDanger && { backgroundColor: colors.danger },
        isCancel && styles.btnCancel,
        !isPrimary && !isDanger && !isCancel && styles.btnSecondary,
        pressed && styles.btnPressed,
      ]}
    >
      <Text
        style={[
          styles.btnText,
          (isPrimary || isDanger) && styles.btnTextOnFill,
          isCancel && { color: colors.textMuted },
          !isPrimary && !isDanger && !isCancel && { color: colors.text },
        ]}
        numberOfLines={1}
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
      backgroundColor: colors.isLight ? 'rgb(12, 18, 22)' : 'rgb(0, 0, 0)',
    },
    centerWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 28,
    },
    card: {
      width: Math.min(width - 56, CARD_MAX_W),
      backgroundColor: colors.surface,
      borderRadius: RADIUS,
      paddingTop: 18,
      paddingBottom: 14,
      paddingHorizontal: 16,
      // Subtle elevation — not a bulky floating brick.
      shadowColor: '#000',
      shadowOpacity: colors.isLight ? 0.12 : 0.4,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
      overflow: 'hidden',
    },
    header: {
      alignItems: 'center',
      paddingHorizontal: 4,
      marginBottom: 14,
    },
    iconCircle: {
      width: ICON_SIZE,
      height: ICON_SIZE,
      borderRadius: ICON_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
    },
    title: {
      color: colors.text,
      fontSize: 16.5,
      fontWeight: '700',
      textAlign: 'center',
      letterSpacing: -0.25,
      lineHeight: 21,
    },
    message: {
      color: colors.textMuted,
      fontSize: 13.5,
      lineHeight: 18.5,
      textAlign: 'center',
      marginTop: 6,
      paddingHorizontal: 2,
    },
    btnCol: {
      gap: 8,
    },
    btnRow: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'stretch',
    },
    btn: {
      minHeight: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
    },
    btnFlex: {
      flex: 1,
      minWidth: 0,
    },
    btnSecondary: {
      backgroundColor: colors.surfaceAlt,
    },
    btnCancel: {
      backgroundColor: colors.surfaceAlt,
    },
    btnPressed: {
      opacity: 0.88,
      transform: [{ scale: 0.985 }],
    },
    btnText: {
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: -0.1,
    },
    btnTextOnFill: {
      color: '#fff',
    },
    input: {
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === 'ios' ? 11 : 9,
      fontSize: 15,
      marginBottom: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      minHeight: 44,
    },
    inputMulti: {
      minHeight: 76,
      textAlignVertical: 'top',
      paddingTop: 10,
    },
    busyOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.isLight ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)',
      alignItems: 'center',
      justifyContent: 'center',
    },

    // ── Bottom sheet ──────────────────────────────────────────────────────
    sheet: {
      position: 'absolute',
      left: 8,
      right: 8,
      bottom: 0,
      backgroundColor: colors.surface,
      borderTopLeftRadius: SHEET_RADIUS,
      borderTopRightRadius: SHEET_RADIUS,
      borderBottomLeftRadius: Platform.OS === 'ios' ? SHEET_RADIUS : 0,
      borderBottomRightRadius: Platform.OS === 'ios' ? SHEET_RADIUS : 0,
      paddingTop: 8,
      paddingHorizontal: 10,
      shadowColor: '#000',
      shadowOpacity: colors.isLight ? 0.16 : 0.45,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: -4 },
      elevation: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
      // Float slightly above the home indicator on iOS (WhatsApp-style inset).
      marginBottom: Platform.OS === 'ios' ? 0 : 0,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.textFaint,
      marginBottom: 10,
      opacity: 0.45,
    },
    sheetTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: 2,
      letterSpacing: -0.15,
      paddingHorizontal: 8,
    },
    sheetMsg: {
      color: colors.textMuted,
      fontSize: 12.5,
      textAlign: 'center',
      marginBottom: 10,
      lineHeight: 17,
      paddingHorizontal: 12,
    },
    sheetActions: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 8,
    },
    sheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 11,
      paddingHorizontal: 12,
      gap: 11,
      minHeight: 48,
    },
    sheetRowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    sheetIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 9,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetTextCol: {
      flex: 1,
      minWidth: 0,
    },
    sheetActionText: {
      fontSize: 15.5,
      fontWeight: '600',
      letterSpacing: -0.1,
    },
    sheetSub: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 1,
      lineHeight: 15,
    },
    sheetCancel: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 14,
      minHeight: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetCancelText: {
      color: colors.text,
      fontSize: 15.5,
      fontWeight: '700',
      letterSpacing: -0.1,
    },
    pressed: { opacity: 0.82 },
  });
