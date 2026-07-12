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
): Promise<{ poll: Poll | null; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { poll: null, error: new Error('not authenticated') };
  const { data, error } = await client
    .from('polls')
    .insert({ conversation_id: conversationId, created_by: user.id, question, options, multiple })
    .select()
    .single();
  return { poll: data, error };
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
