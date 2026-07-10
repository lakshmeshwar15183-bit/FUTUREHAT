// Lumixo web — device authentication for Chat Lock. This is the web analogue of
// the mobile biometric gate: it uses the platform authenticator (Touch ID / Windows
// Hello / Android fingerprint/face — falling back to the device PIN) via WebAuthn.
//
// Lumixo never stores a PIN, password, or biometric. On first use we register a
// platform credential (the OS prompts for fingerprint/face/PIN) and remember ONLY
// its credential id in localStorage, per user. Unlocking re-runs user-verification
// against that credential — the same "prove it's you on this device" gesture
// WhatsApp uses. All secrets stay inside the device's secure hardware.

import { supabase } from '../supabase';

const supported = () =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;

function credKey(userId: string) {
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

export const deviceAuth = {
  /** True when this browser/device exposes a user-verifying platform authenticator
   *  (fingerprint / face / device PIN). Mirrors the mobile `available` flag. */
  async isAvailable(): Promise<boolean> {
    if (!supported()) return false;
    try {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },

  /** Run the device's fingerprint / face / PIN prompt. Resolves true on success.
   *  Registers a platform credential the first time (no secret leaves the device). */
  async authenticate(_reason = 'Unlock chat'): Promise<boolean> {
    if (!supported()) return false;
    const uid = await currentUserId();
    if (!uid) return false;
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const existing = localStorage.getItem(credKey(uid));

      if (!existing) {
        // First time on this device: create a platform credential. The OS prompts
        // for fingerprint / face / PIN as part of this call.
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
        localStorage.setItem(credKey(uid), b64url(cred.rawId));
        return true;
      }

      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ type: 'public-key', id: fromB64url(existing) }],
          userVerification: 'required',
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;
      return !!assertion;
    } catch {
      return false;
    }
  },
};
