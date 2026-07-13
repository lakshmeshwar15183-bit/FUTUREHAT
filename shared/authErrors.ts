// Lumixo — map auth/backend errors to friendly user-facing copy.
// Never surface raw PostgREST/Supabase platform dumps in the UI.

const PLATFORM_NOISE =
  /edge function|non-2xx|functions\.invoke|jwt expired|row-level security|violates|postgres|postgrest|pgrst|http\/|stack trace|supabase\.co|failed to fetch|network request failed/i;

/** Map known auth error codes / messages to short user copy. */
export function friendlyAuthError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback;

  const any = err as {
    message?: string;
    code?: string;
    status?: number;
    name?: string;
    error_description?: string;
  };

  const code = String(any?.code ?? '').toLowerCase();
  const raw = String(any?.message || any?.error_description || '').trim();
  const lower = raw.toLowerCase();

  // Explicit app / SQL exception codes
  if (code === 'invalid_phone_e164' || /invalid_phone_e164/.test(lower)) {
    return 'Enter a valid phone number with country code (for example +919876543210).';
  }
  if (code === 'phone_taken' || /phone_taken|duplicate key.*phone/.test(lower)) {
    return 'That phone number is already linked to another Lumixo account.';
  }
  if (code === 'rate_limited' || /rate_limited|too many requests|429/.test(lower)) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (code === 'not_authenticated' || /not_authenticated|jwt|session/.test(lower) && /expired|missing|invalid/.test(lower)) {
    return 'Please sign in again to continue.';
  }

  // Supabase / GoTrue common codes
  if (
    code === 'invalid_credentials' ||
    /invalid login credentials|invalid email or password|wrong password/.test(lower)
  ) {
    return 'Wrong email or password.';
  }
  if (code === 'email_not_confirmed' || /email not confirmed|confirm your email/.test(lower)) {
    return 'Please verify your email before signing in. Check your inbox for the link.';
  }
  if (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    /already registered|user already exists|already been registered/.test(lower)
  ) {
    return 'An account with this email already exists. Sign in or reset your password.';
  }
  if (code === 'weak_password' || /password.*weak|at least \d+ character/.test(lower)) {
    return 'Password is too weak. Use at least 8 characters.';
  }
  if (code === 'over_email_send_rate_limit' || /email rate limit|over_email/.test(lower)) {
    return 'Too many emails sent. Please wait a few minutes and try again.';
  }
  if (code === 'same_password' || /same password|different from the old/.test(lower)) {
    return 'Choose a password you have not used recently.';
  }
  if (/user not found|no user found/.test(lower)) {
    // Avoid account enumeration on reset — still friendly.
    return 'If an account exists for that email, you will receive a reset link shortly.';
  }
  if (/network|offline|failed to fetch|timeout|timed out/.test(lower)) {
    return 'Network error. Check your connection and try again.';
  }
  if (/otp|sms|phone.*otp|sign.?in with otp/.test(lower)) {
    return 'SMS verification is not used. Sign in with email and password.';
  }

  // Safe short message without platform noise
  if (raw && raw.length <= 160 && !PLATFORM_NOISE.test(raw)) {
    return raw;
  }

  return fallback;
}

export function isOfflineError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? '').toLowerCase();
  return /network|offline|failed to fetch|timeout|timed out|network request failed/.test(msg);
}

/** Validate email format (client-side, not a substitute for server checks). */
export function isValidEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  // Practical RFC 5322-ish; rejects obvious junk
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
}

/** Password policy for Lumixo accounts. */
export function validatePassword(password: string): { ok: true } | { ok: false; message: string } {
  if (!password || password.length < 8) {
    return { ok: false, message: 'Password must be at least 8 characters.' };
  }
  if (password.length > 128) {
    return { ok: false, message: 'Password is too long.' };
  }
  return { ok: true };
}

export function validateDisplayName(name: string): { ok: true } | { ok: false; message: string } {
  const n = name.trim();
  if (n.length < 1) return { ok: false, message: 'Please enter a display name.' };
  if (n.length > 64) return { ok: false, message: 'Display name is too long (max 64 characters).' };
  return { ok: true };
}
