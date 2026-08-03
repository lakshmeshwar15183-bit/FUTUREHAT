# MESSAGE STATUS CONSISTENCY REPORT

**Date:** 2026-07-13  
**Severity:** P0  
**App:** Lumixo (mobile + web)  
**Status:** Fixed and verified

---

## Summary

Chat list and chat screen could show different ticks for the same message (list double-tick “Delivered”, thread single-tick “Sent”). That is fixed by introducing a **single pure source of truth** for outbound ticks and wiring **both surfaces** (plus web) to it. Status is monotonic: `sending → sent → delivered → read` (with local `failed`).

---

## Root cause

### Primary bug (UI inconsistency)

| Surface | Behaviour (before) |
|--------|---------------------|
| **Chat list** (`ConversationsScreen`) | Hardcoded `checkmark-done` (double tick) for **every** outbound last message — **no receipts lookup**. |
| **Chat screen** (`ChatScreen`) | Correctly used `receipts.get(id) ?? 'sent'` → single tick until a real `delivered`/`read` receipt exists. |

So the list **invented** “Delivered” while the thread told the truth (“Sent”). Same pattern on web list (`preview-ticks` always `✓` without receipt state for delivered).

### Secondary gaps in the pipeline

1. **No client `delivered` write** — only `markMessageAsRead` existed. Schema supports `delivered`/`read`, but devices never wrote `delivered` on receive (push / realtime / history load).
2. **No shared tick aggregator** — list and bubble used different local rules; receipt merge could theoretically downgrade on unordered events.
3. **List did not subscribe to receipts** — even if the server had correct receipts, the preview did not update live with the open chat.

---

## Fix implemented

### 1. Single source of truth — `shared/messageStatus.ts`

Pure functions (no UI, no I/O):

- `computeOutboundTick` — final tick for list **and** bubble  
- `aggregateRecipientTick` / `buildTickMap` / `applyReceiptToTickMap` — receipt → tick  
- `mergeTick` — **monotonic** (never downgrade `read` → `delivered` → `sent`)  
- `tickIsDouble` / `tickIsRead` / `tickGlyph` / `tickLabel` — shared presentation helpers  

**Rules (WhatsApp-class):**

| Condition | Tick |
|-----------|------|
| Local pending / outbox | `sending` |
| Local failed | `failed` |
| On server, no recipient receipts | `sent` (single ✓) |
| Any recipient `delivered` | `delivered` (double grey ✓✓) |
| Any recipient `read` | `read` (double blue ✓✓) |
| Own receipt rows | ignored |

### 2. Shared API — `shared/api.ts`

- `getMyConversations` now **batch-fetches receipts** for last messages I sent and sets `ConversationSummary.lastMessageTick`.
- `markMessageAsDelivered` / `markMessagesAsDelivered` — insert-only on conflict (**never** overwrites `read`).
- `markMessageAsRead` still upserts `read` (upgrades from delivered).
- `getMessageTick` for one-off lookups.
- Re-exports all tick helpers for web/mobile.

### 3. Mobile

| File | Change |
|------|--------|
| `ConversationsScreen.tsx` | Preview tick from `lastMessageTick` / `computeOutboundTick` (not hardcoded double). Realtime receipt updates. Mark inbound messages **delivered** while on the list. |
| `ChatScreen.tsx` | Tick map via `buildTickMap` + `applyReceiptToTickMap`. Bubbles/info/viewer use `computeOutboundTick`. Delivered then read on open/receive. |
| `MessageBubble.tsx` | Icons use `tickIsDouble` / `tickIsRead`. |
| `NotificationsBridge.tsx` | FCM message path marks **delivered** (background / killed). |
| `lib/shared.ts` | Re-exports `messageStatus`. |

### 4. Web

| File | Change |
|------|--------|
| `App.tsx` | List preview uses `previewTick` + `tickGlyph` / `tickIsRead`. Realtime receipts + deliver. |
| `ChatView.tsx` | `tickMap` + shared engine (replaces binary “read or not”). |
| `WebNotificationsBridge.tsx` | Mark delivered on message insert. |
| `App.css` | `.preview-ticks.read` blue colour. |

