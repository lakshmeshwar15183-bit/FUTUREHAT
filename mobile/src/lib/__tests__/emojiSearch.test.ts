/**
 * P1: emoji search keywords resolve (WhatsApp-class picker).
 */
import { searchEmojis, QUICK_REACTIONS, EMOJI_CATEGORIES, ALL_EMOJIS } from '../emojiData';

describe('emojiData / searchEmojis', () => {
  it('has non-empty catalog and categories', () => {
    expect(ALL_EMOJIS.length).toBeGreaterThan(200);
    expect(EMOJI_CATEGORIES.length).toBeGreaterThanOrEqual(6);
  });

  it('quick reactions match WhatsApp-style set', () => {
    expect([...QUICK_REACTIONS]).toEqual(['👍', '❤️', '😂', '😮', '😢', '🙏']);
  });

  it('finds hearts for "love"', () => {
    const hits = searchEmojis('love');
    expect(hits.some((e) => e.includes('❤') || e === '😍' || e === '🥰')).toBe(true);
  });

  it('finds laugh for "lol"', () => {
    const hits = searchEmojis('lol');
    expect(hits).toContain('😂');
  });

  it('returns empty for blank query', () => {
    expect(searchEmojis('')).toEqual([]);
    expect(searchEmojis('   ')).toEqual([]);
  });
});
