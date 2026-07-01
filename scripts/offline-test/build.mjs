// Bundle the real localCache.ts + sync.ts to CJS, redirecting ONLY the native /
// cross-module imports to in-memory mocks. The logic under test is untouched.
import { build } from '../../web/node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const m = (f) => resolve(here, 'mocks', f);

const redirect = {
  name: 'redirect',
  setup(b) {
    // external:true keeps these as runtime require()s to the ABSOLUTE mock path,
    // so bundle.cjs and the test share ONE module instance (shared mock state).
    b.onResolve({ filter: /async-storage/ }, () => ({ path: m('async-storage.js'), external: true }));
    b.onResolve({ filter: /netinfo/ }, () => ({ path: m('netinfo.js'), external: true }));
    b.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: m('supabase.js'), external: true }));
    b.onResolve({ filter: /(^|\/)shared$/ }, () => ({ path: m('shared.js'), external: true }));
  },
};

await build({
  entryPoints: [resolve(here, 'entry.js')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: resolve(here, 'bundle.cjs'),
  plugins: [redirect],
  logLevel: 'info',
});
console.log('Bundled real localCache.ts + sync.ts -> bundle.cjs');
