// Lumixo mobile — read device contacts locally for discovery.
// Never uploads the raw list: callers hash phones via contactDiscoveryApi.

import type { LocalContactEntry } from './shared';

export type ContactsPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

function loadContactsModule(): typeof import('expo-contacts') | null {
  try {
    // Native module — present after a rebuild with expo-contacts plugin.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-contacts') as typeof import('expo-contacts');
  } catch {
    return null;
  }
}

/** Request contacts permission (or report unavailable if native module missing). */
export async function requestContactsPermission(): Promise<ContactsPermission> {
  const Contacts = loadContactsModule();
  if (!Contacts) return 'unavailable';
  const current = await Contacts.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (current.canAskAgain === false && current.status === 'denied') return 'denied';
  const next = await Contacts.requestPermissionsAsync();
  if (next.granted) return 'granted';
  return next.status === 'undetermined' ? 'undetermined' : 'denied';
}

/**
 * Read contacts from the device address book.
 * Returns empty array if permission denied or module unavailable.
 */
export async function readLocalContactEntries(): Promise<{
  entries: LocalContactEntry[];
  permission: ContactsPermission;
  error: Error | null;
}> {
  const Contacts = loadContactsModule();
  if (!Contacts) {
    return {
      entries: [],
      permission: 'unavailable',
      error: new Error('Contacts are not available on this build. Update the app to find friends by phone.'),
    };
  }

  const perm = await requestContactsPermission();
  if (perm !== 'granted') {
    return {
      entries: [],
      permission: perm,
      error:
        perm === 'denied'
          ? new Error('Contacts permission is off. Enable it in Settings to find friends on Lumixo.')
          : null,
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
    return { entries, permission: 'granted', error: null };
  } catch (e: any) {
    return {
      entries: [],
      permission: 'granted',
      error: new Error(e?.message || 'Could not read contacts.'),
    };
  }
}
