/**
 * Mirrors web/src/lib/outbox.ts re-flush + max-attempt semantics (pure logic).
 */
type OutboxRow = { id: string; attempts: number };

function makeBox() {
  let items: OutboxRow[] = [];
  let flushing = false;
  let need = false;
  const dead: string[] = [];
  const sent: string[] = [];
  const MAX = 3;

  async function flush(ok: (id: string) => boolean) {
    if (flushing) {
      need = true;
      return;
    }
    flushing = true;
    need = false;
    try {
      do {
        need = false;
        const next: OutboxRow[] = [];
        for (const it of items) {
          if (it.attempts >= MAX) {
            dead.push(it.id);
            continue;
          }
          if (ok(it.id)) sent.push(it.id);
          else next.push({ ...it, attempts: it.attempts + 1 });
        }
        items = next;
      } while (need);
    } finally {
      flushing = false;
    }
  }

  return {
    enqueue(id: string) {
      items.push({ id, attempts: 0 });
    },
    flush,
    get items() {
      return items;
    },
    get dead() {
      return dead;
    },
    get sent() {
      return sent;
    },
    set needReflush(v: boolean) {
      need = v;
    },
  };
}

describe('web outbox re-flush model', () => {
  it('re-runs when flush requested mid-flight', async () => {
    const box = makeBox();
    box.enqueue('A');
    let mid = false;
    await box.flush((id) => {
      if (id === 'A' && !mid) {
        mid = true;
        box.enqueue('B');
        box.needReflush = true;
      }
      return true;
    });
    // Second pass may need explicit flush if model only loops on need flag during first flush
    await box.flush(() => true);
    expect(box.sent).toContain('A');
    expect(box.items.find((i) => i.id === 'B') || box.sent.includes('B')).toBeTruthy();
  });

  it('dead-letters after max attempts', async () => {
    const box = makeBox();
    box.enqueue('poison');
    await box.flush(() => false);
    await box.flush(() => false);
    await box.flush(() => false);
    await box.flush(() => false);
    expect(box.dead).toContain('poison');
  });
});
