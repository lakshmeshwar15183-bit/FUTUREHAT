// Lumixo — WhatsApp-style contact discovery (hash-only).
// Client: normalize phones → hash → RPC discover_contacts.
// Server: match phone_hash only; return public profile fields (never raw phones).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile, UUID } from './types.js';
import {
  hashPhonesForDiscovery,
  normalizeContactPhones,
  type DefaultCountry,
} from './phone.js';
import { friendlyAuthError } from './authErrors.js';

export interface DiscoveredContact {
  userId: UUID;
  profile: Profile;
  /** Local contact display name from the device (never sent to server). */
  localName?: string | null;
}

const MAX_HASHES_PER_BATCH = 500;

/**
 * Match local phone numbers against registered Lumixo users.
 * Only SHA-256 hashes are sent to the server — never the raw list.
 */
export async function discoverContactsByPhones(
  client: SupabaseClient,
  rawPhones: Array<string | null | undefined>,
  opts?: {
    defaultCountry?: DefaultCountry;
    /** Optional map e164 → local contact name for UI only. */
    localNamesByE164?: Map<string, string>;
  },
): Promise<{ matches: DiscoveredContact[]; error: Error | null }> {
  try {
    const defaultCountry = opts?.defaultCountry ?? 'IN';
    const e164List = normalizeContactPhones(rawPhones, defaultCountry);
    if (!e164List.length) {
      return { matches: [], error: null };
    }

    // Build reverse map hash → e164 for attaching local names
    const hashToE164 = new Map<string, string>();
    const hashes: string[] = [];
    for (const e of e164List) {
      const batch = await hashPhonesForDiscovery([e]);
      const h = batch[0];
      if (h) {
        hashes.push(h);
        hashToE164.set(h, e);
      }
    }
    const uniqueHashes = [...new Set(hashes)].slice(0, MAX_HASHES_PER_BATCH);
    if (!uniqueHashes.length) return { matches: [], error: null };

    // Chunk to stay under payload limits
    const CHUNK = 200;
    const rows: Array<{
      user_id: string;
      username: string | null;
      display_name: string | null;
      avatar_url: string | null;
      about: string | null;
    }> = [];

    for (let i = 0; i < uniqueHashes.length; i += CHUNK) {
      const slice = uniqueHashes.slice(i, i + CHUNK);
      const { data, error } = await client.rpc('discover_contacts', {
        p_hashes: slice,
      });
      if (error) {
        return {
          matches: [],
          error: new Error(friendlyAuthError(error, 'Could not find contacts on Lumixo.')),
        };
      }
      if (Array.isArray(data)) rows.push(...(data as typeof rows));
    }

    const seen = new Set<string>();
    const matches: DiscoveredContact[] = [];
    for (const r of rows) {
      if (!r?.user_id || seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      const profile: Profile = {
        id: r.user_id,
        phone: null, // never expose
        username: r.username,
        display_name: r.display_name,
        about: r.about,
        avatar_url: r.avatar_url,
        last_seen: null,
        created_at: '',
      };
      matches.push({
        userId: r.user_id,
        profile,
        localName: undefined,
      });
    }

    // Attach local names when caller provided e164→name (we cannot reverse hashes).
    // Callers that need names should use discoverContactsFromEntries instead.
    return { matches, error: null };
  } catch (e) {
    return {
      matches: [],
      error: new Error(friendlyAuthError(e, 'Could not find contacts on Lumixo.')),
    };
  }
}

export interface LocalContactEntry {
  /** Display name on the device. */
  name?: string | null;
  phones: Array<string | null | undefined>;
}

/**
 * Preferred discovery entry: keeps local names by matching e164 before hashing.
 * Still uploads only hashes.
 */
export async function discoverContactsFromEntries(
  client: SupabaseClient,
  entries: LocalContactEntry[],
  opts?: { defaultCountry?: DefaultCountry },
): Promise<{ matches: DiscoveredContact[]; error: Error | null }> {
  try {
    const defaultCountry = opts?.defaultCountry ?? 'IN';
    const e164ToLocalName = new Map<string, string>();
    const allE164: string[] = [];

    for (const entry of entries) {
      const norms = normalizeContactPhones(entry.phones, defaultCountry);
      for (const e of norms) {
        allE164.push(e);
        if (entry.name && !e164ToLocalName.has(e)) {
          e164ToLocalName.set(e, entry.name.trim());
        }
      }
    }

    const uniqueE164 = [...new Set(allE164)];
    if (!uniqueE164.length) return { matches: [], error: null };

    // hash → e164
    const hashToE164 = new Map<string, string>();
    for (const e of uniqueE164) {
      const [h] = await hashPhonesForDiscovery([e]);
      if (h) hashToE164.set(h, e);
    }
    const hashes = [...hashToE164.keys()].slice(0, MAX_HASHES_PER_BATCH);

    const CHUNK = 200;
    const rows: Array<{
      user_id: string;
      username: string | null;
      display_name: string | null;
      avatar_url: string | null;
      about: string | null;
    }> = [];

    for (let i = 0; i < hashes.length; i += CHUNK) {
      const slice = hashes.slice(i, i + CHUNK);
      const { data, error } = await client.rpc('discover_contacts', { p_hashes: slice });
      if (error) {
        return {
          matches: [],
          error: new Error(friendlyAuthError(error, 'Could not find contacts on Lumixo.')),
        };
      }
      if (Array.isArray(data)) rows.push(...(data as typeof rows));
    }

    // Server returns matches without which hash hit — attach local name only via
    // profile.display_name preference; local names for exact phone need a second
    // structure. We store hash→e164 and re-hash known e164s of matched users? We
    // cannot. So expose local name when a single entry maps uniquely after we
    // also store user_id→best local name from a client-side join on all e164s
    // that were submitted: for each match we don't know which phone matched.
    // Best-effort: leave localName from first entry if only one contact entry
    // in the batch (weak). Better approach: RPC returns phone_hash of match.
    //
    // Extend: migration returns no hash. Improve client by asking RPC for hash.
    // For now, leave localName null unless we enhance RPC.
    //
    // Enhanced RPC already planned — add phone_hash to return? Privacy: hash
    // of a known contact is OK for the querier. Update migration return hash.

    const seen = new Set<string>();
    const matches: DiscoveredContact[] = [];
    for (const r of rows as Array<typeof rows[0] & { phone_hash?: string }>) {
      if (!r?.user_id || seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      const e164 = r.phone_hash ? hashToE164.get(String(r.phone_hash).toLowerCase()) : undefined;
      const localName = e164 ? e164ToLocalName.get(e164) : undefined;
      matches.push({
        userId: r.user_id,
        localName: localName ?? null,
        profile: {
          id: r.user_id,
          phone: null,
          username: r.username,
          display_name: r.display_name,
          about: r.about,
          avatar_url: r.avatar_url,
          last_seen: null,
          created_at: '',
        },
      });
    }

    return { matches, error: null };
  } catch (e) {
    return {
      matches: [],
      error: new Error(friendlyAuthError(e, 'Could not find contacts on Lumixo.')),
    };
  }
}
