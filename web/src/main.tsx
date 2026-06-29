import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthProvider, useAuth } from './AuthContext';
import { PremiumProvider } from './PremiumContext';
import { PresenceProvider } from './PresenceContext';
import { AppLockGate } from './premium/AppLockGate';
import { AuthScreen } from './Auth';
import { App } from './App';
import { pageVariants } from './motion';
import './index.css';
import './theme/premium.css';

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
  const { user, loading } = useAuth();

  if (loading) return <Splash />;

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
          <Root />
        </PresenceProvider>
      </PremiumProvider>
    </AuthProvider>
  </StrictMode>,
);
