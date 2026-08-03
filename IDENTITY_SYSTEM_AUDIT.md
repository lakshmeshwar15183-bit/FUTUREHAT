# IDENTITY SYSTEM AUDIT

**Date:** 2026-07-13  
**Severity:** P0  
**Status:** Fixed — production-ready identity resolution + Instagram-class nicknames

---

## Summary

Chats could show **"Unknown"** for existing users who already had a correct name and avatar. That is fixed with a shared identity engine, cache-first merges that never clobber good labels, chunked profile fetches, and local nicknames.

**Display priority (everywhere):**

1. **Nickname** (local to this user only)  
2. **Display name**  
3. **Username**  
4. **Phone / email** (last resort)  
5. **Previously cached title**  
6. **"Contact"** if the user id is known but labels are still loading  

**Never** invent the string `"Unknown"` for a registered user id.

---

## Root cause of the "Unknown" bug

### 1. Hardcoded fallback in conversation list

`getMyConversations` (shared/api.ts) used:

```ts
otherProfiles[0]?.display_name || 'Unknown'
```

If `display_name` was null/empty but `username` existed → **Unknown**.  
If the profile map missed the peer (failed/partial join) → **Unknown**.

### 2. Partial profile batch loads

`getProfilesPublic` issued a single `.in('id', allIds)` query. Large participant sets can hit PostgREST URL limits or partial failures → missing map entries → empty `otherProfiles` → **Unknown**.

### 3. Cache overwrite without merge

On network refresh, the conversation list **replaced** local cache wholesale. A transient weak response permanently overwrote a previously good title/avatar ("used to show the right name, now Unknown").

### 4. No field-level profile merge

`cacheProfile` overwrote the full row. A later sparse response could wipe `display_name` / `avatar_url`.

### 5. Stub "Unknown" profiles in groups

`groupsApi.getGroupMembers` filled missing rows with `display_name: 'Unknown'`.

### 6. UI sites repeated the same antipattern

ChatView senders, reply quotes, search hits, starred messages, group pickers — all used `|| 'Unknown'` instead of a shared resolver.

---

## Fix implemented

### A. Shared identity engine — `shared/identity.ts`

| Helper | Role |
|--------|------|
| `resolveDisplayName` | Nickname → display → username → phone/email → cache → Contact |
| `resolveUsernameHandle` | `@username` secondary line |
| `resolveConversationTitle` / `resolveConversationAvatar` | List + header titles |
| `mergeProfileIdentity` | Monotonic field merge (never lose good data) |
| `mergeConversationIdentityFields` | List row merge vs cache |
| `stabilizeConversationList` | Full list + nicknames after network load |
| `isWeakLabel` / `isWeakTitle` | Treats `"Unknown"` as disposable |

### B. Local nicknames — Instagram-class

| Piece | Detail |
|-------|--------|
| `shared/nicknames.ts` | Pure map helpers |
| Mobile | AsyncStorage via `localCache.getNicknames` / `setNickname` |
| Web | `localStorage` via `web/src/lib/nicknames.ts` |
| Scope | **Private to current user** — never writes peer account |
| UI | Profile / Contact: **Add nickname** / Edit; leave empty to remove |
| Chat menu | Mobile: "Add/Edit nickname" → Profile |

### C. Profile fetch pipeline

- **Chunked** `getProfilesPublic` (80 ids/chunk).
- Conversation titles via `resolveConversationTitle` (no `"Unknown"`).
- List load: `stabilizeConversationList(network, cache, nicknames, myId)`.
- Persist all participants with **merge** cache (`cacheProfiles`).
- Chat open: enrich peers from per-profile cache before paint.

### D. Surfaces updated

Chat list, chat header, search, forward (uses stabilized titles), groups, calls, notifications titles, starred, replies/quotes, media viewer sender labels, exported chat transcript, contact/group info, web contact modal.

---

## Files modified

```
shared/identity.ts                          NEW
shared/nicknames.ts                         NEW
shared/api.ts                               chunked profiles, title resolve, re-exports
shared/groupsApi.ts                         no Unknown stub

mobile/src/lib/localCache.ts                merge cache + nicknames API
mobile/src/lib/shared.ts
mobile/src/lib/__tests__/identity.test.ts   NEW
mobile/src/screens/ConversationsScreen.tsx
mobile/src/screens/ChatScreen.tsx
mobile/src/screens/ProfileScreen.tsx        nickname UI
mobile/src/screens/GroupInfoScreen.tsx
mobile/src/screens/StarredScreen.tsx
mobile/src/calls/CallContext.tsx

web/src/lib/nicknames.ts                    NEW
web/src/lib/startupCache.ts
web/src/App.tsx
web/src/ChatView.tsx
web/src/profile/ContactProfileModal.tsx     nickname UI
web/src/StarredMessagesModal.tsx
web/src/GroupModal.tsx
web/src/GroupInfoModal.tsx

IDENTITY_SYSTEM_AUDIT.md                    NEW
```

---

## Tests performed

**Suite:** `mobile/src/lib/__tests__/identity.test.ts`  
**Result:** **16/16 passed**

| Area | Coverage |
|------|----------|
| Priority chain | nickname > display > username > phone |
| No Unknown | id present → Contact / username, never Unknown |
| Cache fallback | previous title when profile empty |
| mergeProfileIdentity | null network cannot wipe name/avatar |
| List stability | weak fresh + strong cache → keep strong title |
| Nicknames | apply on stabilize; normalize length |
| Username handle | single `@` prefix |

Also: existing `messageStatus` suite still green; `tsc --noEmit` clean for mobile + web.

---

## Offline / multi-device / failure modes

| Scenario | Behaviour |
|----------|-----------|
| Offline open | Cached conversations + cached profiles + nicknames |
| Server blip | Stabilize keeps previous titles/avatars |
| App restart | AsyncStorage / localStorage restore |
| Nickname change | Local only; other person’s account name unchanged |
| Multi-device | Profile updates still come from server on refresh; **nicknames are per-device storage** (local-only by design, like Instagram contact names on one phone) |
| Truly deleted / purged | Server may label "Deleted user"; we do not invent Unknown for live ids |

---

## Confirmation

1. **Never display "Unknown" for existing registered users** when any valid identity or cache exists.  
2. **Loading races** keep last cached username and photo.  
3. **Nicknames** optional, private, Instagram-priority.  
4. **Identity resolution is shared**, cache-merge-safe, offline-capable, and production-ready.

---

## Manual smoke checklist

1. Open a chat that once showed Unknown → name + avatar restore from cache after pull-to-refresh.  
2. User with only username (no display_name) → list/header show username, not Unknown.  
3. Airplane mode → list still shows real names.  
4. Add nickname in Profile → list + header show nickname; their account name unchanged for others.  
5. Clear nickname (empty save) → falls back to display name.  
6. Group members without full profile → "Contact" or username, never Unknown.
