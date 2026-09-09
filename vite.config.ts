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

/**
 * Where this client's own storage is, in development.
 *
 * hc-web-lit serves itself in production — the same origin holds the app, the
 * content API and the proxy to core — so in development the dev server plays
 * that part. Run `npm run serve` alongside `npm run dev` and the app uses the
 * real store; leave it off and the app falls back to the browser's, which is a
 * supported way to run it and so worth exercising too.
 */
const CONTENT = process.env['HC_CONTENT_URL'] ?? 'http://127.0.0.1:8090';

/**
 * The bare specifier an extension imports, and where it resolves to.
 *
 * §4.5 has an extension author writing
 * `import { HcWidgetBase, registerWidget } from "@homecore/widget-sdk"`, and a
 * browser cannot resolve that on its own — so the host declares an import map
 * and serves the module. This is what lets an extension be built once by its
 * author and loaded by any deployment: it names the SDK, not a file path
 * inside somebody else's dist directory.
 *
 * **The SDK is a second entry, not a copy.** It is built alongside the app, so
 * lit, the widget registry and the presentation primitives land in chunks both
 * of them import — one lit, and more importantly *one registry*, which is what
 * makes an extension's `registerWidget` visible to the host that looks the tag
 * up. Two copies would load without error and draw nothing, which is the worst
 * shape a bug can take.
 */
const SDK_SPECIFIER = '@homecore/widget-sdk';

const importMap = (dev: boolean) => ({
  tag: 'script',
  attrs: { type: 'importmap' },
  // In development vite serves the TypeScript directly and transforms it on
  // request; in a build it is an emitted chunk at a fixed name, because an
  // import map cannot chase a content hash.
  children: JSON.stringify({
    imports: { [SDK_SPECIFIER]: dev ? '/src/sdk/index.ts' : '/sdk.js' },
  }),
  injectTo: 'head-prepend' as const,
});

export default defineConfig(({ command }) => ({
  plugins: [
    {
      name: 'hc-sdk-import-map',
      transformIndexHtml: () => [importMap(command === 'serve')],
    },
  ],
  build: {
    // Chrome runs on the wall tablet, so this is not a compatibility floor —
    // it is just "the Chrome that is installed there" (§16). Read the version
    // off the device and pin it; guessing low costs bundle size for nothing.
    target: 'chrome120',
    sourcemap: true,
    rollupOptions: {
      input: { index: 'index.html', sdk: 'src/sdk/index.ts' },
      // Vite's app build defaults this to `false`, which strips an entry's
      // exports — correct for a page, fatal for a module other code imports.
      // Without it `sdk.js` builds, loads, and exports nothing, and every
      // extension fails on its first named import.
      preserveEntrySignatures: 'strict',
      output: {
        // Only the SDK gets a fixed name — it is the one file an import map
        // has to be able to name. Everything else keeps its hash.
        entryFileNames: (chunk) => (chunk.name === 'sdk' ? 'sdk.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  server: {
    proxy: {
      '/api/v1': {
        target: CORE,
        changeOrigin: true,
        // The event stream is a WebSocket upgrade on the same prefix.
        ws: true,
      },
      '/api/content': { target: CONTENT, changeOrigin: true },
      '/api/assets': { target: CONTENT, changeOrigin: true },
      // Passed through untouched: an extension ships built JS, and having the
      // dev server transform a third party's module would mean development
      // exercised a different loading path from the one a deployment uses.
      '/api/extensions': { target: CONTENT, changeOrigin: true },
    },
  },
  test: {
    globals: true,
    // No import map in vitest: the alias is how the same bare specifier
    // resolves under test that an import map resolves in the browser.
    alias: { '@homecore/widget-sdk': new URL('./src/sdk/index.ts', import.meta.url).pathname },
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
}));
