// Lumixo mobile — app lock. Holds lock state, persists settings in the OS
// secure store, and re-locks when the app returns from the background.
import 'react-native-get-random-values';
import 'expo-standard-web-crypto';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

const K_ENABLED = 'futurehat.applock.enabled';
const K_PIN = 'futurehat.applock.pin';
const K_PIN_SALT = 'futurehat.applock.pin_salt';
const K_BIO = 'futurehat.applock.biometric';

const PBKDF2_ITERATIONS = 210_000;
const MIN_PIN_LEN = 6;

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
  const subtle = (globalThis as unknown as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto subtle not available');
  const keyMaterial = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(bits)}`;
}

const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;
let failedAttempts = 0;
let lockoutUntil = 0;

interface AppLockValue {
  enabled: boolean;
  locked: boolean;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  enable: (pin: string, useBiometric: boolean) => Promise<void>;
  disable: () => Promise<void>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
}

const Ctx = createContext<AppLockValue | null>(null);

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    (async () => {
      const en = (await SecureStore.getItemAsync(K_ENABLED)) === '1';
      const bio = (await SecureStore.getItemAsync(K_BIO)) === '1';
      setEnabled(en);
      setBiometricEnabled(bio);
      setLocked(en);
      const hw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setBiometricAvailable(hw && enrolled);
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/active/) && next.match(/inactive|background/) && enabled) {
        setLocked(true);
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [enabled]);

  const enable = useCallback(async (pin: string, useBiometric: boolean) => {
    if (pin.length < MIN_PIN_LEN) throw new Error(`PIN must be at least ${MIN_PIN_LEN} digits`);
    // PBKDF2 with per-device salt — not plaintext
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    await SecureStore.setItemAsync(K_PIN_SALT, bytesToHex(salt.buffer));
    const hash = await pbkdf2Hash(pin, salt);
    await SecureStore.setItemAsync(K_PIN, hash);
    await SecureStore.setItemAsync(K_ENABLED, '1');
    await SecureStore.setItemAsync(K_BIO, useBiometric ? '1' : '0');
    failedAttempts = 0;
    lockoutUntil = 0;
    setEnabled(true);
    setBiometricEnabled(useBiometric);
    setLocked(false);
  }, []);

  const disable = useCallback(async () => {
    await SecureStore.deleteItemAsync(K_PIN);
    await SecureStore.deleteItemAsync(K_PIN_SALT);
    await SecureStore.setItemAsync(K_ENABLED, '0');
    await SecureStore.setItemAsync(K_BIO, '0');
    failedAttempts = 0;
    lockoutUntil = 0;
    setEnabled(false);
    setBiometricEnabled(false);
    setLocked(false);
  }, []);

  const unlockWithPin = useCallback(async (pin: string) => {
    // Throttle brute force
    if (Date.now() < lockoutUntil) return false;
    const saved = await SecureStore.getItemAsync(K_PIN);
    if (!saved) return false;

    // New PBKDF2 format
    if (saved.startsWith('pbkdf2$')) {
      const saltHex = await SecureStore.getItemAsync(K_PIN_SALT);
      if (!saltHex) return false;
      const salt = hexToBytes(saltHex);
      const next = await pbkdf2Hash(pin, salt);
      if (next === saved) {
        failedAttempts = 0;
        lockoutUntil = 0;
        setLocked(false);
        return true;
      }
      failedAttempts++;
      if (failedAttempts >= MAX_PIN_ATTEMPTS) {
        lockoutUntil = Date.now() + LOCKOUT_MS;
        failedAttempts = 0;
      }
      return false;
    }

    // Legacy plaintext — accept once, upgrade to PBKDF2
    if (saved === pin) {
      try {
        const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
        await SecureStore.setItemAsync(K_PIN_SALT, bytesToHex(salt.buffer));
        const hash = await pbkdf2Hash(pin, salt);
        await SecureStore.setItemAsync(K_PIN, hash);
      } catch { /* ignore upgrade failure */ }
      failedAttempts = 0;
      setLocked(false);
      return true;
    }
    failedAttempts++;
    if (failedAttempts >= MAX_PIN_ATTEMPTS) {
      lockoutUntil = Date.now() + LOCKOUT_MS;
      failedAttempts = 0;
    }
    return false;
  }, []);

  const unlockWithBiometric = useCallback(async () => {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Lumixo',
      fallbackLabel: 'Use PIN',
    });
    if (res.success) {
      setLocked(false);
      return true;
    }
    return false;
  }, []);

  return (
    <Ctx.Provider
      value={{
        enabled,
        locked,
        biometricEnabled,
        biometricAvailable,
        enable,
        disable,
        unlockWithPin,
        unlockWithBiometric,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAppLock(): AppLockValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppLock must be used within AppLockProvider');
  return ctx;
}
