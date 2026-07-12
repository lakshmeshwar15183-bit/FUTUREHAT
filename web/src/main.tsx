/**
 * Lumixo web — tiny entry (critical path).
 *
 * Goals:
 *  1. HTML boot shell already painted (index.html).
 *  2. This file stays small: React + boot glue only.
 *  3. Supabase SDK, App, ChatView, CallEngine load as async chunks.
 *  4. #root NEVER paints empty after boot shell is removed (stability P0).
 */
import { StrictMode, useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './lib/ErrorBoundary';
import { afterFirstPaint, mark } from './lib/startupCache';
import { installViewportStability } from './lib/viewportStability';
import './index.css';
import './theme/premium.css';

mark('js-exec');

/** Minimal in-#root shell so we never show a pure blank frame after fh-boot is gone. */
function BootFallback() {
  return (
    <div className="fh-boot-fallback" role="status" aria-label="Loading Lumixo">
      <div className="fh-boot-fallback-brand">Lumixo</div>
    </div>
  );
}

function Boot() {
  const [Tree, setTree] = useState<ComponentType | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => installViewportStability(), []);

  useEffect(() => {
    mark('app-import-start');
    let cancelled = false;
    // Dynamic import → separate chunk including supabase + App shell.
    void import('./appTree')
      .then((m) => {
        if (cancelled) return;
        mark('app-import-done');
        setTree(() => m.AppTree);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('[Lumixo] appTree load failed', e);
        setLoadError(e?.message || 'Failed to load application');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Diagnostics + SW only after paint (and after tree if slow).
  useEffect(() => {
    afterFirstPaint(() => {
      void import('./diagnostics/logBuffer').then((m) => m.initDiagnostics());
      void import('./pwa/usePwaInstall').then((m) => m.registerServiceWorker());
    });
  }, []);

  if (loadError) {
    return (
      <div className="fh-boot-fallback" role="alert">
        <div className="fh-boot-fallback-brand">Lumixo</div>
        <p style={{ color: '#8696a0', fontSize: 14, marginTop: 12 }}>{loadError}</p>
        <button type="button" className="fh-error-btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  // Keep a painted fallback until Tree mounts — never return bare null after shell removal.
  if (!Tree) return <BootFallback />;
  return <Tree />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Boot />
    </ErrorBoundary>
  </StrictMode>,
);
