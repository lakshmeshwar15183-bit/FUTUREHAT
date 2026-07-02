// FUTUREHAT mobile — community event composer with an inline date/time picker.
// Replaces the old free-text "When — YYYY-MM-DD HH:mm" field (which silently
// defaulted to now on parse failure) with a tap-only picker that can never
// produce an invalid date — web parity for datetime-local (community event
// create). No native datepicker dependency (see InlineDateTimePicker).
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import InlineDateTimePicker, {
  type DateTimeSel, nextQuarterHour, resolveDate,
} from './InlineDateTimePicker';

export interface EventDraft {
  title: string;
  location: string;
  startsAt: string; // ISO
}

interface Props {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (draft: EventDraft) => void;
}

export default function EventComposerModal({ visible, onCancel, onSubmit }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [anchor, setAnchor] = useState(() => new Date());
  const [sel, setSel] = useState<DateTimeSel>({ dayOffset: 0, hour: 0, minute: 0 });

  useEffect(() => {
    if (!visible) return;
    const now = new Date();
    const q = nextQuarterHour(now);
    setAnchor(now);
    setTitle('');
    setLocation('');
    setSel({ dayOffset: 0, hour: q.hour, minute: q.minute });
  }, [visible]);

  const canSubmit = title.trim().length > 0;

  function submit() {
    const t = title.trim();
    if (!t) return;
    onSubmit({ title: t, location: location.trim(), startsAt: resolveDate(anchor, sel).toISOString() });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>New event</Text>

          <TextInput
            style={styles.input}
            placeholder="Event title"
            placeholderTextColor={colors.textFaint}
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            style={styles.input}
            placeholder="Location (optional)"
            placeholderTextColor={colors.textFaint}
            value={location}
            onChangeText={setLocation}
          />

          <InlineDateTimePicker anchor={anchor} value={sel} onChange={setSel} />

          <View style={styles.actions}>
            <Pressable onPress={onCancel} hitSlop={8}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} hitSlop={8} disabled={!canSubmit}>
              <Text style={[styles.submit, !canSubmit && styles.submitDisabled]}>Create</Text>
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
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(6), marginTop: spacing(4) },
    cancel: { color: colors.textMuted, fontSize: font.body },
    submit: { color: colors.primary, fontSize: font.body, fontWeight: '700' },
    submitDisabled: { opacity: 0.4 },
  });
