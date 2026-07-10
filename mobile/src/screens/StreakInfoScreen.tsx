// Lumixo mobile — Streaks info pages (How it works, Qualifying activities,
// Levels, Rewards, Penalties & demotions, Restrictions & anti-abuse, Moderator
// selection). Data-driven so every page shares the Lumixo design language.
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';

import { STREAK_TIERS } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type R = RouteProp<RootStackParamList, 'StreakInfo'>;
export type StreakInfoPage =
  | 'how' | 'qualifying' | 'levels' | 'rewards' | 'penalties' | 'restrictions' | 'moderator';

export const STREAK_INFO_TITLES: Record<StreakInfoPage, string> = {
  how: 'How streaks work',
  qualifying: 'Qualifying activities',
  levels: 'Streak levels',
  rewards: 'Rewards',
  penalties: 'Penalties & demotions',
  restrictions: 'Restrictions & anti-abuse',
  moderator: 'Moderator selection',
};

interface Block { h?: string; p?: string; bullets?: string[]; }

const PAGES: Record<StreakInfoPage, Block[]> = {
  how: [
    { p: 'A streak is a bond between TWO people — you and one friend. It lives with the pair, not with a device or a chat in your list.' },
    { h: 'Both must show up', p: 'Each day, BOTH of you must independently do at least one qualifying activity. If only one of you participates, the day does not count — no matter how much that one person sends.' },
    { h: 'One point a day, max', p: 'A completed day adds exactly +1. Doing five things in a day still adds only +1.' },
    { h: 'Miss a day, lose points', p: 'If a day is missed, the pair loses 3 points. Your score can never go below 0.' },
    { h: 'Your tier follows your score', p: 'The emoji you see is decided by your CURRENT score. Lose enough points and you can be demoted to a lower tier.' },
    { h: 'Locking & archiving are safe', p: 'Locking, archiving, hiding or removing a chat from your list is only about organisation and privacy. It never pauses, resets, duplicates or deletes your streak. Activity in a locked or archived chat still counts.' },
    { h: 'The server decides', p: 'Days are measured on one consistent daily window (UTC) on our servers. Changing your phone’s clock or timezone does nothing.' },
  ],
  qualifying: [
    { p: 'During each daily window, YOU must independently complete at least one of these:' },
    { bullets: [
      'One text message containing at least 5 real words',
      'One photo you successfully send',
      'One video you successfully send',
      'One connected voice call lasting more than 15 seconds',
      'One connected video call lasting more than 15 seconds',
    ] },
    { h: 'And so must they', p: 'Your partner must independently qualify too. Only when BOTH of you have qualified does the day complete for +1.' },
    { h: 'What does NOT count', bullets: [
      'Five separate one-word messages (a single message must itself have 5+ words)',
      'Failed, unsent or draft messages',
      'Missed, rejected, unanswered or cancelled calls',
      'Ringing time — only the connected (answered) portion counts, and it must exceed 15 seconds',
    ] },
  ],
  levels: [], // rendered specially below
  rewards: [
    { h: '💎 Diamond — 365 points', p: 'The first time your pair reaches 365, you BOTH receive one month of Lumixo+ Premium, free. If you already have Premium, the month is ADDED on top — it never shortens what you already have.' },
    { h: 'Once per pair, ever', p: 'Each milestone reward is granted a single time for the lifetime of the pair. You cannot lose points and re-earn the same reward by reaching the milestone again.' },
    { h: '🛡 Moderator milestone — 367 points', p: 'Just past Diamond, the pair becomes eligible for the Moderator reward. See “Moderator selection”.' },
    { h: '🏆 Hall of Legends — 730 points', p: 'Around two years of streak earns your pair a permanent place in the Hall of Legends.' },
  ],
  penalties: [
    { h: 'Scoring', bullets: ['A completed mutual day: +1', 'A missed day: −3', 'Minimum score: 0 (never negative)'] },
    { h: 'Demotion is immediate', p: 'Because your tier is based on your current score, losing points can drop you to a lower tier right away.' },
    { h: 'Example', p: 'You are at 100 💜 (Purple Heart). You miss a day: −3 → 97. You immediately move back to ❤️ (Red Heart).' },
  ],
  restrictions: [
    { p: 'Streaks are enforced entirely on the server. The app can only show your streak — it can never set your score, claim a reward, or grant a role.' },
    { h: 'We protect against', bullets: [
      'Forged or client-supplied scores and milestone claims',
      'Fake or replayed activity and duplicate events',
      'Fake call durations (only real connected time counts)',
      'Repeated reward claims (each milestone pays out once, ever)',
      'Two devices or races processing the same day twice',
      'Device clock / timezone manipulation (one fixed server window)',
      'Deleting a message after it qualified',
    ] },
    { h: 'Accounts', p: 'Blocked, deleted, banned, suspended or disabled accounts are handled safely and do not receive rewards or roles they aren’t entitled to.' },
  ],
  moderator: [
    { p: 'After your pair passes the Diamond stage, you become eligible for the Moderator reward.' },
    { h: 'When', p: 'The pair becomes eligible when the streak reaches 367 points. The system processes this milestone automatically.' },
    { h: 'Who', p: 'Only ONE person from the pair is selected as Moderator — not both. Selection is decided and applied entirely on the server, is recorded in an audit log, and can never be triggered from the app.' },
    { h: 'Safety', p: 'The reward can never demote an owner, corrupt admin privileges, or let anyone promote themselves. Moderators cannot change streak scores.' },
  ],
};

