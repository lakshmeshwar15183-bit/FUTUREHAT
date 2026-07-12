// Lumixo web — Auth screen with interactive mascot (CSS-only — no framer-motion).

import { useState, type FormEvent } from 'react';
import { signInWithEmail, signUpWithEmail } from '@shared/api';
import { supabase } from './supabase';
import { Mascot } from './Mascot';
import './Auth.css';

// Where we tell Supabase to send the user after they click the reset-password
// link. MUST match Supabase Auth redirect allow-list.
function resetRedirectUrl(): string {
  const envSite = (import.meta as any).env?.VITE_SITE_URL as string | undefined;
  let base = envSite?.replace(/\/+$/, '') || '';
  if (!base) {
    const origin = window.location.origin;
    const isLocal = /localhost|127\.0\.0\.1/.test(origin);
    if (isLocal) {
      base = 'https://futurehat-app.netlify.app';
      console.warn('[auth] VITE_SITE_URL unset on localhost — using production site for reset redirect');
    } else {
      base = origin.replace(/\/+$/, '');
    }
  }
  return `${base}/reset-password`;
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
        setNotice('Password reset link sent. Check your email and click the link to continue.');
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
      <div className="auth-card glass auth-card-enter">
        <div className="auth-mascot">
          <Mascot gaze={gaze} coverEyes={pwFocused} happy={happy} />
        </div>
        <h1 className="auth-logo">Lumixo</h1>
        <p className="auth-tagline">Real-time messaging, reimagined</p>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              disabled={loading}
            />
          )}
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
          {error && <div className="auth-error">{error}</div>}
          {notice && (
            <div className="auth-error" style={{ background: 'rgba(0, 168, 132, 0.15)', color: 'inherit' }}>
              {notice}
            </div>
          )}
          <button type="submit" disabled={loading} className="auth-submit">
            {loading ? (
              <span className="fh-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
            ) : mode === 'signin' ? (
              'Sign In'
            ) : mode === 'signup' ? (
              'Create account'
            ) : (
              'Send reset link'
            )}
          </button>
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
            <>
              Already have an account?{' '}
              <a onClick={() => { setError(''); setNotice(''); setMode('signin'); }}>Sign in</a>
            </>
          )}
          {mode === 'forgot' && (
            <>
              Remembered it?{' '}
              <a onClick={() => { setError(''); setNotice(''); setMode('signin'); }}>Back to sign in</a>
            </>
          )}
        </div>
      </div>

      <div className="auth-footer">Developed by LAKSHMESHWAR PANDEY</div>
    </div>
  );
}
