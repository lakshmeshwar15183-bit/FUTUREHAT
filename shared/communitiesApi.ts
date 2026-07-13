// Lumixo — communities, channels, polls and events (framework-agnostic).
// Channels reuse the conversations/messages stack: creating a channel creates a
// backing conversation, so every chat feature works inside a channel for free.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID, Profile } from './types.js';
import { getCurrentUser } from './api.js';

export interface Community {
  id: UUID;
  name: string;
  description: string | null;
  avatar_url: string | null;
  owner_id: UUID;
  created_at: string;
}

export interface Channel {
  id: UUID;
  community_id: UUID;
  conversation_id: UUID;
  name: string;
  kind: 'text' | 'announcement' | 'broadcast';
  created_at: string;
}

export interface Poll {
  id: UUID;
  conversation_id: UUID;
  created_by: UUID;
  question: string;
  options: string[];
  multiple: boolean;
  closes_at: string | null;
  created_at: string;
  /** When true, clients hide voter identities (0062). Optional pre-migration. */
  anonymous?: boolean | null;
}

export interface PollVote {
  poll_id: UUID;
  user_id: UUID;
  option_index: number;
}

export interface CommunityEvent {
  id: UUID;
  conversation_id: UUID | null;
  community_id: UUID | null;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  created_by: UUID;
  created_at: string;
}

// ── Communities ──────────────────────────────────────────────────────────────
export async function createCommunity(
  client: SupabaseClient,
  name: string,
  description?: string,
  avatarUrl?: string | null,
): Promise<{ community: Community | null; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { community: null, error: new Error('not authenticated') };
  const { data, error } = await client
    .from('communities')
    .insert({ name, description: description ?? null, avatar_url: avatarUrl, owner_id: user.id })
    .select()
    .single();
  if (error || !data) return { community: null, error };
  // Owner joins as admin.
  await client
    .from('community_members')
    .insert({ community_id: data.id, user_id: user.id, role: 'admin' });
  return { community: data, error: null };
}

export async function getMyCommunities(client: SupabaseClient): Promise<Community[]> {
  const user = await getCurrentUser(client);
  if (!user) return [];
  const { data: memberships } = await client
    .from('community_members')
    .select('community_id')
    .eq('user_id', user.id);
  const ids = (memberships ?? []).map((m: any) => m.community_id);
  if (!ids.length) return [];
  const { data } = await client.from('communities').select('*').in('id', ids).order('created_at');
  return data ?? [];
}

/** Channel row with optional last-message preview for the Communities list. */
export interface ChannelSummary extends Channel {
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  unreadCount?: number;
}

/** Community + nested groups/channels for the WhatsApp-style expandable list. */
export interface CommunitySummary extends Community {
  channels: ChannelSummary[];
  lastActivityAt?: string | null;
  lastPreview?: string | null;
  totalUnread?: number;
  memberCount?: number;
}

function previewFromMessage(m: {
  type?: string | null;
  content?: string | null;
  is_deleted?: boolean | null;
} | null | undefined): string {
  if (!m) return '';
  if (m.is_deleted) return 'This message was removed by Lumixo.';
  if (m.type === 'image') return '📷 Photo';
  if (m.type === 'video') return '🎥 Video';
  if (m.type === 'audio') return '🎤 Voice message';
  if (m.type === 'file') return m.content?.trim() ? `📄 ${m.content}` : '📄 Document';
  if (m.type === 'system') {
    return (m.content ?? '').replace(/\s*\[call:[0-9a-f-]{36}\]\s*$/i, '').trim();
  }
  return (m.content ?? '').trim();
}

/**
 * Load communities with channels + last-message previews for the tab list.
 * Best-effort: never throws; offline callers should keep cache on catch.
 */
