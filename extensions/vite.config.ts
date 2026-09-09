/**
 * How an extension is built — and deliberately, how *anyone's* is.
 *
 * This config is the one thing in the repo that a third-party author would
 * copy verbatim. It is separate from the app's build for a reason that is the
 * whole point of §3 Rule 1: if the first-party extension were built as part of
 * the app, it would be sharing the app's module graph and proving nothing.
 * Built this way it is an ESM module on a disk, resolved through an import
 * map, exactly as a package downloaded from a stranger would be.
 *
 * **`@homecore/widget-sdk` is external, and that is the load-bearing line.**
 * Bundling it would give the extension its own lit, its own widget registry
 * and its own copy of the presentation primitives. The module would load
 * without error, register its element in a registry the host never reads, and
 * draw nothing — the worst shape a bug can take, because every individual
 * piece appears to work. Left external, the browser resolves it through the
 * host's import map to the one instance the host is using.
 *
 * Output goes into the extension store beside the manifest, which is all
 * "installing" means here (§ server/extensions.ts).
 */
import { defineConfig } from 'vite';

export const EXTENSIONS_ROOT = import.meta.dirname;

export default defineConfig({
  root: EXTENSIONS_ROOT,
  build: {
    // Same target as the app: one browser (§16), so no reason for an
    // extension to be compiled for a different one than its host.
    target: 'chrome120',
    outDir: 'hc-button',
    // The manifest and any assets already live there; a build must not clear
    // the directory it is being installed into.
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: 'hc-button/button.ts',
      formats: ['es'],
      // Matches `entry` in hc-extension.json. A mismatch here is the single
      // most likely mistake an author makes, and the symptom is a 404 the
      // host reports by id, which is why `loadExtension` names the extension.
      fileName: () => 'button.js',
    },
    rollupOptions: {
      external: ['@homecore/widget-sdk'],
    },
  },
});
