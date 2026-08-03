/**
 * Unit tests for production auth/account helpers:
 * phone E.164 + discovery hash, friendly auth errors, validation.
 */
import {
  normalizeToE164,
  isValidE164,
  phoneDiscoveryHash,
  hashPhonesForDiscovery,
  maskPhoneE164,
  PHONE_HASH_PREFIX,
} from '../../../../shared/phone';
import {
  friendlyAuthError,
  isValidEmail,
  validatePassword,
  validateDisplayName,
} from '../../../../shared/authErrors';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

describe('phone E.164 normalization', () => {
  it('accepts valid E.164', () => {
    expect(isValidE164('+919876543210')).toBe(true);
    expect(isValidE164('+14155552671')).toBe(true);
    expect(isValidE164('9876543210')).toBe(false);
    expect(isValidE164('+0123')).toBe(false);
  });

  it('normalizes India national numbers', () => {
    expect(normalizeToE164('9876543210', 'IN')).toBe('+919876543210');
    expect(normalizeToE164('09876543210', 'IN')).toBe('+919876543210');
    expect(normalizeToE164('+91 98765 43210', 'IN')).toBe('+919876543210');
    expect(normalizeToE164('00919876543210', 'IN')).toBe('+919876543210');
  });

  it('rejects garbage', () => {
    expect(normalizeToE164('abc', 'IN')).toBeNull();
    expect(normalizeToE164('123', 'IN')).toBeNull();
    expect(normalizeToE164('', 'IN')).toBeNull();
  });

  it('masks phone for UI without full reveal', () => {
    const m = maskPhoneE164('+919876543210');
    expect(m.startsWith('+')).toBe(true);
    expect(m.includes('3210')).toBe(true);
    expect(m.includes('987654')).toBe(false);
  });
});

describe('phone discovery hash', () => {
  it('matches SQL algorithm: sha256(lumixo-phone-v1:E164)', async () => {
    const e164 = '+919876543210';
    const expected = createHash('sha256')
      .update(`${PHONE_HASH_PREFIX}${e164}`, 'utf8')
      .digest('hex');
    const got = await phoneDiscoveryHash(e164);
    expect(got).toBe(expected);
    expect(got).toMatch(/^[0-9a-f]{64}$/);
  });

  it('dedupes batch hashes', async () => {
    const hashes = await hashPhonesForDiscovery(['+919876543210', '+919876543210']);
    expect(hashes).toHaveLength(1);
  });
});

describe('friendly auth errors', () => {
  it('maps invalid credentials', () => {
    expect(friendlyAuthError({ message: 'Invalid login credentials' })).toMatch(/Wrong email or password/i);
  });
  it('maps email not confirmed', () => {
    expect(friendlyAuthError({ message: 'Email not confirmed' })).toMatch(/verify your email/i);
  });
  it('maps already registered', () => {
    expect(friendlyAuthError({ message: 'User already registered' })).toMatch(/already exists/i);
  });
  it('maps phone taken', () => {
    expect(friendlyAuthError({ message: 'phone_taken' })).toMatch(/already linked/i);
  });
  it('maps rate limit', () => {
    expect(friendlyAuthError({ message: 'rate_limited' })).toMatch(/Too many/i);
  });
  it('never surfaces platform noise', () => {
    const msg = friendlyAuthError({ message: 'Edge Function returned a non-2xx status code' });
    expect(msg).not.toMatch(/non-2xx/i);
  });
});

describe('validation', () => {
  it('validates email', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('bad')).toBe(false);
  });
  it('password min 8', () => {
    expect(validatePassword('short').ok).toBe(false);
    expect(validatePassword('longenough').ok).toBe(true);
  });
  it('display name required', () => {
    expect(validateDisplayName('  ').ok).toBe(false);
    expect(validateDisplayName('Ada').ok).toBe(true);
  });
});

describe('migration 0058', () => {
  const mig = fs.readFileSync(
    path.join(__dirname, '../../../../supabase/migrations/0058_auth_account_system.sql'),
    'utf8',
  );

  it('defines phone_e164, phone_hash, discovery, logout_all, set_my_phone', () => {
    expect(mig).toMatch(/phone_e164/);
    expect(mig).toMatch(/phone_hash/);
    expect(mig).toMatch(/phone_discovery_hash/);
    expect(mig).toMatch(/discover_contacts/);
    expect(mig).toMatch(/set_my_phone/);
    expect(mig).toMatch(/logout_all_devices/);
    expect(mig).toMatch(/get_my_account/);
    expect(mig).toMatch(/lumixo-phone-v1:/);
  });

  it('keeps public_profiles free of phone columns', () => {
    // The public_profiles view body should not select phone
    const viewMatch = mig.match(/create or replace view public\.public_profiles[\s\S]*?grant select/i);
    expect(viewMatch).toBeTruthy();
    expect(viewMatch![0]).not.toMatch(/\bphone_e164\b/);
    expect(viewMatch![0]).not.toMatch(/\bphone_hash\b/);
    expect(viewMatch![0]).not.toMatch(/\bphone\b/);
  });

  it('does not introduce SMS OTP auth paths', () => {
    expect(mig).not.toMatch(/sign_in_with_otp|phone_otp|sms_otp|verify_otp/i);
    expect(mig).toMatch(/no SMS OTP/);
  });
});
