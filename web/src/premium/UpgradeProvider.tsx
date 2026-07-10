// Lumixo+ — lets any component open the upgrade page. Mounts the modal once.

import { createContext, useContext, useState, useCallback, lazy, Suspense, type ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';

// Lazy: the upgrade page (feature grid + payment code) loads only when opened.
const UpgradeModal = lazy(() => import('./UpgradeModal').then((m) => ({ default: m.UpgradeModal })));

interface UpgradeCtx {
  open: () => void;
}

const Ctx = createContext<UpgradeCtx>({ open: () => {} });

export function UpgradeProvider({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(false);
  const open = useCallback(() => setShow(true), []);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <Suspense fallback={null}>
        <AnimatePresence>{show && <UpgradeModal onClose={() => setShow(false)} />}</AnimatePresence>
      </Suspense>
    </Ctx.Provider>
  );
}

export function useUpgrade() {
  return useContext(Ctx);
}
