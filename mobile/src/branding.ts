// Lumixo mobile — app branding (settings, about, help). Never shown in chat threads.
export const APP_NAME = 'Lumixo';
export const APP_VERSION = '4.6.3';

/** Public support contact — use for all Help & Support surfaces. */
export const SUPPORT_EMAIL = 'supportlumixo@gmail.com';

/** Team label for grievance / legal notices (no personal names). */
export const GRIEVANCE_TEAM = 'Lumixo Grievance Team';

/** Public product credit (Help, Settings About, legal footers). */
export const CREDIT = '© Lumixo. All rights reserved.';
export const CREDIT_ALT = 'Built with ❤️ by Team Lumixo.';

/**
 * Internal owner string for developer override / admin tooling only.
 * Do not surface in Help & Support or customer-facing footers.
 */
export const OWNER = 'LAKSHMESHWAR PANDEY';

/** @deprecated use GRIEVANCE_TEAM */
export const GRIEVANCE_OFFICER = GRIEVANCE_TEAM;

/** Pre-filled mailto for support contact. */
export function supportMailto(
  subject = 'Lumixo Support Request',
  body = '',
): string {
  const q = new URLSearchParams();
  q.set('subject', subject);
  if (body) q.set('body', body);
  return `mailto:${SUPPORT_EMAIL}?${q.toString()}`;
}
