// FUTUREHAT mobile — shared status helpers used by the strip, viewer and composer.
// Groups active statuses by author (WhatsApp-style), resolves author profiles,
// and marks each group seen/unseen for the current user. Kept framework-free so
// both the horizontal strip and the full-screen viewer share one source of truth.
import type { Status, Profile } from '../../lib/shared';

export interface StatusGroup {
  userId: string;
  profile: Profile | null;
  statuses: Status[]; // oldest-first, ready for sequential playback
  allSeen: boolean;
}

export function isVideoStatus(s: Status): boolean {
  if (s.type === 'video') return true;
  return !!s.media_url && /\.(mp4|webm|mov|m4v|ogv)$/i.test(s.media_url);
}

export function isAudioStatus(s: Status): boolean {
  if (s.type === 'audio') return true;
  return !!s.media_url && /\.(m4a|mp3|aac|wav|ogg|opus)$/i.test(s.media_url);
}

// ── Client-side 36h expiry (CP5) ────────────────────────────────────────────
// The server RLS already hides expired statuses on the next fetch, but we also
// prune locally so a status vanishes the moment it hits `expires_at` — no poll,
// no manual refresh. Returns pruned copies plus the earliest future expiry so a
// caller can schedule the next tick.
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

// Build the ordered list of author groups from the flat active-status list.
// `resolveProfile` fills in an author profile when the joined one is missing.
export async function buildStatusGroups(
  all: Status[],
  myId: string,
  viewed: Set<string>,
  resolveProfile: (userId: string) => Promise<Profile | null>,
): Promise<{ mine: StatusGroup | null; groups: StatusGroup[] }> {
  const byUser = new Map<string, Status[]>();
  for (const s of all) {
    const arr = byUser.get(s.user_id) ?? [];
    arr.push(s);
    byUser.set(s.user_id, arr);
  }

  const build = async (userId: string, list: Status[]): Promise<StatusGroup> => {
    const chron = [...list].reverse(); // oldest-first for playback
    const joined = chron[0].profile;
    const profile = joined
      ? ({ id: joined.id, display_name: joined.display_name, avatar_url: joined.avatar_url } as Profile)
      : await resolveProfile(userId);
    return {
      userId,
      profile,
      statuses: chron,
      allSeen: userId === myId ? true : chron.every((s) => viewed.has(s.id)),
    };
  };

  const mineList = byUser.get(myId);
  const mine = mineList && mineList.length ? await build(myId, mineList) : null;
  byUser.delete(myId);

  const groups: StatusGroup[] = [];
  for (const [userId, list] of byUser) groups.push(await build(userId, list));
  groups.sort((a, b) => {
    if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1; // unseen first
    return b.statuses[b.statuses.length - 1].created_at.localeCompare(
      a.statuses[a.statuses.length - 1].created_at,
    );
  });

  return { mine, groups };
}
