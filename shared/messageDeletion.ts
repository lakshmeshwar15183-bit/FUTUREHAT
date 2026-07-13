// Lumixo — soft-delete / moderation tombstone helpers (shared mobile + web).
import type { Message } from './types.js';

export type MessageDeletedKind = 'user' | 'moderation';

/** True when Lumixo moderation removed the message (not a user unsend). */
export function isModerationRemoved(
  m: Pick<Message, 'is_deleted' | 'deleted_kind'> | null | undefined,
): boolean {
  return !!m?.is_deleted && m.deleted_kind === 'moderation';
}

/**
 * Placeholder copy for a soft-deleted message.
 * - moderation (DM): guidelines line
 * - moderation (group): shorter “removed by Lumixo”
 * - user unsend / legacy deleted: “This message was deleted”
 */
export function deletedMessageLabel(
  m: Pick<Message, 'is_deleted' | 'deleted_kind'> | null | undefined,
  opts?: { isGroup?: boolean },
): string {
  if (!m?.is_deleted) return '';
  if (m.deleted_kind === 'moderation') {
    return opts?.isGroup
      ? 'This message was removed by Lumixo.'
      : 'This message was removed by Lumixo for violating our Community Guidelines.';
  }
  return 'This message was deleted';
}

/** Quote / reply-preview text when the parent was removed. */
export function deletedReplyLabel(
  m: Pick<Message, 'is_deleted' | 'deleted_kind'> | null | undefined,
): string {
  if (!m?.is_deleted) return '';
  if (m.deleted_kind === 'moderation') return 'Removed by Lumixo';
  return 'This message was deleted';
}

/** Chat-list preview must never surface original moderated body (content is null). */
export function deletedListPreview(
  m: Pick<Message, 'is_deleted' | 'deleted_kind'> | null | undefined,
): string {
  if (!m?.is_deleted) return '';
  if (m.deleted_kind === 'moderation') return 'Message removed by Lumixo';
  return 'This message was deleted';
}
