import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from './AuthContext';
import { PremiumProvider } from './PremiumContext';
import { PresenceProvider } from './PresenceContext';
import { CallProvider } from './calls/CallContext';
import { AppLockGate } from './premium/AppLockGate';
import { AuthScreen } from './Auth';
import { ResetPasswordScreen } from './ResetPassword';
import { supabase } from './supabase';
import { App } from './App';
import { registerServiceWorker } from './pwa/usePwaInstall';
import { initDiagnostics } from './diagnostics/logBuffer';
import { ErrorBoundary } from './lib/ErrorBoundary';
import { afterFirstPaint, mark, measure, removeBootShell } from './lib/startupCache';
import './index.css';
import './theme/premium.css';

mark('js-exec');

// Diagnostics + SW after first paint — never on critical path.
afterFirstPaint(() => {
  initDiagnostics();
  registerServiceWorker();
});

/** Minimal CSS splash — no framer-motion on the critical path. */
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

  // Cache-first auth almost always has loading=false immediately.
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

  // No AnimatePresence mode="wait" — that forced a blank frame between routes.
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <PremiumProvider>
          <PresenceProvider>
            <CallProvider>
              <Root />
            </CallProvider>
          </PresenceProvider>
        </PremiumProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
