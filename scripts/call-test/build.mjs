// Bundle the real webrtc.ts, redirecting native + cross-module imports to mocks.
// external:true keeps them as runtime require()s so bundle and test share state.
import { build } from '../../web/node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const m = (f) => resolve(here, 'mocks', f);

await build({
  entryPoints: [resolve(here, 'entry.js')],
  bundle: true, format: 'cjs', platform: 'node',
  outfile: resolve(here, 'bundle.cjs'),
  plugins: [{
    name: 'redirect',
    setup(b) {
      b.onResolve({ filter: /react-native-webrtc/ }, () => ({ path: m('react-native-webrtc.js'), external: true }));
      b.onResolve({ filter: /react-native-incall-manager/ }, () => ({ path: m('react-native-incall-manager.js'), external: true }));
      b.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: m('supabase.js'), external: true }));
      b.onResolve({ filter: /(^|\/)shared$/ }, () => ({ path: m('shared.js'), external: true }));
    },
  }],
  logLevel: 'warning',
});
console.log('Bundled real webrtc.ts -> bundle.cjs');
