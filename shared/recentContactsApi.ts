// Lumixo — recent contacts / previously-chatted-users history.
// Framework-agnostic; both web and mobile import this.
//
// Backed by public.recent_contacts (migration 0028). This list is INDEPENDENT
// of the conversations list, so deleting a chat never removes the person here.
// The "add" side is performed server-side inside the SECURITY DEFINER
// start_direct_conversation() RPC (records both directions of the pair), so the
// only client-facing operations are: read my history, and remove one entry.
//
// Security: every row is owner-scoped by RLS (owner_id = auth.uid()). Reads and
// deletes below rely on that boundary — a client can never see or delete another
// user's history regardless of the ids it supplies.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile, UUID } from './types.js';
import { getProfilesPublic } from './api.js';

export interface RecentContact {
  contact: Profile;
  first_interaction_at: string;
  last_interaction_at: string;
}

/**
 * My recent-contact history, newest interaction first, with each contact's
 * PUBLIC profile (no phone). Under 0050/0051, embedding profiles(*) for peers
 * returns null (RLS own-only) — so we load public_profiles in a second query.
 */
export async function listRecentContacts(client: SupabaseClient): Promise<RecentContact[]> {
  const { data, error } = await client
    .from('recent_contacts')
    .select('contact_id, first_interaction_at, last_interaction_at')
    .order('last_interaction_at', { ascending: false });
  if (error || !data?.length) return [];
  const ids = data.map((r: { contact_id: UUID }) => r.contact_id as UUID);
  const profs = await getProfilesPublic(client, ids);
  return data
    .map((r: { contact_id: UUID; first_interaction_at: string; last_interaction_at: string }) => {
      const contact = profs.get(r.contact_id);
      if (!contact) return null;
      return {
        contact,
        first_interaction_at: r.first_interaction_at,
        last_interaction_at: r.last_interaction_at,
      };
    })
    .filter((r): r is RecentContact => !!r);
}

/**
 * Remove ONE person from my recent-contacts history. Scoped to the caller by
 * RLS (delete policy: auth.uid() = owner_id), so this only ever removes my own
 * row for that contact. It does NOT delete messages, delete the conversation,
 * block the user, or touch the other user's account — it only forgets the
 * history entry.
 */
export async function removeRecentContact(
  client: SupabaseClient,
  contactId: UUID,
): Promise<{ error: unknown }> {
  const { error } = await client.from('recent_contacts').delete().eq('contact_id', contactId);
  return { error };
}
