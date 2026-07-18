import { createMessageBatcher } from '../messageBatch';
import type { Message } from '../shared';

function msg(id: string): Message {
  return {
    id,
    conversation_id: 'c',
    sender_id: 'u',
    type: 'text',
    content: id,
    media_url: null,
    reply_to: null,
    is_deleted: false,
    edited_at: null,
    created_at: new Date().toISOString(),
  } as Message;
}

describe('createMessageBatcher', () => {
  test('coalesces multiple pushes into one apply', async () => {
    const applied: Message[][] = [];
    const b = createMessageBatcher((batch) => applied.push(batch), 10);
    b.push(msg('a'));
    b.push(msg('b'));
    b.push(msg('a')); // last write wins for same id
    await new Promise((r) => setTimeout(r, 40));
    expect(applied.length).toBe(1);
    expect(applied[0].map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  test('flush applies immediately', () => {
    const applied: Message[][] = [];
    const b = createMessageBatcher((batch) => applied.push(batch), 1000);
    b.push(msg('x'));
    b.flush();
    expect(applied.length).toBe(1);
    expect(applied[0][0].id).toBe('x');
  });
});
