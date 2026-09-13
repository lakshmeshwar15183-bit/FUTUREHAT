// Lumixo E2EE — WhatsApp-class per-conversation encryption
//
// Crypto: X25519 identity keys (nacl.box) + XSalsa20Poly1305 secretbox per message.
// Keys: conversation symmetric key (32B) sealed to each participant's public key via
//       sealedbox (ephemeral X25519 + SalsaBox, libsodium-compatible).
//
// This file is PURE CRYPTO — no Supabase, no storage. Platform adapters (SecureStore
// vs localStorage) live in e2eIdentity.ts. Works on both Web (WASM-free) and Expo
// (pure JS via tweetnacl — no native module / rebuild).
//
// Dependencies: tweetnacl, tweetnacl-util, tweetnacl-sealedbox-js
// Install: npm i tweetnacl tweetnacl-util tweetnacl-sealedbox-js

import nacl from 'tweetnacl';
// tweetnacl-util is CJS with default export containing helpers
// @ts-ignore
import naclUtil from 'tweetnacl-util';
// @ts-ignore no types for sealedbox
import _sealedbox from 'tweetnacl-sealedbox-js';
const util: typeof naclUtil = (naclUtil as unknown as { default: typeof naclUtil }).default ?? naclUtil;
const sealedbox: typeof _sealedbox = (_sealedbox as unknown as { default: typeof _sealedbox }).default ?? _sealedbox;

// ── Constants ───────────────────────────────────────────────────────────────
export const E2E_KEY_BYTES = 32;
export const E2E_NONCE_BYTES = 24;
export const E2E_PUBLIC_KEY_BYTES = 32;
export const E2E_SECRET_KEY_BYTES = 32;

// ── Base64 helpers (tweetnacl-util uses standard base64, not url-safe) ─────
export function b64encode(bytes: Uint8Array): string {
  return util.encodeBase64(bytes);
}

export function b64decode(b64: string): Uint8Array {
  return util.decodeBase64(b64);
}

export function utf8Encode(str: string): Uint8Array {
  return util.decodeUTF8(str);
}

export function utf8Decode(bytes: Uint8Array): string {
  return util.encodeUTF8(bytes);
}

// ── Identity keypair (X25519 via nacl.box) ──────────────────────────────────
// nacl.box uses Curve25519-XSalsa20-Poly1305. The same keypair works for both
// sealedbox and direct box. We use box.keyPair for identities.

export interface E2EKeyPair {
  publicKey: Uint8Array; // 32B
  secretKey: Uint8Array; // 32B
  publicKeyB64: string;
  secretKeyB64: string;
}

export function generateIdentityKeyPair(): E2EKeyPair {
  const kp = nacl.box.keyPair();
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    publicKeyB64: b64encode(kp.publicKey),
    secretKeyB64: b64encode(kp.secretKey),
  };
}

export function keyPairFromSecretB64(secretB64: string): E2EKeyPair | null {
  try {
    const secret = b64decode(secretB64);
    if (secret.length !== E2E_SECRET_KEY_BYTES) return null;
    // Derive public key via scalarMult base
    const kp = nacl.box.keyPair.fromSecretKey(secret);
    return {
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
      publicKeyB64: b64encode(kp.publicKey),
      secretKeyB64: b64encode(kp.secretKey),
    };
  } catch {
    return null;
  }
}

// ── Conversation symmetric key ───────────────────────────────────────────────
export function generateConversationKey(): Uint8Array {
  return nacl.randomBytes(E2E_KEY_BYTES);
}

export function conversationKeyToB64(key: Uint8Array): string {
  return b64encode(key);
}

export function conversationKeyFromB64(b64: string): Uint8Array | null {
  try {
    const k = b64decode(b64);
    if (k.length !== E2E_KEY_BYTES) return null;
    return k;
  } catch {
    return null;
  }
}

// ── Sealed box: encrypt conversation key to a participant's public key ──────
// Sealedbox is anonymous — no sender private key needed; uses ephemeral keypair.
// Libsodium-compatible: ephemeralPub(32) + box(key, nonce=blake2b(ephemPub+recipPub), recipPub, ephemSec)

