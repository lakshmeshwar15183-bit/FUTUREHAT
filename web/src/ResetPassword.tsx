// Lumixo web — recovery-link landing page.
//
// Trigger: the user clicked "Reset password" in an email. Supabase redirects
// them to `${SITE_URL}/reset-password#access_token=…&refresh_token=…&type=recovery`.
// Because our client sets `detectSessionInUrl: true` on the web, the Supabase
// SDK reads that fragment on load, calls setSession() under the hood, and fires
// a PASSWORD_RECOVERY event on onAuthStateChange. Main.tsx catches that event
// (or the pathname) and mounts this screen so the user can actually pick a new
// password — the old build silently dropped them into the chat app instead.
//
// This screen calls updateUser({ password }), then signs the user out so any
// old refresh tokens are invalidated (Supabase-recommended pattern).
import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { supabase } from './supabase';
import { spring } from './motion';
import './Auth.css';

interface Props {
  /** True when we arrived via a PASSWORD_RECOVERY event OR the URL matched
   *  `/reset-password`. False → we render an "invalid link" state so users who
   *  bookmark or share the URL don't hit a live form with no recovery session. */
  hasRecoverySession: boolean;
  /** Called when the flow is done or the user aborts. Main.tsx uses it to
   *  clear its own `recoveryMode` flag and drop the user back on Auth. */
  onDone: () => void;
}

export function ResetPasswordScreen({ hasRecoverySession, onDone }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Strip the recovery fragment from the URL — but ONLY once the SDK has
  // installed a session, so we don't race the detectSessionInUrl handler that
  // reads the tokens on client creation. If the fragment is still there when
  // the user opens the site again (e.g. via history back), Supabase would
  // re-process an already-consumed token and hit the "already used" error.
  useEffect(() => {
    if (!hasRecoverySession) return;
    if (window.location.hash || window.location.pathname === '/reset-password') {
      window.history.replaceState(null, '', '/');
    }
  }, [hasRecoverySession]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setDone(true);
      // Force a fresh sign-in with the new password: invalidates any old
      // refresh tokens tied to the recovery session.
      await supabase.auth.signOut();
      setTimeout(() => onDone(), 900);
    } catch (err: any) {
      const msg = (err?.message ?? '').toLowerCase();
      if (msg.includes('expired') || msg.includes('invalid') || msg.includes('token')) {
        setError('This reset link has expired or already been used. Request a new one from the sign-in screen.');
      } else {
        setError(err?.message ?? 'Could not update password. Try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-aurora" aria-hidden />
      <motion.div
        className="auth-card glass"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={spring}
      >
        <h1 className="auth-logo">Lumixo</h1>
        <p className="auth-tagline">Choose a new password</p>

        {!hasRecoverySession ? (
          <>
            <div className="auth-error" role="alert">
              This reset link is invalid or has expired. Request a new one from the sign-in screen.
            </div>
            <motion.button
              whileTap={{ scale: 0.96 }}
              type="button"
              onClick={onDone}
              className="auth-submit"
              style={{ marginTop: 16 }}
            >
              Back to sign in
            </motion.button>
          </>
        ) : done ? (
          <div className="auth-error" role="status" style={{ background: 'rgba(0, 168, 132, 0.15)', color: 'inherit' }}>
            Password updated. Sign in with your new password.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <input
              type="password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              disabled={loading}
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              disabled={loading}
            />
            {error && (
              <div className="auth-error" role="alert">{error}</div>
            )}
            <motion.button whileTap={{ scale: 0.96 }} type="submit" disabled={loading} className="auth-submit">
              {loading ? <span className="fh-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : 'Update password'}
            </motion.button>
            <div className="auth-toggle">
              <a onClick={onDone}>Back to sign in</a>
            </div>
          </form>
        )}
      </motion.div>

      <div className="auth-footer">Developed by LAKSHMESHWAR PANDEY</div>
    </div>
  );
}