export async function getMyCommunitySummaries(
  client: SupabaseClient,
): Promise<CommunitySummary[]> {
  const communities = await getMyCommunities(client);
  if (!communities.length) return [];

  const ids = communities.map((c) => c.id);
  const { data: channelRows } = await client
    .from('channels')
    .select('*')
    .in('community_id', ids)
    .order('created_at');
  const channels = (channelRows ?? []) as Channel[];

  // Member counts (single query)
  const { data: memRows } = await client
    .from('community_members')
    .select('community_id')
    .in('community_id', ids);
  const memberCountByComm = new Map<string, number>();
  for (const r of memRows ?? []) {
    const cid = (r as { community_id: string }).community_id;
    memberCountByComm.set(cid, (memberCountByComm.get(cid) ?? 0) + 1);
  }

  // Last message per channel conversation (parallel, capped)
  const convIds = channels.map((c) => c.conversation_id).filter(Boolean);
  const lastByConv = new Map<string, { preview: string; at: string }>();
  if (convIds.length) {
    // Batch: fetch recent messages then keep newest per conversation.
    const { data: msgs } = await client
      .from('messages')
      .select('conversation_id, type, content, is_deleted, created_at')
      .in('conversation_id', convIds.slice(0, 80))
      .order('created_at', { ascending: false })
      .limit(Math.min(convIds.length * 3, 240));
    for (const raw of msgs ?? []) {
      const m = raw as {
        conversation_id: string;
        type?: string;
        content?: string;
        is_deleted?: boolean;
        created_at: string;
      };
      if (lastByConv.has(m.conversation_id)) continue;
      lastByConv.set(m.conversation_id, {
        preview: previewFromMessage(m),
        at: m.created_at,
      });
    }
  }

  const channelsByComm = new Map<string, ChannelSummary[]>();
  for (const ch of channels) {
    const last = lastByConv.get(ch.conversation_id);
    const summary: ChannelSummary = {
      ...ch,
      lastMessagePreview: last?.preview ?? null,
      lastMessageAt: last?.at ?? ch.created_at,
      unreadCount: 0,
    };
    const list = channelsByComm.get(ch.community_id) ?? [];
    list.push(summary);
    channelsByComm.set(ch.community_id, list);
  }

  // Announcement channels first, then alphabetical (WhatsApp order).
  for (const [cid, list] of channelsByComm) {
    list.sort((a, b) => {
      const aAnn = a.kind === 'announcement' ? 0 : 1;
      const bAnn = b.kind === 'announcement' ? 0 : 1;
      if (aAnn !== bAnn) return aAnn - bAnn;
      return a.name.localeCompare(b.name);
    });
    channelsByComm.set(cid, list);
  }

  return communities.map((c) => {
    const chs = channelsByComm.get(c.id) ?? [];
    let lastActivityAt: string | null = c.created_at;
    let lastPreview: string | null = c.description || 'Community';
    for (const ch of chs) {
      if (ch.lastMessageAt && (!lastActivityAt || ch.lastMessageAt > lastActivityAt)) {
        lastActivityAt = ch.lastMessageAt;
        lastPreview = ch.lastMessagePreview
          ? `${ch.name}: ${ch.lastMessagePreview}`
          : ch.name;
      }
    }
    const totalUnread = chs.reduce((n, ch) => n + (ch.unreadCount ?? 0), 0);
    return {
      ...c,
      channels: chs,
      lastActivityAt,
      lastPreview,
      totalUnread,
      memberCount: memberCountByComm.get(c.id) ?? 0,
    };
  }).sort((a, b) => {
    // Newest activity first
    const at = a.lastActivityAt ?? a.created_at;
    const bt = b.lastActivityAt ?? b.created_at;
    return bt.localeCompare(at);
  });
}

export async function leaveCommunity(
  client: SupabaseClient,
  communityId: UUID,
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('community_members')
    .delete()
    .eq('community_id', communityId)
    .eq('user_id', user.id);
  return { error };
}

export interface CommunityMember {
  community_id: UUID;
  user_id: UUID;
  role: 'member' | 'admin';
  joined_at: string;
  profile?: Profile;
}

