// FUTUREHAT web — Auth screen with interactive mascot + motion.

import { useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { signInWithEmail, signUpWithEmail } from '@shared/api';
import { supabase } from './supabase';
import { Mascot } from './Mascot';
import { spring, quick } from './motion';
import './Auth.css';

export function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [happy, setHappy] = useState(false);

  const gaze = Math.min(1, email.length / 24);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
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
        <h1 className="auth-logo">FUTUREHAT</h1>
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
          <AnimatePresence>
            {error && (
              <motion.div
                className="auth-error"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>
          <motion.button whileTap={{ scale: 0.96 }} type="submit" disabled={loading} className="auth-submit">
            {loading ? <span className="fh-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : mode === 'signin' ? 'Sign In' : 'Create account'}
          </motion.button>
        </form>

        <div className="auth-toggle">
          {mode === 'signin' ? (
            <>New here? <a onClick={() => setMode('signup')}>Create an account</a></>
          ) : (
            <>Already have an account? <a onClick={() => setMode('signin')}>Sign in</a></>
          )}
        </div>
      </motion.div>

      <div className="auth-footer">Developed by LAKSHMESHWAR PANDEY</div>
    </div>
  );
}
