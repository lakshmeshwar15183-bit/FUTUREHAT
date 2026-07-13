// Lumixo mobile — poll in chat: tallies, multi, close, view voters, anonymous.
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Poll, PollVote } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';

interface Props {
  poll: Poll;
  votes: PollVote[];
  myUserId: string | null;
  onVote: (optionIndex: number) => void;
  onClose?: () => void;
  onViewVoters?: (optionIndex: number) => void;
  /** Preloaded voter names for expanded option */
  voters?: { userId: string; displayName: string | null }[];
  votersOption?: number | null;
  closing?: boolean;
}

export default function PollCard({
  poll,
  votes,
  myUserId,
  onVote,
  onClose,
  onViewVoters,
  voters = [],
  votersOption = null,
  closing = false,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const total = votes.length;
  const counts = useMemo(() => {
    const c = new Array(poll.options.length).fill(0);
    for (const v of votes) if (v.option_index >= 0 && v.option_index < c.length) c[v.option_index] += 1;
    return c;
  }, [votes, poll.options.length]);
  const mine = useMemo(
    () => new Set(votes.filter((v) => v.user_id === myUserId).map((v) => v.option_index)),
    [votes, myUserId],
  );
  const closed = !!poll.closes_at && new Date(poll.closes_at).getTime() < Date.now();
  const isCreator = !!myUserId && poll.created_by === myUserId;
  const anonymous = !!poll.anonymous;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="bar-chart" size={16} color={colors.primary} />
        <Text style={styles.kind}>
          {poll.multiple ? 'Select one or more' : 'Select one'}
          {anonymous ? ' · Anonymous' : ''}
        </Text>
      </View>
      <Text style={styles.question}>{poll.question}</Text>

      {poll.options.map((opt, i) => {
        const c = counts[i];
        const pct = total ? Math.round((c / total) * 100) : 0;
        const chosen = mine.has(i);
        return (
          <View key={i} style={styles.optBlock}>
            <Pressable style={styles.opt} onPress={() => onVote(i)} disabled={closed}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${pct}%`, backgroundColor: chosen ? colors.primary : colors.surfaceAlt },
                  ]}
                />
              </View>
              <View style={styles.optRow}>
                <Ionicons
                  name={
                    chosen
                      ? poll.multiple
                        ? 'checkbox'
                        : 'radio-button-on'
                      : poll.multiple
                        ? 'square-outline'
                        : 'radio-button-off'
                  }
                  size={16}
                  color={chosen ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.optText, chosen && styles.optTextOn]} numberOfLines={2}>
                  {opt}
                </Text>
                <Text style={styles.pct}>{pct}%</Text>
              </View>
            </Pressable>
            {!anonymous && c > 0 && onViewVoters && (
              <Pressable onPress={() => onViewVoters(i)} hitSlop={6}>
                <Text style={styles.votersLink}>
                  {votersOption === i ? 'Hide voters' : `View voters (${c})`}
                </Text>
              </Pressable>
            )}
            {votersOption === i && !anonymous && (
              <View style={styles.votersList}>
                {voters.map((v) => (
                  <Text key={v.userId} style={styles.voterName}>
                    {v.displayName || 'Member'}
                  </Text>
                ))}
              </View>
            )}
          </View>
        );
      })}

      <View style={styles.footRow}>
        <Text style={styles.total}>
          {total} vote{total === 1 ? '' : 's'} · {poll.multiple ? 'multiple' : 'single'}
          {closed ? ' · closed' : ''}
        </Text>
        {isCreator && !closed && onClose && (
          <Pressable onPress={onClose} disabled={closing} hitSlop={8}>
            {closing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.closeBtn}>Close poll</Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    card: {
      alignSelf: 'flex-start',
      maxWidth: '86%',
      backgroundColor: colors.bubbleIn,
      borderRadius: radius.md,
      padding: spacing(3),
      marginHorizontal: spacing(3),
      marginVertical: spacing(1),
    },
    head: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing(1) },
    kind: {
      color: colors.primary,
      fontSize: font.tiny,
      fontWeight: '700',
      marginLeft: spacing(1.5),
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    question: { color: colors.text, fontSize: font.body, fontWeight: '700', marginBottom: spacing(2) },
    optBlock: { marginBottom: spacing(2) },
    opt: { marginBottom: 2 },
    barTrack: { ...StyleSheet.absoluteFillObject, borderRadius: radius.sm, overflow: 'hidden' },
    barFill: { height: '100%', opacity: 0.25, borderRadius: radius.sm },
    optRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing(2),
      paddingHorizontal: spacing(2),
    },
    optText: { flex: 1, color: colors.text, fontSize: font.small, marginLeft: spacing(2) },
    optTextOn: { fontWeight: '700' },
    pct: { color: colors.textMuted, fontSize: font.small, fontWeight: '600', marginLeft: spacing(2) },
    votersLink: {
      color: colors.primary,
      fontSize: font.tiny,
      fontWeight: '600',
      marginLeft: spacing(2),
      marginBottom: 2,
    },
    votersList: { paddingLeft: spacing(4), marginBottom: spacing(1) },
    voterName: { color: colors.textMuted, fontSize: font.tiny, paddingVertical: 1 },
    footRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing(1),
    },
    total: { color: colors.textFaint, fontSize: font.tiny, flex: 1 },
    closeBtn: { color: colors.primary, fontSize: font.tiny, fontWeight: '700' },
  });
