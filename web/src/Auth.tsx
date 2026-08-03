// Lumixo web — Auth screen with official Lumi cat mascot.
// Authentication APIs/Supabase are unchanged — UI/animation only.

import { useEffect, useState, type FormEvent } from 'react';
import { signInWithEmail, signUpWithEmail } from '@shared/api';
import { requestPasswordReset } from '@shared/authApi';
import { friendlyAuthError } from '@shared/authErrors';
import { supabase } from './supabase';
import { LumixoCat } from './mascot/LumixoCat';
import { CAT_MOTION, catGazeFromEmail, catMoodFromAuth, type CatMood } from '@shared/lumixoCat';
import './Auth.css';

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
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showConfused, setShowConfused] = useState(false);

  const gaze = catGazeFromEmail(email);
  const baseMood: CatMood = catMoodFromAuth({
    passwordFocused,
    emailFocused: emailFocused || (!passwordFocused && email.length > 0 && !success),
    error: showConfused ? error : null,
    success,
  });
  // Welcome wave on signup when not typing / celebrating.
  const mood: CatMood = baseMood === 'idle' && mode === 'signup' ? 'wave' : baseMood;

  // Confused mood: brief shake + ~1s sad eyes, then back to idle/watching.
  useEffect(() => {
    if (!error) return;
    setShowConfused(true);
    const t = setTimeout(() => setShowConfused(false), CAT_MOTION.confuseHoldMs + 600);
    return () => clearTimeout(t);
  }, [error]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setSuccess(false);
    setLoading(true);
    try {
      if (mode === 'signup') {
        if (password.length < 8) throw new Error('Password must be at least 8 characters.');
        const { error: err, needsEmailVerification } = await signUpWithEmail(
          supabase,
          email,
          password,
          displayName,
          { phone: phone.trim() || null },
        );
        if (err) throw err;
        setSuccess(true);
        setTimeout(() => {
          setNotice(
            needsEmailVerification
              ? 'Account created. Check your email to verify, then sign in.'
              : 'Account created! Sign in to continue.',
          );
          setMode('signin');
          setSuccess(false);
        }, 900);
      } else if (mode === 'forgot') {
        const { error: err } = await requestPasswordReset(supabase, email, resetRedirectUrl());
        if (err) throw err;
        setNotice('If an account exists for that email, you will receive a reset link shortly.');
        setMode('signin');
      } else {
        const { error: err } = await signInWithEmail(supabase, email, password);
        if (err) throw err;
        setSuccess(true);
        // Session listener navigates; keep celebrate until unmount.
      }
    } catch (err: any) {
      setError(friendlyAuthError(err, 'Authentication failed'));
      setSuccess(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-aurora" aria-hidden />
      <div className={`auth-card glass auth-card-enter ${success ? 'auth-card-success' : ''}`}>
        <div className="auth-mascot" aria-hidden>
          <LumixoCat mood={mood} gaze={gaze} size="hero" decorative />
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
              disabled={loading || success}
              autoComplete="name"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => {
              setEmailFocused(true);
              setPasswordFocused(false);
            }}
            onBlur={() => setEmailFocused(false)}
            required
            disabled={loading || success}
            autoComplete="email"
          />
          {mode !== 'forgot' && (
            <input
              type="password"
              placeholder={mode === 'signup' ? 'Password (min 8 characters)' : 'Password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => {
                setPasswordFocused(true);
                setEmailFocused(false);
              }}
              onBlur={() => setPasswordFocused(false)}
              required
              minLength={mode === 'signup' ? 8 : 1}
              disabled={loading || success}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          )}
          {mode === 'signup' && (
            <input
              type="tel"
              placeholder="Phone (optional, +91…)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={loading || success}
              autoComplete="tel"
            />
          )}
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="auth-error" role="status" style={{ background: 'rgba(0, 168, 132, 0.15)', color: 'inherit' }}>
              {notice}
            </div>
          )}
          <button type="submit" disabled={loading || success} className="auth-submit">
            {loading ? (
              <span className="fh-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
            ) : success ? (
              'Welcome!'
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
              <a
                onClick={() => {
                  setError('');
                  setNotice('');
                  setMode('forgot');
                }}
              >
                Forgot password?
              </a>
              <span style={{ margin: '0 8px', opacity: 0.5 }}>·</span>
              New here?{' '}
              <a
                onClick={() => {
                  setError('');
                  setNotice('');
                  setMode('signup');
                }}
              >
                Create an account
              </a>
            </>
          )}
          {mode === 'signup' && (
            <>
              Already have an account?{' '}
              <a
                onClick={() => {
                  setError('');
                  setNotice('');
                  setMode('signin');
                }}
              >
                Sign in
              </a>
            </>
          )}
          {mode === 'forgot' && (
            <>
              Remembered it?{' '}
              <a
                onClick={() => {
                  setError('');
                  setNotice('');
                  setMode('signin');
                }}
              >
                Back to sign in
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
