// FUTUREHAT mobile — a poll rendered inside a chat thread. Shows live tallies
// with progress bars; tap an option to (un)vote. Respects single/multiple choice.
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Poll, PollVote } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';

interface Props {
  poll: Poll;
  votes: PollVote[];
  myUserId: string | null;
  onVote: (optionIndex: number) => void;
}

export default function PollCard({ poll, votes, myUserId, onVote }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const total = votes.length;
  // Tally once per votes/options change instead of filtering the whole vote
  // array for every option on every render.
  const counts = useMemo(() => {
    const c = new Array(poll.options.length).fill(0);
    for (const v of votes) if (v.option_index >= 0 && v.option_index < c.length) c[v.option_index] += 1;
    return c;
  }, [votes, poll.options.length]);
  const mine = useMemo(
    () => new Set(votes.filter((v) => v.user_id === myUserId).map((v) => v.option_index)),
    [votes, myUserId],
  );
  // A poll past its closes_at can no longer be voted on (mirrors web).
  const closed = !!poll.closes_at && new Date(poll.closes_at).getTime() < Date.now();

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="bar-chart" size={16} color={colors.primary} />
        <Text style={styles.kind}>{poll.multiple ? 'Select one or more' : 'Select one'}</Text>
      </View>
      <Text style={styles.question}>{poll.question}</Text>

      {poll.options.map((opt, i) => {
        const c = counts[i];
        const pct = total ? Math.round((c / total) * 100) : 0;
        const chosen = mine.has(i);
        return (
          <Pressable key={i} style={styles.opt} onPress={() => onVote(i)} disabled={closed}>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: chosen ? colors.primary : colors.surfaceAlt }]} />
            </View>
            <View style={styles.optRow}>
              <Ionicons
                name={chosen ? (poll.multiple ? 'checkbox' : 'radio-button-on') : poll.multiple ? 'square-outline' : 'radio-button-off'}
                size={16}
                color={chosen ? colors.primary : colors.textMuted}
              />
              <Text style={[styles.optText, chosen && styles.optTextOn]} numberOfLines={2}>{opt}</Text>
              <Text style={styles.pct}>{pct}%</Text>
            </View>
          </Pressable>
        );
      })}

      <Text style={styles.total}>
        {total} vote{total === 1 ? '' : 's'} · {poll.multiple ? 'multiple choice' : 'single choice'}{closed ? ' · closed' : ''}
      </Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    card: { alignSelf: 'flex-start', maxWidth: '86%', backgroundColor: colors.bubbleIn, borderRadius: radius.md, padding: spacing(3), marginHorizontal: spacing(3), marginVertical: spacing(1) },
    head: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing(1) },
    kind: { color: colors.primary, fontSize: font.tiny, fontWeight: '700', marginLeft: spacing(1.5), textTransform: 'uppercase', letterSpacing: 0.4 },
    question: { color: colors.text, fontSize: font.body, fontWeight: '700', marginBottom: spacing(2) },
    opt: { marginBottom: spacing(2) },
    barTrack: { ...StyleSheet.absoluteFillObject, borderRadius: radius.sm, overflow: 'hidden' },
    barFill: { height: '100%', opacity: 0.25, borderRadius: radius.sm },
    optRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(2), paddingHorizontal: spacing(2) },
    optText: { flex: 1, color: colors.text, fontSize: font.small, marginLeft: spacing(2) },
    optTextOn: { fontWeight: '700' },
    pct: { color: colors.textMuted, fontSize: font.small, fontWeight: '600', marginLeft: spacing(2) },
    total: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing(1) },
  });
