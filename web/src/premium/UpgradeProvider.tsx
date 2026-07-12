// Lumixo+ — lets any component open the upgrade page. Mounts the modal once.
// No framer-motion on the provider path (modal brings its own when opened).

import { createContext, useContext, useState, useCallback, lazy, Suspense, type ReactNode } from 'react';

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
        {show && <UpgradeModal onClose={() => setShow(false)} />}
      </Suspense>
    </Ctx.Provider>
  );
}

export function useUpgrade() {
  return useContext(Ctx);
}
