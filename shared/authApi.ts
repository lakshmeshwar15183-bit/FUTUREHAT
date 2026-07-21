// Lumixo — production auth API (email primary, no SMS OTP).
// All money/chat/premium stays on auth.users.id (= profiles.id).
// Framework-agnostic: web + mobile import this module.

import type { SupabaseClient, User, Session } from '@supabase/supabase-js';
import {
  friendlyAuthError,
  isValidEmail,
  validatePassword,
  validateDisplayName,
} from './authErrors.js';
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from './disposableEmail.js';
import { isValidE164, normalizeToE164, type DefaultCountry } from './phone.js';

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  /** Optional phone (any free-form); normalized to E.164 before send. */
  phone?: string | null;
  defaultCountry?: DefaultCountry;
  /** Email redirect after confirm (web / deep link). */
  emailRedirectTo?: string;
}

export interface AuthResult {
  user: User | null;
  session: Session | null;
  error: Error | null;
  /** True when account created but email confirmation is required. */
  needsEmailVerification?: boolean;
}

function asError(err: unknown, fallback: string): Error {
  const msg = friendlyAuthError(err, fallback);
  const e = new Error(msg);
  const code = (err as { code?: string })?.code;
  if (code) (e as Error & { code?: string }).code = code;
  return e;
}

/** Register with email + password. Phone optional (E.164 via metadata → profile). */
export async function registerWithEmail(
  client: SupabaseClient,
  input: SignUpInput,
): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  if (!isValidEmail(email)) {
    return { user: null, session: null, error: new Error('Enter a valid email address.') };
  }
  // Free offline block: reject known temporary / disposable inboxes.
  if (isDisposableEmail(email)) {
    return { user: null, session: null, error: new Error(DISPOSABLE_EMAIL_MESSAGE) };
  }
  const nameCheck = validateDisplayName(input.displayName);
  if (!nameCheck.ok) {
    return { user: null, session: null, error: new Error(nameCheck.message) };
  }
  const pwCheck = validatePassword(input.password);
  if (!pwCheck.ok) {
    return { user: null, session: null, error: new Error(pwCheck.message) };
  }

  let phoneE164: string | null = null;
  if (input.phone && String(input.phone).trim()) {
    phoneE164 = normalizeToE164(input.phone, input.defaultCountry ?? 'IN');
    if (!phoneE164) {
      return {
        user: null,
        session: null,
        error: new Error('Enter a valid phone number with country code (for example +919876543210).'),
      };
    }
  }

  try {
    const { data, error } = await client.auth.signUp({
      email,
      password: input.password,
      options: {
        emailRedirectTo: input.emailRedirectTo,
        data: {
          display_name: input.displayName.trim(),
          ...(phoneE164 ? { phone_e164: phoneE164 } : {}),
        },
      },
    });
    if (error) {
      return { user: null, session: null, error: asError(error, 'Could not create account.') };
    }

    const user = data.user ?? null;
    const session = data.session ?? null;
    const needsEmailVerification = !!user && !session && !user.email_confirmed_at;

    // Best-effort security event when session is immediate (confirmations off).
    if (session?.user) {
      void client
        .from('security_events')
        .insert({ user_id: session.user.id, kind: 'login', user_agent: 'register' })
        .then(() => {}, () => {});
    }

    return { user, session, error: null, needsEmailVerification };
  } catch (e) {
    return { user: null, session: null, error: asError(e, 'Could not create account.') };
  }
}

/** Email + password sign-in. */
export async function loginWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<AuthResult> {
  const mail = email.trim().toLowerCase();
  if (!isValidEmail(mail)) {
    return { user: null, session: null, error: new Error('Enter a valid email address.') };
  }
  if (!password) {
    return { user: null, session: null, error: new Error('Password is required.') };
  }

  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: mail,
      password,
    });
    if (error) {
      return { user: null, session: null, error: asError(error, 'Could not sign in.') };
    }
    if (data.user?.id) {
      void client
        .from('security_events')
        .insert({ user_id: data.user.id, kind: 'login', user_agent: 'password' })
        .then(() => {}, () => {});
      // Ack any prior force-logout stamp so AdminGate does not bounce this
      // brand-new session (was causing "login twice" on mobile/web).
      void client
        .from('profiles')
        .select('force_logout_at')
        .eq('id', data.user.id)
        .maybeSingle()
        .then(({ data: row }) => {
          const stamp = (row as { force_logout_at?: string } | null)?.force_logout_at;
          if (!stamp) return;
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('fh:forceLogoutAck', stamp);
            }
          } catch { /* ignore */ }
          // Mobile AsyncStorage is not available in this shared module; AdminGate
          // also acks via decideForceLogout(ack_keep) on the new session.
        }, () => {});
    }
    return { user: data.user, session: data.session, error: null };
  } catch (e) {
    return { user: null, session: null, error: asError(e, 'Could not sign in.') };
  }
}

