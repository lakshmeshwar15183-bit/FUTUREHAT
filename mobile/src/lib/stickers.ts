// Lumixo — production sticker catalog (offline-first).
// Stickers are emoji glyphs on colored cards — rendered as native Text (never
// blank SVG data-URIs). Sent as image messages with media_meta.sticker so
// MessageBubble draws a sticker card instead of SignedImage.
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface StickerDef {
  id: string;
  emoji: string;
  bg: string;
  /** Soft bounce animation when shown in picker / bubble. */
  animated?: boolean;
  keywords?: string[];
}

export interface StickerPack {
  id: string;
  name: string;
  icon: string;
  /** Free packs ship for everyone; fun packs also free for default offline UX. */
  free: boolean;
  stickers: StickerDef[];
}

export interface Sticker extends StickerDef {
  packId: string;
  packName: string;
  /** Stable protocol URL used as media_url (no network). */
  url: string;
}

const RECENT_KEY = 'fh:sticker:recent:v1';
const FAV_KEY = 'fh:sticker:fav:v1';
const RECENT_MAX = 24;

export const STICKER_URL_PREFIX = 'lumixo-sticker://';

export function stickerUrl(id: string): string {
  return `${STICKER_URL_PREFIX}${id}`;
}

export function isStickerUrl(url?: string | null): boolean {
  return !!url && (url.startsWith(STICKER_URL_PREFIX) || url.startsWith('data:image/svg+xml'));
}

