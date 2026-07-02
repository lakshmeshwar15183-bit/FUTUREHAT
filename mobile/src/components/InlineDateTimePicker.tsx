// FUTUREHAT mobile — dependency-free date/time picker. A horizontal 30-day
// strip plus hour/minute steppers, so a selection is always a valid Date (no
// free-text parsing). Controlled: parent owns {dayOffset, hour, minute} and the
// `anchor` (today). Shared by EventComposerModal (C1) and ScheduleMessageModal
// (M8). Use resolveDate() to turn the selection into a concrete Date.
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, spacing, radius, type Palette } from '../theme';

export interface DateTimeSel {
  dayOffset: number; // 0..29 from anchor day
  hour: number; // 0..23
  minute: number; // 0..59 (15-min steps)
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const MINUTE_STEP = 15;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function nextQuarterHour(now: Date): { hour: number; minute: number } {
  const m = Math.ceil(now.getMinutes() / MINUTE_STEP) * MINUTE_STEP;
  if (m >= 60) return { hour: (now.getHours() + 1) % 24, minute: 0 };
  return { hour: now.getHours(), minute: m };
}

/** Concrete Date for a selection anchored on `anchor`'s day. */
export function resolveDate(anchor: Date, sel: DateTimeSel): Date {
  const d = new Date(startOfDay(anchor).getTime() + sel.dayOffset * DAY_MS);
  d.setHours(sel.hour, sel.minute, 0, 0);
  return d;
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

interface Props {
  anchor: Date;
  value: DateTimeSel;
  onChange: (next: DateTimeSel) => void;
}

export default function InlineDateTimePicker({ anchor, value, onChange }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const days = useMemo(() => {
    const base = startOfDay(anchor);
    return Array.from({ length: 30 }, (_, i) => new Date(base.getTime() + i * DAY_MS));
  }, [anchor]);

  const stepHour = (dir: 1 | -1) => onChange({ ...value, hour: (value.hour + dir + 24) % 24 });
  const stepMinute = (dir: 1 | -1) =>
    onChange({ ...value, minute: (value.minute + dir * MINUTE_STEP + 60) % 60 });

  return (
    <View>
      <Text style={styles.sectionLabel}>Date</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayStrip}>
        {days.map((d, i) => {
          const active = i === value.dayOffset;
          return (
            <Pressable
              key={i}
              onPress={() => onChange({ ...value, dayOffset: i })}
              style={[styles.dayChip, active && styles.dayChipActive]}
            >
              <Text style={[styles.dayChipTop, active && styles.dayChipTextActive]}>{dayLabel(d, anchor)}</Text>
              <Text style={[styles.dayChipNum, active && styles.dayChipTextActive]}>{d.getDate()}</Text>
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
            <Text style={styles.timeText}>{fmtTime(value.hour, value.minute)}</Text>
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
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginTop: spacing(3), marginBottom: spacing(2) },
    dayStrip: { gap: spacing(2), paddingBottom: spacing(1) },
    dayChip: { width: 58, paddingVertical: spacing(2), borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
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
  });
