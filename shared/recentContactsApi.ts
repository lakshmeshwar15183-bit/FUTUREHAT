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

export interface RecentContact {
  contact: Profile;
  first_interaction_at: string;
  last_interaction_at: string;
}

/**
 * My recent-contact history, newest interaction first, with each contact's
 * profile embedded. RLS restricts the result to my own rows. The explicit FK
 * hint (`recent_contacts_contact_id_fkey`) is required because the table has two
 * foreign keys to `profiles` (owner_id + contact_id) and PostgREST would
 * otherwise be unable to pick which one to embed.
 */
export async function listRecentContacts(client: SupabaseClient): Promise<RecentContact[]> {
  const { data, error } = await client
    .from('recent_contacts')
    .select('first_interaction_at, last_interaction_at, contact:profiles!recent_contacts_contact_id_fkey(*)')
    .order('last_interaction_at', { ascending: false });
  if (error || !data) return [];
  return (data as any[])
    .map((r) => ({
      // PostgREST returns a many-to-one embed as an object, but the generated
      // typing can widen it to an array — normalise defensively.
      contact: (Array.isArray(r.contact) ? r.contact[0] : r.contact) as Profile,
      first_interaction_at: r.first_interaction_at,
      last_interaction_at: r.last_interaction_at,
    }))
    .filter((r) => !!r.contact);
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
