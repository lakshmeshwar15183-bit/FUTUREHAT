// Stable lazy() wrappers — once a chunk resolves, Suspense never re-suspends
// for that module (avoids ChatSkeleton flash / blank pane on parent remount).

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const cache = new Map<string, Promise<{ default: ComponentType<any> }>>();

/**
 * Like React.lazy, but reuses the same promise forever so a remount of
 * <Suspense> after resize/visibility does not show the fallback again.
 */
export function lazyStable<T extends ComponentType<any>>(
  key: string,
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => {
    let p = cache.get(key);
    if (!p) {
      p = factory().catch((err) => {
        // Allow retry on next import if chunk failed once (network blip).
        cache.delete(key);
        throw err;
      }) as Promise<{ default: ComponentType<any> }>;
      cache.set(key, p);
    }
    return p as Promise<{ default: T }>;
  });
}
