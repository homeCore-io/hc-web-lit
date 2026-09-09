/**
 * How a wall panel gets a credential and keeps it.
 *
 * The properties worth pinning are about what is *left behind*: a key must
 * survive a reload, must not survive in the address bar, and must not survive
 * being refused. Everything else about a panel is the ordinary client.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PanelCredential, isPanelKey, type PanelUrl } from '../src/core/panel.js';

/** A stand-in address bar, so a test can read what was left in it. */
function urlAt(href: string): PanelUrl & { current: string } {
  return {
    current: href,
    get href() {
      return this.current;
    },
    replace(next: string) {
      // `replaceState` takes a relative URL and resolves it; do the same, or
      // an assertion about the path would pass on a string that never was one.
      this.current = new URL(next, this.current).toString();
    },
  };
}

beforeEach(() => globalThis.localStorage?.clear());
afterEach(() => globalThis.localStorage?.clear());

describe('what counts as a key', () => {
  it('is core’s own prefix and nothing else', () => {
    // The dispatch in `validate_query_token` is on exactly this prefix, so
    // this client's idea of a key and core's have to be the same idea.
    expect(isPanelKey('hc_sk_abc123')).toBe(true);
    expect(isPanelKey('hc_sk_')).toBe(false);
    expect(isPanelKey('eyJhbGciOiJIUzI1NiJ9.x.y')).toBe(false);
    expect(isPanelKey(undefined)).toBe(false);
    expect(isPanelKey(null)).toBe(false);
  });
});

describe('provisioning a panel', () => {
  it('takes the key out of the URL and keeps it', () => {
    const url = urlAt('http://panel.local/?kiosk&key=hc_sk_live');
    expect(new PanelCredential(url).claim()).toBe('hc_sk_live');

    // The address a panel then sits on for months. Not in the bar, not in the
    // history, and not in any `Referer` this page sends afterwards.
    expect(url.current).toBe('http://panel.local/?kiosk');
    expect(url.current).not.toContain('hc_sk_');
  });

  it('is remembered across a reload, with no key in the URL', () => {
    new PanelCredential(urlAt('http://panel.local/?key=hc_sk_live')).claim();
    // The next boot: same device, no query string, still authenticated. This
    // is the whole feature — a tablet that comes back after a power cut.
    expect(new PanelCredential(urlAt('http://panel.local/')).claim()).toBe('hc_sk_live');
  });

  it('is re-keyed by opening it once with a new key', () => {
    new PanelCredential(urlAt('http://panel.local/?key=hc_sk_old')).claim();
    const url = urlAt('http://panel.local/?key=hc_sk_new');
    expect(new PanelCredential(url).claim()).toBe('hc_sk_new');
    expect(new PanelCredential(urlAt('http://panel.local/')).claim()).toBe('hc_sk_new');
  });

  it('strips something that is not a key without storing it', () => {
    // Somebody pastes a password into `?key=`. It is wrong either way, but it
    // must not end up in the address bar and it must not end up on the tablet.
    const url = urlAt('http://panel.local/?kiosk&key=hunter2');
    expect(new PanelCredential(url).claim()).toBeUndefined();
    expect(url.current).toBe('http://panel.local/?kiosk');
    expect(new PanelCredential(urlAt('http://panel.local/')).stored()).toBeUndefined();
  });

  it('leaves an address with no key alone', () => {
    const url = urlAt('http://panel.local/dash?kiosk#room');
    expect(new PanelCredential(url).claim()).toBeUndefined();
    expect(url.current).toBe('http://panel.local/dash?kiosk#room');
  });

  it('keeps the rest of the query and the fragment', () => {
    const url = urlAt('http://panel.local/x?key=hc_sk_live&page=house&kiosk#top');
    expect(new PanelCredential(url).claim()).toBe('hc_sk_live');
    expect(url.current).toBe('http://panel.local/x?page=house&kiosk#top');
  });

  it('forgets a key core refused', () => {
    // A revoked key does not become valid by being retried, and a panel that
    // kept presenting one would show a login screen no reload could get past.
    const panel = new PanelCredential(urlAt('http://panel.local/?key=hc_sk_dead'));
    panel.claim();
    panel.forget();
    expect(new PanelCredential(urlAt('http://panel.local/')).claim()).toBeUndefined();
  });
});

describe('a browser that will not store anything', () => {
  it('starts, and simply forgets the key', () => {
    // Private browsing, or site data turned off. `localStorage` *throws* here
    // rather than returning nothing, and a panel that failed to start because
    // it could not save a credential is worse than one that needs re-keying.
    const store = globalThis.localStorage;
    const throwing = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
      removeItem() {
        throw new Error('denied');
      },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: throwing,
      configurable: true,
    });
    try {
      const url = urlAt('http://panel.local/?key=hc_sk_live');
      const panel = new PanelCredential(url);
      // The key still works for this session; it is the reload that loses it.
      expect(panel.claim()).toBe('hc_sk_live');
      expect(panel.stored()).toBeUndefined();
      expect(() => panel.forget()).not.toThrow();
      expect(url.current).toBe('http://panel.local/');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: store,
        configurable: true,
      });
    }
  });
});

describe('with no address bar at all', () => {
  it('reads what is stored and asks nothing of the DOM', () => {
    // Server-side rendering, or a test harness. Constructing this must not be
    // the thing that throws.
    globalThis.localStorage?.setItem('hc.panel.key', 'hc_sk_live');
    expect(new PanelCredential(undefined).claim()).toBe('hc_sk_live');
  });
});
