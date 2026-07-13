// Lumixo — Instagram-like local nicknames.
//
// Nicknames are PRIVATE to the current user on this device family of storage
// (AsyncStorage / localStorage). They never write to the peer's account and
// never change what other people see.

export type NicknameMap = Record<string, string>; // peerUserId → nickname

export function normalizeNickname(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  // Cap length (Instagram-ish ~30).
  return t.slice(0, 30);
}

export function nicknameStorageKey(myUserId: string): string {
  return `fh:nicknames:v1:${myUserId}`;
}

/** Pure merge helper for tests / multi-write. */
export function setNicknameInMap(
  map: NicknameMap,
  peerUserId: string,
  nickname: string | null,
): NicknameMap {
  const next = { ...map };
  const n = normalizeNickname(nickname);
  if (!n) delete next[peerUserId];
  else next[peerUserId] = n;
  return next;
}

export function getNicknameFromMap(
  map: NicknameMap | null | undefined,
  peerUserId: string | null | undefined,
): string | null {
  if (!map || !peerUserId) return null;
  return normalizeNickname(map[peerUserId] ?? null);
}
