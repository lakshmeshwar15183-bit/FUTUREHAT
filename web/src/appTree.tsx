// Lumixo web — full app tree (async chunk).
// Loaded after the tiny entry so @supabase/supabase-js is NOT on the first paint path.
// HTML boot shell is already visible when this chunk downloads.

import { useEffect } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { PremiumProvider } from './PremiumContext';
import { PresenceProvider } from './PresenceContext';
import { CallProvider } from './calls/CallContext';
import { AppLockGate } from './premium/AppLockGate';
import { AuthScreen } from './Auth';
import { ResetPasswordScreen } from './ResetPassword';
import { supabase } from './supabase';
import { App } from './App';
import { mark, measure, removeBootShell } from './lib/startupCache';

function Splash() {
  return (
    <div className="fh-splash" role="status" aria-label="Loading">
      <div className="fh-splash-logo">🎩</div>
      <div className="fh-spinner" />
    </div>
  );
}

function Root() {
  const { user, loading, recoveryMode, clearRecoveryMode } = useAuth();

  useEffect(() => {
    mark('react-ready');
    removeBootShell();
    measure('boot-to-ready', 'js-exec', 'react-ready');
  }, []);

  if (loading) return <Splash />;

  if (recoveryMode) {
    return (
      <div style={{ height: '100%' }}>
        <ResetPasswordScreen
          hasRecoverySession={!!user}
          onDone={() => {
            clearRecoveryMode();
            void supabase.auth.signOut();
          }}
        />
      </div>
    );
  }

  if (user) {
    return (
      <div style={{ height: '100%' }} className="fh-app-root">
        <AppLockGate>
          <App />
        </AppLockGate>
      </div>
    );
  }

  return (
    <div style={{ height: '100%' }} className="fh-auth-root">
      <AuthScreen />
    </div>
  );
}

/** Mounted from main.tsx after dynamic import — keeps supabase off entry chunk. */
export function AppTree() {
  mark('app-tree-mount');
  return (
    <AuthProvider>
      <PremiumProvider>
        <PresenceProvider>
          <CallProvider>
            <Root />
          </CallProvider>
        </PresenceProvider>
      </PremiumProvider>
    </AuthProvider>
  );
}
