/**
 * P0/P1: Clear-chat keep-starred filter (pure logic mirror of clearChatMessagesForMe).
 */
function filterClearIds(
  messageIds: string[],
  starredIds: Set<string>,
  keepStarred: boolean,
): string[] {
  if (!keepStarred) return [...messageIds];
  return messageIds.filter((id) => !starredIds.has(id));
}

describe('clear chat keep-starred filter', () => {
  const msgs = ['a', 'b', 'c', 'd'];
  const starred = new Set(['b', 'd']);

  it('clears all when keepStarred=false', () => {
    expect(filterClearIds(msgs, starred, false)).toEqual(msgs);
  });

  it('preserves starred when keepStarred=true', () => {
    expect(filterClearIds(msgs, starred, true)).toEqual(['a', 'c']);
  });

  it('clears nothing when all starred', () => {
    expect(filterClearIds(['b', 'd'], starred, true)).toEqual([]);
  });
});
