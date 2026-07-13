# MODERATION WORKFLOW

**Date:** 2026-07-13  
**Status:** Production redesign complete  
**Goal:** Admins and moderators **never** need to type a message UUID for normal moderation.

---

## Problem (before)

The Admin → Messages tab centered on:

> “Delete a message by ID” → free-text **message UUID** field

Admins do not know UUIDs when reviewing abuse reports. That forced hunting through databases or incomplete UI — unacceptable for production trust & safety.

---

## New principle

**Report-first moderation.**

1. Users report a message (or profile).  
2. The server **snapshots** everything the moderator needs.  
3. The dashboard shows a **report card** with full context.  
4. Every action button uses IDs **already on that card** — no paste field.

Manual UUID delete remains only under **Advanced** (emergency).

---

## What is captured when a message is reported

`report_message()` (RPC, migrations 0017 + **0053**) stores:

| Field | Source |
|-------|--------|
| Message UUID | `messages.id` |
| Sender user ID | `messages.sender_id` |
| Message text snapshot | `messages.content` → `reported_content` |
| Message type | `text` / `image` / `video` / `audio` / `file` / … |
| Message timestamp | `messages.created_at` |
| Conversation / Chat ID | `messages.conversation_id` |
| Reporter user ID | `auth.uid()` |
| Reason | Picker vocabulary |
| Optional details | Free text note |
| Status | `open` |

`admin_list_reports` enriches for the UI:

- Reporter name + username  
- Sender (reported) name + username  
- **Conversation label** (group name or DM peer names — “Receiver / Group”)  
- Live or snapshotted content  
- Whether the message still exists  

---

## Report card actions (no UUID typing)

| Button | Behaviour |
|--------|-----------|
| **Delete message** | `admin_delete_message(msg, reason, report_id)` using `r.message_id` |
| **View message** | Opens conversation viewer scrolled to that message |
| **View full conversation** | Same viewer without jump |
| **Warn user** | Official warning linked to report |
| **Suspend user** | Account suspended (e.g. 7 days) + resolve report |
| **Ban user** | Account banned + resolve report |
| **Ignore report** | Status → `dismissed` |
| **Mark in review / Resolve** | Lifecycle stamps |

**Details** expands:

- Message UUID **+ Copy**  
- Sender user ID + Copy  
- Reporter user ID + Copy  
- Conversation / Chat ID + Copy  
- Report ID + Copy  
- Type, reason, existence  

---

## Global search

**Admin → Search** accepts:

- Message UUID (exact)  
- User ID (exact)  
- Username / email / phone (via `admin_search_users`)  
- Chat / conversation ID (exact)  
- Message content / report reason text  

Results can delete a message **from the hit row** (still audited) but the primary path remains Reports.

---

## Recent deleted messages

**Admin → Messages → Recent deleted messages** lists audit trail of `delete_message`:

- UUID (+ copy)  
- Deleted by (name)  
- Deleted at  
- Reason  
- Linked report id (if any)  
- Restore status (`restorable` / restored / not restorable)  

**Restore** uses `admin_restore_message` when a content snapshot was stored in the audit meta.

---

## Advanced emergency tool only

**Admin → Messages → Advanced — emergency delete by UUID**

- Collapsed by default  
- Explicitly labeled emergency  
- Optional reason field  
- Still writes full audit log  

Normal operators should **not** open this for day-to-day work.

---

## Audit / traceability

| Action | Audit |
|--------|--------|
| Report status change | `report_status` + reviewer stamp |
| Delete message | `delete_message` + reason, report_id, type, conversation, content snapshot |
| Restore message | `restore_message` |
| Warn / ban / suspend | Existing account / warning RPCs with reasons referencing report id |
| Moderator audit tab | Immutable slice of moderator actions |

Every moderation action is server-gated (`_require_moderator_or_admin` / `_require_admin`) and recorded.

---

## Operator flow (happy path)

```
User reports message in chat
        ↓
report_message() snapshots IDs + content + type + time
        ↓
Admin opens Dashboard → Reports (queue)
        ↓
Reads quote, reporter, sender, chat label
        ↓
[Details] if audit copy needed → Copy Message UUID
        ↓
Delete message / Warn / Suspend / Ban / Ignore
        ↓
Audit log + report status updated
```

**Confirmation:** During normal moderation, admins **never** manually search for or type message IDs. UUIDs appear only for transparency (copy) and Advanced emergency tools.

---

## Files

| Area | Path |
|------|------|
| Migration | `supabase/migrations/0053_moderation_workflow.sql` |
| Types | `shared/types.ts` (`AdminReport` fields, `AdminDeletedMessage`) |
| API | `shared/adminApi.ts` |
| Web reports | `web/src/admin/AdminReports.tsx` |
| Web messages/search | `web/src/admin/AdminOps.tsx` |
| Web styles | `web/src/admin/AdminDashboard.css` |
| Mobile admin | `mobile/src/screens/admin/AdminDashboardScreen.tsx` |
| This doc | `MODERATION_WORKFLOW.md` |

---

## Deploy note

Apply migration **0053** on Supabase before relying on new list columns / restore / deleted list:

```bash
# your usual migration path, e.g.
# supabase db push
# or scripts/apply-migrations
```

Until 0053 is applied, older `admin_list_reports` still works but may omit `message_type` / `conversation_label` (UI degrades gracefully).

---

## Confirmation checklist

- [x] Report auto-includes message + people + chat context  
- [x] UUID visible with copy, not as a required input  
- [x] Delete / View / Conversation / Warn / Suspend / Ban / Ignore on every report  
- [x] Delete uses report-bound UUID  
- [x] Global search by UUID / user / username / email / phone / chat  
- [x] Recent deleted messages + restore status  
- [x] Manual UUID under Advanced only  
- [x] Actions audited  
