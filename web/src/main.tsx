import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthProvider, useAuth } from './AuthContext';
import { PremiumProvider } from './PremiumContext';
import { PresenceProvider } from './PresenceContext';
import { CallProvider } from './calls/CallContext';
import { AppLockGate } from './premium/AppLockGate';
import { AuthScreen } from './Auth';
import { ResetPasswordScreen } from './ResetPassword';
import { supabase } from './supabase';
import { App } from './App';
import { pageVariants } from './motion';
import { registerServiceWorker } from './pwa/usePwaInstall';
import { initDiagnostics } from './diagnostics/logBuffer';
import './index.css';
import './theme/premium.css';

// PWA install support + diagnostic log capture (best-effort, no-op on failure).
initDiagnostics();
registerServiceWorker();

function Splash() {
  return (
    <div className="fh-splash">
      <motion.div
        className="fh-splash-logo"
        initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      >
        🎩
      </motion.div>
      <div className="fh-spinner" />
    </div>
  );
}

function Root() {
  const { user, loading, recoveryMode, clearRecoveryMode } = useAuth();

  if (loading) return <Splash />;

  // Recovery beats every other route. The user MIGHT be technically signed in
  // via the temporary recovery session — we still need them to pick a new
  // password before the app is safe to use. When they finish (or abort) the
  // ResetPassword screen clears recoveryMode + signs out, dropping us back on
  // AuthScreen. The has-session flag is derived from the URL so we can also
  // handle a direct visit to /reset-password (e.g. bookmarked link) gracefully.
  if (recoveryMode) {
    return (
      <motion.div key="reset" variants={pageVariants} initial="initial" animate="animate" exit="exit" style={{ height: '100%' }}>
        <ResetPasswordScreen
          hasRecoverySession={!!user}
          onDone={() => {
            clearRecoveryMode();
            // Best-effort ensure we drop the recovery session before showing
            // the sign-in screen; safe to call even if already signed out.
            void supabase.auth.signOut();
          }}
        />
      </motion.div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {user ? (
        <motion.div key="app" variants={pageVariants} initial="initial" animate="animate" exit="exit" style={{ height: '100%' }}>
          <AppLockGate>
            <App />
          </AppLockGate>
        </motion.div>
      ) : (
        <motion.div key="auth" variants={pageVariants} initial="initial" animate="animate" exit="exit" style={{ height: '100%' }}>
          <AuthScreen />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <PremiumProvider>
        <PresenceProvider>
          <CallProvider>
            <Root />
          </CallProvider>
        </PresenceProvider>
      </PremiumProvider>
    </AuthProvider>
  </StrictMode>,
);
