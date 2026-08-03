/**
 * Streak share text — pure unit tests (no RN / Supabase).
 */
import { formatStreakShareText, emojiForScore } from '../streakApi';

describe('formatStreakShareText', () => {
  it('includes score, peer, and app identity', () => {
    const t = formatStreakShareText({
      score: 12,
      emoji: '🎏',
      peerName: 'Ankit',
      successfulDays: 12,
    });
    expect(t).toContain('12');
    expect(t).toContain('Ankit');
    expect(t).toContain('🎏');
    expect(t).toContain('Lumixo');
    expect(t).toContain('successful day');
  });

  it('falls back emoji from score when missing', () => {
    const t = formatStreakShareText({ score: 50, peerName: 'Sam' });
    expect(t).toContain(emojiForScore(50));
    expect(t).toContain('Sam');
  });

  it('handles zero / empty peer safely', () => {
    const t = formatStreakShareText({ score: 0 });
    expect(t).toContain('my friend');
    expect(t).toContain('0');
  });
});
