import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  resolve: {
    alias: {
      // Resolve relative to this config so the build works on any machine/CI.
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    modulePreload: { polyfill: true },
    // Split big vendors into separate, long-cacheable chunks loaded in parallel.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('\\react\\')) {
              return 'react';
            }
            if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) {
              return 'motion';
            }
            if (id.includes('date-fns')) return 'datefns';
            if (id.includes('@supabase')) return 'supabase';
          }
        },
      },
    },
    chunkSizeWarningLimit: 700,
    // Slightly better gzip / parse characteristics on modern browsers.
    minify: 'esbuild',
  },
  // Avoid re-bundling thrash in dev for large deps.
  optimizeDeps: {
    include: ['react', 'react-dom', '@supabase/supabase-js', 'date-fns'],
  },
});
