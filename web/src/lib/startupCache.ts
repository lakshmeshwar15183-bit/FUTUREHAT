// Lumixo web — startup cache helpers for cache-first UI.
// Conversations + session hints live in localStorage (sync, zero network).
// Never blocks the main thread with heavy work; JSON parse is bounded.

import type { ConversationSummary, UserPreferences } from '@shared/types';
import type { User } from '@supabase/supabase-js';

const CONV_PREFIX = 'fh:web:convs:v1:';
const PREFS_PREFIX = 'fh:web:prefs:v1:';
const MAX_CACHED_CONVS = 80;

/** Performance marks for WEB_PERFORMANCE_REPORT / DevTools. */
export function mark(name: string) {
  try {
    performance.mark(`fh:${name}`);
  } catch {
    /* noop */
  }
}

export function measure(name: string, start: string, end: string) {
  try {
    performance.measure(`fh:${name}`, `fh:${start}`, `fh:${end}`);
  } catch {
    /* noop */
  }
}

/**
 * Synchronously peek a stored Supabase auth session from localStorage.
 * Avoids waiting on getSession() for the first paint decision.
 * Returns null when no valid user is found.
 */
export function peekStoredUser(): User | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('sb-') || !key.includes('auth-token')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        user?: User;
        currentSession?: { user?: User };
        expires_at?: number;
      };
      const user = parsed?.user ?? parsed?.currentSession?.user ?? null;
      if (!user?.id) continue;
      // Soft expiry check — still show shell if expired; getSession will refresh/sign out.
      if (typeof parsed.expires_at === 'number' && parsed.expires_at * 1000 < Date.now() - 86_400_000) {
        // more than 1 day past expiry → ignore
        continue;
      }
      return user;
    }
  } catch {
    /* corrupt storage */
  }
  return null;
}

export function convCacheKey(uid: string) {
  return `${CONV_PREFIX}${uid}`;
}

export function readCachedConversations(uid: string): ConversationSummary[] {
  try {
    const raw = localStorage.getItem(convCacheKey(uid));
    if (!raw) return [];
    const list = JSON.parse(raw) as ConversationSummary[];
    return Array.isArray(list) ? list.slice(0, MAX_CACHED_CONVS) : [];
  } catch {
    return [];
  }
}

export function writeCachedConversations(uid: string, list: ConversationSummary[]): void {
  try {
    // Cap payload size for mobile Safari localStorage limits.
    const slim = list.slice(0, MAX_CACHED_CONVS).map((c) => ({
      conversation: c.conversation,
      participants: c.participants,
      lastMessage: c.lastMessage
        ? {
            ...c.lastMessage,
            // avoid caching huge media_meta blobs if any
            content: (c.lastMessage.content || '').slice(0, 500),
          }
        : null,
      unreadCount: c.unreadCount,
      title: c.title,
      avatarUrl: c.avatarUrl,
    }));
    localStorage.setItem(convCacheKey(uid), JSON.stringify(slim));
  } catch {
    /* quota — drop oldest half and retry once */
    try {
      localStorage.setItem(
        convCacheKey(uid),
        JSON.stringify(list.slice(0, Math.floor(MAX_CACHED_CONVS / 2))),
      );
    } catch {
      /* noop */
    }
  }
}

export function readCachedPrefs(uid: string): Partial<UserPreferences> | null {
  try {
    const raw = localStorage.getItem(PREFS_PREFIX + uid);
    return raw ? (JSON.parse(raw) as Partial<UserPreferences>) : null;
  } catch {
    return null;
  }
}

export function writeCachedPrefs(uid: string, prefs: UserPreferences): void {
  try {
    localStorage.setItem(PREFS_PREFIX + uid, JSON.stringify(prefs));
  } catch {
    /* noop */
  }
}

/** Schedule non-critical work after first paint / when browser is idle. */
export function afterFirstPaint(fn: () => void) {
  if (typeof window === 'undefined') {
    fn();
    return;
  }
  const run = () => {
    try {
      fn();
    } catch {
      /* never break UI */
    }
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => run(), { timeout: 1500 });
  } else {
    setTimeout(run, 0);
  }
}

/** Remove the static HTML boot shell once React has painted. */
export function removeBootShell() {
  try {
    document.documentElement.classList.add('fh-ready');
    const el = document.getElementById('fh-boot');
    if (el) {
      // next frame so React paint lands first
      requestAnimationFrame(() => {
        el.remove();
      });
    }
  } catch {
    /* noop */
  }
}
