// Lumixo — Owner/Admin data-access layer. Framework-agnostic; web + mobile
// share it. Every function here calls a SECURITY DEFINER RPC (or an RLS-guarded
// table) from 0013_owner_admin.sql that RE-CHECKS the caller's privilege server-
// side, so these wrappers are a convenience, NOT the security boundary. Client
// gating (getServerOwner/getServerAdmin) only decides what UI to show.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  UUID,
  AccountStatus,
  PremiumDuration,
  AnnouncementKind,
  FeatureFlag,
  Announcement,
  AdminUserSummary,
  AdminUserDetail,
  AuditEntry,
  AdminStats,
  AdminCallStats,
  AdminMessageStats,
  AdminDbHealth,
  AdminGlobalSearch,
  AdminReport,
  AdminConversationView,
  ReportStatus,
  WarningReason,
  MailboxItem,
  ModeratorAuditEntry,
} from './types.js';

// ── Privilege checks (server-authoritative) ─────────────────────────────────────

export async function getServerOwner(client: SupabaseClient): Promise<boolean> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return false;
  const { data, error } = await client.rpc('is_owner', { uid: auth.user.id });
  return !error && data === true;
}

export async function getServerModerator(client: SupabaseClient): Promise<boolean> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return false;
  const { data, error } = await client.rpc('is_moderator', { uid: auth.user.id });
  return !error && data === true;
}

// ── User management ─────────────────────────────────────────────────────────────

export async function adminSearchUsers(client: SupabaseClient, q: string): Promise<AdminUserSummary[]> {
  const { data, error } = await client.rpc('admin_search_users', { q });
  if (error) throw error;
  return (data as AdminUserSummary[]) ?? [];
}

export async function adminGetUser(client: SupabaseClient, target: UUID): Promise<AdminUserDetail> {
  const { data, error } = await client.rpc('admin_get_user', { target });
  if (error) throw error;
  return data as AdminUserDetail;
}

// Ban / suspend / restore / unban / disable / lock — all via one gate.
export async function adminSetAccountStatus(
  client: SupabaseClient,
  target: UUID,
  status: AccountStatus,
  reason?: string,
  until?: string,
): Promise<void> {
  const { error } = await client.rpc('admin_set_account_status', {
    target, new_status: status, reason: reason ?? null, until: until ?? null,
  });
  if (error) throw error;
}

export const adminBanUser = (c: SupabaseClient, t: UUID, reason?: string) =>
  adminSetAccountStatus(c, t, 'banned', reason);
export const adminSuspendUser = (c: SupabaseClient, t: UUID, until: string, reason?: string) =>
  adminSetAccountStatus(c, t, 'suspended', reason, until);
export const adminRestoreUser = (c: SupabaseClient, t: UUID) =>
  adminSetAccountStatus(c, t, 'active');
export const adminDisableUser = (c: SupabaseClient, t: UUID, reason?: string) =>
  adminSetAccountStatus(c, t, 'disabled', reason);
export const adminLockUser = (c: SupabaseClient, t: UUID, reason?: string) =>
  adminSetAccountStatus(c, t, 'locked', reason);

export async function adminVerifyUser(client: SupabaseClient, target: UUID, verified: boolean): Promise<void> {
  const { error } = await client.rpc('admin_verify_user', { target, verified });
  if (error) throw error;
}

export async function adminForceLogout(client: SupabaseClient, target: UUID): Promise<void> {
  const { error } = await client.rpc('admin_force_logout', { target });
  if (error) throw error;
}

export async function adminDeleteAccount(client: SupabaseClient, target: UUID, reason?: string): Promise<void> {
  const { error } = await client.rpc('admin_delete_account', { target, reason: reason ?? null });
  if (error) throw error;
}

// Assign / remove Moderator, or demote to User. The 'admin' (and 'owner') roles are
// PERMANENT and can never be assigned or transferred through the app — Lumixo has a
// single hardcoded owner/admin (the developer allowlist). The server-side admin_set_role
// (migration 0025) rejects any role other than 'user'/'moderator'; this type mirrors that.
export async function adminSetRole(client: SupabaseClient, target: UUID, role: 'user' | 'moderator'): Promise<void> {
  const { error } = await client.rpc('admin_set_role', { target, new_role: role });
  if (error) throw error;
}

// ── Premium management (immediate) ──────────────────────────────────────────────

export async function adminGrantPremium(
  client: SupabaseClient, target: UUID, duration: PremiumDuration, customEnd?: string,
): Promise<void> {
  const { error } = await client.rpc('admin_grant_premium', {
    target, duration, custom_end: customEnd ?? null,
  });
  if (error) throw error;
}
// "Gift" is a grant; alias for clarity at call sites.
export const adminGiftPremium = adminGrantPremium;

export async function adminRevokePremium(client: SupabaseClient, target: UUID): Promise<void> {
  const { error } = await client.rpc('admin_revoke_premium', { target });
  if (error) throw error;
}

// ── Content moderation ──────────────────────────────────────────────────────────

