import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_API_PROXY_TARGET =
  process.env.VITE_API_PROXY_TARGET ||
  process.env.VITE_API_BASE_URL ||
  'https://terranthrowvwa-production.up.railway.app';

export default defineConfig({
  plugins: [react()],
  base: '/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1000,
    minify: 'terser',
    terserOptions: {
      compress: { drop_console: true, drop_debugger: true }
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'map-vendor': ['maplibre-gl']
        }
      }
    },
    sourcemap: false
  },
  server: {
    port: 3002,
    strictPort: false,
    host: true,
    proxy: {
      // In dev, proxy /api to the local Express server.
      // In production, VITE_API_BASE_URL points directly to Railway — no proxy needed.
      '/api': {
        target: DEV_API_PROXY_TARGET,
        changeOrigin: true,
      }
    }
  },
  preview: {
    port: 3002,
    strictPort: false,
    host: true
  }
});
