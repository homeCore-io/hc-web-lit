/**
 * The entry point, and the one place the service worker is registered.
 *
 * **Production only.** A service worker in development caches the shell that
 * Vite is busy replacing, so an edit appears to do nothing until somebody
 * clears storage — an hour lost to a tool that was supposed to save one.
 */
/// <reference types="vite/client" />
import './shell/hc-app.js';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // After load: registering during startup competes with fetching the app
  // itself, on exactly the hardware where that is slowest.
  globalThis.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // A tablet with storage disabled, or a browser that will not. The app
      // works without it; only the reload-during-an-outage does not.
    });
  });
}