export async function adminDeleteMessage(client: SupabaseClient, msg: UUID): Promise<void> {
  const { error } = await client.rpc('admin_delete_message', { msg });
  if (error) throw error;
}
export async function adminDeleteStatus(client: SupabaseClient, statusId: UUID): Promise<void> {
  const { error } = await client.rpc('admin_delete_status', { status_id: statusId });
  if (error) throw error;
}
export async function adminDeleteCommunity(client: SupabaseClient, comm: UUID): Promise<void> {
  const { error } = await client.rpc('admin_delete_community', { comm });
  if (error) throw error;
}
export async function adminDeleteConversation(client: SupabaseClient, conv: UUID): Promise<void> {
  const { error } = await client.rpc('admin_delete_conversation', { conv });
  if (error) throw error;
}
export async function adminDeleteChannel(client: SupabaseClient, chan: UUID): Promise<void> {
  const { error } = await client.rpc('admin_delete_channel', { chan });
  if (error) throw error;
}

// ── Community management ─────────────────────────────────────────────────────────

export async function adminCommunityRemoveMember(client: SupabaseClient, comm: UUID, target: UUID): Promise<void> {
  const { error } = await client.rpc('admin_community_remove_member', { comm, target });
  if (error) throw error;
}
export async function adminTransferCommunity(client: SupabaseClient, comm: UUID, newOwner: UUID): Promise<void> {
  const { error } = await client.rpc('admin_transfer_community', { comm, new_owner: newOwner });
  if (error) throw error;
}
export async function adminEditCommunity(client: SupabaseClient, comm: UUID, name?: string, description?: string): Promise<void> {
  const { error } = await client.rpc('admin_edit_community', {
    comm, new_name: name ?? null, new_description: description ?? null,
  });
  if (error) throw error;
}

// ── Feature flags + app management (owner-only server-side) ───────────────────────

export async function getFeatureFlags(client: SupabaseClient): Promise<FeatureFlag[]> {
  const { data } = await client.from('feature_flags').select('*').order('key');
  return (data as FeatureFlag[]) ?? [];
}

/** Read one flag's enabled state; defaults to `fallback` if the flag/table is absent. */
export async function isFeatureEnabled(client: SupabaseClient, key: string, fallback = true): Promise<boolean> {
  const { data, error } = await client.from('feature_flags').select('enabled').eq('key', key).maybeSingle();
  if (error || !data) return fallback;
  return (data as { enabled: boolean }).enabled;
}

export async function adminSetFeatureFlag(client: SupabaseClient, key: string, enabled: boolean): Promise<void> {
  const { error } = await client.rpc('admin_set_feature_flag', { p_key: key, p_enabled: enabled });
  if (error) throw error;
}

export async function adminSetAppEnabled(client: SupabaseClient, enabled: boolean): Promise<void> {
  const { error } = await client.rpc('admin_set_app_enabled', { p_enabled: enabled });
  if (error) throw error;
}

export async function getActiveAnnouncements(client: SupabaseClient): Promise<Announcement[]> {
  const { data } = await client.from('announcements').select('*')
    .eq('active', true).order('created_at', { ascending: false });
  return (data as Announcement[]) ?? [];
}

export async function adminSendAnnouncement(
  client: SupabaseClient, kind: AnnouncementKind, title: string, body?: string,
): Promise<string | null> {
  const { data, error } = await client.rpc('admin_send_announcement', {
    p_kind: kind, p_title: title, p_body: body ?? null,
  });
  if (error) throw error;
  return (data as string) ?? null;
}

// Removes the latest active announcement (owner-only RPC). Returns the deleted
// announcement id, or null if there was no active announcement to remove.
export async function adminRemoveCurrentAnnouncement(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.rpc('admin_remove_announcement');
  if (error) throw error;
  return (data as string) ?? null;
}

// ── Analytics / metrics / health ─────────────────────────────────────────────────

export async function adminStats(client: SupabaseClient): Promise<AdminStats> {
  const { data, error } = await client.rpc('admin_stats');
  if (error) throw error;
  return data as AdminStats;
}
export async function adminCallStats(client: SupabaseClient): Promise<AdminCallStats> {
  const { data, error } = await client.rpc('admin_call_stats');
  if (error) throw error;
  return data as AdminCallStats;
}
export async function adminMessageStats(client: SupabaseClient): Promise<AdminMessageStats> {
  const { data, error } = await client.rpc('admin_message_stats');
  if (error) throw error;
  return data as AdminMessageStats;
}
export async function adminDbHealth(client: SupabaseClient): Promise<AdminDbHealth> {
  const { data, error } = await client.rpc('admin_db_health');
  if (error) throw error;
  return data as AdminDbHealth;
}

// ── Global search + audit + devices ──────────────────────────────────────────────

export async function adminGlobalSearch(client: SupabaseClient, q: string): Promise<AdminGlobalSearch> {
  const { data, error } = await client.rpc('admin_global_search', { q });
  if (error) throw error;
  return data as AdminGlobalSearch;
}

// Owner-only server-side.
export async function adminAuditLog(client: SupabaseClient, limit = 200): Promise<AuditEntry[]> {
  const { data, error } = await client.rpc('admin_audit_log', { p_limit: limit });
  if (error) throw error;
  return (data as AuditEntry[]) ?? [];
}