export function stickerIdFromUrl(url: string): string | null {
  if (url.startsWith(STICKER_URL_PREFIX)) return url.slice(STICKER_URL_PREFIX.length) || null;
  return null;
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

/** Default animal packs + fun packs — available offline, no download required. */
export const STICKER_PACKS: StickerPack[] = [
  pack('cats', 'Cute cats', '🐱', true, [
    ['hi', '😺', '#ffd6e7', true, ['cat', 'hi', 'hello']],
    ['love', '😻', '#ff9ec4', true, ['cat', 'love', 'heart']],
    ['lol', '😹', '#ffcf5c', true, ['cat', 'lol', 'laugh']],
    ['wink', '😼', '#b388ff', false, ['cat', 'wink']],
    ['kiss', '😽', '#ff7a9c', false, ['cat', 'kiss']],
    ['shock', '🙀', '#7aa2ff', true, ['cat', 'wow', 'shock']],
    ['sad', '😿', '#9aa7b8', false, ['cat', 'sad', 'cry']],
    ['mad', '😾', '#ff7a59', false, ['cat', 'mad', 'angry']],
    ['cute', '🐱', '#ffb347', true, ['cat', 'cute']],
    ['box', '🐈', '#2bd6c0', false, ['cat']],
    ['black', '🐈‍⬛', '#4a5568', false, ['cat', 'black']],
    ['party', '🐱', '#00a884', true, ['cat', 'party']],
  ]),
  pack('dogs', 'Cute dogs', '🐶', true, [
    ['happy', '🐶', '#ffcf5c', true, ['dog', 'happy']],
    ['love', '🐕', '#ff9ec4', false, ['dog', 'love']],
    ['guide', '🦮', '#5b8cff', false, ['dog']],
    ['service', '🐕‍🦺', '#2bd6c0', false, ['dog']],
    ['poodle', '🐩', '#ff7a9c', true, ['dog', 'cute']],
    ['wolf', '🐺', '#9aa7b8', false, ['dog', 'wolf']],
    ['howl', '🐶', '#b388ff', true, ['dog', 'howl']],
    ['run', '🐕', '#ff7a59', true, ['dog', 'run']],
    ['bone', '🦴', '#e8d5b7', false, ['dog', 'bone']],
    ['ball', '🎾', '#7dcea0', false, ['dog', 'play']],
    ['good', '👍', '#00a884', false, ['dog', 'good']],
    ['night', '🌙', '#5b6b8c', false, ['dog', 'night']],
  ]),
  pack('hamsters', 'Hamsters', '🐹', true, [
    ['hi', '🐹', '#ffb347', true, ['hamster', 'hi']],
    ['cute', '🐹', '#ffcf5c', true, ['hamster', 'cute']],
    ['love', '💕', '#ff9ec4', false, ['hamster', 'love']],
    ['food', '🥜', '#e8d5b7', false, ['hamster', 'food']],
    ['sleep', '😴', '#b388ff', false, ['hamster', 'sleep']],
    ['run', '🏃', '#2bd6c0', true, ['hamster', 'run']],
    ['wow', '😮', '#7aa2ff', true, ['hamster', 'wow']],
    ['party', '🎉', '#ff7a9c', true, ['hamster', 'party']],
  ]),
  pack('rabbits', 'Rabbits', '🐰', true, [
    ['hi', '🐰', '#ffe4f0', true, ['rabbit', 'hi', 'bunny']],
    ['hop', '🐇', '#ffd6e7', true, ['rabbit', 'hop']],
    ['love', '💗', '#ff9ec4', false, ['rabbit', 'love']],
    ['carrot', '🥕', '#ffb347', false, ['rabbit', 'food']],
    ['flower', '🌸', '#ff7a9c', false, ['rabbit', 'flower']],
    ['shy', '🙈', '#b388ff', false, ['rabbit', 'shy']],
    ['happy', '😊', '#ffcf5c', true, ['rabbit', 'happy']],
    ['night', '⭐', '#7aa2ff', false, ['rabbit', 'night']],
  ]),
  pack('pandas', 'Pandas', '🐼', true, [
    ['hi', '🐼', '#e8e8e8', true, ['panda', 'hi']],
    ['love', '❤️', '#ff5c7a', false, ['panda', 'love']],
    ['eat', '🎋', '#2bd6c0', false, ['panda', 'eat']],
    ['sleep', '💤', '#9aa7b8', false, ['panda', 'sleep']],
    ['play', '🎾', '#ffcf5c', true, ['panda', 'play']],
    ['hug', '🤗', '#ff9ec4', true, ['panda', 'hug']],
    ['cool', '😎', '#5b8cff', false, ['panda', 'cool']],
    ['party', '🥳', '#b388ff', true, ['panda', 'party']],
  ]),
  pack('bears', 'Bears', '🐻', true, [
    ['hi', '🐻', '#c4a484', true, ['bear', 'hi']],
    ['polar', '🐻‍❄️', '#e8f4ff', false, ['bear', 'polar']],
    ['honey', '🍯', '#ffb347', false, ['bear', 'honey']],
    ['hug', '🧸', '#ff9ec4', true, ['bear', 'hug', 'teddy']],
    ['love', '💖', '#ff7a9c', false, ['bear', 'love']],
    ['sleep', '😴', '#9aa7b8', false, ['bear', 'sleep']],
    ['strong', '💪', '#ff7a59', true, ['bear', 'strong']],
    ['wave', '👋', '#5b8cff', true, ['bear', 'wave']],
  ]),
  pack('penguins', 'Penguins', '🐧', true, [
    ['hi', '🐧', '#4a5568', true, ['penguin', 'hi']],
    ['slide', '🧊', '#7aa2ff', true, ['penguin', 'slide', 'ice']],
    ['love', '💕', '#ff9ec4', false, ['penguin', 'love']],
    ['cold', '❄️', '#e8f4ff', false, ['penguin', 'cold']],
    ['fish', '🐟', '#5b8cff', false, ['penguin', 'fish']],
    ['happy', '😄', '#ffcf5c', true, ['penguin', 'happy']],
    ['dance', '💃', '#b388ff', true, ['penguin', 'dance']],
    ['night', '🌙', '#2a3441', false, ['penguin', 'night']],
  ]),
  pack('foxes', 'Foxes', '🦊', true, [
    ['hi', '🦊', '#ff7a59', true, ['fox', 'hi']],
    ['sly', '😏', '#ffb347', false, ['fox', 'sly']],
    ['love', '🧡', '#ff9ec4', false, ['fox', 'love']],
    ['run', '💨', '#ffcf5c', true, ['fox', 'run']],
    ['night', '🌟', '#5b6b8c', false, ['fox', 'night']],
    ['cute', '🥰', '#ff7a9c', true, ['fox', 'cute']],
    ['think', '🤔', '#9aa7b8', false, ['fox', 'think']],
    ['party', '🎊', '#b388ff', true, ['fox', 'party']],
  ]),
  pack('koalas', 'Koalas', '🐨', true, [
    ['hi', '🐨', '#c5c6c7', true, ['koala', 'hi']],
    ['sleep', '😴', '#9aa7b8', false, ['koala', 'sleep']],
    ['leaf', '🍃', '#2bd6c0', false, ['koala', 'leaf']],
    ['hug', '🤗', '#ff9ec4', true, ['koala', 'hug']],
    ['love', '💚', '#7dcea0', false, ['koala', 'love']],
    ['yawn', '🥱', '#b388ff', false, ['koala', 'yawn']],
    ['happy', '😊', '#ffcf5c', true, ['koala', 'happy']],
    ['wave', '👋', '#5b8cff', true, ['koala', 'wave']],
  ]),
  // Fun packs
  pack('happy', 'Happy', '😄', true, [
    ['smile', '😄', '#ffcf5c', true, ['happy', 'smile']],
    ['grin', '😁', '#ffb347', true, ['happy', 'grin']],
    ['joy', '😂', '#ff9ec4', true, ['happy', 'joy', 'lol']],
    ['rofl', '🤣', '#ff7a59', true, ['happy', 'rofl']],
    ['cool', '😎', '#5b8cff', false, ['happy', 'cool']],
    ['star', '🤩', '#b388ff', true, ['happy', 'star']],
    ['party', '🥳', '#00a884', true, ['happy', 'party']],
    ['wink', '😉', '#2bd6c0', false, ['happy', 'wink']],
  ]),
  pack('love', 'Love', '❤️', true, [
    ['heart', '❤️', '#ff5c7a', true, ['love', 'heart']],
    ['spark', '💖', '#ff7a9c', true, ['love', 'spark']],
    ['two', '💕', '#ff9ec4', false, ['love']],
    ['kiss', '😘', '#ffb347', false, ['love', 'kiss']],
    ['hug', '🤗', '#b388ff', true, ['love', 'hug']],
    ['ring', '💍', '#7aa2ff', false, ['love', 'ring']],
    ['rose', '🌹', '#e74c3c', false, ['love', 'rose']],
    ['cupid', '💘', '#ff5c7a', true, ['love', 'cupid']],
  ]),
  pack('celebration', 'Celebration', '🎉', true, [
    ['party', '🎉', '#ff7a9c', true, ['party', 'celebrate']],
    ['tada', '🎊', '#b388ff', true, ['party', 'tada']],
    ['balloon', '🎈', '#ff5c7a', true, ['party', 'balloon']],
    ['spark', '✨', '#ffcf5c', true, ['party', 'sparkle']],
    ['fire', '🔥', '#ff7a59', true, ['party', 'fire']],
    ['champ', '🏆', '#ffb347', false, ['party', 'win']],
    ['clap', '👏', '#2bd6c0', true, ['party', 'clap']],
    ['horn', '🥳', '#5b8cff', true, ['party']],
  ]),
  pack('thanks', 'Thanks', '🙏', true, [
    ['pray', '🙏', '#5b8cff', false, ['thanks', 'pray']],
    ['bow', '🙇', '#b388ff', false, ['thanks', 'bow']],
    ['heart', '💝', '#ff7a9c', true, ['thanks', 'heart']],
    ['flower', '💐', '#ff9ec4', false, ['thanks', 'flower']],
    ['star', '⭐', '#ffcf5c', true, ['thanks', 'star']],
    ['ok', '👍', '#00a884', false, ['thanks', 'ok']],
    ['hug', '🫂', '#2bd6c0', true, ['thanks', 'hug']],
    ['smile', '😊', '#ffb347', false, ['thanks', 'smile']],
  ]),
  pack('goodmorning', 'Good Morning', '🌅', true, [
    ['sun', '☀️', '#ffcf5c', true, ['morning', 'sun']],
    ['rise', '🌅', '#ffb347', true, ['morning', 'sunrise']],
    ['coffee', '☕', '#c4a484', false, ['morning', 'coffee']],
    ['flower', '🌻', '#ff9ec4', false, ['morning', 'flower']],
    ['bird', '🐦', '#7aa2ff', true, ['morning', 'bird']],
    ['yawn', '🥱', '#b388ff', false, ['morning', 'yawn']],
    ['smile', '😊', '#2bd6c0', false, ['morning', 'smile']],
    ['hi', '👋', '#5b8cff', true, ['morning', 'hi']],
  ]),
  pack('goodnight', 'Good Night', '🌙', true, [
    ['moon', '🌙', '#5b6b8c', true, ['night', 'moon']],
    ['stars', '⭐', '#ffcf5c', true, ['night', 'star']],
    ['sleep', '😴', '#b388ff', false, ['night', 'sleep']],
    ['zzz', '💤', '#9aa7b8', false, ['night', 'zzz']],
    ['bed', '🛏️', '#7aa2ff', false, ['night', 'bed']],
    ['dream', '💭', '#ff9ec4', true, ['night', 'dream']],
    ['owl', '🦉', '#4a5568', false, ['night', 'owl']],
    ['kiss', '😘', '#ff7a9c', false, ['night', 'kiss']],
  ]),
  pack('birthday', 'Birthday', '🎂', true, [
    ['cake', '🎂', '#ff9ec4', true, ['birthday', 'cake']],
    ['party', '🎉', '#ff7a9c', true, ['birthday', 'party']],
    ['gift', '🎁', '#5b8cff', true, ['birthday', 'gift']],
    ['balloon', '🎈', '#b388ff', true, ['birthday', 'balloon']],
    ['candle', '🕯️', '#ffcf5c', false, ['birthday', 'candle']],
    ['confetti', '🎊', '#00a884', true, ['birthday', 'confetti']],
    ['wish', '✨', '#ffb347', true, ['birthday', 'wish']],
    ['age', '🥳', '#ff7a59', true, ['birthday']],
  ]),
  pack('congrats', 'Congratulations', '🏆', true, [
    ['trophy', '🏆', '#ffb347', true, ['congrats', 'trophy']],
    ['medal', '🥇', '#ffcf5c', true, ['congrats', 'medal']],
    ['clap', '👏', '#2bd6c0', true, ['congrats', 'clap']],
    ['party', '🎉', '#ff7a9c', true, ['congrats', 'party']],
    ['fire', '🔥', '#ff7a59', true, ['congrats', 'fire']],
    ['star', '🌟', '#5b8cff', true, ['congrats', 'star']],
    ['crown', '👑', '#b388ff', false, ['congrats', 'crown']],
    ['rocket', '🚀', '#00a884', true, ['congrats', 'rocket']],
  ]),
  pack('funny', 'Funny memes', '😂', true, [
    ['lol', '😂', '#ffcf5c', true, ['funny', 'lol']],
    ['rofl', '🤣', '#ffb347', true, ['funny', 'rofl']],
    ['facepalm', '🤦', '#9aa7b8', false, ['funny', 'facepalm']],
    ['think', '🤔', '#7aa2ff', false, ['funny', 'think']],
    ['eyes', '👀', '#5b8cff', true, ['funny', 'eyes']],
    ['skull', '💀', '#4a5568', false, ['funny', 'dead']],
    ['clown', '🤡', '#ff7a9c', true, ['funny', 'clown']],
    ['monkey', '🙈', '#c4a484', true, ['funny', 'monkey']],
  ]),
  pack('hearts', 'Hearts', '💕', true, [
    ['red', '❤️', '#ff5c7a', true, ['heart', 'red']],
    ['orange', '🧡', '#ff7a59', false, ['heart', 'orange']],
    ['yellow', '💛', '#ffcf5c', false, ['heart', 'yellow']],
    ['green', '💚', '#2bd6c0', false, ['heart', 'green']],
    ['blue', '💙', '#5b8cff', false, ['heart', 'blue']],
    ['purple', '💜', '#b388ff', false, ['heart', 'purple']],
    ['spark', '💖', '#ff9ec4', true, ['heart', 'spark']],
    ['two', '💞', '#ff7a9c', true, ['heart']],
  ]),
  pack('flowers', 'Flowers', '🌸', true, [
    ['cherry', '🌸', '#ffd6e7', true, ['flower', 'cherry']],
    ['rose', '🌹', '#e74c3c', false, ['flower', 'rose']],
    ['tulip', '🌷', '#ff7a9c', false, ['flower', 'tulip']],
    ['sun', '🌻', '#ffcf5c', true, ['flower', 'sunflower']],
    ['hibiscus', '🌺', '#ff5c7a', false, ['flower', 'hibiscus']],
    ['bouquet', '💐', '#ff9ec4', true, ['flower', 'bouquet']],
    ['blossom', '🌼', '#ffb347', false, ['flower', 'blossom']],
    ['lotus', '🪷', '#b388ff', false, ['flower', 'lotus']],
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

/** Flat list (compat with OverlayEditor / legacy callers). */
export const STICKERS: Sticker[] = ALL;

export function getStickerById(id: string): Sticker | undefined {
  return BY_ID.get(id);
}

export function getStickerByUrl(url: string): Sticker | undefined {
  const id = stickerIdFromUrl(url);
  if (id) return BY_ID.get(id);
  // Legacy SVG data-URI stickers — match by emoji if possible
  return undefined;
}

export function resolveSticker(meta?: {
  sticker?: boolean;
  stickerId?: string;
  emoji?: string;
  bg?: string;
  animated?: boolean;
  packId?: string;
} | null, mediaUrl?: string | null): Sticker | null {
  if (meta?.stickerId) {
    const s = BY_ID.get(meta.stickerId);
    if (s) return s;
  }
  if (mediaUrl) {
    const s = getStickerByUrl(mediaUrl);
    if (s) return s;
  }
  if (meta?.sticker && meta.emoji) {
    return {
      id: meta.stickerId ?? 'custom',
      emoji: meta.emoji,
      bg: meta.bg ?? '#2a3441',
      animated: !!meta.animated,
      packId: meta.packId ?? 'custom',
      packName: 'Sticker',
      url: mediaUrl ?? stickerUrl(meta.stickerId ?? 'custom'),
    };
  }
  return null;
}

export function searchStickers(query: string, limit = 80): Sticker[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Sticker[] = [];
  const seen = new Set<string>();
  for (const s of ALL) {
    const hay = [s.emoji, s.packName, s.packId, s.id, ...(s.keywords ?? [])].join(' ').toLowerCase();
    if (hay.includes(q) || s.emoji.includes(query.trim())) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        hits.push(s);
        if (hits.length >= limit) break;
      }
    }
  }
  return hits;
}

// ── Recents / favorites (in-memory + AsyncStorage) ─────────────────────────

let recentIds: string[] = [];
let favIds: string[] = [];
let stickerHydrated = false;
let stickerHydratePromise: Promise<void> | null = null;
const stickerListeners = new Set<() => void>();

function notifyStickers() {
  for (const l of stickerListeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

export function preloadStickerCache(): Promise<void> {
  if (stickerHydrated) return Promise.resolve();
  if (stickerHydratePromise) return stickerHydratePromise;
  stickerHydratePromise = (async () => {
    try {
      const [r, f] = await Promise.all([
        AsyncStorage.getItem(RECENT_KEY),
        AsyncStorage.getItem(FAV_KEY),
      ]);
      recentIds = parseIdList(r).slice(0, RECENT_MAX);
      favIds = parseIdList(f);
    } catch {
      /* keep empty */
    } finally {
      stickerHydrated = true;
      notifyStickers();
    }
  })();
  return stickerHydratePromise;
}

void preloadStickerCache();

export function subscribeStickerCache(fn: () => void): () => void {
  stickerListeners.add(fn);
  return () => {
    stickerListeners.delete(fn);
  };
}

export function getRecentStickers(): Sticker[] {
  return recentIds.map((id) => BY_ID.get(id)).filter((s): s is Sticker => !!s);
}

export function getFavoriteStickers(): Sticker[] {
  return favIds.map((id) => BY_ID.get(id)).filter((s): s is Sticker => !!s);
}

export function getFavoriteStickerIds(): string[] {
  return favIds;
}

export function pushRecentSticker(id: string): void {
  if (!BY_ID.has(id)) return;
  recentIds = [id, ...recentIds.filter((x) => x !== id)].slice(0, RECENT_MAX);
  notifyStickers();
  void AsyncStorage.setItem(RECENT_KEY, JSON.stringify(recentIds)).catch(() => {});
}

export function toggleFavoriteSticker(id: string): boolean {
  if (!BY_ID.has(id)) return false;
  if (favIds.includes(id)) {
    favIds = favIds.filter((x) => x !== id);
    notifyStickers();
    void AsyncStorage.setItem(FAV_KEY, JSON.stringify(favIds)).catch(() => {});
    return false;
  }
  favIds = [id, ...favIds];
  notifyStickers();
  void AsyncStorage.setItem(FAV_KEY, JSON.stringify(favIds)).catch(() => {});
  return true;
}

export function isFavoriteSticker(id: string): boolean {
  return favIds.includes(id);
}

/** Build media_meta payload for send / outbox. */
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