/**
 * Sign out this device (local) or all sessions (global).
 * Global also stamps force_logout_at so other Lumixo clients drop sessions.
 */
export async function logout(
  client: SupabaseClient,
  opts?: { allDevices?: boolean },
): Promise<{ error: Error | null }> {
  try {
    if (opts?.allDevices) {
      // Signal other devices first (force_logout_at + clear devices table).
      await client.rpc('logout_all_devices').then(() => {}, () => {});
      const { error } = await client.auth.signOut({ scope: 'global' });
      if (error) return { error: asError(error, 'Could not sign out everywhere.') };
      return { error: null };
    }
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) return { error: asError(error, 'Could not sign out.') };
    return { error: null };
  } catch (e) {
    return { error: asError(e, 'Could not sign out.') };
  }
}

/** Request password reset email. Always friendly; avoids account enumeration. */
export async function requestPasswordReset(
  client: SupabaseClient,
  email: string,
  redirectTo: string,
): Promise<{ error: Error | null }> {
  const mail = email.trim().toLowerCase();
  if (!isValidEmail(mail)) {
    return { error: new Error('Enter a valid email address.') };
  }
  if (!redirectTo) {
    return { error: new Error('Password reset is not configured on this build.') };
  }
  try {
    const { error } = await client.auth.resetPasswordForEmail(mail, { redirectTo });
    if (error) return { error: asError(error, 'Could not send reset email.') };
    return { error: null };
  } catch (e) {
    return { error: asError(e, 'Could not send reset email.') };
  }
}

/** Complete password update after recovery session is installed. */
export async function completePasswordReset(
  client: SupabaseClient,
  newPassword: string,
): Promise<{ error: Error | null }> {
  const pw = validatePassword(newPassword);
  if (!pw.ok) return { error: new Error(pw.message) };
  try {
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) return { error: asError(error, 'Could not update password.') };
    const { data: u } = await client.auth.getUser();
    if (u?.user?.id) {
      void client
        .from('security_events')
        .insert({ user_id: u.user.id, kind: 'password_change' })
        .then(() => {}, () => {});
    }
    // Invalidate other sessions after password change.
    await client.rpc('logout_all_devices').then(() => {}, () => {});
    return { error: null };
  } catch (e) {
    return { error: asError(e, 'Could not update password.') };
  }
}

/** Load own account snapshot (email, phone_e164, profile fields). */
export async function getMyAccount(client: SupabaseClient): Promise<{
  account: {
    id: string;
    email: string | null;
    email_confirmed: boolean;
    display_name: string | null;
    username: string | null;
    about: string | null;
    avatar_url: string | null;
    phone_e164: string | null;
    has_phone: boolean;
    created_at?: string;
    last_seen?: string;
  } | null;
  error: Error | null;
}> {
  try {
    const { data, error } = await client.rpc('get_my_account');
    if (error) {
      // Fallback for DBs before 0058
      const { data: sess } = await client.auth.getSession();
      const user = sess.session?.user;
      if (!user) return { account: null, error: asError(error, 'Could not load account.') };
      const { data: prof } = await client
        .from('profiles')
        .select('id, display_name, username, about, avatar_url, phone, last_seen, created_at')
        .eq('id', user.id)
        .maybeSingle();
      return {
        account: {
          id: user.id,
          email: user.email ?? null,
          email_confirmed: !!user.email_confirmed_at,
          display_name: prof?.display_name ?? null,
          username: prof?.username ?? null,
          about: prof?.about ?? null,
          avatar_url: prof?.avatar_url ?? null,
          phone_e164: (prof as { phone?: string })?.phone ?? null,
          has_phone: !!(prof as { phone?: string })?.phone,
          created_at: prof?.created_at,
          last_seen: prof?.last_seen,
        },
        error: null,
      };
    }
    return { account: data as any, error: null };
  } catch (e) {
    return { account: null, error: asError(e, 'Could not load account.') };
  }
}

