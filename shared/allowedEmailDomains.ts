// Lumixo — BETA-ONLY email provider allowlist.
// While in beta, signups are restricted to well-known trusted providers to
// reduce spam / fake accounts. Server migration 0068 mirrors this list for
// hard enforcement (clients cannot bypass it).
//
// TEMPORARY: when beta ends, remove the isAllowedEmailDomain() checks in
// authApi.ts / accountApi.ts and run the rollback noted in migration 0068.
// The disposable-email block (disposableEmail.ts / 0066) stays either way.
//
// To add or remove a provider, edit ONLY this file and the seed list in the
// server migration — no other code changes needed.

import { emailDomain } from './disposableEmail.js';

/** Trusted providers accepted during beta. Exact, lowercase domains. */
export const ALLOWED_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  'gmail.com',
  'googlemail.com',
  // Microsoft
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  // Apple
  'icloud.com',
  'me.com',
  'mac.com',
  // Yahoo
  'yahoo.com',
  'yahoo.co.in',
  'ymail.com',
  // Proton
  'proton.me',
  'protonmail.com',
  // Zoho
  'zoho.com',
  'zohomail.com',
  // AOL
  'aol.com',
  // GMX
  'gmx.com',
  'gmx.net',
  // Mail.com
  'mail.com',
  // Fastmail
  'fastmail.com',
  'fastmail.fm',
  // Tuta
  'tuta.com',
  'tutanota.com',
  // Yandex
  'yandex.com',
  'yandex.ru',
  // Mail.ru
  'mail.ru',
  // Tencent
  'qq.com',
  // NetEase
  '163.com',
  '126.com',
  // Naver
  'naver.com',
  // India ISPs / portals
  'rediffmail.com',
  'indiatimes.com',
  // UK / North America ISPs
  'btinternet.com',
  'comcast.net',
  'verizon.net',
  'att.net',
  'cox.net',
  'charter.net',
  'bellsouth.net',
  'shaw.ca',
  'rogers.com',
  'telus.net',
  'virginmedia.com',
]);

/**
 * True when the email's domain is on the beta allowlist.
 * Trims whitespace and matches case-insensitively (via emailDomain()).
 * Exact-match only — subdomains of allowed hosts (e.g. evil.gmail.com) fail.
 */
export function isAllowedEmailDomain(email: string): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  return ALLOWED_EMAIL_DOMAINS.has(domain);
}

/** User-facing copy when a domain is outside the beta allowlist. */
export const UNSUPPORTED_EMAIL_DOMAIN_MESSAGE =
  '🚀 Lumixo is currently in beta. Please sign up using a supported email provider.';
