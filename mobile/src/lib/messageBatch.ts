// Lumixo mobile — coalesce rapid realtime message inserts into one setState
// per animation frame (or ~32ms). Keeps scroll at 60fps during active chats
// without dropping messages (flush always applies full queue).

import type { Message } from './shared';

type ApplyFn = (incoming: Message[]) => void;

export function createMessageBatcher(apply: ApplyFn, maxWaitMs = 32) {
  let queue: Message[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let raf: number | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (raf != null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    // Dedupe by id, last write wins (same message updated twice in one frame).
    const map = new Map<string, Message>();
    for (const m of batch) map.set(m.id, m);
    apply([...map.values()]);
  };

  const schedule = () => {
    if (timer != null) return;
    // Prefer rAF when available; fallback timer for tests / non-UI contexts.
    if (typeof requestAnimationFrame === 'function') {
      raf = requestAnimationFrame(() => {
        raf = null;
        flush();
      });
      // Cap wait if rAF is delayed (background).
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, maxWaitMs);
    } else {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, maxWaitMs);
    }
  };

  return {
    /** Queue a message for coalesced apply. */
    push(m: Message) {
      queue.push(m);
      schedule();
    },
    /** Immediate flush (unmount / critical path). */
    flush,
    /** Drop pending without apply. */
    clear() {
      queue = [];
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (raf != null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    },
  };
}
