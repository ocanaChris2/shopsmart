import { defineConfig } from 'vite';
import react            from '@vitejs/plugin-react';
import path             from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },

  build: {
    // Targeting modern evergreen browsers; drops IE11 polyfills entirely.
    target:    'esnext',
    minify:    'esbuild',
    sourcemap: true,         // keep sourcemaps for error monitoring (Sentry etc.)

    rollupOptions: {
      output: {
        // Manual chunking: split vendor bundles so unchanged dependencies are
        // served from the browser cache even after an app-code deploy.
        manualChunks: {
          'vendor-react':  ['react', 'react-dom'],
          'vendor-router': ['react-router-dom'],
          'vendor-query':  ['@tanstack/react-query'],
          'vendor-table':  ['@tanstack/react-table'],
          'vendor-form':   ['react-hook-form', '@hookform/resolvers', 'zod'],
          'vendor-ui': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-select',
            '@radix-ui/react-switch',
            '@radix-ui/react-label',
            '@radix-ui/react-toast',
            '@radix-ui/react-dropdown-menu',
            'class-variance-authority',
            'clsx',
            'tailwind-merge',
            'lucide-react',
          ],
        },
      },
    },
  },

  // Dev proxy: routes /api/* to the local Fastify server so the frontend can
  // run on :5173 without CORS issues during development.
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target:      'http://localhost:3000',
        changeOrigin: true,
      },
      '/auth': {
        target:      'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
