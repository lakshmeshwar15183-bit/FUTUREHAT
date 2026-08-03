// Lumixo — soft-delete / moderation tombstone helpers (shared mobile + web).
import type { Message } from './types.js';

export type MessageDeletedKind = 'user' | 'moderation';

/** True when Lumixo moderation removed the message (not a user unsend). */
export function isModerationRemoved(
  m: Pick<Message, 'is_deleted' | 'deleted_kind'> | null | undefined,
): boolean {
  return !!m?.is_deleted && m.deleted_kind === 'moderation';
}

/** Canonical tombstone for user unsend (delete for everyone). */
export const UNSEND_TOMBSTONE = 'This message was removed by Lumixo.';

/**
 * Placeholder copy for a soft-deleted message.
 * - moderation (DM): guidelines line
 * - moderation (group) + user unsend: short Lumixo tombstone
 * Never “This message was deleted” / “deleted for everyone”.
 */
export function deletedMessageLabel(
  m: Pick<Message, 'is_deleted' | 'deleted_kind'> | null | undefined,
  opts?: { isGroup?: boolean },
): string {
  if (!m?.is_deleted) return '';
  if (m.deleted_kind === 'moderation' && !opts?.isGroup) {
    return 'This message was removed by Lumixo for violating our Community Guidelines.';
  }
  return UNSEND_TOMBSTONE;
}

/** Quote / reply-preview text when the parent was removed or hard-deleted. */
export function deletedReplyLabel(
  m: Pick<Message, 'is_deleted' | 'deleted_kind'> | null | undefined,
): string {
  if (!m?.is_deleted) return '';
  if (m.deleted_kind === 'moderation') return 'Removed by Lumixo';
  // Unsend / missing parent: no “message deleted” bubble — reply quote only.
  return 'Original message unavailable';
}

/** Chat-list preview must never surface original moderated body (content is null). */
export function deletedListPreview(
  m: Pick<Message, 'is_deleted' | 'deleted_kind'> | null | undefined,
): string {
  if (!m?.is_deleted) return '';
  if (m.deleted_kind === 'moderation') return 'Message removed by Lumixo';
  return UNSEND_TOMBSTONE;
}

/**
 * Telegram-style: sender may "also delete for everyone" for their own
 * non-system messages at any age (no short unsend window).
 * Named distinctly from conversation-level canDeleteForEveryone (messageExtras).
 */
export function canDeleteMessageForEveryone(
  m: Pick<Message, 'is_deleted' | 'type' | 'sender_id'> | null | undefined,
  myId: string | null | undefined,
): boolean {
  if (!m || !myId || m.is_deleted || m.type === 'system') return false;
  return m.sender_id === myId;
}

/** @deprecated Use canDeleteMessageForEveryone. */
export function canUnsendMessage(
  m: Pick<Message, 'created_at' | 'is_deleted' | 'type' | 'sender_id'> | null | undefined,
  myId: string | null | undefined,
  _nowMs = Date.now(),
): boolean {
  void _nowMs;
  return canDeleteMessageForEveryone(m, myId);
}

/** True when a soft-deleted row should be hidden entirely (user unsend legacy). */
export function shouldOmitDeletedFromTimeline(
  m: Pick<Message, 'is_deleted' | 'deleted_kind'> | null | undefined,
): boolean {
  if (!m?.is_deleted) return false;
  // Keep moderation tombstones; hide user soft-deletes (Telegram: no ghost).
  return m.deleted_kind !== 'moderation';
}
