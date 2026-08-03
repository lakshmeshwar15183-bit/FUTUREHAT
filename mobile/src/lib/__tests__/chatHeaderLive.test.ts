import {
  bindChatHeaderLive,
  patchChatHeaderLive,
  setChatHeaderTyping,
  getChatHeaderLive,
  resolveHeaderSubtitle,
  clearChatHeaderLive,
  subscribeChatHeaderLive,
} from '../chatHeaderLive';

describe('chatHeaderLive', () => {
  afterEach(() => clearChatHeaderLive());

  test('typing does not change baseSubtitle; resolve prefers typing', () => {
    bindChatHeaderLive('c1', { title: 'Ada', baseSubtitle: 'online', isGroup: false });
    setChatHeaderTyping('c1', 'Ada');
    const live = getChatHeaderLive();
    expect(live.baseSubtitle).toBe('online');
    expect(resolveHeaderSubtitle(live)).toBe('typing…');
    setChatHeaderTyping('c1', null);
    expect(resolveHeaderSubtitle(getChatHeaderLive())).toBe('online');
  });

  test('ignores patches for other conversation', () => {
    bindChatHeaderLive('c1', { title: 'A' });
    patchChatHeaderLive('c2', { title: 'B' });
    expect(getChatHeaderLive().title).toBe('A');
  });

  test('subscribers notified on patch', () => {
    const hits: number[] = [];
    const unsub = subscribeChatHeaderLive(() => hits.push(1));
    bindChatHeaderLive('c1', { title: 'A' });
    patchChatHeaderLive('c1', { title: 'B' });
    unsub();
    patchChatHeaderLive('c1', { title: 'C' });
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});
