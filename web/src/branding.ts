// Lumixo — product branding for settings, about, help. Not shown inside chats.

export const APP_NAME = 'Lumixo';
export const APP_VERSION = '4.6.3';

/** Public support contact — all Help & Support surfaces. */
export const SUPPORT_EMAIL = 'supportlumixo@gmail.com';

/** Team label for grievance / legal notices (no personal names). */
export const GRIEVANCE_TEAM = 'Lumixo Grievance Team';

/** Public product credit. */
export const CREDIT = '© Lumixo. All rights reserved.';
export const CREDIT_ALT = 'Built with ❤️ by Team Lumixo.';

/**
 * Internal owner for admin tooling only — never show in Help & Support UI.
 */
export const OWNER = 'LAKSHMESHWAR PANDEY';

/** @deprecated use GRIEVANCE_TEAM */
export const GRIEVANCE_OFFICER = GRIEVANCE_TEAM;

export function supportMailto(
  subject = 'Lumixo Support Request',
  body = '',
): string {
  const q = new URLSearchParams();
  q.set('subject', subject);
  if (body) q.set('body', body);
  return `mailto:${SUPPORT_EMAIL}?${q.toString()}`;
}
