import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Build output, all three kinds: the app's, an extension's, and an
  // extension's again after it has been installed into the store. Linting
  // generated JS reports the minifier's choices as the author's mistakes.
  { ignores: ['dist', 'coverage', 'extensions/*/*.js', 'var'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The host is the only thing allowed to reach the socket, the token or
      // `window` directly (§19.4). This is the lint half of that rule; the SDK
      // gets the widget-facing half in Phase 2 (§5.8).
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Go through the API client, not fetch directly (§19.4).' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The service worker runs in a worker, not a page: `self` and `caches` are
    // its globals and `window` is not one of them. Linted rather than ignored
    // — it is the only code that decides what a disconnected tablet sees, so
    // it is the last file that should go unchecked.
    files: ['public/sw.js'],
    languageOptions: {
      globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', URL: 'readonly' },
    },
    rules: {
      // A service worker's whole job is intercepting fetches; the rule above
      // is about widgets reaching past the host, which this is not.
      'no-restricted-globals': 'off',
    },
  },
  {
    // Build-time scripts. Node, not a browser — they run under `node` and
    // never ship, so `console` is how they report and `process` is how they
    // fail. Linted rather than ignored, for the same reason the service
    // worker is: `tool/icons.mjs` decides what every icon in the product
    // looks like.
    files: ['tool/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
);
