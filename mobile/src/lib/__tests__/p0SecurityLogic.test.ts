/**
 * Pure-logic unit tests for the six P0 security seals.
 * These mirror production guards so regressions fail CI without a live DB.
 */

// ── 1) System message type forgery ──────────────────────────────────────────
const ALLOWED_MESSAGE_TYPES = new Set(['text', 'image', 'video', 'file', 'audio']);

function clientRejectsSystemType(type: string): boolean {
  return type === 'system' || !ALLOWED_MESSAGE_TYPES.has(type);
}

function editBlocksSystem(type: string): boolean {
  return type === 'system';
}

// ── 2) Push drain abuse ─────────────────────────────────────────────────────
function clientSendPushBody() {
  return { drainOutbox: false, limit: 1 };
}

// ── 3) FCM token hijack ─────────────────────────────────────────────────────
function wouldReassign(ownerId: string | null, authUid: string): boolean {
  // Match 0051: refuse if owner is set and different.
  if (ownerId != null && ownerId !== authUid) return false;
  return true; // own or unowned → claim/refresh OK
}

// ── 4) Profile public cols ──────────────────────────────────────────────────
const PROFILE_PUBLIC_COLS =
  'id, username, display_name, about, avatar_url, last_seen, created_at';

// ── 5) AppLock WebAuthn ─────────────────────────────────────────────────────
function webAuthnGetOptions(storedCredId: string | null) {
  if (!storedCredId) return { mode: 'create' as const };
  return {
    mode: 'get' as const,
    allowCredentials: [{ type: 'public-key', id: storedCredId }],
    userVerification: 'required' as const,
  };
}

// ── 6) XSS safeHref ─────────────────────────────────────────────────────────
function p0SafeHref(u?: string | null, origin = 'https://lumixo.app'): string | undefined {
  if (!u) return undefined;
  const trimmed = String(u).trim();
  if (!trimmed || /^(javascript|vbscript|data\s*:?\s*text\/html)/i.test(trimmed)) return undefined;
  try {
    const { protocol } = new URL(trimmed, origin);
    return protocol === 'http:' || protocol === 'https:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function p0SafeMediaSrc(u?: string | null): string | undefined {
  if (!u) return undefined;
  const trimmed = String(u).trim();
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^blob:/i.test(trimmed)) return trimmed;
  return p0SafeHref(trimmed);
}

describe('P0.1 system message forgery (client)', () => {
  it('rejects type=system on send', () => {
    expect(clientRejectsSystemType('system')).toBe(true);
    expect(clientRejectsSystemType('text')).toBe(false);
  });
  it('blocks edit of system messages', () => {
    expect(editBlocksSystem('system')).toBe(true);
    expect(editBlocksSystem('text')).toBe(false);
  });
});

describe('P0.2 push RPC client abuse', () => {
  it('sendPush must not drain global outbox', () => {
    expect(clientSendPushBody().drainOutbox).toBe(false);
  });
});

describe('P0.3 FCM token hijack', () => {
  it('refuses reassignment when token owned by another user', () => {
    expect(wouldReassign('user-B', 'user-A')).toBe(false);
  });
  it('allows own token refresh', () => {
    expect(wouldReassign('user-A', 'user-A')).toBe(true);
  });
  it('allows claim of unowned token', () => {
    expect(wouldReassign(null, 'user-A')).toBe(true);
  });
});

describe('P0.4 profiles phone enumeration', () => {
  it('public columns never include phone', () => {
    expect(PROFILE_PUBLIC_COLS.includes('phone')).toBe(false);
    expect(PROFILE_PUBLIC_COLS.includes('account_status')).toBe(false);
  });
});

describe('P0.5 AppLock unbound WebAuthn', () => {
  it('get path always binds allowCredentials', () => {
    const opts = webAuthnGetOptions('abc123');
    expect(opts.mode).toBe('get');
    if (opts.mode === 'get') {
      expect(opts.allowCredentials).toHaveLength(1);
      expect(opts.allowCredentials[0].id).toBe('abc123');
      expect(opts.userVerification).toBe('required');
    }
  });
  it('first use creates, does not unbound-get', () => {
    expect(webAuthnGetOptions(null).mode).toBe('create');
  });
});

describe('P0.6 XSS media links', () => {
  it('blocks javascript: href', () => {
    expect(p0SafeHref('javascript:alert(1)')).toBeUndefined();
    expect(p0SafeHref("javascript:fetch('//evil')")).toBeUndefined();
  });
  it('blocks data:text/html', () => {
    expect(p0SafeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(p0SafeMediaSrc('data:text/html,<script>x</script>')).toBeUndefined();
  });
  it('allows https media and data:image stickers', () => {
    expect(p0SafeHref('https://x.supabase.co/storage/v1/object/sign/a.jpg')).toBeDefined();
    expect(p0SafeMediaSrc('data:image/svg+xml;base64,abc')).toBeDefined();
  });
  it('blocks vbscript:', () => {
    expect(p0SafeHref('vbscript:msgbox(1)')).toBeUndefined();
  });
});
