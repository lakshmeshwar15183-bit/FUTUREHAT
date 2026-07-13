// Lumixo web — local-only nicknames (Instagram-class).
import {
  type NicknameMap,
  nicknameStorageKey,
  setNicknameInMap,
  getNicknameFromMap,
  normalizeNickname,
} from '@shared/nicknames';

export type { NicknameMap };

export function readNicknames(myUserId: string): NicknameMap {
  if (typeof localStorage === 'undefined' || !myUserId) return {};
  try {
    const raw = localStorage.getItem(nicknameStorageKey(myUserId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as NicknameMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeNicknames(myUserId: string, map: NicknameMap): void {
  if (typeof localStorage === 'undefined' || !myUserId) return;
  try {
    localStorage.setItem(nicknameStorageKey(myUserId), JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function getNickname(myUserId: string, peerId: string): string | null {
  return getNicknameFromMap(readNicknames(myUserId), peerId);
}

export function setNickname(
  myUserId: string,
  peerId: string,
  nickname: string | null,
): NicknameMap {
  const next = setNicknameInMap(readNicknames(myUserId), peerId, nickname);
  writeNicknames(myUserId, next);
  return next;
}

export { normalizeNickname, getNicknameFromMap };
