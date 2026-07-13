// Lumixo — identity resolution (display names, avatars, conversation titles).
//
// HARD RULE: never show "Unknown" for a user we already know exists if any
// usable label (nickname, display name, username, phone, email, or previously
// cached title) is available. Network blips must not wipe a good name.
//
// Priority (Instagram-class):
//   1. Local nickname (this device / this account only)
//   2. Display name
//   3. Username
//   4. Phone / email (last resort identifiers)
//   5. Previously cached label
//   6. "Contact" (existing id, no labels yet) — never invent "Unknown" for live ids

export type IdentityLike = {
  id?: string | null;
  display_name?: string | null;
  username?: string | null;
  phone?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

/** True if a string is empty or the forbidden placeholder we never want to show. */
export function isWeakLabel(s: string | null | undefined): boolean {
  if (s == null) return true;
  const t = s.trim();
  if (!t) return true;
  if (/^unknown$/i.test(t)) return true;
  if (/^deleted user$/i.test(t)) return false; // intentional purged-account label
  return false;
}

export function cleanLabel(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  if (!t) return null;
  if (/^unknown$/i.test(t)) return null;
  return t;
}

/**
 * Resolve the primary display name for UI.
 * Never returns "Unknown" when `person.id` is set unless `allowUnknown` is true
 * (reserved for truly unresolvable / deleted after all retries).
 */
export function resolveDisplayName(
  person: IdentityLike | null | undefined,
  opts?: {
    nickname?: string | null;
    /** Previously shown label (cache) — preferred over placeholders. */
    fallback?: string | null;
    /** Only true after confirmed account purge / no id. */
    allowUnknown?: boolean;
  },
): string {
  const nick = cleanLabel(opts?.nickname);
  if (nick) return nick;

  const display = cleanLabel(person?.display_name);
  if (display) return display;

  const username = cleanLabel(person?.username);
  if (username) return username.startsWith('@') ? username.slice(1) : username;

  const phone = cleanLabel(person?.phone);
  if (phone) return phone;

  const email = cleanLabel(person?.email);
  if (email) return email;

  const fb = cleanLabel(opts?.fallback);
  if (fb) return fb;

  if (person?.id) return 'Contact';
  return opts?.allowUnknown ? 'Unknown' : 'Contact';
}

/** Secondary line (@username) when it differs from the primary name. */
export function resolveUsernameHandle(
  person: IdentityLike | null | undefined,
): string | null {
  const u = cleanLabel(person?.username);
  if (!u) return null;
  return u.startsWith('@') ? u : `@${u}`;
}

export function resolveAvatarUrl(
  person: IdentityLike | null | undefined,
  fallback?: string | null,
): string | null {
  const a = person?.avatar_url?.trim();
  if (a) return a;
  const f = fallback?.trim();
  return f || null;
}

/**
 * Merge two profile snapshots — never lose a non-empty field to null/empty
 * from a partial or failed fetch (race / offline / public_profiles gap).
 */
export function mergeProfileIdentity<T extends IdentityLike>(
  prev: T | null | undefined,
  next: T | null | undefined,
): T | null {
  if (!next && !prev) return null;
  if (!next) return (prev as T) ?? null;
  if (!prev) return next;
  const pick = (a: string | null | undefined, b: string | null | undefined) => {
    const ca = cleanLabel(a);
    if (ca) return a ?? ca;
    const cb = cleanLabel(b);
    if (cb) return b ?? cb;
    return a ?? b ?? null;
  };
  return {
    ...prev,
    ...next,
    id: next.id || prev.id,
    display_name: pick(next.display_name, prev.display_name) as T['display_name'],
    username: pick(next.username, prev.username) as T['username'],
    phone: pick(next.phone as string | null, prev.phone as string | null) as T['phone'],
    avatar_url: (next.avatar_url?.trim() || prev.avatar_url?.trim() || null) as T['avatar_url'],
  };
}

export type ConversationIdentity = {
  type?: string | null;
  name?: string | null;
  avatar_url?: string | null;
};

/**
 * Title for a conversation row / chat header.
 * Groups use group name; DMs use identity priority + optional nickname.
 */
export function resolveConversationTitle(
  conversation: ConversationIdentity,
  otherParticipants: IdentityLike[],
  opts?: {
    nickname?: string | null;
    /** Cached title — keep if fresh resolution is weak. */
    previousTitle?: string | null;
    myId?: string | null;
  },
): string {
  if (conversation.type === 'group') {
    const n = cleanLabel(conversation.name);
    if (n) return n;
    const prev = cleanLabel(opts?.previousTitle);
    if (prev && !/^group$/i.test(prev)) return prev;
    return 'Group';
  }

  const peer = otherParticipants[0] ?? null;
  const nick = opts?.nickname ?? null;
  const resolved = resolveDisplayName(peer, {
    nickname: nick,
    fallback: opts?.previousTitle,
  });
  // If we somehow still got a weak label but previous title was good, keep it.
  if (isWeakLabel(resolved) && !isWeakLabel(opts?.previousTitle)) {
    return opts!.previousTitle!.trim();
  }
  return resolved;
}

export function resolveConversationAvatar(
  conversation: ConversationIdentity,
  otherParticipants: IdentityLike[],
  previousAvatar?: string | null,
): string | null {
  if (conversation.type === 'group') {
    return conversation.avatar_url?.trim() || previousAvatar?.trim() || null;
  }
  const peer = otherParticipants[0];
  return resolveAvatarUrl(peer, previousAvatar);
}

/** True if a title should not clobber a stronger cached title. */
export function isWeakTitle(title: string | null | undefined): boolean {
  if (isWeakLabel(title)) return true;
  const t = (title || '').trim().toLowerCase();
  return t === 'contact' || t === 'group' || t === 'chat' || t === 'user';
}

/**
 * When refreshing the conversation list, never replace a good cached title/avatar
 * with a weaker network result (the classic "Unknown flash" / permanent Unknown bug).
 */
export function mergeConversationIdentityFields<
  T extends {
    conversation: { id: string; type?: string; name?: string | null; avatar_url?: string | null };
    participants: IdentityLike[];
    title: string;
    avatarUrl: string | null;
  },
>(
  cached: T | null | undefined,
  fresh: T,
  opts?: { nickname?: string | null; myId?: string | null },
): T {
  const nickname = opts?.nickname ?? null;
  const myId = opts?.myId ?? null;

  const peerSlice = (parts: IdentityLike[]) =>
    fresh.conversation.type === 'group'
      ? parts
      : parts.filter((p) => !myId || p.id !== myId);

  if (!cached || cached.conversation.id !== fresh.conversation.id) {
    const others = peerSlice(fresh.participants);
    const title = resolveConversationTitle(fresh.conversation, others, {
      nickname,
      previousTitle: fresh.title,
    });
    return {
      ...fresh,
      title: isWeakTitle(title) && !isWeakTitle(fresh.title) ? fresh.title : title,
      avatarUrl: resolveConversationAvatar(fresh.conversation, others, fresh.avatarUrl),
    };
  }

  // Merge participant profiles field-wise (never lose cached name/avatar fields).
  const prevById = new Map(cached.participants.map((p) => [p.id || '', p]));
  const mergedParticipants = fresh.participants.map((p) => {
    const prev = p.id ? prevById.get(p.id) : null;
    return mergeProfileIdentity(prev, p) ?? p;
  });
  for (const p of cached.participants) {
    if (p.id && !mergedParticipants.some((x) => x.id === p.id)) {
      mergedParticipants.push(p);
    }
  }

  const others = peerSlice(mergedParticipants);
  let title = resolveConversationTitle(fresh.conversation, others, {
    nickname,
    previousTitle: cached.title,
  });
  if (isWeakTitle(title) && !isWeakTitle(cached.title)) title = cached.title;

  const avatarUrl =
    resolveConversationAvatar(fresh.conversation, others, cached.avatarUrl) ||
    fresh.avatarUrl ||
    cached.avatarUrl;

  return {
    ...fresh,
    participants: mergedParticipants as T['participants'],
    title,
    avatarUrl,
  };
}

/**
 * Apply nicknames + identity merge across a full conversation list after network load.
 */
export function stabilizeConversationList<
  T extends {
    conversation: { id: string; type?: string; name?: string | null; avatar_url?: string | null };
    participants: IdentityLike[];
    title: string;
    avatarUrl: string | null;
  },
>(
  fresh: T[],
  cached: T[],
  nicknames: Record<string, string>,
  myId?: string | null,
): T[] {
  const cacheById = new Map(cached.map((c) => [c.conversation.id, c]));
  return fresh.map((f) => {
    const prev = cacheById.get(f.conversation.id);
    const peer =
      f.conversation.type === 'group'
        ? null
        : f.participants.find((p) => p.id && p.id !== myId) ?? null;
    const nick = peer?.id ? nicknames[peer.id] ?? null : null;
    return mergeConversationIdentityFields(prev, f, { nickname: nick, myId });
  });
}
