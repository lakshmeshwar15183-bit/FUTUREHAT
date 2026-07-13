import {
  deletedListPreview,
  deletedMessageLabel,
  deletedReplyLabel,
  isModerationRemoved,
} from '../messageDeletion';

describe('messageDeletion', () => {
  const userDel = { is_deleted: true, deleted_kind: 'user' as const };
  const modDel = { is_deleted: true, deleted_kind: 'moderation' as const };
  const live = { is_deleted: false, deleted_kind: null };

  it('detects moderation removals', () => {
    expect(isModerationRemoved(modDel)).toBe(true);
    expect(isModerationRemoved(userDel)).toBe(false);
    expect(isModerationRemoved(live)).toBe(false);
  });

  it('uses guidelines copy for DM moderation and short copy for groups', () => {
    expect(deletedMessageLabel(modDel, { isGroup: false })).toMatch(/Community Guidelines/i);
    expect(deletedMessageLabel(modDel, { isGroup: true })).toBe(
      'This message was removed by Lumixo.',
    );
  });

  it('uses user unsend copy for user deletes', () => {
    expect(deletedMessageLabel(userDel)).toBe('This message was deleted');
  });

  it('reply and list previews never leak original body', () => {
    expect(deletedReplyLabel(modDel)).toBe('Removed by Lumixo');
    expect(deletedListPreview(modDel)).toBe('Message removed by Lumixo');
    expect(deletedListPreview(userDel)).toBe('This message was deleted');
  });
});