/** Set or clear own phone (E.164). Discovery hash computed server-side. */
export async function setMyPhone(
  client: SupabaseClient,
  phone: string | null,
  defaultCountry: DefaultCountry = 'IN',
): Promise<{ phoneE164: string | null; error: Error | null }> {
  try {
    let e164: string | null = null;
    if (phone && String(phone).trim()) {
      e164 = normalizeToE164(phone, defaultCountry);
      if (!e164 || !isValidE164(e164)) {
        return {
          phoneE164: null,
          error: new Error('Enter a valid phone number with country code (for example +919876543210).'),
        };
      }
    }

    const { data, error } = await client.rpc('set_my_phone', { p_phone: e164 });
    if (error) {
      // Fallback: direct update (trigger hashes if 0058 applied partially)
      const { data: sess } = await client.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid) return { phoneE164: null, error: asError(error, 'Could not update phone.') };
      const { error: upErr } = await client
        .from('profiles')
        .update({ phone: e164, phone_e164: e164 })
        .eq('id', uid);
      if (upErr) return { phoneE164: null, error: asError(upErr, 'Could not update phone.') };
      return { phoneE164: e164, error: null };
    }
    const phoneOut = (data as { phone_e164?: string | null })?.phone_e164 ?? e164;
    return { phoneE164: phoneOut ?? null, error: null };
  } catch (e) {
    return { phoneE164: null, error: asError(e, 'Could not update phone.') };
  }
}

/** Update display name / about / avatar after signup (complete profile). */
export async function completeProfile(
  client: SupabaseClient,
  updates: {
    displayName?: string;
    about?: string;
    avatarUrl?: string | null;
    username?: string;
    phone?: string | null;
    defaultCountry?: DefaultCountry;
  },
): Promise<{ error: Error | null }> {
  try {
    const { data: sess } = await client.auth.getSession();
    const uid = sess.session?.user?.id;
    if (!uid) return { error: new Error('Please sign in again to continue.') };

    const patch: Record<string, unknown> = {};
    if (updates.displayName !== undefined) {
      const c = validateDisplayName(updates.displayName);
      if (!c.ok) return { error: new Error(c.message) };
      patch.display_name = updates.displayName.trim();
    }
    if (updates.about !== undefined) patch.about = updates.about;
    if (updates.avatarUrl !== undefined) patch.avatar_url = updates.avatarUrl;
    if (updates.username !== undefined) {
      const u = updates.username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (u.length > 0 && u.length < 3) {
        return { error: new Error('Username must be at least 3 characters.') };
      }
      if (u) patch.username = u;
    }

    if (Object.keys(patch).length) {
      const { error } = await client.from('profiles').update(patch).eq('id', uid);
      if (error) return { error: asError(error, 'Could not update profile.') };
    }

    if (updates.phone !== undefined) {
      const { error } = await setMyPhone(client, updates.phone, updates.defaultCountry ?? 'IN');
      if (error) return { error };
    }

    return { error: null };
  } catch (e) {
    return { error: asError(e, 'Could not update profile.') };
  }
}

/** Resend signup confirmation email. */
export async function resendVerificationEmail(
  client: SupabaseClient,
  email: string,
  emailRedirectTo?: string,
): Promise<{ error: Error | null }> {
  const mail = email.trim().toLowerCase();
  if (!isValidEmail(mail)) return { error: new Error('Enter a valid email address.') };
  try {
    const { error } = await client.auth.resend({
      type: 'signup',
      email: mail,
      options: emailRedirectTo ? { emailRedirectTo } : undefined,
    });
    if (error) return { error: asError(error, 'Could not resend verification email.') };
    return { error: null };
  } catch (e) {
    return { error: asError(e, 'Could not resend verification email.') };
  }
}
