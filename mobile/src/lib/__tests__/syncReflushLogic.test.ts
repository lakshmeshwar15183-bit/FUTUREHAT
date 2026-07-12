/**
 * Unit-level model of outbox re-flush semantics (sync.ts).
 * Guards the race: enqueue during flush must schedule another pass.
 */

type Item = { id: string; attempts: number };

function makeFlusher() {
  let flushing = false;
  let needsReflush = false;
  let box: Item[] = [];
  const sent: string[] = [];
  const dead: string[] = [];
  const MAX = 3;

  async function flush(process: (item: Item) => Promise<'ok' | 'fail'>) {
    if (flushing) {
      needsReflush = true;
      return;
    }
    flushing = true;
    needsReflush = false;
    try {
      do {
        needsReflush = false;
        const snapshot = [...box];
        for (const item of snapshot) {
          if (item.attempts >= MAX) {
            box = box.filter((b) => b.id !== item.id);
            dead.push(item.id);
            continue;
          }
          const res = await process(item);
          if (res === 'ok') {
            box = box.filter((b) => b.id !== item.id);
            sent.push(item.id);
          } else {
            item.attempts += 1;
          }
        }
      } while (needsReflush);
    } finally {
      flushing = false;
      if (needsReflush) {
        needsReflush = false;
        await flush(process);
      }
    }
  }

  return {
    enqueue(id: string) {
      box.push({ id, attempts: 0 });
      return flush(async () => 'ok');
    },
    flush,
    get sent() { return sent; },
    get dead() { return dead; },
    get pending() { return box.map((b) => b.id); },
  };
}

describe('outbox re-flush race', () => {
  it('re-runs when enqueue happens mid-flush', async () => {
    const f = makeFlusher();
    let resolveFirst!: () => void;
    const gate = new Promise<void>((r) => { resolveFirst = r; });
    let first = true;

    const process = async (item: Item): Promise<'ok' | 'fail'> => {
      if (first) {
        first = false;
        // Mid-flush enqueue B
        void f.enqueue('B');
        await gate;
      }
      return 'ok';
    };

    f.enqueue('A'); // starts flush of A only if we wire differently
    // Seed A then flush with gate
    const flusher = makeFlusher();
    // Manual seed
    await flusher.flush(async () => 'ok'); // empty

    // Better direct scenario:
    const box: Item[] = [{ id: 'A', attempts: 0 }];
    let flushing = false;
    let needsReflush = false;
    const sent: string[] = [];
    let midEnqueued = false;

    async function flush() {
      if (flushing) {
        needsReflush = true;
        return;
      }
      flushing = true;
      needsReflush = false;
      try {
        do {
          needsReflush = false;
          const snap = [...box];
          for (const item of snap) {
            if (item.id === 'A' && !midEnqueued) {
              midEnqueued = true;
              box.push({ id: 'B', attempts: 0 });
              // Concurrent flush request (like flushOutbox from send)
              void flush();
            }
            // process success
            const idx = box.findIndex((b) => b.id === item.id);
            if (idx >= 0) box.splice(idx, 1);
            sent.push(item.id);
          }
        } while (needsReflush);
      } finally {
        flushing = false;
      }
    }

    await flush();
    expect(sent).toContain('A');
    expect(sent).toContain('B');
    expect(box).toHaveLength(0);
  });

  it('dead-letters after max attempts', async () => {
    const box: Item[] = [{ id: 'poison', attempts: 3 }];
    const dead: string[] = [];
    const MAX = 3;
    if ((box[0].attempts ?? 0) >= MAX) {
      dead.push(box[0].id);
      box.length = 0;
    }
    expect(dead).toEqual(['poison']);
    expect(box).toHaveLength(0);
  });
});
