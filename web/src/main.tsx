/**
 * Lumixo web — tiny entry (critical path).
 *
 * Goals:
 *  1. HTML boot shell already painted (index.html).
 *  2. This file stays small: React + boot glue only.
 *  3. Supabase SDK, App, ChatView, CallEngine load as async chunks.
 */
import { StrictMode, useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './lib/ErrorBoundary';
import { afterFirstPaint, mark } from './lib/startupCache';
import './index.css';
import './theme/premium.css';

mark('js-exec');

function Boot() {
  const [Tree, setTree] = useState<ComponentType | null>(null);

  useEffect(() => {
    mark('app-import-start');
    // Dynamic import → separate chunk including supabase + App shell.
    void import('./appTree').then((m) => {
      mark('app-import-done');
      setTree(() => m.AppTree);
    });
  }, []);

  // Diagnostics + SW only after paint (and after tree if slow).
  useEffect(() => {
    afterFirstPaint(() => {
      void import('./diagnostics/logBuffer').then((m) => m.initDiagnostics());
      void import('./pwa/usePwaInstall').then((m) => m.registerServiceWorker());
    });
  }, []);

  // null → HTML #fh-boot shell remains visible (no blank flash).
  if (!Tree) return null;
  return <Tree />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Boot />
    </ErrorBoundary>
  </StrictMode>,
);