export default function StreakInfoScreen() {
  const route = useRoute<R>();
  const page = (route.params?.page ?? 'how') as StreakInfoPage;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(4), paddingBottom: spacing(10) }}>
      {page === 'levels' ? (
        <View>
          <Text style={styles.p}>Your tier is decided by your current score:</Text>
          <View style={styles.levelsCard}>
            {STREAK_TIERS.map((t) => (
              <View key={t.emoji + t.min} style={styles.levelRow}>
                <Text style={styles.levelEmoji} allowFontScaling={false}>{t.emoji}</Text>
                <Text style={styles.levelLabel}>{t.label}</Text>
                <Text style={styles.levelRange}>
                  {t.max === Infinity ? `${t.min}+` : t.min === t.max ? `${t.min}` : `${t.min}–${t.max}`}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>💎 is the exact 365-point Diamond milestone. 🪙 continues the streak from 366 to 729. 🏆 is Hall of Legends at 730+.</Text>
        </View>
      ) : (
        PAGES[page].map((b, i) => (
          <View key={i} style={{ marginBottom: spacing(4) }}>
            {b.h ? <Text style={styles.h}>{b.h}</Text> : null}
            {b.p ? <Text style={styles.p}>{b.p}</Text> : null}
            {b.bullets ? b.bullets.map((x, j) => (
              <View key={j} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{x}</Text>
              </View>
            )) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    h: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: spacing(1.5) },
    p: { color: colors.textMuted, fontSize: font.body, lineHeight: 21, marginBottom: spacing(2) },
    bulletRow: { flexDirection: 'row', marginTop: spacing(1), paddingRight: spacing(2) },
    bulletDot: { color: colors.primary, fontSize: font.body, width: 16 },
    bulletText: { color: colors.textMuted, fontSize: font.body, lineHeight: 21, flex: 1 },
    note: { color: colors.textFaint, fontSize: font.small, marginTop: spacing(4), lineHeight: 19 },
    levelsCard: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden', marginTop: spacing(2) },
    levelRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    levelEmoji: { fontSize: 24, width: 40 },
    levelLabel: { flex: 1, color: colors.text, fontSize: font.body, fontWeight: '600' },
    levelRange: { color: colors.textMuted, fontSize: font.body, fontWeight: '700' },
  });
