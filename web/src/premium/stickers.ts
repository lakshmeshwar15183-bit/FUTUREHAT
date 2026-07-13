// Lumixo — sticker catalog (web parity with mobile/src/lib/stickers.ts).
// Stickers are emoji glyphs on colored cards; no SVG data-URI (blank renders).

export interface StickerDef {
  id: string;
  emoji: string;
  bg: string;
  animated?: boolean;
  keywords?: string[];
}

export interface StickerPack {
  id: string;
  name: string;
  icon: string;
  free: boolean;
  stickers: StickerDef[];
}

export interface Sticker extends StickerDef {
  packId: string;
  packName: string;
  url: string;
}

export const STICKER_URL_PREFIX = 'lumixo-sticker://';

export function stickerUrl(id: string): string {
  return `${STICKER_URL_PREFIX}${id}`;
}

function pack(
  id: string,
  name: string,
  icon: string,
  free: boolean,
  items: Array<[string, string, string?, boolean?, string[]?]>,
): StickerPack {
  return {
    id,
    name,
    icon,
    free,
    stickers: items.map(([sid, emoji, bg = '#2a3441', animated, keywords]) => ({
      id: `${id}_${sid}`,
      emoji,
      bg,
      animated: !!animated,
      keywords: keywords ?? [],
    })),
  };
}