export function sealConversationKey(
  conversationKey: Uint8Array,
  recipientPublicKeyB64: string,
): string | null {
  try {
    const recipPub = b64decode(recipientPublicKeyB64);
    if (recipPub.length !== E2E_PUBLIC_KEY_BYTES) return null;
    const sealed = sealedbox.seal(conversationKey, recipPub);
    return b64encode(sealed);
  } catch {
    return null;
  }
}

export function openSealedConversationKey(
  sealedB64: string,
  recipientPublicKeyB64: string,
  recipientSecretKeyB64: string,
): Uint8Array | null {
  try {
    const sealed = b64decode(sealedB64);
    const pub = b64decode(recipientPublicKeyB64);
    const sec = b64decode(recipientSecretKeyB64);
    if (pub.length !== 32 || sec.length !== 32) return null;
    const opened = sealedbox.open(sealed, pub, sec);
    if (!opened) return null;
    if (opened.length !== E2E_KEY_BYTES) return null;
    return opened;
  } catch {
    return null;
  }
}

// ── Message secretbox (XSalsa20Poly1305) ────────────────────────────────────
// Ciphertext format: base64( nonce(24) || secretbox(plaintext, nonce, key) )
// secretbox overhead is 16B (Poly1305 tag).

export function encryptMessage(plaintext: string, conversationKey: Uint8Array): string | null {
  try {
    if (conversationKey.length !== E2E_KEY_BYTES) return null;
    // Enforce plaintext limit before encryption (matches guard_message_update 16000)
    if (plaintext.length > 16000) return null;
    const msgBytes = utf8Encode(plaintext);
    const nonce = nacl.randomBytes(E2E_NONCE_BYTES);
    const box = nacl.secretbox(msgBytes, nonce, conversationKey);
    const combined = new Uint8Array(nonce.length + box.length);
    combined.set(nonce, 0);
    combined.set(box, nonce.length);
    return b64encode(combined);
  } catch {
    return null;
  }
}

export function decryptMessage(cipherB64: string, conversationKey: Uint8Array): string | null {
  try {
    if (conversationKey.length !== E2E_KEY_BYTES) return null;
    const combined = b64decode(cipherB64);
    if (combined.length < E2E_NONCE_BYTES + 16) return null; // nonce + tag
    const nonce = combined.slice(0, E2E_NONCE_BYTES);
    const box = combined.slice(E2E_NONCE_BYTES);
    const opened = nacl.secretbox.open(box, nonce, conversationKey);
    if (!opened) return null;
    return utf8Decode(opened);
  } catch {
    return null;
  }
}

// ── Validation helpers ───────────────────────────────────────────────────────
export function isValidPublicKeyB64(b64: string): boolean {
  try {
    const b = b64decode(b64);
    return b.length === E2E_PUBLIC_KEY_BYTES;
  } catch {
    return false;
  }
}

export function isEncryptedContent(s: string | null | undefined): boolean {
  if (!s) return false;
  // Encrypted is base64 and at least nonce+tag
  try {
    const b = b64decode(s);
    return b.length >= E2E_NONCE_BYTES + 16;
  } catch {
    return false;
  }
}

// ── In-memory conversation key cache (per-process, cleared on app restart) ──
// This avoids re-opening sealedbox on every message render.
// Caller must populate via fetchConversationKey or setConversationKeyCache.
const convKeyCache = new Map<string, Uint8Array>();

export function getConversationKeyFromCache(conversationId: string): Uint8Array | null {
  return convKeyCache.get(conversationId) ?? null;
}

export function setConversationKeyCache(conversationId: string, key: Uint8Array): void {
  if (key.length === E2E_KEY_BYTES) convKeyCache.set(conversationId, key);
}

export function clearConversationKeyCache(conversationId?: string): void {
  if (conversationId) convKeyCache.delete(conversationId);
  else convKeyCache.clear();
}

// ── Feature flag helpers ─────────────────────────────────────────────────────
export function shouldUseE2E(
  conversation: { e2e_enabled?: boolean | null } | null | undefined,
  hasConversationKey: boolean,
): boolean {
  // E2E only when conversation flagged and we have the sealed key for this device.
  // Legacy conversations (e2e_enabled false/ null) stay plaintext.
  return !!conversation?.e2e_enabled && hasConversationKey;
}
