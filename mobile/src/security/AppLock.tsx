// FUTUREHAT mobile — app lock. Holds lock state, persists settings in the OS
// secure store, and re-locks when the app returns from the background.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

const K_ENABLED = 'futurehat.applock.enabled';
const K_PIN = 'futurehat.applock.pin';
const K_BIO = 'futurehat.applock.biometric';

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
    await SecureStore.setItemAsync(K_PIN, pin);
    await SecureStore.setItemAsync(K_ENABLED, '1');
    await SecureStore.setItemAsync(K_BIO, useBiometric ? '1' : '0');
    setEnabled(true);
    setBiometricEnabled(useBiometric);
    setLocked(false);
  }, []);

  const disable = useCallback(async () => {
    await SecureStore.deleteItemAsync(K_PIN);
    await SecureStore.setItemAsync(K_ENABLED, '0');
    await SecureStore.setItemAsync(K_BIO, '0');
    setEnabled(false);
    setBiometricEnabled(false);
    setLocked(false);
  }, []);

  const unlockWithPin = useCallback(async (pin: string) => {
    const saved = await SecureStore.getItemAsync(K_PIN);
    if (saved && saved === pin) {
      setLocked(false);
      return true;
    }
    return false;
  }, []);

  const unlockWithBiometric = useCallback(async () => {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock FUTUREHAT',
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
