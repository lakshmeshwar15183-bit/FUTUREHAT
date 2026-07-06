// FUTUREHAT web — shared status helpers used by the strip, viewer and composer.
// Groups active statuses by author (WhatsApp-style), marks each group seen/unseen
// for the current user, and classifies media type. Mirrors the mobile helper so
// both platforms behave identically.
import type { Status } from '@shared/types';

export interface StatusGroup {
  userId: string;
  name: string;
  avatar: string | null;
  statuses: Status[]; // oldest-first, ready for sequential playback
  allSeen: boolean;
}

export function isVideo(s: Status): boolean {
  if (s.type === 'video') return true;
  return !!s.media_url && /\.(mp4|webm|mov|m4v|ogv)$/i.test(s.media_url);
}

export function isAudio(s: Status): boolean {
  if (s.type === 'audio') return true;
  return !!s.media_url && /\.(m4a|mp3|aac|wav|ogg|opus|webm)$/i.test(s.media_url);
}

// ── Client-side 36h expiry (CP5) ────────────────────────────────────────────
// Server RLS hides expired statuses on the next fetch; we also prune locally so
// a status vanishes the moment it hits `expires_at` — no poll, no refresh.
export function statusExpired(s: Status, now: number): boolean {
  return new Date(s.expires_at).getTime() <= now;
}

export function pruneExpiredGroups(
  mine: StatusGroup | null,
  groups: StatusGroup[],
  now: number,
): { mine: StatusGroup | null; groups: StatusGroup[]; changed: boolean; nextExpiry: number | null } {
  let changed = false;
  let nextExpiry: number | null = null;
  const consider = (s: Status) => {
    const t = new Date(s.expires_at).getTime();
    if (t > now && (nextExpiry === null || t < nextExpiry)) nextExpiry = t;
  };
  const prune = (g: StatusGroup): StatusGroup | null => {
    const kept = g.statuses.filter((s) => {
      if (statusExpired(s, now)) { changed = true; return false; }
      consider(s);
      return true;
    });
    return kept.length ? { ...g, statuses: kept } : null;
  };
  const prunedMine = mine ? prune(mine) : null;
  const prunedGroups = groups.map(prune).filter((g): g is StatusGroup => g !== null);
  return { mine: prunedMine, groups: prunedGroups, changed, nextExpiry };
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

// Build the ordered list of author groups from the flat active-status list.
export function buildStatusGroups(
  all: Status[],
  myId: string,
  viewed: Set<string>,
): { mine: StatusGroup | null; groups: StatusGroup[] } {
  const byUser = new Map<string, Status[]>();
  for (const s of all) {
    const arr = byUser.get(s.user_id) ?? [];
    arr.push(s);
    byUser.set(s.user_id, arr);
  }

  const build = (userId: string, list: Status[]): StatusGroup => {
    const chron = [...list].reverse(); // oldest-first for playback
    const p = chron[0].profile;
    return {
      userId,
      name: userId === myId ? 'My status' : p?.display_name || 'FUTUREHAT user',
      avatar: p?.avatar_url ?? null,
      statuses: chron,
      allSeen: userId === myId ? true : chron.every((s) => viewed.has(s.id)),
    };
  };

  const mineList = byUser.get(myId);
  const mine = mineList && mineList.length ? build(myId, mineList) : null;
  byUser.delete(myId);

  const groups: StatusGroup[] = [];
  for (const [userId, list] of byUser) groups.push(build(userId, list));
  groups.sort((a, b) => {
    if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1; // unseen first
    return b.statuses[b.statuses.length - 1].created_at.localeCompare(
      a.statuses[a.statuses.length - 1].created_at,
    );
  });

  return { mine, groups };
}
