// Lumixo — premium multi-field prompt (uses global dialog design tokens).
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View, KeyboardAvoidingView, Platform } from 'react-native';
import Animated, { Easing, FadeIn, ZoomIn } from 'react-native-reanimated';
import { useColors, spacing, font, type Palette } from '../theme';

export interface Field {
  key: string;
  placeholder: string;
  multiline?: boolean;
  initial?: string;
}

interface Props {
  visible: boolean;
  title: string;
  fields: Field[];
  submitLabel?: string;
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
}

const RADIUS = 26;

export default function InputModal({ visible, title, fields, submitLabel = 'Done', onCancel, onSubmit }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [values, setValues] = useState<Record<string, string>>({});

  React.useEffect(() => {
    if (visible) {
      const init: Record<string, string> = {};
      fields.forEach((f) => (init[f.key] = f.initial ?? ''));
      setValues(init);
    }
  }, [visible, fields]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View entering={FadeIn.duration(180)} style={StyleSheet.absoluteFill}>
          <Pressable style={styles.backdrop} onPress={onCancel} />
        </Animated.View>
        <Animated.View
          entering={ZoomIn.duration(220).easing(Easing.out(Easing.cubic))}
          style={styles.card}
        >
          <Text style={styles.title}>{title}</Text>
          {fields.map((f) => (
            <TextInput
              key={f.key}
              style={[styles.input, f.multiline && styles.multiline]}
              placeholder={f.placeholder}
              placeholderTextColor={colors.textFaint}
              value={values[f.key] ?? ''}
              onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: t }))}
              multiline={f.multiline}
            />
          ))}
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
            onPress={() => onSubmit(values)}
          >
            <Text style={styles.primaryText}>{submitLabel}</Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={onCancel} hitSlop={8}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing(5) },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.isLight ? 'rgba(15,23,28,0.45)' : 'rgba(0,0,0,0.62)',
    },
    card: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.surface,
      borderRadius: RADIUS,
      padding: spacing(5),
      shadowColor: '#000',
      shadowOpacity: colors.isLight ? 0.18 : 0.45,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 14 },
      elevation: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    title: {
      color: colors.text,
      fontSize: 19,
      fontWeight: '700',
      marginBottom: spacing(4),
      textAlign: 'center',
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
    multiline: { minHeight: 88, textAlignVertical: 'top' },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: 16,
      minHeight: 50,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing(3),
    },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    cancelBtn: { alignItems: 'center', paddingVertical: spacing(3), marginTop: spacing(1) },
    cancelText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  });
