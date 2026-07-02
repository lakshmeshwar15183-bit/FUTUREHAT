// FUTUREHAT mobile — community event composer with an inline date/time picker.
// Replaces the old free-text "When — YYYY-MM-DD HH:mm" field (which silently
// defaulted to now on parse failure) with a tap-only picker that can never
// produce an invalid date — web parity for datetime-local (ChatView/community
// event create). No native datepicker dependency: a horizontal day strip plus
// hour/minute steppers guarantee a valid, in-future Date.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, spacing, radius, font, type Palette } from '../theme';

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

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_STEP = 15;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function nextQuarterHour(now: Date): { hour: number; minute: number } {
  const m = Math.ceil(now.getMinutes() / MINUTE_STEP) * MINUTE_STEP;
  if (m >= 60) return { hour: (now.getHours() + 1) % 24, minute: 0 };
  return { hour: now.getHours(), minute: m };
}

function dayLabel(d: Date, today: Date): string {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(today).getTime()) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function fmtTime(hour: number, minute: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return `${h}:${minute.toString().padStart(2, '0')} ${ampm}`;
}

export default function EventComposerModal({ visible, onCancel, onSubmit }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [dayOffset, setDayOffset] = useState(0); // 0..29 from today
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);

  // The 30-day strip is stable across a single open; anchor it on mount/open.
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    if (!visible) return;
    const now = new Date();
    const q = nextQuarterHour(now);
    setToday(now);
    setTitle('');
    setLocation('');
    setDayOffset(0);
    setHour(q.hour);
    setMinute(q.minute);
  }, [visible]);

  const days = useMemo(() => {
    const base = startOfDay(today);
    return Array.from({ length: 30 }, (_, i) => new Date(base.getTime() + i * DAY_MS));
  }, [today]);

  const stepHour = (dir: 1 | -1) => setHour((h) => (h + dir + 24) % 24);
  const stepMinute = (dir: 1 | -1) =>
    setMinute((m) => (m + dir * MINUTE_STEP + 60) % 60);

  function submit() {
    const t = title.trim();
    if (!t) return; // require a title (Create stays disabled otherwise)
    const start = new Date(days[dayOffset]);
    start.setHours(hour, minute, 0, 0);
    onSubmit({ title: t, location: location.trim(), startsAt: start.toISOString() });
  }

  const canSubmit = title.trim().length > 0;

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

          <Text style={styles.sectionLabel}>Date</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayStrip}
          >
            {days.map((d, i) => {
              const active = i === dayOffset;
              return (
                <Pressable
                  key={i}
                  onPress={() => setDayOffset(i)}
                  style={[styles.dayChip, active && styles.dayChipActive]}
                >
                  <Text style={[styles.dayChipTop, active && styles.dayChipTextActive]}>
                    {dayLabel(d, today)}
                  </Text>
                  <Text style={[styles.dayChipNum, active && styles.dayChipTextActive]}>
                    {d.getDate()}
                  </Text>
                  <Text style={[styles.dayChipMon, active && styles.dayChipTextActive]}>
                    {d.toLocaleDateString(undefined, { month: 'short' })}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.sectionLabel}>Time</Text>
          <View style={styles.timeRow}>
            <View style={styles.stepper}>
              <Pressable hitSlop={10} onPress={() => stepHour(-1)}>
                <Ionicons name="chevron-down" size={22} color={colors.primary} />
              </Pressable>
              <View style={styles.timeReadout}>
                <Text style={styles.timeText}>{fmtTime(hour, minute)}</Text>
              </View>
              <Pressable hitSlop={10} onPress={() => stepHour(1)}>
                <Ionicons name="chevron-up" size={22} color={colors.primary} />
              </Pressable>
            </View>
            <View style={styles.minuteCol}>
              <Pressable hitSlop={10} onPress={() => stepMinute(1)} style={styles.minBtn}>
                <Ionicons name="add" size={18} color={colors.primary} />
                <Text style={styles.minBtnLabel}>{MINUTE_STEP}m</Text>
              </Pressable>
              <Pressable hitSlop={10} onPress={() => stepMinute(-1)} style={styles.minBtn}>
                <Ionicons name="remove" size={18} color={colors.primary} />
                <Text style={styles.minBtnLabel}>{MINUTE_STEP}m</Text>
              </Pressable>
            </View>
          </View>

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
    sectionLabel: { color: colors.textMuted, fontSize: font.small, fontWeight: '600', marginTop: spacing(3), marginBottom: spacing(2) },
    dayStrip: { gap: spacing(2), paddingBottom: spacing(1) },
    dayChip: {
      width: 58, paddingVertical: spacing(2), borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt, alignItems: 'center',
    },
    dayChipActive: { backgroundColor: colors.primary },
    dayChipTop: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
    dayChipNum: { color: colors.text, fontSize: 18, fontWeight: '800', marginVertical: 1 },
    dayChipMon: { color: colors.textFaint, fontSize: 10 },
    dayChipTextActive: { color: '#fff' },
    timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(4) },
    stepper: {
      flexDirection: 'row', alignItems: 'center', gap: spacing(3),
      backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
      paddingHorizontal: spacing(3), paddingVertical: spacing(2),
    },
    timeReadout: { minWidth: 92, alignItems: 'center' },
    timeText: { color: colors.text, fontSize: 18, fontWeight: '700' },
    minuteCol: { gap: spacing(2) },
    minBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 2,
      backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
      paddingHorizontal: spacing(3), paddingVertical: spacing(1),
    },
    minBtnLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(6), marginTop: spacing(4) },
    cancel: { color: colors.textMuted, fontSize: font.body },
    submit: { color: colors.primary, fontSize: font.body, fontWeight: '700' },
    submitDisabled: { opacity: 0.4 },
  });