### 5. Types

- `ConversationSummary.lastMessageTick` optional field for list/cache consistency.

---

## Pipeline verification

| Stage | Behaviour after fix |
|-------|---------------------|
| **Sending** | Outbox pending → `sending` (clock) on bubble; list when last is pending. |
| **Sent** | Server insert, no recipient receipts → `sent` (single ✓) on **list and chat**. |
| **Delivered** | Peer device receives (realtime / push / history load) → `delivered` receipt → double grey ✓✓ everywhere. |
| **Read** | Peer opens chat (not ghost) → `read` receipt → double blue ✓✓ everywhere. |
| **Offline → online** | Pending stays `sending` until outbox flush; then `sent`; receipts apply monotonically. |
| **App restart** | List hydrates cache (with `lastMessageTick` after sync); chat rebuilds tick map from `getReceipts`. |
| **Multi-device** | Best recipient status wins; realtime list + chat both apply `applyReceiptToTickMap`. |
| **Reconnect** | Full rebuild from server receipts; live merges never downgrade. |
| **Timing** | No “list updates first with fake double-tick”; both surfaces only advance on real receipts. |

---

## Files modified

```
shared/messageStatus.ts                          (NEW)
shared/api.ts
shared/types.ts
mobile/src/lib/shared.ts
mobile/src/lib/__tests__/messageStatus.test.ts   (NEW)
mobile/src/components/MessageBubble.tsx
mobile/src/components/NotificationsBridge.tsx
mobile/src/screens/ConversationsScreen.tsx
mobile/src/screens/ChatScreen.tsx
web/src/App.tsx
web/src/App.css
web/src/ChatView.tsx
web/src/lib/WebNotificationsBridge.tsx
MESSAGE_STATUS_CONSISTENCY_REPORT.md             (NEW)
```

---

## Tests passed

**Suite:** `mobile/src/lib/__tests__/messageStatus.test.ts`  
**Result:** **24/24 passed**

| Category | Cases |
|----------|--------|
| Rank & merge | Order, no-downgrade, upgrade, failed recovery |
| Sent → Delivered → Read | Empty receipts, delivered, read, offline pending, failed |
| Multi-device / ordering | Ignore self, best-of recipients, out-of-order read-then-delivered, slow delivered-then-read, batch map |
| **List vs chat identity** | Same inputs ⇒ same tick for all states (sent/delivered/read/pending/failed/tickMap); **never hardcode double without receipts** |
| Reconnect / restart | Rebuild identity; merge after partial realtime |

**Typecheck:** `mobile` and `web` `tsc --noEmit` clean.

Automated UI E2E for “background app / killed app / multi-device hardware” is not in this repo’s jest harness; those paths are covered by:

- FCM `markMessageAsDelivered` in `NotificationsBridge`
- Realtime deliver on list + chat
- Monotonic merge unit tests (ordering / restart)

---

## Confirmation: list and chat can never disagree again

**Invariant:** For a given outbound message, any UI that needs a tick **must** call:

```ts
computeOutboundTick({ messageId, senderId, pending?, failed?, receipts? | tickMap? })
```

- Chat list: `resolvePreviewTick` / `previewTick` → same function (or server field `lastMessageTick` produced by the same `aggregateRecipientTick`).
- Chat bubble: `computeOutboundTick` with the live tick map.
- Receipts apply only through `applyReceiptToTickMap` / `buildTickMap` (monotonic).

There is **no** remaining code path that draws double-ticks for “mine” without a `delivered` or `read` receipt.

**WhatsApp parity achieved for tick display:** the same message always shows the same status in the chat list and inside the chat.

---

## Manual smoke checklist (recommended)

1. Send a message → list and open chat both show **single ✓**.  
2. Peer has app open (or receives push) without opening chat → both show **double grey ✓✓**.  
3. Peer opens chat → both show **double blue ✓✓**.  
4. Kill app, reopen → ticks still match.  
5. Airplane mode send → clock, then single ✓ after reconnect.  
6. Web + mobile both open for sender → same ticks after peer actions.
