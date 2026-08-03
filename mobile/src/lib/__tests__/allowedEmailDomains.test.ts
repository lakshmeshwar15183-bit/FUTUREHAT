/**
 * Beta email-provider allowlist — shared/allowedEmailDomains.ts (0068 migration).
 * Client mirror of the auth.users trigger gate.
 */
import {
  ALLOWED_EMAIL_DOMAINS,
  UNSUPPORTED_EMAIL_DOMAIN_MESSAGE,
  isAllowedEmailDomain,
} from '../../../../shared/allowedEmailDomains';
import { friendlyAuthError } from '../../../../shared/authErrors';

describe('beta email allowlist', () => {
  test('every approved provider passes', () => {
    for (const domain of ALLOWED_EMAIL_DOMAINS) {
      expect(isAllowedEmailDomain(`user@${domain}`)).toBe(true);
    }
    // Spot-check the exact list from the spec is present.
    for (const domain of [
      'gmail.com', 'googlemail.com',
      'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
      'icloud.com', 'me.com', 'mac.com',
      'yahoo.com', 'yahoo.co.in', 'ymail.com',
      'proton.me', 'protonmail.com',
      'zoho.com', 'zohomail.com',
      'aol.com',
      'gmx.com', 'gmx.net',
      'mail.com',
      'fastmail.com', 'fastmail.fm',
      'tuta.com', 'tutanota.com',
      'yandex.com', 'yandex.ru',
      'mail.ru',
      'qq.com',
      '163.com', '126.com',
      'naver.com',
      'rediffmail.com', 'indiatimes.com',
      'btinternet.com',
      'comcast.net', 'verizon.net', 'att.net', 'cox.net', 'charter.net',
      'bellsouth.net', 'shaw.ca', 'rogers.com', 'telus.net', 'virginmedia.com',
    ]) {
      expect(ALLOWED_EMAIL_DOMAINS.has(domain)).toBe(true);
    }
  });

  test('unsupported domains are rejected', () => {
    for (const email of [
      'user@company.com',
      'user@university.edu',
      'user@custom-domain.io',
      'user@gmail.co',        // lookalike
      'user@outlook.in',      // regional variant not on the list
      'user@mailinator.com',  // disposable
    ]) {
      expect(isAllowedEmailDomain(email)).toBe(false);
    }
  });

  test('case-insensitive matching', () => {
    expect(isAllowedEmailDomain('User@GMAIL.COM')).toBe(true);
    expect(isAllowedEmailDomain('me@Outlook.Com')).toBe(true);
    expect(isAllowedEmailDomain('X@YAHOO.CO.IN')).toBe(true);
  });

  test('leading/trailing whitespace is ignored', () => {
    expect(isAllowedEmailDomain('  user@gmail.com  ')).toBe(true);
    expect(isAllowedEmailDomain('\tuser@icloud.com\n')).toBe(true);
    expect(isAllowedEmailDomain('  user@notallowed.com  ')).toBe(false);
  });

  test('subdomains of allowed hosts do NOT pass (exact match only)', () => {
    expect(isAllowedEmailDomain('user@mail.gmail.com')).toBe(false);
    expect(isAllowedEmailDomain('user@evil.outlook.com')).toBe(false);
  });

  test('malformed emails are rejected', () => {
    for (const email of ['', 'no-at-sign', '@gmail.com', 'user@', 'user@gmail']) {
      expect(isAllowedEmailDomain(email)).toBe(false);
    }
  });

  test('server error code maps to the beta message', () => {
    expect(friendlyAuthError({ code: 'email_domain_not_allowed' })).toBe(
      UNSUPPORTED_EMAIL_DOMAIN_MESSAGE,
    );
    expect(friendlyAuthError(new Error('email_domain_not_allowed'))).toBe(
      UNSUPPORTED_EMAIL_DOMAIN_MESSAGE,
    );
  });

  test('beta message matches the spec copy', () => {
    expect(UNSUPPORTED_EMAIL_DOMAIN_MESSAGE).toBe(
      '🚀 Lumixo is currently in beta. Please sign up using a supported email provider.',
    );
  });
});
