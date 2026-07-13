/**
 * Production sticker catalog + offline cache helpers.
 */
import {
  STICKER_PACKS,
  STICKERS,
  getStickerById,
  searchStickers,
  stickerMediaMeta,
  stickerUrl,
  isStickerUrl,
  resolveSticker,
} from '../stickers';

describe('stickers catalog', () => {
  it('ships default animal + fun packs offline', () => {
    const ids = STICKER_PACKS.map((p) => p.id);
    for (const need of [
      'cats',
      'dogs',
      'hamsters',
      'rabbits',
      'pandas',
      'bears',
      'penguins',
      'foxes',
      'koalas',
      'happy',
      'love',
      'celebration',
      'thanks',
      'goodmorning',
      'goodnight',
      'birthday',
      'congrats',
      'funny',
      'hearts',
      'flowers',
    ]) {
      expect(ids).toContain(need);
    }
  });

  it('has a non-trivial flat sticker list', () => {
    expect(STICKERS.length).toBeGreaterThan(80);
    for (const s of STICKERS) {
      expect(s.emoji.length).toBeGreaterThan(0);
      expect(s.bg.startsWith('#')).toBe(true);
      expect(s.url).toBe(stickerUrl(s.id));
    }
  });

  it('resolves stickers by id and media_meta', () => {
    const first = STICKERS[0];
    expect(getStickerById(first.id)?.emoji).toBe(first.emoji);
    const meta = stickerMediaMeta(first);
    const resolved = resolveSticker(meta as any, first.url);
    expect(resolved?.emoji).toBe(first.emoji);
    expect(isStickerUrl(first.url)).toBe(true);
  });

  it('searches by keyword', () => {
    const cats = searchStickers('cat');
    expect(cats.length).toBeGreaterThan(0);
    expect(cats.some((s) => s.packId === 'cats')).toBe(true);
  });
});
