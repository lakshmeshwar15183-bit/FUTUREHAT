// Lumixo E2EE identity + conversation-key distribution
// Bridges pure crypto (e2e.ts) with Supabase + platform storage.
//
// Responsibilities:
//   • Ensure each user has an X25519 identity keypair (generate once, persist locally,
//     publish public key to e2e_identities via upsert_e2e_identity).
//   • Fetch peer public keys (get_e2e_public_keys RPC).
//   • Create / rotate per-conversation symmetric keys and seal them to participants
//     (conversation_keys table).
//   • Cache opened conversation keys in-memory for fast encrypt/decrypt.
//
// Storage adapters: web uses localStorage, mobile uses expo-secure-store.
// Pass an adapter or use the default detect.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  b64encode,
  b64decode,
  generateIdentityKeyPair,
  keyPairFromSecretB64,
  generateConversationKey,
  sealConversationKey,
  openSealedConversationKey,
  setConversationKeyCache,
  getConversationKeyFromCache,
  clearConversationKeyCache,
  type E2EKeyPair,
} from './e2e.js';

// ── Storage adapter ──────────────────────────────────────────────────────────
export interface E2EStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem?(key: string): Promise<void> | void;
}

function webStorage(): E2EStorage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return {
        getItem: (k) => window.localStorage.getItem(k),
        setItem: (k, v) => window.localStorage.setItem(k, v),
      };
    }
  } catch { /* ignore */ }
  return null;
}

// Default: try web localStorage, else in-memory fallback (for tests)
const memFallback = new Map<string, string>();
const defaultStorage: E2EStorage = webStorage() ?? {
  getItem: (k) => memFallback.get(k) ?? null,
  setItem: (k, v) => { memFallback.set(k, v); },
};

function privKeyStorageKey(userId: string): string {
  return `lumixo:e2e:priv:${userId}`;
}
function pubKeyStorageKey(userId: string): string {
  return `lumixo:e2e:pub:${userId}`;
}

// ── Identity ─────────────────────────────────────────────────────────────────
export async function getOrCreateIdentity(
  client: SupabaseClient,
  userId: string,
  storage: E2EStorage = defaultStorage,
): Promise<E2EKeyPair | null> {
  // 1) Try local store
  try {
    const privB64 = await storage.getItem(privKeyStorageKey(userId));
    const pubB64 = await storage.getItem(pubKeyStorageKey(userId));
    if (privB64 && pubB64) {
      const kp = keyPairFromSecretB64(privB64);
      if (kp && kp.publicKeyB64 === pubB64) {
        // Ensure server has it (in case it was generated offline)
        await publishPublicKey(client, kp.publicKeyB64).catch(() => {});
        return kp;
      }
    }
  } catch { /* ignore */ }

  // 2) Check server for existing public key — if another device already published,
  //    we cannot derive private key, so we must generate a new pair and overwrite.
  //    (Phase 1 single-keypair model: new device re-generates, old history undecryptable
  //    until Phase 2 multi-device). We warn but proceed.
  try {
    const { data } = await client.from('e2e_identities').select('public_key').eq('user_id', userId).maybeSingle();
    if (data?.public_key) {
      // Server has a key but we have no private — this is a new device.
      // We generate a fresh pair and overwrite the server (old conversations will need re-seal).
      // In Phase 1 we do this silently; UI can show "New device — old encrypted history unavailable".
    }
  } catch { /* ignore */ }

  // 3) Generate fresh
  const kp = generateIdentityKeyPair();
  try {
    await storage.setItem(privKeyStorageKey(userId), kp.secretKeyB64);
    await storage.setItem(pubKeyStorageKey(userId), kp.publicKeyB64);
  } catch { /* storage fail = no persistence, still return for session */ }

  await publishPublicKey(client, kp.publicKeyB64).catch(() => {});

  return kp;
}

export async function getLocalIdentity(
  userId: string,
  storage: E2EStorage = defaultStorage,
): Promise<E2EKeyPair | null> {
  try {
    const privB64 = await storage.getItem(privKeyStorageKey(userId));
    if (!privB64) return null;
    return keyPairFromSecretB64(privB64);
  } catch {
    return null;
  }
}

async function publishPublicKey(client: SupabaseClient, publicKeyB64: string): Promise<void> {
  const { error } = await client.rpc('upsert_e2e_identity', { p_public_key: publicKeyB64 });
  if (error) throw error;
}

// Fetch public keys for a set of userIds (for sealing)
export async function fetchPublicKeys(
  client: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!userIds.length) return map;
  try {
    const { data, error } = await client.rpc('get_e2e_public_keys', { p_user_ids: userIds });
    if (!error && Array.isArray(data)) {
      for (const row of data as { user_id: string; public_key: string }[]) {
        map.set(row.user_id, row.public_key);
      }
    } else {
      // Fallback direct select (if RPC not deployed yet)
      const { data: rows } = await client.from('e2e_identities').select('user_id, public_key').in('user_id', userIds);
      for (const r of rows as { user_id: string; public_key: string }[] ?? []) map.set(r.user_id, r.public_key);
    }
  } catch {
    // Fallback
    try {
      const { data: rows } = await client.from('e2e_identities').select('user_id, public_key').in('user_id', userIds);
      for (const r of rows as { user_id: string; public_key: string }[] ?? []) map.set(r.user_id, r.public_key);
    } catch { /* ignore */ }
  }
  return map;
}

