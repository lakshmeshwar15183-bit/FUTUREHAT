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
    // Split big vendors into separate, long-cacheable chunks loaded in parallel.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          motion: ['framer-motion'],
          datefns: ['date-fns'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