export const STICKER_PACKS: StickerPack[] = [
  pack('cats', 'Cute cats', '🐱', true, [
    ['hi', '😺', '#ffd6e7', true],
    ['love', '😻', '#ff9ec4', true],
    ['lol', '😹', '#ffcf5c', true],
    ['wink', '😼', '#b388ff'],
    ['kiss', '😽', '#ff7a9c'],
    ['shock', '🙀', '#7aa2ff', true],
    ['sad', '😿', '#9aa7b8'],
    ['mad', '😾', '#ff7a59'],
  ]),
  pack('dogs', 'Cute dogs', '🐶', true, [
    ['happy', '🐶', '#ffcf5c', true],
    ['love', '🐕', '#ff9ec4'],
    ['poodle', '🐩', '#ff7a9c', true],
    ['wolf', '🐺', '#9aa7b8'],
    ['bone', '🦴', '#e8d5b7'],
    ['ball', '🎾', '#7dcea0'],
  ]),
  pack('hamsters', 'Hamsters', '🐹', true, [
    ['hi', '🐹', '#ffb347', true],
    ['cute', '🐹', '#ffcf5c', true],
    ['love', '💕', '#ff9ec4'],
    ['food', '🥜', '#e8d5b7'],
  ]),
  pack('rabbits', 'Rabbits', '🐰', true, [
    ['hi', '🐰', '#ffe4f0', true],
    ['hop', '🐇', '#ffd6e7', true],
    ['love', '💗', '#ff9ec4'],
    ['carrot', '🥕', '#ffb347'],
  ]),
  pack('pandas', 'Pandas', '🐼', true, [
    ['hi', '🐼', '#e8e8e8', true],
    ['love', '❤️', '#ff5c7a'],
    ['eat', '🎋', '#2bd6c0'],
    ['hug', '🤗', '#ff9ec4', true],
  ]),
  pack('bears', 'Bears', '🐻', true, [
    ['hi', '🐻', '#c4a484', true],
    ['polar', '🐻‍❄️', '#e8f4ff'],
    ['hug', '🧸', '#ff9ec4', true],
    ['honey', '🍯', '#ffb347'],
  ]),
  pack('penguins', 'Penguins', '🐧', true, [
    ['hi', '🐧', '#4a5568', true],
    ['slide', '🧊', '#7aa2ff', true],
    ['love', '💕', '#ff9ec4'],
    ['cold', '❄️', '#e8f4ff'],
  ]),
  pack('foxes', 'Foxes', '🦊', true, [
    ['hi', '🦊', '#ff7a59', true],
    ['sly', '😏', '#ffb347'],
    ['love', '🧡', '#ff9ec4'],
    ['cute', '🥰', '#ff7a9c', true],
  ]),
  pack('koalas', 'Koalas', '🐨', true, [
    ['hi', '🐨', '#c5c6c7', true],
    ['sleep', '😴', '#9aa7b8'],
    ['hug', '🤗', '#ff9ec4', true],
    ['leaf', '🍃', '#2bd6c0'],
  ]),
  pack('happy', 'Happy', '😄', true, [
    ['smile', '😄', '#ffcf5c', true],
    ['joy', '😂', '#ff9ec4', true],
    ['cool', '😎', '#5b8cff'],
    ['party', '🥳', '#00a884', true],
  ]),
  pack('love', 'Love', '❤️', true, [
    ['heart', '❤️', '#ff5c7a', true],
    ['spark', '💖', '#ff7a9c', true],
    ['kiss', '😘', '#ffb347'],
    ['rose', '🌹', '#e74c3c'],
  ]),
  pack('celebration', 'Celebration', '🎉', true, [
    ['party', '🎉', '#ff7a9c', true],
    ['tada', '🎊', '#b388ff', true],
    ['balloon', '🎈', '#ff5c7a', true],
    ['fire', '🔥', '#ff7a59', true],
  ]),
  pack('thanks', 'Thanks', '🙏', true, [
    ['pray', '🙏', '#5b8cff'],
    ['heart', '💝', '#ff7a9c', true],
    ['ok', '👍', '#00a884'],
    ['smile', '😊', '#ffb347'],
  ]),
  pack('goodmorning', 'Good Morning', '🌅', true, [
    ['sun', '☀️', '#ffcf5c', true],
    ['coffee', '☕', '#c4a484'],
    ['hi', '👋', '#5b8cff', true],
    ['flower', '🌻', '#ff9ec4'],
  ]),
  pack('goodnight', 'Good Night', '🌙', true, [
    ['moon', '🌙', '#5b6b8c', true],
    ['sleep', '😴', '#b388ff'],
    ['stars', '⭐', '#ffcf5c', true],
    ['zzz', '💤', '#9aa7b8'],
  ]),
  pack('birthday', 'Birthday', '🎂', true, [
    ['cake', '🎂', '#ff9ec4', true],
    ['gift', '🎁', '#5b8cff', true],
    ['party', '🎉', '#ff7a9c', true],
    ['wish', '✨', '#ffb347', true],
  ]),
  pack('congrats', 'Congratulations', '🏆', true, [
    ['trophy', '🏆', '#ffb347', true],
    ['medal', '🥇', '#ffcf5c', true],
    ['clap', '👏', '#2bd6c0', true],
    ['rocket', '🚀', '#00a884', true],
  ]),
  pack('funny', 'Funny memes', '😂', true, [
    ['lol', '😂', '#ffcf5c', true],
    ['facepalm', '🤦', '#9aa7b8'],
    ['eyes', '👀', '#5b8cff', true],
    ['clown', '🤡', '#ff7a9c', true],
  ]),
  pack('hearts', 'Hearts', '💕', true, [
    ['red', '❤️', '#ff5c7a', true],
    ['spark', '💖', '#ff9ec4', true],
    ['blue', '💙', '#5b8cff'],
    ['purple', '💜', '#b388ff'],
  ]),
  pack('flowers', 'Flowers', '🌸', true, [
    ['cherry', '🌸', '#ffd6e7', true],
    ['rose', '🌹', '#e74c3c'],
    ['sun', '🌻', '#ffcf5c', true],
    ['bouquet', '💐', '#ff9ec4', true],
  ]),
];

const BY_ID = new Map<string, Sticker>();
const ALL: Sticker[] = [];

for (const p of STICKER_PACKS) {
  for (const s of p.stickers) {
    const full: Sticker = {
      ...s,
      packId: p.id,
      packName: p.name,
      url: stickerUrl(s.id),
    };
    BY_ID.set(s.id, full);
    ALL.push(full);
  }
}

export const STICKERS: Sticker[] = ALL;

export function getStickerById(id: string): Sticker | undefined {
  return BY_ID.get(id);
}

export function stickerMediaMeta(s: Sticker): Record<string, unknown> {
  return {
    sticker: true,
    stickerId: s.id,
    emoji: s.emoji,
    bg: s.bg,
    animated: !!s.animated,
    packId: s.packId,
    width: 200,
    height: 200,
  };
}
