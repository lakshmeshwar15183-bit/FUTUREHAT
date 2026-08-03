// Lumixo — multi-field prompt modal (matches DialogHost design tokens).
import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import Animated, { Easing, FadeIn, ZoomIn } from 'react-native-reanimated';
import { useColors, type Palette } from '../theme';

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

const RADIUS = 22;
const CARD_MAX_W = 300;

export default function InputModal({
  visible,
  title,
  fields,
  submitLabel = 'Done',
  onCancel,
  onSubmit,
}: Props) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, width), [colors, width]);
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
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View entering={FadeIn.duration(160)} style={StyleSheet.absoluteFill}>
          <Pressable style={styles.backdrop} onPress={onCancel} />
        </Animated.View>
        <Animated.View
          entering={ZoomIn.duration(170)
            .easing(Easing.out(Easing.cubic))
            .withInitialValues({ transform: [{ scale: 0.96 }], opacity: 0 })}
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
          <View style={styles.btnRow}>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnCancel, pressed && styles.pressed]}
              onPress={onCancel}
            >
              <Text style={[styles.btnText, { color: colors.textMuted }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                { backgroundColor: colors.primary },
                pressed && styles.pressed,
              ]}
              onPress={() => onSubmit(values)}
            >
              <Text style={[styles.btnText, styles.btnTextOnFill]}>{submitLabel}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Palette, width: number) =>
  StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 28,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.isLight ? 'rgba(12,18,22,0.4)' : 'rgba(0,0,0,0.55)',
    },
    card: {
      width: Math.min(width - 56, CARD_MAX_W),
      backgroundColor: colors.surface,
      borderRadius: RADIUS,
      paddingTop: 18,
      paddingBottom: 14,
      paddingHorizontal: 16,
      shadowColor: '#000',
      shadowOpacity: colors.isLight ? 0.12 : 0.4,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
    },
    title: {
      color: colors.text,
      fontSize: 16.5,
      fontWeight: '700',
      textAlign: 'center',
      letterSpacing: -0.25,
      lineHeight: 21,
      marginBottom: 12,
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
    multiline: {
      minHeight: 76,
      textAlignVertical: 'top',
      paddingTop: 10,
    },
    btnRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 2,
    },
    btn: {
      flex: 1,
      height: 44,
      minHeight: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    btnCancel: {
      backgroundColor: colors.surfaceAlt,
    },
    btnPrimary: {},
    btnText: {
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: -0.1,
    },
    btnTextOnFill: {
      color: '#fff',
    },
    pressed: {
      opacity: 0.88,
      transform: [{ scale: 0.985 }],
    },
  });