export async function adminRemoveDevice(client: SupabaseClient, deviceId: UUID): Promise<void> {
  const { error } = await client.rpc('admin_remove_device', { p_device: deviceId });
  if (error) throw error;
}

// ── Reports (0017) ──────────────────────────────────────────────────────────
// List reports, optionally filtered by status. Newest first.
export async function adminListReports(
  client: SupabaseClient, status?: ReportStatus, limit = 200,
): Promise<AdminReport[]> {
  const { data, error } = await client.rpc('admin_list_reports', {
    p_status: status ?? null, p_limit: limit,
  });
  if (error) throw error;
  return (data as AdminReport[]) ?? [];
}

// Count of still-actionable reports (open + reviewing) — powers the badge.
export async function adminReportsPendingCount(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc('admin_reports_pending_count');
  if (error) throw error;
  return (data as number) ?? 0;
}

// Move a report through Review / Dismiss / Resolve (stamps reviewer + time).
export async function adminSetReportStatus(
  client: SupabaseClient, reportId: UUID, status: ReportStatus,
): Promise<void> {
  const { error } = await client.rpc('admin_set_report_status', {
    p_report: reportId, p_status: status,
  });
  if (error) throw error;
}

// Warn a user, optionally linked to the report that triggered it.
export async function adminWarnUser(
  client: SupabaseClient, target: UUID, message: string, reportId?: UUID,
): Promise<void> {
  const { error } = await client.rpc('admin_warn_user', {
    p_target: target, p_message: message, p_report: reportId ?? null,
  });
  if (error) throw error;
}

// Load a full conversation so the dashboard can open it and jump to a message.
export async function adminGetConversation(
  client: SupabaseClient, conversationId: UUID, limit = 300,
): Promise<AdminConversationView> {
  const { data, error } = await client.rpc('admin_get_conversation', {
    p_conversation: conversationId, p_limit: limit,
  });
  if (error) throw error;
  return data as AdminConversationView;
}

// ── Moderator system (0023) ──────────────────────────────────────────────────
// Assign / remove the moderator role via the modular server entry point, which
// wraps {role change + mailbox notification + audit} in one call. Admin-gated
// server-side; a future eligibility system can call the same RPC.
export async function assignModerator(client: SupabaseClient, target: UUID): Promise<void> {
  const { error } = await client.rpc('assign_moderator', { p_target: target });
  if (error) throw error;
}
export async function removeModerator(client: SupabaseClient, target: UUID): Promise<void> {
  const { error } = await client.rpc('remove_moderator', { p_target: target });
  if (error) throw error;
}

// Issue a structured official warning (fixed reason + optional note), delivered
// to the target's mailbox and permanently recorded. Moderator-or-admin gated.
export async function issueWarning(
  client: SupabaseClient, target: UUID, reason: WarningReason, note?: string, reportId?: UUID,
): Promise<void> {
  const { error } = await client.rpc('issue_warning', {
    p_target: target, p_reason: reason, p_note: note ?? null, p_report: reportId ?? null,
  });
  if (error) throw error;
}

// Escalate a report to admins (flag + note; sets status 'reviewing').
export async function escalateReport(
  client: SupabaseClient, reportId: UUID, note?: string,
): Promise<void> {
  const { error } = await client.rpc('mod_escalate_report', {
    p_report: reportId, p_note: note ?? null,
  });
  if (error) throw error;
}

// ── User mailbox ──────────────────────────────────────────────────────────────
export async function getMyMailbox(client: SupabaseClient, limit = 100): Promise<MailboxItem[]> {
  const { data, error } = await client.rpc('my_mailbox', { p_limit: limit });
  if (error) throw error;
  return (data as MailboxItem[]) ?? [];
}
export async function getMailboxUnseenCount(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc('my_mailbox_unseen_count');
  if (error) return 0;
  return (data as number) ?? 0;
}
export async function markMailboxSeen(client: SupabaseClient, id: UUID): Promise<void> {
  const { error } = await client.rpc('mark_mailbox_seen', { p_id: id });
  if (error) throw error;
}
export async function markAllMailboxSeen(client: SupabaseClient): Promise<void> {
  const { error } = await client.rpc('mark_all_mailbox_seen');
  if (error) throw error;
}

// Admin-only view of moderator actions (immutable audit_log slice).
export async function moderatorAuditLog(client: SupabaseClient, limit = 300): Promise<ModeratorAuditEntry[]> {
  const { data, error } = await client.rpc('admin_moderator_audit', { p_limit: limit });
  if (error) throw error;
  return (data as ModeratorAuditEntry[]) ?? [];
}

// Register/update the current device (clients call on launch so admins can see and
// remotely revoke devices). Best-effort; ignores errors (table may not exist yet).
export async function registerDevice(
  client: SupabaseClient, deviceId: string, name: string, platform: string,
): Promise<void> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return;
  await client.from('devices').upsert(
    { user_id: auth.user.id, device_id: deviceId, name, platform, last_seen: new Date().toISOString() },
    { onConflict: 'user_id,device_id' },
  );
}
