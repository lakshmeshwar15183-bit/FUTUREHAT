// Lumixo mobile — schedule a message for later (premium; web ChatView
// "Scheduling"). Shows a read-only preview of the current draft plus the shared
// inline date/time picker; confirming returns the chosen future Date to the
// caller, which persists it via scheduleMessage(). Rejects past times (parity
// with web handleSchedule "Pick a future time").
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import InlineDateTimePicker, {
  type DateTimeSel, nextQuarterHour, resolveDate,
} from './InlineDateTimePicker';

interface Props {
  visible: boolean;
  draft: string;
  onCancel: () => void;
  onConfirm: (when: Date) => void;
}

export default function ScheduleMessageModal({ visible, draft, onCancel, onConfirm }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [anchor, setAnchor] = useState(() => new Date());
  const [sel, setSel] = useState<DateTimeSel>({ dayOffset: 0, hour: 0, minute: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const now = new Date();
    const q = nextQuarterHour(now);
    setAnchor(now);
    setSel({ dayOffset: 0, hour: q.hour, minute: q.minute });
    setError(null);
  }, [visible]);

  function confirm() {
    const when = resolveDate(anchor, sel);
    if (when.getTime() <= Date.now()) { setError('Pick a future time'); return; }
    onConfirm(when);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Schedule message</Text>

          <View style={styles.preview}>
            <Text style={styles.previewText} numberOfLines={3}>{draft || 'Your message'}</Text>
          </View>

          <InlineDateTimePicker anchor={anchor} value={sel} onChange={(s) => { setSel(s); setError(null); }} />

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <Pressable onPress={onCancel} hitSlop={8}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Pressable onPress={confirm} hitSlop={8}>
              <Text style={styles.submit}>Schedule</Text>
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
    preview: {
      backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
      paddingHorizontal: spacing(3), paddingVertical: spacing(3),
    },
    previewText: { color: colors.text, fontSize: font.body },
    error: { color: colors.danger, fontSize: font.small, marginTop: spacing(2) },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(6), marginTop: spacing(4) },
    cancel: { color: colors.textMuted, fontSize: font.body },
    submit: { color: colors.primary, fontSize: font.body, fontWeight: '700' },
  });
