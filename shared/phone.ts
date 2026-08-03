// Lumixo — phone normalization + discovery hashing.
// Phone is optional and used only for contact discovery / future recovery.
// Raw numbers never leave the device during discovery — only SHA-256 hashes.

/** Public salt version — MUST match SQL phone_discovery_hash(). */
export const PHONE_HASH_PREFIX = 'lumixo-phone-v1:';

const E164_RE = /^\+[1-9][0-9]{7,14}$/;

/** Default country for national numbers without a + prefix (India — Lumixo market). */
export type DefaultCountry = 'IN' | 'US' | 'GB' | 'AE' | 'SG' | 'NONE';

const COUNTRY_DIAL: Record<Exclude<DefaultCountry, 'NONE'>, string> = {
  IN: '91',
  US: '1',
  GB: '44',
  AE: '971',
  SG: '65',
};

/** True when value is already valid E.164. */
export function isValidE164(value: string | null | undefined): boolean {
  return !!value && E164_RE.test(value);
}

/**
 * Normalize a free-form phone string to E.164, or null if invalid.
 * - Strips spaces, dashes, parentheses
 * - Accepts leading 00 as international prefix
 * - National numbers use defaultCountry dial code
 */
export function normalizeToE164(
  raw: string | null | undefined,
  defaultCountry: DefaultCountry = 'IN',
): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Keep leading +; drop other non-digits.
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;

  if (s.startsWith('+')) {
    const digits = s.slice(1).replace(/\D/g, '');
    if (!digits || digits[0] === '0') return null;
    const e164 = `+${digits}`;
    return isValidE164(e164) ? e164 : null;
  }

  let digits = s.replace(/\D/g, '');
  if (!digits) return null;

  // National trunk prefix 0 (common in IN/GB/…)
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');

  if (defaultCountry === 'NONE') {
    // Require explicit country — cannot invent one.
    return null;
  }

  const dial = COUNTRY_DIAL[defaultCountry];
  // Already includes dial code without +
  if (digits.startsWith(dial) && digits.length >= dial.length + 7) {
    const e164 = `+${digits}`;
    return isValidE164(e164) ? e164 : null;
  }

  // India: 10-digit mobile starting 6–9
  if (defaultCountry === 'IN' && /^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }
  // US/CA: 10-digit NANP
  if (defaultCountry === 'US' && /^[2-9]\d{9}$/.test(digits)) {
    return `+1${digits}`;
  }

  const e164 = `+${dial}${digits}`;
  return isValidE164(e164) ? e164 : null;
}

/** SHA-256 hex. Works in browser, RN (crypto.subtle), and Node. */
export async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof TextEncoder !== 'undefined') {
    const data = new TextEncoder().encode(input);
    const buf = await subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Node / Jest fallback
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto') as typeof import('crypto');
    return nodeCrypto.createHash('sha256').update(input, 'utf8').digest('hex');
  } catch {
    throw new Error('SHA-256 not available in this environment');
  }
}

/** Discovery hash for one E.164 number (matches SQL phone_discovery_hash). */
export async function phoneDiscoveryHash(e164: string): Promise<string> {
  if (!isValidE164(e164)) {
    throw new Error('invalid_phone_e164');
  }
  return sha256Hex(`${PHONE_HASH_PREFIX}${e164}`);
}

/** Normalize many contact numbers → unique valid E.164 list. */
export function normalizeContactPhones(
  rawList: Array<string | null | undefined>,
  defaultCountry: DefaultCountry = 'IN',
): string[] {
  const out = new Set<string>();
  for (const raw of rawList) {
    const e = normalizeToE164(raw, defaultCountry);
    if (e) out.add(e);
  }
  return [...out];
}

/** Hash a batch of E.164 numbers for discover_contacts RPC. */
export async function hashPhonesForDiscovery(e164List: string[]): Promise<string[]> {
  const hashes = await Promise.all(
    e164List.filter(isValidE164).map((e) => phoneDiscoveryHash(e)),
  );
  return [...new Set(hashes)];
}

/** Mask E.164 for UI: +91•••••3210 */
export function maskPhoneE164(e164: string | null | undefined): string {
  if (!e164 || !isValidE164(e164)) return '';
  const digits = e164.slice(1);
  if (digits.length <= 4) return e164;
  const last4 = digits.slice(-4);
  const ccLen = Math.min(3, Math.max(1, digits.length - 7));
  const cc = digits.slice(0, ccLen);
  return `+${cc}${'•'.repeat(Math.max(4, digits.length - ccLen - 4))}${last4}`;
}
