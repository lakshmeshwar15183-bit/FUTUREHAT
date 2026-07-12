// Lumixo+ — App lock. When enabled (premium), the app is hidden behind a PIN
// (and device biometrics via WebAuthn when available) until unlocked this session.
// No framer-motion — keeps app shell off the motion chunk.

import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../AuthContext';
import { usePremium } from '../PremiumContext';

async function digest(userId: string, pin: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}:${pin}`));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function pinStorageKey(userId: string) {
  return `fh_pin_${userId}`;
}

export function AppLockGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { preferences, isPremium } = usePremium();
  const locked = isPremium && preferences.app_lock;

  const [unlocked, setUnlocked] = useState(false);
  const [entry, setEntry] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'enter' | 'create'>('enter');

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
  }, [locked, user]);

  if (unlocked || !locked || !user) return <>{children}</>;

  function unlock() {
    sessionStorage.setItem(`fh_unlocked_${user!.id}`, '1');
    setUnlocked(true);
    setEntry('');
    setError('');
  }

  async function submit() {
    if (entry.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }
    const key = pinStorageKey(user!.id);
    const hash = await digest(user!.id, entry);
    if (mode === 'create') {
      localStorage.setItem(key, hash);
      unlock();
    } else if (localStorage.getItem(key) === hash) {
      unlock();
    } else {
      setError('Incorrect PIN');
      setEntry('');
    }
  }

  async function biometric() {
    try {
      if (!('credentials' in navigator) || !window.PublicKeyCredential) {
        setError('Biometrics not available on this device');
        return;
      }
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      await navigator.credentials.get({
        publicKey: { challenge, timeout: 30000, userVerification: 'required' },
      } as any);
      unlock();
    } catch {
      setError('Biometric check cancelled');
    }
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
          {mode === 'create' ? 'Create a PIN to protect your chats' : 'Enter your PIN to continue'}
        </p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={entry}
          onChange={(e) => setEntry(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="••••"
          style={{
            width: '100%',
            textAlign: 'center',
            letterSpacing: 8,
            fontSize: 22,
            padding: '12px',
            borderRadius: 12,
            border: '1px solid var(--fh-border)',
            background: 'var(--fh-elevated)',
            color: 'var(--fh-text)',
            outline: 'none',
          }}
        />
        {error && (
          <div style={{ color: '#ff6b6b', fontSize: 13, marginTop: 10 }}>{error}</div>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          style={{
            width: '100%',
            marginTop: 16,
            padding: 12,
            borderRadius: 12,
            border: 'none',
            background: 'var(--fh-accent)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          {mode === 'create' ? 'Set PIN' : 'Unlock'}
        </button>
        {mode === 'enter' && (
          <button
            type="button"
            onClick={() => void biometric()}
            style={{
              width: '100%',
              marginTop: 10,
              padding: 10,
              borderRadius: 12,
              border: '1px solid var(--fh-border)',
              background: 'transparent',
              color: 'var(--fh-text)',
              cursor: 'pointer',
            }}
          >
            Use Face ID / Touch ID
          </button>
        )}
      </div>
    </div>
  );
}
