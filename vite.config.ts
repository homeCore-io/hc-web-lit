/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Chrome runs on the wall tablet, so this is not a compatibility floor —
    // it is just "the Chrome that is installed there" (§16). Read the version
    // off the device and pin it; guessing low costs bundle size for nothing.
    target: 'chrome120',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