/** Members of a community, hydrated with their profiles (for the member list). */
export async function getCommunityMembers(
  client: SupabaseClient,
  communityId: UUID,
): Promise<CommunityMember[]> {
  const { data } = await client
    .from('community_members')
    .select('*')
    .eq('community_id', communityId)
    .order('joined_at');
  const members = (data ?? []) as CommunityMember[];
  const ids = members.map((m) => m.user_id);
  if (!ids.length) return [];
  // Peer profiles without phone (public_profiles). Never select *.
  const { data: profiles, error: profErr } = await client
    .from('public_profiles')
    .select('id, username, display_name, about, avatar_url, last_seen, created_at')
    .in('id', ids);
  let rows = (profiles ?? []) as Profile[];
  if (profErr) {
    const { data: fallback } = await client
      .from('profiles')
      .select('id, username, display_name, about, avatar_url, last_seen, created_at')
      .in('id', ids);
    rows = (fallback ?? []) as Profile[];
  }
  const byId = new Map(rows.map((p) => [p.id, { ...p, phone: null } as Profile]));
  return members.map((m) => ({ ...m, profile: byId.get(m.user_id) }));
}

export async function joinCommunity(client: SupabaseClient, communityId: UUID) {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('community_members')
    .insert({ community_id: communityId, user_id: user.id, role: 'member' });
  return { error };
}

// ── Channels (backed by a conversation) ──────────────────────────────────────
export async function createChannel(
  client: SupabaseClient,
  communityId: UUID,
  name: string,
  kind: Channel['kind'] = 'text',
): Promise<{ channel: Channel | null; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { channel: null, error: new Error('not authenticated') };

  // Backing conversation (group). Community members are added as participants.
  const { data: conv, error: convErr } = await client
    .from('conversations')
    .insert({ type: 'group', name })
    .select()
    .single();
  if (convErr || !conv) return { channel: null, error: convErr };

  const { data: members } = await client
    .from('community_members')
    .select('user_id')
    .eq('community_id', communityId);
  const rows = (members ?? []).map((m: any) => ({ conversation_id: conv.id, user_id: m.user_id }));
  if (rows.length) await client.from('conversation_participants').insert(rows);

  const { data, error } = await client
    .from('channels')
    .insert({ community_id: communityId, conversation_id: conv.id, name, kind })
    .select()
    .single();
  return { channel: data, error };
}

export async function getChannels(client: SupabaseClient, communityId: UUID): Promise<Channel[]> {
  const { data } = await client
    .from('channels')
    .select('*')
    .eq('community_id', communityId)
    .order('created_at');
  return data ?? [];
}

// ── Polls ────────────────────────────────────────────────────────────────────
export async function createPoll(
  client: SupabaseClient,
  conversationId: UUID,
  question: string,
  options: string[],
  multiple = false,
  anonymous = false,
): Promise<{ poll: Poll | null; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { poll: null, error: new Error('not authenticated') };
  // Prefer full insert (anonymous column from 0062). If the column is missing
  // (migration not applied), fall back so create still works.
  let { data, error } = await client
    .from('polls')
    .insert({
      conversation_id: conversationId,
      created_by: user.id,
      question,
      options,
      multiple,
      anonymous: !!anonymous,
    })
    .select()
    .single();
  if (error && /anonymous|column/i.test(error.message || '')) {
    ({ data, error } = await client
      .from('polls')
      .insert({
        conversation_id: conversationId,
        created_by: user.id,
        question,
        options,
        multiple,
      })
      .select()
      .single());
  }
  return { poll: data, error };
}

/** Close a poll now (creator only — RLS update own polls). */
export async function closePoll(
  client: SupabaseClient,
  pollId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('polls')
    .update({ closes_at: new Date().toISOString() })
    .eq('id', pollId);
  return { error: error ? new Error(error.message) : null };
}

