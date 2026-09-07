import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
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
);
