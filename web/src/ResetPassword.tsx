// Lumixo web — recovery-link landing page (CSS-only — no framer-motion).
//
// Trigger: user clicked "Reset password" in email. Supabase redirects to
// `${SITE_URL}/reset-password#…&type=recovery`. AuthContext sets recoveryMode
// and appTree mounts this screen.

import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from './supabase';
import { LumixoCat } from './mascot/LumixoCat';
import './Auth.css';

interface Props {
  hasRecoverySession: boolean;
  onDone: () => void;
}

export function ResetPasswordScreen({ hasRecoverySession, onDone }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!hasRecoverySession) return;
    if (window.location.hash || window.location.pathname === '/reset-password') {
      window.history.replaceState(null, '', '/');
    }
  }, [hasRecoverySession]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setDone(true);
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
      <div className="auth-card glass auth-card-enter">
        <div className="auth-mascot" aria-hidden>
          <LumixoCat mood={done ? 'celebrating' : hasRecoverySession ? 'hiding' : 'sad'} size="lg" decorative />
        </div>
        <h1 className="auth-logo">Lumixo</h1>
        <p className="auth-tagline">Choose a new password</p>

        {!hasRecoverySession ? (
          <>
            <div className="auth-error" role="alert">
              This reset link is invalid or has expired. Request a new one from the sign-in screen.
            </div>
            <button type="button" onClick={onDone} className="auth-submit" style={{ marginTop: 16 }}>
              Back to sign in
            </button>
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
            <button type="submit" disabled={loading} className="auth-submit">
              {loading ? <span className="fh-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : 'Update password'}
            </button>
            <div className="auth-toggle">
              <a onClick={onDone}>Back to sign in</a>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
