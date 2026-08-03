/**
 * Identity resolution + nickname priority tests.
 * Guards: never show "Unknown" for existing users; cache merge; nicknames.
 */
import {
  resolveDisplayName,
  resolveUsernameHandle,
  resolveConversationTitle,
  mergeProfileIdentity,
  mergeConversationIdentityFields,
  stabilizeConversationList,
  isWeakTitle,
  isWeakLabel,
  type IdentityLike,
} from '../../../../shared/identity';
import {
  normalizeNickname,
  setNicknameInMap,
  getNicknameFromMap,
} from '../../../../shared/nicknames';

describe('resolveDisplayName priority', () => {
  test('nickname beats display name and username', () => {
    expect(
      resolveDisplayName(
        { id: 'u1', display_name: 'Ada Lovelace', username: 'ada' },
        { nickname: 'Auntie Ada' },
      ),
    ).toBe('Auntie Ada');
  });

  test('display_name beats username', () => {
    expect(
      resolveDisplayName({ id: 'u1', display_name: 'Ada', username: 'ada' }),
    ).toBe('Ada');
  });

  test('username used when display_name empty', () => {
    expect(
      resolveDisplayName({ id: 'u1', display_name: null, username: 'ada' }),
    ).toBe('ada');
  });

  test('phone used when name/username missing', () => {
    expect(
      resolveDisplayName({ id: 'u1', display_name: null, username: null, phone: '+911234' }),
    ).toBe('+911234');
  });

  test('never returns Unknown for a user with id', () => {
    expect(resolveDisplayName({ id: 'u1', display_name: null, username: null })).toBe('Contact');
    expect(resolveDisplayName({ id: 'u1', display_name: 'Unknown', username: 'realuser' })).toBe('realuser');
  });

  test('fallback cached title used when profile empty', () => {
    expect(
      resolveDisplayName(
        { id: 'u1', display_name: null, username: null },
        { fallback: 'Cached Friend' },
      ),
    ).toBe('Cached Friend');
  });

  test('literal Unknown is treated as weak', () => {
    expect(isWeakLabel('Unknown')).toBe(true);
    expect(isWeakLabel('unknown')).toBe(true);
    expect(isWeakTitle('Unknown')).toBe(true);
  });
});

describe('mergeProfileIdentity', () => {
  test('never loses display_name to null network patch', () => {
    const prev: IdentityLike = {
      id: 'u1',
      display_name: 'Ada',
      username: 'ada',
      avatar_url: 'https://x/a.png',
      phone: null,
    };
    const next: IdentityLike = {
      id: 'u1',
      display_name: null,
      username: null,
      avatar_url: null,
      phone: null,
    };
    const m = mergeProfileIdentity(prev, next)!;
    expect(m.display_name).toBe('Ada');
    expect(m.username).toBe('ada');
    expect(m.avatar_url).toBe('https://x/a.png');
  });

  test('accepts stronger network fields', () => {
    const prev: IdentityLike = { id: 'u1', display_name: 'Ada', username: null, avatar_url: null };
    const next: IdentityLike = {
      id: 'u1',
      display_name: 'Ada Lovelace',
      username: 'ada',
      avatar_url: 'https://x/b.png',
    };
    const m = mergeProfileIdentity(prev, next)!;
    expect(m.display_name).toBe('Ada Lovelace');
    expect(m.username).toBe('ada');
    expect(m.avatar_url).toBe('https://x/b.png');
  });
});

describe('conversation title stability', () => {
  const baseConv = { id: 'c1', type: 'direct' as const, name: null as string | null, avatar_url: null as string | null };

  test('resolveConversationTitle uses username not Unknown', () => {
    expect(
      resolveConversationTitle(baseConv, [{ id: 'u2', display_name: null, username: 'bob' }]),
    ).toBe('bob');
  });

  test('mergeConversationIdentityFields keeps cached title when fresh is weak', () => {
    type Row = {
      conversation: typeof baseConv;
      participants: IdentityLike[];
      title: string;
      avatarUrl: string | null;
    };
    const cached: Row = {
      conversation: baseConv,
      participants: [{ id: 'u2', display_name: 'Bob Builder', username: 'bob', avatar_url: 'a.png' }],
      title: 'Bob Builder',
      avatarUrl: 'a.png',
    };
    const fresh: Row = {
      conversation: baseConv,
      participants: [{ id: 'u2', display_name: null, username: null, avatar_url: null }],
      title: 'Unknown',
      avatarUrl: null,
    };
    const merged = mergeConversationIdentityFields(cached, fresh, { myId: 'me' });
    expect(merged.title).toBe('Bob Builder');
    expect(merged.avatarUrl).toBe('a.png');
    expect(merged.participants[0].display_name).toBe('Bob Builder');
  });

  test('stabilizeConversationList applies nicknames', () => {
    type Row = {
      conversation: typeof baseConv;
      participants: IdentityLike[];
      title: string;
      avatarUrl: string | null;
    };
    const fresh: Row[] = [{
      conversation: baseConv,
      participants: [
        { id: 'me', display_name: 'Me', username: 'me' },
        { id: 'u2', display_name: 'Bob', username: 'bob' },
      ],
      title: 'Bob',
      avatarUrl: null,
    }];
    const out = stabilizeConversationList(fresh, [], { u2: 'Bobby' }, 'me');
    expect(out[0].title).toBe('Bobby');
  });

  test('stabilize never invents Unknown from empty profile', () => {
    type Row = {
      conversation: typeof baseConv;
      participants: IdentityLike[];
      title: string;
      avatarUrl: string | null;
    };
    const fresh: Row[] = [{
      conversation: baseConv,
      participants: [{ id: 'u2', display_name: null, username: null }],
      title: 'Unknown',
      avatarUrl: null,
    }];
    const cached: Row[] = [{
      conversation: baseConv,
      participants: [{ id: 'u2', display_name: 'Sam', username: 'sam' }],
      title: 'Sam',
      avatarUrl: 's.png',
    }];
    const out = stabilizeConversationList(fresh, cached, {}, 'me');
    expect(out[0].title).not.toMatch(/unknown/i);
    expect(out[0].title).toBe('Sam');
  });
});

describe('nicknames', () => {
  test('normalize trims and caps length', () => {
    expect(normalizeNickname('  hi  ')).toBe('hi');
    expect(normalizeNickname('x'.repeat(50))!.length).toBe(30);
    expect(normalizeNickname('   ')).toBeNull();
  });

  test('set/get map', () => {
    let map = setNicknameInMap({}, 'u2', 'Bobby');
    expect(getNicknameFromMap(map, 'u2')).toBe('Bobby');
    map = setNicknameInMap(map, 'u2', null);
    expect(getNicknameFromMap(map, 'u2')).toBeNull();
  });
});

describe('username handle', () => {
  test('prefixes @ once', () => {
    expect(resolveUsernameHandle({ username: 'ada' })).toBe('@ada');
    expect(resolveUsernameHandle({ username: '@ada' })).toBe('@ada');
    expect(resolveUsernameHandle({ username: null })).toBeNull();
  });
});
