// Lumixo web — light call context (critical path).
// Heavy WebRTC + framer-motion overlay loads after first paint via CallEngine.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CallType } from '@shared/types';
import { useAuth } from '../AuthContext';
import { afterFirstPaint } from '../lib/startupCache';

export interface CallCtx {
  startCall: (conversationId: string, type: CallType, peerName: string) => void;
  busy: boolean;
}

const Ctx = createContext<CallCtx>({
  startCall: () => {},
  busy: false,
});

export const useCall = () => useContext(Ctx);

type EngineApi = CallCtx;
type EngineComp = React.ComponentType<{ onApiReady: (api: EngineApi) => void }>;

/**
 * Stable provider: children never remount when the heavy engine arrives.
 * Engine renders only the call overlay as a sibling.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const engineApi = useRef<EngineApi | null>(null);
  const pending = useRef<Array<[string, CallType, string]>>([]);
  const [busy, setBusy] = useState(false);
  const [Engine, setEngine] = useState<EngineComp | null>(null);

  const loadEngine = useCallback(() => {
    if (Engine) return;
    void import('./CallEngine').then((m) => {
      setEngine(() => m.CallEngine);
    });
  }, [Engine]);

  // Prefetch engine after first paint when signed in (incoming call readiness).
  useEffect(() => {
    if (!user) {
      engineApi.current = null;
      setBusy(false);
      setEngine(null);
      return;
    }
    afterFirstPaint(() => loadEngine());
  }, [user, loadEngine]);

  const startCall = useCallback(
    (conversationId: string, type: CallType, peerName: string) => {
      if (engineApi.current) {
        engineApi.current.startCall(conversationId, type, peerName);
        return;
      }
      // User tapped call before engine loaded — queue + force load.
      pending.current.push([conversationId, type, peerName]);
      loadEngine();
    },
    [loadEngine],
  );

  const onApiReady = useCallback((api: EngineApi) => {
    engineApi.current = api;
    setBusy(api.busy);
    // Flush any startCall taps that happened while loading.
    const q = pending.current.splice(0, pending.current.length);
    for (const args of q) {
      api.startCall(...args);
    }
  }, []);

  // Keep busy flag in sync when engine reports phase changes via onApiReady.
  // Engine re-calls onApiReady when phase changes.
  const value: CallCtx = { startCall, busy };

  return (
    <Ctx.Provider value={value}>
      {children}
      {user && Engine ? <Engine onApiReady={onApiReady} /> : null}
    </Ctx.Provider>
  );
}