/** Votes for one option with optional display names (for “View voters”). */
export async function getPollVoters(
  client: SupabaseClient,
  pollId: UUID,
  optionIndex: number,
): Promise<{ userId: UUID; displayName: string | null }[]> {
  const { data: votes } = await client
    .from('poll_votes')
    .select('user_id')
    .eq('poll_id', pollId)
    .eq('option_index', optionIndex);
  if (!votes?.length) return [];
  const ids = votes.map((v) => v.user_id as UUID);
  const { data: profiles } = await client
    .from('public_profiles')
    .select('id, display_name, username')
    .in('id', ids);
  const byId = new Map(
    (profiles ?? []).map((p: any) => [
      p.id as UUID,
      (p.display_name as string | null) || (p.username as string | null),
    ]),
  );
  return ids.map((id) => ({ userId: id, displayName: byId.get(id) ?? null }));
}

export async function getPolls(client: SupabaseClient, conversationId: UUID): Promise<Poll[]> {
  const { data } = await client
    .from('polls')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function getPollVotes(client: SupabaseClient, pollId: UUID): Promise<PollVote[]> {
  const { data } = await client.from('poll_votes').select('*').eq('poll_id', pollId);
  return data ?? [];
}

export async function votePoll(
  client: SupabaseClient,
  pollId: UUID,
  optionIndex: number,
  multiple: boolean,
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  if (!multiple) {
    // single-choice: clear previous votes first
    await client.from('poll_votes').delete().eq('poll_id', pollId).eq('user_id', user.id);
  }
  const { error } = await client
    .from('poll_votes')
    .insert({ poll_id: pollId, user_id: user.id, option_index: optionIndex });
  return { error };
}

// Remove the current user's vote for a single option (used by multiple-choice
// polls to toggle a chosen option back off — mirrors web PollCard `cast`).
export async function unvotePoll(
  client: SupabaseClient,
  pollId: UUID,
  optionIndex: number,
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('poll_votes')
    .delete()
    .eq('poll_id', pollId)
    .eq('user_id', user.id)
    .eq('option_index', optionIndex);
  return { error };
}

// ── Events ───────────────────────────────────────────────────────────────────
export async function createEvent(
  client: SupabaseClient,
  params: {
    conversationId?: UUID;
    communityId?: UUID;
    title: string;
    description?: string;
    location?: string;
    startsAt: string;
  },
): Promise<{ event: CommunityEvent | null; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { event: null, error: new Error('not authenticated') };
  const { data, error } = await client
    .from('events')
    .insert({
      conversation_id: params.conversationId ?? null,
      community_id: params.communityId ?? null,
      title: params.title,
      description: params.description ?? null,
      location: params.location ?? null,
      starts_at: params.startsAt,
      created_by: user.id,
    })
    .select()
    .single();
  return { event: data, error };
}

export async function getCommunityEvents(
  client: SupabaseClient,
  communityId: UUID,
): Promise<CommunityEvent[]> {
  const { data } = await client
    .from('events')
    .select('*')
    .eq('community_id', communityId)
    .order('starts_at');
  return data ?? [];
}

/** Events attached to a group / channel conversation (future-ready group events). */
export async function getConversationEvents(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<CommunityEvent[]> {
  const { data } = await client
    .from('events')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('starts_at', { ascending: true });
  return data ?? [];
}

export async function getEventRsvps(
  client: SupabaseClient,
  eventId: UUID,
): Promise<{ user_id: UUID; status: 'going' | 'maybe' | 'no' }[]> {
  const { data } = await client
    .from('event_rsvps')
    .select('user_id, status')
    .eq('event_id', eventId);
  return (data ?? []) as { user_id: UUID; status: 'going' | 'maybe' | 'no' }[];
}

export async function rsvpEvent(
  client: SupabaseClient,
  eventId: UUID,
  status: 'going' | 'maybe' | 'no',
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('event_rsvps')
    .upsert(
      { event_id: eventId, user_id: user.id, status, updated_at: new Date().toISOString() },
      { onConflict: 'event_id,user_id' },
    );
  return { error };
}
