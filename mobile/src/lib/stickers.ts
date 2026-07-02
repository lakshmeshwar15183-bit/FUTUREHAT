// FUTUREHAT+ — premium stickers (ported verbatim from web/src/premium/stickers.ts
// for parity). Each sticker is a self-contained SVG rendered to a data URI and
// sent as an image message, so there's no storage/schema dependency. expo-image
// renders the SVG data URI directly.
interface StickerDef { id: string; emoji: string; bg: string; }

const PACK: StickerDef[] = [
  { id: 'love', emoji: '😍', bg: '#ff7a9c' },
  { id: 'lol', emoji: '🤣', bg: '#ffcf5c' },
  { id: 'cool', emoji: '😎', bg: '#5b8cff' },
  { id: 'party', emoji: '🥳', bg: '#b388ff' },
  { id: 'fire', emoji: '🔥', bg: '#ff7a59' },
  { id: 'heart', emoji: '❤️', bg: '#ff5c7a' },
  { id: 'clap', emoji: '👏', bg: '#2bd6c0' },
  { id: 'cry', emoji: '😭', bg: '#7aa2ff' },
  { id: 'wow', emoji: '🤩', bg: '#ffb347' },
  { id: 'think', emoji: '🤔', bg: '#9aa7b8' },
  { id: 'hug', emoji: '🫶', bg: '#ff9ec4' },
  { id: 'rocket', emoji: '🚀', bg: '#00a884' },
];

function dataUri(emoji: string, bg: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">` +
    `<rect width="200" height="200" rx="40" fill="${bg}"/>` +
    `<text x="100" y="108" font-size="120" text-anchor="middle" dominant-baseline="central">${emoji}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export interface Sticker { id: string; url: string; emoji: string; }

export const STICKERS: Sticker[] = PACK.map((s) => ({ id: s.id, emoji: s.emoji, url: dataUri(s.emoji, s.bg) }));
