// Lumixo web — Auth screen with interactive mascot + motion.

import { useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { signInWithEmail, signUpWithEmail } from '@shared/api';
import { supabase } from './supabase';
import { Mascot } from './Mascot';
import { spring, quick } from './motion';
import './Auth.css';

// Where we tell Supabase to send the user after they click the reset-password
// link. MUST match one of the entries in Supabase → Auth → URL Configuration →
// Additional Redirect URLs, otherwise the auth server silently downgrades to
// the project's Site URL (and the "reset link opens the wrong page" bug is back).
// VITE_SITE_URL overrides `window.location.origin` for cases where the app is
// hosted behind a proxy that reports a different origin than the public domain.
function resetRedirectUrl(): string {
  const base = (import.meta as any).env?.VITE_SITE_URL || window.location.origin;
  return `${String(base).replace(/\/+$/, '')}/reset-password`;
}

export function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [happy, setHappy] = useState(false);

  const gaze = Math.min(1, email.length / 24);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error: err } = await signUpWithEmail(supabase, email, password, displayName);
        if (err) throw err;
        setHappy(true);
        setTimeout(() => {
          alert('Account created! Sign in to continue.');
          setMode('signin');
          setHappy(false);
        }, 700);
      } else if (mode === 'forgot') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: resetRedirectUrl(),
        });
        if (err) throw err;
        setNotice("Password reset link sent. Check your email and click the link to continue.");
        setMode('signin');
      } else {
        const { error: err } = await signInWithEmail(supabase, email, password);
        if (err) throw err;
        setHappy(true);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
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
        <div className="auth-mascot">
          <Mascot gaze={gaze} coverEyes={pwFocused} happy={happy} />
        </div>
        <h1 className="auth-logo">Lumixo</h1>
        <p className="auth-tagline">Real-time messaging, reimagined</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <AnimatePresence initial={false} mode="popLayout">
            {mode === 'signup' && (
              <motion.input
                key="name"
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 48 }}
                exit={{ opacity: 0, height: 0 }}
                transition={quick}
                type="text"
                placeholder="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                disabled={loading}
              />
            )}
          </AnimatePresence>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => setPwFocused(false)}
            required
            disabled={loading}
          />
          {mode !== 'forgot' && (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setPwFocused(true)}
              onBlur={() => setPwFocused(false)}
              required
              minLength={6}
              disabled={loading}
            />
          )}
          <AnimatePresence>
            {error && (
              <motion.div
                key="err"
                className="auth-error"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {error}
              </motion.div>
            )}
            {notice && (
              <motion.div
                key="ntc"
                className="auth-error"
                style={{ background: 'rgba(0, 168, 132, 0.15)', color: 'inherit' }}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {notice}
              </motion.div>
            )}
          </AnimatePresence>
          <motion.button whileTap={{ scale: 0.96 }} type="submit" disabled={loading} className="auth-submit">
            {loading ? (
              <span className="fh-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
            ) : mode === 'signin' ? 'Sign In'
              : mode === 'signup' ? 'Create account'
              : 'Send reset link'}
          </motion.button>
        </form>

        <div className="auth-toggle">
          {mode === 'signin' && (
            <>
              <a onClick={() => { setError(''); setNotice(''); setMode('forgot'); }}>Forgot password?</a>
              <span style={{ margin: '0 8px', opacity: 0.5 }}>·</span>
              New here? <a onClick={() => { setError(''); setNotice(''); setMode('signup'); }}>Create an account</a>
            </>
          )}
          {mode === 'signup' && (
            <>Already have an account? <a onClick={() => { setError(''); setNotice(''); setMode('signin'); }}>Sign in</a></>
          )}
          {mode === 'forgot' && (
            <>Remembered it? <a onClick={() => { setError(''); setNotice(''); setMode('signin'); }}>Back to sign in</a></>
          )}
        </div>
      </motion.div>

      <div className="auth-footer">Developed by LAKSHMESHWAR PANDEY</div>
    </div>
  );
}
