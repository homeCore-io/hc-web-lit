/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

/**
 * Where core is, in development.
 *
 * **This has to be a proxy, not a base URL.** Core sends no CORS headers at
 * all, so a page served from the dev server cannot call it cross-origin — the
 * browser refuses before core ever sees the request. hc-web-flutter does not
 * hit this because nginx serves the app and proxies `/api/v1` to core on the
 * same origin, which is also how this app is deployed. So dev mirrors
 * production rather than working around it: the client always talks to a
 * relative `/api/v1`, and something in front routes it.
 */
const CORE = process.env['HC_CORE_URL'] ?? 'http://10.0.10.150:8080';

export default defineConfig({
  build: {
    // Chrome runs on the wall tablet, so this is not a compatibility floor —
    // it is just "the Chrome that is installed there" (§16). Read the version
    // off the device and pin it; guessing low costs bundle size for nothing.
    target: 'chrome120',
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api/v1': {
        target: CORE,
        changeOrigin: true,
        // The event stream is a WebSocket upgrade on the same prefix.
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
