// Lumixo — group chat polish helpers (links, mentions, pin cycle).
// Pure utilities — no schema changes. Used by web + mobile Group Info / Chat.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Message, UUID, GroupMember } from './types.js';

// ── Shared links ──────────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>"'`\]\)]+/gi;

export interface SharedLink {
  url: string;
  messageId: UUID;
  senderId: UUID;
  createdAt: string;
  preview: string;
}

/** Extract http(s) URLs from a message body (text / caption). */
export function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = text.match(URL_RE) ?? [];
  // De-dupe while preserving order; strip trailing punctuation often stuck to URLs.
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    const url = raw.replace(/[),.!?;:]+$/g, '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** Pull shared links from an already-loaded message page (client-side). */
export function linksFromMessages(messages: Message[], limit = 80): SharedLink[] {
  const out: SharedLink[] = [];
  for (const m of messages) {
    if (m.is_deleted || m.type === 'system') continue;
    const urls = extractUrls(m.content);
    for (const url of urls) {
      out.push({
        url,
        messageId: m.id,
        senderId: m.sender_id,
        createdAt: m.created_at,
        preview: (m.content || url).slice(0, 120),
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Fetch recent text messages and extract shared links (Group Info “Links” tab).
 * Best-effort — empty on error. Scoped by RLS via conversation membership.
 */
export async function getSharedLinks(
  client: SupabaseClient,
  conversationId: UUID,
  limit = 60,
): Promise<SharedLink[]> {
  try {
    const { data } = await client
      .from('messages')
      .select('id, sender_id, content, created_at, type, is_deleted')
      .eq('conversation_id', conversationId)
      .eq('is_deleted', false)
      .in('type', ['text', 'image', 'video', 'file'])
      .not('content', 'is', null)
      .order('created_at', { ascending: false })
      .limit(Math.min(200, limit * 3));
    return linksFromMessages((data ?? []) as Message[], limit);
  } catch {
    return [];
  }
}

// ── Mentions ──────────────────────────────────────────────────────────────────

/** Detect trailing `@query` in the composer (WhatsApp-style mention trigger). */
export function activeMentionQuery(text: string, cursor?: number): {
  query: string;
  start: number;
} | null {
  const pos = cursor ?? text.length;
  const before = text.slice(0, pos);
  // Match @ at start or after whitespace; query may be empty (show all).
  const m = before.match(/(^|[\s([{])@([^\s@]*)$/);
  if (!m) return null;
  const start = before.length - (m[2].length + 1);
  return { query: m[2], start };
}

/** Filter group members for the mention picker (excludes self when provided). */
export function filterMentionMembers(
  members: GroupMember[],
  query: string,
  myId?: UUID | null,
  limit = 8,
): GroupMember[] {
  const q = query.trim().toLowerCase();
  const list = members.filter((m) => m.userId !== myId);
  if (!q) return list.slice(0, limit);
  return list
    .filter((m) => {
      const name = (m.profile.display_name || '').toLowerCase();
      const user = (m.profile.username || '').toLowerCase();
      return name.includes(q) || user.includes(q);
    })
    .slice(0, limit);
}

/**
 * Insert a mention at the active `@query` span.
 * Format: `@DisplayName ` (human-readable; push resolution uses usernames when present).
 */
export function applyMention(
  text: string,
  mentionStart: number,
  displayLabel: string,
  cursor?: number,
): { text: string; cursor: number } {
  const pos = cursor ?? text.length;
  const insert = `@${displayLabel.replace(/\s+/g, '')} `;
  const next = text.slice(0, mentionStart) + insert + text.slice(pos);
  return { text: next, cursor: mentionStart + insert.length };
}

/**
 * Resolve mentioned member ids from message text using @username or @DisplayName
 * tokens (no spaces in token). Used to fire `mention` push notifications.
 */
export function resolveMentionedUserIds(
  text: string,
  members: GroupMember[],
  myId?: UUID | null,
): UUID[] {
  if (!text.includes('@')) return [];
  const tokens = new Set(
    (text.match(/@([A-Za-z0-9_.\-]{1,40})/g) ?? []).map((t) => t.slice(1).toLowerCase()),
  );
  if (!tokens.size) return [];
  const ids: UUID[] = [];
  for (const m of members) {
    if (m.userId === myId) continue;
    const user = (m.profile.username || '').toLowerCase();
    const name = (m.profile.display_name || '').replace(/\s+/g, '').toLowerCase();
    if ((user && tokens.has(user)) || (name && tokens.has(name))) {
      ids.push(m.userId);
    }
  }
  return ids;
}

// ── Pinned messages cycle ─────────────────────────────────────────────────────

/** Next pinned message id when the user taps the pinned banner (cycles). */
export function nextPinnedId(
  pinnedIds: string[],
  current: string | null,
): string | null {
  if (!pinnedIds.length) return null;
  if (!current) return pinnedIds[0];
  const i = pinnedIds.indexOf(current);
  if (i < 0) return pinnedIds[0];
  return pinnedIds[(i + 1) % pinnedIds.length];
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** Format conversation created_at for Group Info. */
export function formatGroupCreatedAt(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

/** Hostname for link rows (WhatsApp-style secondary line). */
export function linkHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}
