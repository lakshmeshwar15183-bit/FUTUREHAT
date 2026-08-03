// Lumixo web — device authentication for App Lock + Chat Lock.
//
// Uses the platform authenticator (Touch ID / Windows Hello / Android biometrics
// / device PIN) via WebAuthn. CRITICAL SECURITY RULES:
//
//  1) NEVER call credentials.get without allowCredentials bound to OUR stored
//     credential id. An unbound get accepts ANY user-verifying credential on the
//     device (password-manager passkeys, other sites' keys) and is a bypass.
//  2) Registration (create) is first-use only; unlock always asserts the stored id.
//  3) No secrets leave the device — only the credential id is in localStorage.

import { supabase } from '../supabase';

const supported = () =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;

function credKey(userId: string) {
  return `fh_device_cred_${userId}`;
}

// Legacy key used by older Chat Lock builds — migrate on first successful assert.
function legacyCredKey(userId: string) {
  return `fh_chatlock_cred_${userId}`;
}

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function loadStoredCredId(uid: string): string | null {
  return localStorage.getItem(credKey(uid)) || localStorage.getItem(legacyCredKey(uid));
}

function saveCredId(uid: string, idB64: string) {
  localStorage.setItem(credKey(uid), idB64);
  // Keep legacy key in sync so older code paths still find it.
  localStorage.setItem(legacyCredKey(uid), idB64);
}

export const deviceAuth = {
  /** True when this browser/device exposes a user-verifying platform authenticator. */
  async isAvailable(): Promise<boolean> {
    if (!supported()) return false;
    try {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },

  /** Whether a credential is already registered for this user on this device. */
  async hasCredential(): Promise<boolean> {
    const uid = await currentUserId();
    if (!uid) return false;
    return !!loadStoredCredId(uid);
  },

  /**
   * Register (first time) or assert (subsequent) the platform credential.
   * Returns true only on success for THIS app's stored credential.
   *
   * NEVER uses unbound credentials.get — that would accept any UV credential.
   */
  async authenticate(_reason = 'Unlock'): Promise<boolean> {
    if (!supported()) return false;
    const uid = await currentUserId();
    if (!uid) return false;
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const existing = loadStoredCredId(uid);

      if (!existing) {
        // First time: create platform credential (OS prompts for biometrics/PIN).
        const cred = (await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: { name: 'Lumixo', id: location.hostname },
            user: {
              id: new TextEncoder().encode(uid),
              name: 'Lumixo',
              displayName: 'Lumixo',
            },
            pubKeyCredParams: [
              { type: 'public-key', alg: -7 },
              { type: 'public-key', alg: -257 },
            ],
            authenticatorSelection: {
              authenticatorAttachment: 'platform',
              userVerification: 'required',
              residentKey: 'preferred',
            },
            timeout: 60000,
          },
        })) as PublicKeyCredential | null;
        if (!cred) return false;
        saveCredId(uid, b64url(cred.rawId));
        return true;
      }

      // Unlock: MUST bind allowCredentials to our stored id only.
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ type: 'public-key', id: fromB64url(existing) }],
          userVerification: 'required',
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;
      if (!assertion) return false;
      // Migrate legacy key → primary key after successful assert.
      saveCredId(uid, existing);
      return true;
    } catch {
      return false;
    }
  },
};
