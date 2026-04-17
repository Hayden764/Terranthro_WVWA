import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load .env so VITE_API_PROXY_TARGET is available inside the config file.
  // Without loadEnv, process.env doesn't see .env values here.
  const env = loadEnv(mode, process.cwd(), '');

  const DEV_API_PROXY_TARGET =
    env.VITE_API_PROXY_TARGET ||
    env.VITE_API_BASE_URL ||
    'https://terranthrowvwa-production.up.railway.app';

  return {
  plugins: [react()],
  base: '/',
  resolve: {
    // @mapbox/mapbox-gl-draw imports 'mapbox-gl' internally.
    // Redirect it to maplibre-gl so we don't ship two map libraries.
    alias: {
      'mapbox-gl': 'maplibre-gl',
    },
  },
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
  };
});
