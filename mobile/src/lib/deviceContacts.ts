// Lumixo mobile — read device contacts locally for discovery.
// Never uploads the raw list: callers hash phones via contactDiscoveryApi.
//
// Permission flow (WhatsApp-class):
//  1) Already granted → never ask again, just read.
//  2) Can ask → show Android runtime dialog immediately (no custom pre-dialog).
//  3) Soft deny → friendly explanation; app stays fully usable.
//  4) Permanent deny (Don't ask again) → Open Settings (no more requestPermissions).

import type { LocalContactEntry } from './shared';

export type ContactsPermission =
  | 'granted'
  | 'denied'
  | 'permanently_denied'
  | 'undetermined'
  | 'unavailable';

export type ContactsPermissionResult = {
  permission: ContactsPermission;
  /** False when Android will not show the runtime dialog again. */
  canAskAgain: boolean;
};

function loadContactsModule(): typeof import('expo-contacts') | null {
  try {
    // Native module — present after a rebuild with expo-contacts plugin.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-contacts') as typeof import('expo-contacts');
  } catch {
    return null;
  }
}

function mapStatus(
  granted: boolean,
  status: string,
  canAskAgain: boolean,
): ContactsPermission {
  if (granted) return 'granted';
  if (status === 'undetermined') return 'undetermined';
  if (!canAskAgain) return 'permanently_denied';
  return 'denied';
}

/** Current permission without prompting. */
export async function getContactsPermission(): Promise<ContactsPermissionResult> {
  const Contacts = loadContactsModule();
  if (!Contacts) {
    return { permission: 'unavailable', canAskAgain: false };
  }
  const current = await Contacts.getPermissionsAsync();
  return {
    permission: mapStatus(!!current.granted, current.status, current.canAskAgain !== false),
    canAskAgain: current.canAskAgain !== false,
  };
}

/**
 * Ensure we may read contacts (WhatsApp-class).
 * - granted → no dialog
 * - can ask → system runtime dialog only (no custom pre-dialog)
 * - permanently denied → do not call requestPermissions again
 */
export async function ensureContactsPermission(): Promise<ContactsPermissionResult> {
  const Contacts = loadContactsModule();
  if (!Contacts) {
    return { permission: 'unavailable', canAskAgain: false };
  }

  const current = await Contacts.getPermissionsAsync();
  if (current.granted) {
    return { permission: 'granted', canAskAgain: true };
  }

  // Permanent deny: never re-request; UI should offer Open Settings.
  if (current.status === 'denied' && current.canAskAgain === false) {
    return { permission: 'permanently_denied', canAskAgain: false };
  }

  // First install or soft deny — Android system dialog only.
  const next = await Contacts.requestPermissionsAsync();
  return {
    permission: mapStatus(!!next.granted, next.status, next.canAskAgain !== false),
    canAskAgain: next.canAskAgain !== false,
  };
}

/**
 * Read contacts from the device address book after ensuring permission.
 * Does not invent custom dialogs — callers handle UX from `permission`.
 */
export async function readLocalContactEntries(): Promise<{
  entries: LocalContactEntry[];
  permission: ContactsPermission;
  canAskAgain: boolean;
  error: Error | null;
}> {
  const Contacts = loadContactsModule();
  if (!Contacts) {
    return {
      entries: [],
      permission: 'unavailable',
      canAskAgain: false,
      error: new Error(
        'Contacts are not available on this build. Update the app to find friends by phone.',
      ),
    };
  }

  const { permission, canAskAgain } = await ensureContactsPermission();
  if (permission !== 'granted') {
    return {
      entries: [],
      permission,
      canAskAgain,
      // No error for soft/permanent deny — NewChatScreen owns the copy.
      error: null,
    };
  }

  try {
    const page = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      pageSize: 2000,
      pageOffset: 0,
    });

    const entries: LocalContactEntry[] = [];
    for (const c of page.data ?? []) {
      const phones = (c.phoneNumbers ?? [])
        .map((p) => p.number)
        .filter((n): n is string => !!n && n.trim().length > 0);
      if (!phones.length) continue;
      entries.push({
        name: c.name || c.firstName || null,
        phones,
      });
    }
    return { entries, permission: 'granted', canAskAgain: true, error: null };
  } catch (e: any) {
    return {
      entries: [],
      permission: 'granted',
      canAskAgain: true,
      error: new Error(e?.message || 'Could not read contacts.'),
    };
  }
}
