// Unit tests for group chat polish helpers (no DB).
import {
  activeMentionQuery,
  applyMention,
  filterMentionMembers,
  nextPinnedId,
  linksFromMessages,
  extractUrls,
  formatGroupCreatedAt,
  resolveMentionedUserIds,
} from '../../../../shared/groupChatExtras';
import type { GroupMember, Message } from '../../../../shared/types';

const member = (id: string, name: string, username?: string): GroupMember => ({
  userId: id,
  role: 'member',
  joinedAt: '2026-01-01',
  profile: {
    id,
    phone: null,
    username: username ?? null,
    display_name: name,
    about: null,
    avatar_url: null,
    last_seen: null,
    created_at: '2026-01-01',
  },
});

describe('groupChatExtras', () => {
  it('detects trailing @mention query', () => {
    expect(activeMentionQuery('hi @al')).toEqual({ query: 'al', start: 3 });
    expect(activeMentionQuery('hi there')).toBeNull();
  });

  it('applies mention replacement', () => {
    const r = applyMention('hi @al', 3, 'alice');
    expect(r.text).toBe('hi @alice ');
  });

  it('filters members for mention picker', () => {
    const list = [member('1', 'Alice', 'alice'), member('2', 'Bob', 'bob')];
    expect(filterMentionMembers(list, 'ali', null).map((m) => m.userId)).toEqual(['1']);
  });

  it('cycles pinned ids', () => {
    expect(nextPinnedId(['a', 'b', 'c'], null)).toBe('a');
    expect(nextPinnedId(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextPinnedId(['a', 'b', 'c'], 'c')).toBe('a');
  });

  it('extracts unique urls', () => {
    expect(extractUrls('see https://a.com/x and https://a.com/x')).toEqual(['https://a.com/x']);
  });

  it('builds shared links from messages', () => {
    const msgs = [
      {
        id: 'm1',
        conversation_id: 'c',
        sender_id: 's',
        type: 'text',
        content: 'https://lumixo.app/invite',
        media_url: null,
        reply_to: null,
        is_deleted: false,
        created_at: '2026-01-02',
        edited_at: null,
      } as Message,
    ];
    expect(linksFromMessages(msgs)).toHaveLength(1);
  });

  it('formats created date', () => {
    expect(formatGroupCreatedAt('2026-07-01T00:00:00.000Z')).toMatch(/2026/);
  });

  it('resolves mentioned user ids', () => {
    const list = [member('1', 'Alice Wonder', 'alice'), member('2', 'Bob', 'bob')];
    expect(resolveMentionedUserIds('hey @alice and @Bob', list)).toEqual(['1', '2']);
  });
});
