// FUTUREHAT mobile — cross-platform prompt modal (Android has no Alert.prompt).
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors, spacing, radius, font, type Palette } from '../theme';

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

export default function InputModal({ visible, title, fields, submitLabel = 'Done', onCancel, onSubmit }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [values, setValues] = useState<Record<string, string>>({});

  // Reset when opening.
  React.useEffect(() => {
    if (visible) {
      const init: Record<string, string> = {};
      fields.forEach((f) => (init[f.key] = f.initial ?? ''));
      setValues(init);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
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
          <View style={styles.actions}>
            <Pressable onPress={onCancel} hitSlop={8}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => onSubmit(values)} hitSlop={8}>
              <Text style={styles.submit}>{submitLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing(6) },
    card: { width: '100%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(5) },
    title: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: spacing(3) },
    input: {
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      borderRadius: radius.md,
      paddingHorizontal: spacing(3),
      paddingVertical: spacing(3),
      fontSize: font.body,
      marginBottom: spacing(2),
    },
    multiline: { minHeight: 70, textAlignVertical: 'top' },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(6), marginTop: spacing(3) },
    cancel: { color: colors.textMuted, fontSize: font.body },
    submit: { color: colors.primary, fontSize: font.body, fontWeight: '700' },
  });
