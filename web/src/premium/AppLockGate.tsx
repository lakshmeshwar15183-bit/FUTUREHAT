// Lumixo+ — App lock. When enabled (premium), the app is hidden behind a PIN
// (and device biometrics via WebAuthn when available) until unlocked this session.
// No framer-motion — keeps app shell off the motion chunk.
//
// Security notes:
//  • Biometric path uses deviceAuth (bound credential + allowCredentials), never
//    an unbound WebAuthn get that accepts any platform key.
//  • PIN is stored as PBKDF2-SHA-256(salt, pin) with per-user salt — not a fast
//    SHA-256 of userId:pin (offline brute-force was trivial for 4-digit PINs).
//  • Minimum PIN length is 6 digits.

import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../AuthContext';
import { usePremium } from '../PremiumContext';
import { deviceAuth } from '../lib/deviceAuth';

const PBKDF2_ITERATIONS = 210_000;
const MIN_PIN_LEN = 6;

function pinStorageKey(userId: string) {
  return `fh_pin_${userId}`;
}

function pinSaltKey(userId: string) {
  return `fh_pin_salt_${userId}`;
}

/** Legacy fast hash (pre-hardening) — still accepted once, then re-hashed with PBKDF2. */
async function legacyDigest(userId: string, pin: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}:${pin}`));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2Hash(pin: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(bits)}`;
}

async function storePin(userId: string, pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(pinSaltKey(userId), bytesToHex(salt.buffer));
  const hash = await pbkdf2Hash(pin, salt);
  localStorage.setItem(pinStorageKey(userId), hash);
}

async function verifyPin(userId: string, pin: string): Promise<boolean> {
  const stored = localStorage.getItem(pinStorageKey(userId));
  if (!stored) return false;

  // New format: pbkdf2$iter$hex
  if (stored.startsWith('pbkdf2$')) {
    const saltHex = localStorage.getItem(pinSaltKey(userId));
    if (!saltHex) return false;
    const salt = hexToBytes(saltHex);
    const next = await pbkdf2Hash(pin, salt);
    return next === stored;
  }

  // Legacy SHA-256(userId:pin) — accept once, upgrade to PBKDF2.
  const legacy = await legacyDigest(userId, pin);
  if (legacy !== stored) return false;
  await storePin(userId, pin);
  return true;
}

export { pinStorageKey };

export function AppLockGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { preferences, isPremium } = usePremium();
  const locked = isPremium && preferences.app_lock;

  const [unlocked, setUnlocked] = useState(false);
  const [entry, setEntry] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'enter' | 'create'>('enter');
  const [busy, setBusy] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    if (!user) {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('fh_unlocked_')) sessionStorage.removeItem(k);
      }
      setUnlocked(true);
      return;
    }
    if (!locked) {
      setUnlocked(true);
      return;
    }
    if (sessionStorage.getItem(`fh_unlocked_${user.id}`) === '1') {
      setUnlocked(true);
      return;
    }
    const hasPin = !!localStorage.getItem(pinStorageKey(user.id));
    setMode(hasPin ? 'enter' : 'create');
    setUnlocked(false);
    void deviceAuth.isAvailable().then(setBioAvailable);
  }, [locked, user]);

  if (unlocked || !locked || !user) return <>{children}</>;

  function unlock(enrollBio = false) {
    sessionStorage.setItem(`fh_unlocked_${user!.id}`, '1');
    setUnlocked(true);
    setEntry('');
    setError('');
    if (enrollBio) void registerBiometricsAfterPin();
  }

  async function submit() {
    if (entry.length < MIN_PIN_LEN) {
      setError(`PIN must be at least ${MIN_PIN_LEN} digits`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'create') {
        await storePin(user!.id, entry);
        unlock(true); // first PIN → enroll biometrics for next session
      } else if (await verifyPin(user!.id, entry)) {
        unlock(true); // successful PIN → ensure device credential exists
      } else {
        setError('Incorrect PIN');
        setEntry('');
      }
    } finally {
      setBusy(false);
    }
  }

  async function biometric() {
    setBusy(true);
    setError('');
    try {
      // Bound platform credential only — deviceAuth NEVER does unbound get.
      const available = await deviceAuth.isAvailable();
      if (!available) {
        setError('Biometrics not available — use your PIN');
        return;
      }
      // CRITICAL: do not allow credentials.create as an unlock path (would enroll
      // any platform UV without knowing the PIN). Biometrics only after a
      // credential was registered post-PIN unlock.
      const has = await deviceAuth.hasCredential();
      if (!has) {
        setError('Unlock with PIN first to enable biometrics on this device');
        return;
      }
      const ok = await deviceAuth.authenticate('Unlock Lumixo');
      if (ok) unlock();
      else setError('Biometric check cancelled or failed');
    } catch {
      setError('Biometric check cancelled');
    } finally {
      setBusy(false);
    }
  }

  /** After successful PIN unlock, register platform credential for next time. */
  async function registerBiometricsAfterPin() {
    try {
      if (!(await deviceAuth.isAvailable())) return;
      if (await deviceAuth.hasCredential()) return;
      await deviceAuth.authenticate('Enable biometrics for Lumixo');
    } catch { /* optional */ }
  }

  return (
    <div className="fh-splash">
      <div
        className="glass"
        style={{ padding: 32, borderRadius: 24, width: 320, textAlign: 'center' }}
      >
        <div style={{ fontSize: 40 }}>🔐</div>
        <h2 style={{ margin: '10px 0 4px' }}>
          {mode === 'create' ? 'Set a PIN' : 'Lumixo locked'}
        </h2>
        <p style={{ color: 'var(--fh-muted)', fontSize: 13, marginBottom: 18 }}>
          {mode === 'create'
            ? `Create a ${MIN_PIN_LEN}+ digit PIN to protect your chats`
            : 'Enter your PIN to continue'}
        </p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={entry}
          disabled={busy}
          onChange={(e) => setEntry(e.target.value.replace(/\D/g, '').slice(0, 12))}
          onKeyDown={(e) => e.key === 'Enter' && !busy && void submit()}
          placeholder="••••••"
          aria-label="App lock PIN"
          style={{
            width: '100%',
            textAlign: 'center',
            letterSpacing: 8,
            fontSize: 22,
            padding: '12px 10px',
            borderRadius: 12,
            border: '1px solid var(--fh-border)',
            background: 'var(--fh-surface)',
            color: 'var(--fh-text)',
            marginBottom: 12,
          }}
        />
        {error && (
          <p role="alert" style={{ color: '#ef4444', fontSize: 13, margin: '0 0 10px' }}>
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 12,
            border: 'none',
            background: 'var(--fh-primary)',
            color: '#fff',
            fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
            marginBottom: 10,
          }}
        >
          {mode === 'create' ? 'Save PIN' : 'Unlock'}
        </button>
        {bioAvailable && mode === 'enter' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void biometric()}
            style={{
              width: '100%',
              padding: '10px 16px',
              borderRadius: 12,
              border: '1px solid var(--fh-border)',
              background: 'transparent',
              color: 'var(--fh-text)',
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Use biometrics
          </button>
        )}
      </div>
    </div>
  );
}
