// Lumixo — production group system API (WhatsApp-class).
// All privileged writes go through SECURITY DEFINER RPCs in migration 0037.
// Framework-agnostic; web and mobile both import this.

import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type {
  UUID,
  Profile,
  Conversation,
  GroupMember,
  GroupPermissions,
  GroupJoinRequest,
  ParticipantRole,
} from './types.js';
import { getCurrentUser } from './api.js';
import { sendPush } from './pushApi.js';

// ── Create ────────────────────────────────────────────────────────────────────
// Use createGroupConversation() from api.ts (RPC 0037). Callers may fire
// sendPush afterward for "added to group" notifications.

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getGroupConversation(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<Conversation | null> {
  const { data } = await client
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('type', 'group')
    .maybeSingle();
  return (data as Conversation) ?? null;
}

export async function getGroupMembers(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<GroupMember[]> {
  const { data: parts, error } = await client
    .from('conversation_participants')
    .select('user_id, role, joined_at')
    .eq('conversation_id', conversationId)
    .order('joined_at', { ascending: true });
  if (error || !parts?.length) return [];

  const ids = parts.map((p) => p.user_id as UUID);
  // Never select phone — use public_profiles (0050/0051).
  const { data: profiles, error: profErr } = await client
    .from('public_profiles')
    .select('id, display_name, avatar_url, username, about, last_seen, created_at')
    .in('id', ids);
  let rows = (profiles ?? []) as Profile[];
  if (profErr) {
    const { data: fallback } = await client
      .from('profiles')
      .select('id, display_name, avatar_url, username, about, last_seen, created_at')
      .in('id', ids);
    rows = (fallback ?? []) as Profile[];
  }
  const byId = new Map<UUID, Profile>(
    rows.map((p) => [p.id as UUID, { ...p, phone: null } as Profile]),
  );

  // Super admins first, then admins, then members (WhatsApp order).
  const rank = (r: string) => (r === 'super_admin' ? 0 : r === 'admin' ? 1 : 2);
  return parts
    .map((p) => {
      const profile = byId.get(p.user_id as UUID);
      return {
        userId: p.user_id as UUID,
        role: p.role as ParticipantRole,
        joinedAt: p.joined_at as string,
        profile: profile ?? {
          id: p.user_id as UUID,
          phone: null,
          username: null,
          display_name: 'Unknown',
          about: null,
          avatar_url: null,
          last_seen: null,
          created_at: p.joined_at as string,
        },
      } satisfies GroupMember;
    })
    .sort((a, b) => rank(a.role) - rank(b.role) || a.joinedAt.localeCompare(b.joinedAt));
}

export async function getMyGroupRole(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<ParticipantRole | null> {
  const user = await getCurrentUser(client);
  if (!user) return null;
  const { data } = await client
    .from('conversation_participants')
    .select('role')
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)
    .maybeSingle();
  return (data?.role as ParticipantRole) ?? null;
}

export function isGroupAdminRole(role: ParticipantRole | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export function isGroupOwnerRole(role: ParticipantRole | null | undefined): boolean {
  return role === 'super_admin';
}

export function permissionsFromConversation(c: Conversation | null | undefined): GroupPermissions {
  return {
    onlyAdminsCanSend: !!c?.only_admins_can_send,
    onlyAdminsCanEditInfo: c?.only_admins_can_edit_info !== false,
    onlyAdminsCanAddMembers: c?.only_admins_can_add_members !== false,
    onlyAdminsCanPin: c?.only_admins_can_pin !== false,
    onlyAdminsManageDisappearing: c?.only_admins_manage_disappearing !== false,
    approveNewMembers: !!c?.approve_new_members,
    memberHistoryVisible: c?.member_history_visible !== false,
  };
}

// ── Update info ───────────────────────────────────────────────────────────────

export async function updateGroupInfo(
  client: SupabaseClient,
  conversationId: UUID,
  updates: {
    name?: string;
    description?: string | null;
    avatarUrl?: string | null;
    clearAvatar?: boolean;
  },
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('update_group_info', {
    p_conversation: conversationId,
    p_name: updates.name ?? null,
    p_description: updates.description === undefined ? null : updates.description,
    p_avatar_url: updates.avatarUrl ?? null,
    p_clear_avatar: !!updates.clearAvatar,
  });
  return { error: error ? new Error(error.message) : null };
}

export async function setGroupPermissions(
  client: SupabaseClient,
  conversationId: UUID,
  perms: Partial<GroupPermissions>,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('set_group_permissions', {
    p_conversation: conversationId,
    p_only_admins_can_send: perms.onlyAdminsCanSend ?? null,
    p_only_admins_can_edit_info: perms.onlyAdminsCanEditInfo ?? null,
    p_only_admins_can_add_members: perms.onlyAdminsCanAddMembers ?? null,
    p_only_admins_can_pin: perms.onlyAdminsCanPin ?? null,
    p_only_admins_manage_disappearing: perms.onlyAdminsManageDisappearing ?? null,
    p_approve_new_members: perms.approveNewMembers ?? null,
    p_member_history_visible: perms.memberHistoryVisible ?? null,
  });
  return { error: error ? new Error(error.message) : null };
}

// ── Members ───────────────────────────────────────────────────────────────────

export async function addGroupMembers(
  client: SupabaseClient,
  conversationId: UUID,
  memberIds: UUID[],
): Promise<{ added: number; error: Error | null }> {
  const { data, error } = await client.rpc('add_group_members', {
    p_conversation: conversationId,
    p_member_ids: memberIds,
  });
  if (error) return { added: 0, error: new Error(error.message) };
  if (memberIds.length) {
    void sendPush(client, {
      conversationId,
      kind: 'system',
      title: 'Group',
      body: 'New members were added to the group',
      data: { type: 'added_to_group' },
    });
  }
  return { added: typeof data === 'number' ? data : 0, error: null };
}

export async function removeGroupMember(
  client: SupabaseClient,
  conversationId: UUID,
  userId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('remove_group_member', {
    p_conversation: conversationId,
    p_user_id: userId,
  });
  if (!error) {
    void sendPush(client, {
      conversationId,
      kind: 'system',
      title: 'Group',
      body: 'A member was removed from the group',
      data: { type: 'removed_from_group', userId },
    });
  }
  return { error: error ? new Error(error.message) : null };
}

export async function promoteGroupAdmin(
  client: SupabaseClient,
  conversationId: UUID,
  userId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('set_group_member_role', {
    p_conversation: conversationId,
    p_user_id: userId,
    p_role: 'admin',
  });
  if (!error) {
    void sendPush(client, {
      conversationId,
      kind: 'system',
      title: 'Group',
      body: 'You are now a group admin',
      data: { type: 'admin_promotion', userId },
    });
  }
  return { error: error ? new Error(error.message) : null };
}

export async function demoteGroupAdmin(
  client: SupabaseClient,
  conversationId: UUID,
  userId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('set_group_member_role', {
    p_conversation: conversationId,
    p_user_id: userId,
    p_role: 'member',
  });
  return { error: error ? new Error(error.message) : null };
}

export async function transferGroupOwnership(
  client: SupabaseClient,
  conversationId: UUID,
  newOwnerId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('transfer_group_ownership', {
    p_conversation: conversationId,
    p_new_owner: newOwnerId,
  });
  return { error: error ? new Error(error.message) : null };
}

export async function leaveGroup(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('leave_group', { p_conversation: conversationId });
  return { error: error ? new Error(error.message) : null };
}

export async function deleteGroup(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('delete_group', { p_conversation: conversationId });
  return { error: error ? new Error(error.message) : null };
}

// ── Invites ───────────────────────────────────────────────────────────────────

export async function getOrCreateGroupInvite(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<{ token: string | null; error: Error | null }> {
  const { data, error } = await client.rpc('get_or_create_group_invite', {
    p_conversation: conversationId,
  });
  if (error) return { token: null, error: new Error(error.message) };
  return { token: (data as string) ?? null, error: null };
}

export async function resetGroupInvite(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<{ token: string | null; error: Error | null }> {
  const { data, error } = await client.rpc('reset_group_invite', {
    p_conversation: conversationId,
  });
  if (error) return { token: null, error: new Error(error.message) };
  return { token: (data as string) ?? null, error: null };
}

export async function revokeGroupInvite(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('revoke_group_invite', {
    p_conversation: conversationId,
  });
  return { error: error ? new Error(error.message) : null };
}

/** Public invite URL used by QR codes and share sheets. */
export function groupInviteUrl(token: string, origin?: string): string {
  let base = origin || 'https://futurehat-app.netlify.app';
  try {
    // Browser-only fallback without referencing `window` at the type level
    // (shared package tsconfig has no DOM lib).
    const g: any = globalThis as any;
    if (!origin && g?.location?.origin) base = g.location.origin as string;
  } catch { /* ignore */ }
  return `${String(base).replace(/\/$/, '')}/invite/g/${token}`;
}

export async function joinByInvite(
  client: SupabaseClient,
  token: string,
): Promise<{
  targetType: string | null;
  targetId: UUID | null;
  status: 'joined' | 'pending' | 'already_member' | null;
  error: Error | null;
}> {
  const { data, error } = await client.rpc('join_by_invite', { p_token: token });
  if (error) {
    return { targetType: null, targetId: null, status: null, error: new Error(error.message) };
  }
  // RPC returns setof rows; supabase-js may return an array or single object.
  const row = Array.isArray(data) ? data[0] : data;
  return {
    targetType: (row as any)?.target_type ?? null,
    targetId: (row as any)?.target_id ?? null,
    status: ((row as any)?.status as any) ?? 'joined',
    error: null,
  };
}

// ── Join requests ─────────────────────────────────────────────────────────────

export async function listGroupJoinRequests(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<GroupJoinRequest[]> {
  const { data, error } = await client.rpc('list_group_join_requests', {
    p_conversation: conversationId,
  });
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    userId: r.user_id as UUID,
    displayName: r.display_name as string | null,
    avatarUrl: r.avatar_url as string | null,
    username: r.username as string | null,
    createdAt: r.created_at as string,
  }));
}

export async function resolveGroupJoinRequest(
  client: SupabaseClient,
  conversationId: UUID,
  userId: UUID,
  approve: boolean,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('resolve_group_join_request', {
    p_conversation: conversationId,
    p_user_id: userId,
    p_approve: approve,
  });
  return { error: error ? new Error(error.message) : null };
}

// ── Pins ──────────────────────────────────────────────────────────────────────

export async function pinGroupMessage(
  client: SupabaseClient,
  conversationId: UUID,
  messageId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('pin_group_message', {
    p_conversation: conversationId,
    p_message: messageId,
  });
  return { error: error ? new Error(error.message) : null };
}

export async function unpinGroupMessage(
  client: SupabaseClient,
  conversationId: UUID,
  messageId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('unpin_group_message', {
    p_conversation: conversationId,
    p_message: messageId,
  });
  return { error: error ? new Error(error.message) : null };
}

export async function getPinnedMessageIds(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<UUID[]> {
  const { data } = await client
    .from('conversation_pinned_messages')
    .select('message_id')
    .eq('conversation_id', conversationId)
    .order('pinned_at', { ascending: false });
  return (data ?? []).map((r) => r.message_id as UUID);
}

// ── Realtime ──────────────────────────────────────────────────────────────────

/** Subscribe to group metadata + membership changes for a conversation. */
export function subscribeToGroup(
  client: SupabaseClient,
  conversationId: UUID,
  handlers: {
    onConversation?: (row: Conversation) => void;
    onParticipantChange?: () => void;
    onJoinRequestChange?: () => void;
  },
): RealtimeChannel {
  const channel = client
    .channel(`group:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversations',
        filter: `id=eq.${conversationId}`,
      },
      (payload) => {
        handlers.onConversation?.(payload.new as Conversation);
      },
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'conversation_participants',
        filter: `conversation_id=eq.${conversationId}`,
      },
      () => handlers.onParticipantChange?.(),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'group_join_requests',
        filter: `conversation_id=eq.${conversationId}`,
      },
      () => handlers.onJoinRequestChange?.(),
    )
    .subscribe();
  return channel;
}

// ── Client-side permission helpers ────────────────────────────────────────────

export function canSendInGroup(
  role: ParticipantRole | null,
  perms: GroupPermissions,
): boolean {
  if (!role) return false;
  if (!perms.onlyAdminsCanSend) return true;
  return isGroupAdminRole(role);
}

export function canEditGroupInfo(
  role: ParticipantRole | null,
  perms: GroupPermissions,
): boolean {
  if (!role) return false;
  if (!perms.onlyAdminsCanEditInfo) return true;
  return isGroupAdminRole(role);
}

export function canAddMembers(
  role: ParticipantRole | null,
  perms: GroupPermissions,
): boolean {
  if (!role) return false;
  if (!perms.onlyAdminsCanAddMembers) return true;
  return isGroupAdminRole(role);
}

export function canManageAdmins(role: ParticipantRole | null): boolean {
  return isGroupOwnerRole(role);
}

export function canPinMessages(
  role: ParticipantRole | null,
  perms: GroupPermissions,
): boolean {
  if (!role) return false;
  if (!perms.onlyAdminsCanPin) return true;
  return isGroupAdminRole(role);
}

export function canManageDisappearing(
  role: ParticipantRole | null,
  perms: GroupPermissions,
): boolean {
  if (!role) return false;
  if (!perms.onlyAdminsManageDisappearing) return true;
  return isGroupAdminRole(role);
}
