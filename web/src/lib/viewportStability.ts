// Lumixo web — stable layout height across resize / minimize / mobile browser chrome.
//
// ROOT CAUSE (class of bugs):
//   • height: 100vh alone can disagree with the *actual* layout viewport after
//     minimize→restore, desktop resize, or mobile URL bar show/hide.
//   • content-visibility: auto skips painting offscreen rows; Chrome has shipped
//     bugs where restoring a backgrounded tab leaves those subtrees unpainted
//     (blank pane) until a full reflow.
//
// This module sets --app-height to the visual/layout viewport in px and forces
// a cheap reflow when the document becomes visible again.

let installed = false;

function applyHeight() {
  try {
    const h =
      window.visualViewport?.height ??
      window.innerHeight ??
      document.documentElement.clientHeight;
    if (h > 0) {
      document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`);
    }
  } catch {
    /* noop */
  }
}

/** Force browsers to repaint after tab restore / bfcache (avoids blank canvas). */
function forceRepaint() {
  try {
    const root = document.getElementById('root');
    if (!root) return;
    // Toggle a no-op class to invalidate paint without unmounting React.
    root.classList.add('fh-repaint');
    // Read layout to flush
    void root.offsetHeight;
    requestAnimationFrame(() => {
      root.classList.remove('fh-repaint');
    });
  } catch {
    /* noop */
  }
}

export function installViewportStability(): () => void {
  if (typeof window === 'undefined' || installed) return () => {};
  installed = true;

  applyHeight();

  let resizeRaf = 0;
  const onResize = () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      applyHeight();
    });
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      applyHeight();
      forceRepaint();
    }
  };

  const onPageShow = (e: PageTransitionEvent) => {
    // bfcache restore
    applyHeight();
    if (e.persisted) forceRepaint();
  };

  window.addEventListener('resize', onResize, { passive: true });
  window.visualViewport?.addEventListener('resize', onResize, { passive: true });
  window.visualViewport?.addEventListener('scroll', onResize, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onPageShow);

  return () => {
    installed = false;
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('scroll', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
  };
}