// ── Conversation keys ────────────────────────────────────────────────────────

// Create a fresh conversation key and seal it to all participants (including self).
// Call this when creating a new E2EE conversation or rotating.
export async function createAndDistributeConversationKey(
  client: SupabaseClient,
  conversationId: string,
  participantIds: string[],
  storage: E2EStorage = defaultStorage,
): Promise<Uint8Array | null> {
  const key = generateConversationKey();
  const pubMap = await fetchPublicKeys(client, participantIds);
  // Need own identity for self-seal check (we seal to self too via pubMap)
  const sealedRows: { conversation_id: string; user_id: string; encrypted_key: string }[] = [];
  for (const uid of participantIds) {
    const pubB64 = pubMap.get(uid);
    if (!pubB64) {
      // Participant has no E2EE identity yet — skip (they'll get key on next rotation after they publish).
      // Conversation will be partially encrypted; document as P1 to retry.
      continue;
    }
    const sealed = sealConversationKey(key, pubB64);
    if (!sealed) continue;
    sealedRows.push({ conversation_id: conversationId, user_id: uid, encrypted_key: sealed });
  }
  if (sealedRows.length === 0) return null;
  // Upsert sealed keys
  const { error } = await client.from('conversation_keys').upsert(sealedRows, { onConflict: 'conversation_id,user_id' } as any);
  if (error) {
    // Fallback per-row insert
    for (const row of sealedRows) {
      try { await client.from('conversation_keys').upsert(row, { onConflict: 'conversation_id,user_id' } as any); } catch { /* ignore */ }
    }
  }
  setConversationKeyCache(conversationId, key);
  return key;
}

// Ensure we have the conversation key for the current user (fetch + open sealed box).
// Returns null if not E2EE or key unavailable.
export async function ensureConversationKey(
  client: SupabaseClient,
  conversationId: string,
  userId: string,
  storage: E2EStorage = defaultStorage,
): Promise<Uint8Array | null> {
  const cached = getConversationKeyFromCache(conversationId);
  if (cached) return cached;

  // Need local identity to open sealed box
  const kp = await getLocalIdentity(userId, storage);
  if (!kp) return null;

  try {
    const { data, error } = await client
      .from('conversation_keys')
      .select('encrypted_key')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data?.encrypted_key) return null;
    const opened = openSealedConversationKey(data.encrypted_key, kp.publicKeyB64, kp.secretKeyB64);
    if (!opened) return null;
    setConversationKeyCache(conversationId, opened);
    return opened;
  } catch {
    return null;
  }
}

// When a new participant is added to an E2EE conversation, seal existing key to them
// (or generate new key and re-seal to all if you want rotation).
export async function addParticipantToE2EConversation(
  client: SupabaseClient,
  conversationId: string,
  newUserId: string,
  existingParticipantIds: string[], // including self, for rotation case
  storage: E2EStorage = defaultStorage,
  rotate = false,
): Promise<boolean> {
  // Try to get current key (self)
  const me = (await client.auth.getSession()).data.session?.user?.id;
  if (!me) return false;

  let key: Uint8Array | null = null;
  if (!rotate) {
    key = await ensureConversationKey(client, conversationId, me, storage);
  }
  if (!key || rotate) {
    // Generate fresh and re-distribute to all (rotation)
    const all = [...new Set([...existingParticipantIds, newUserId])];
    key = await createAndDistributeConversationKey(client, conversationId, all, storage);
    return !!key;
  }
  // Just seal existing key to new member
  const pubMap = await fetchPublicKeys(client, [newUserId]);
  const pubB64 = pubMap.get(newUserId);
  if (!pubB64 || !key) return false;
  const sealed = sealConversationKey(key, pubB64);
  if (!sealed) return false;
  const { error } = await client
    .from('conversation_keys')
    .upsert({ conversation_id: conversationId, user_id: newUserId, encrypted_key: sealed }, { onConflict: 'conversation_id,user_id' } as any);
  return !error;
}

// Check if conversation is E2EE-enabled
export async function isConversationE2E(client: SupabaseClient, conversationId: string): Promise<boolean> {
  try {
    const { data } = await client.from('conversations').select('e2e_enabled').eq('id', conversationId).maybeSingle();
    return !!(data as { e2e_enabled?: boolean })?.e2e_enabled;
  } catch {
    return false;
  }
}

export { clearConversationKeyCache, getConversationKeyFromCache, setConversationKeyCache };
