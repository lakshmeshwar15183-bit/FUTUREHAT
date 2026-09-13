// Lumixo mobile — E2EE secure storage adapter (SecureStore)
// Private keys never touch AsyncStorage or logs; SecureStore is hardware-backed
// when available (Keystore / Secure Enclave).

import * as SecureStore from 'expo-secure-store';

export const e2eStorage = {
  getItem: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
  removeItem: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
};
