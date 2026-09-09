/**
 * How a wall panel authenticates without anybody standing in front of it.
 *
 * A panel is a browser with no keyboard, mounted somewhere awkward, that has
 * to come back on its own after a power cut at 3am. Three ways to give it a
 * credential, and only one of them is right:
 *
 * - **A password in the source.** It would work, and it puts an admin login
 *   in a file anyone who opens the page can read.
 * - **The IP whitelist.** Core has one, and it is genuinely the simplest thing
 *   — but it authenticates an address rather than a device, so every browser
 *   on that address gets in, a DHCP lease that moves gets in, and the panel
 *   has no identity to revoke when it is taken off the wall.
 * - **An API key**, which is what this is. It names a credential rather than a
 *   place: it carries its own scopes, so a panel that only shows dashboards
 *   cannot write content; it can carry `allowed_cidrs`, so the address
 *   restriction is still available *in addition*; and it revokes on its own
 *   without touching anybody's login.
 *
 * **The provisioning step is real and there is no way around it.** A
 * credential has to reach the tablet somehow, and the tablet has no keyboard.
 * So it arrives the way everything else reaches a panel — in the URL, once:
 *
 * ```
 * http://panel.local/?kiosk&key=hc_sk_…
 * ```
 *
 * The page takes the key out of the URL and into the device's own storage, and
 * replaces the address so what is left in the bar, in the history, and in any
 * `Referer` this page ever sends is the plain kiosk URL. What the person typed
 * once is not what the panel keeps showing.
 *
 * **This is the one thing that does not go in the content store.** `ServerContent`
 * is shared on purpose — content written on a phone is there on the wall — and
 * a credential that behaved that way would put every panel's key on every
 * device. A key belongs to *this* tablet, so it lives in this browser's own
 * storage and nowhere else.
 */

/** Core's prefix for an API key. `verify_api_key` dispatches on exactly this. */
export const KEY_PREFIX = 'hc_sk_';

/** Namespaced away from `hc.content.`, which is shared and this is not. */
const SLOT = 'hc.panel.key';

/**
 * Shaped like a key core would accept.
 *
 * Checked before storing rather than after failing, so pasting a password into
 * `?key=` leaves nothing behind on the tablet. It is a shape test and not a
 * validity test — only core can say whether a key is live.
 */
export function isPanelKey(value: unknown): value is string {
  return (
    typeof value === 'string' && value.startsWith(KEY_PREFIX) && value.length > KEY_PREFIX.length
  );
}

/** Just enough of `Location`/`History` to be substitutable in a test. */
export interface PanelUrl {
  readonly href: string;
  replace(href: string): void;
}

/** The live one: read the address bar, rewrite it without navigating. */
export function documentUrl(): PanelUrl | undefined {
  const loc = globalThis.location;
  const hist = globalThis.history;
  if (loc === undefined || hist === undefined) return undefined;
  return {
    get href() {
      return loc.href;
    },
    replace(href: string) {
      hist.replaceState(hist.state, '', href);
    },
  };
}

export class PanelCredential {
  private readonly url: PanelUrl | undefined;

  constructor(url: PanelUrl | undefined = documentUrl()) {
    this.url = url;
  }

  /**
   * The key this panel should use, taking one out of the URL if it is there.
   *
   * Provisioning wins over what is stored, which is how a panel is re-keyed:
   * open it once with a new `?key=` and the old one is gone. A `?key=` that is
   * not shaped like a key is stripped from the address and *not* stored —
   * whatever it was, it should not stay in the address bar either.
   */
  claim(): string | undefined {
    const fromUrl = this.take();
    if (fromUrl !== undefined) {
      this.store(fromUrl);
      return fromUrl;
    }
    return this.stored();
  }

  /** What is on this device, without looking at the URL. */
  stored(): string | undefined {
    try {
      const raw = globalThis.localStorage?.getItem(SLOT);
      return isPanelKey(raw) ? raw : undefined;
    } catch {
      // Private browsing, or site data turned off. A panel with no key falls
      // back to the login screen, which is the right place to end up.
      return undefined;
    }
  }

  /**
   * Throw the key away.
   *
   * Called when core refuses it, because a revoked key does not become valid
   * by being retried: a panel that kept presenting one would show a login
   * screen it could never get past, with a dead credential underneath
   * explaining why. Forgetting it means the next `?key=` provisions cleanly.
   */
  forget(): void {
    try {
      globalThis.localStorage?.removeItem(SLOT);
    } catch {
      // Unwritable storage had nothing in it to remove.
    }
  }

  private store(key: string): void {
    try {
      globalThis.localStorage?.setItem(SLOT, key);
    } catch {
      // The key still works for this session; the panel will need
      // re-provisioning after a reload. Better than refusing to start.
    }
  }

  /**
   * Pull `key` out of the address and rewrite it without one.
   *
   * `replaceState` rather than `pushState`: the provisioning URL must not
   * become a history entry, or Back puts the key back in the bar. Returns
   * undefined when there was nothing to take, which is every load after the
   * first.
   */
  private take(): string | undefined {
    if (this.url === undefined) return undefined;
    let parsed: URL;
    try {
      parsed = new URL(this.url.href);
    } catch {
      return undefined;
    }
    if (!parsed.searchParams.has('key')) return undefined;

    const value = parsed.searchParams.get('key');
    parsed.searchParams.delete('key');
    // `?kiosk` has no value and `URLSearchParams` re-serialises it as `kiosk=`.
    // Harmless — `has('kiosk')` is what reads it — but the address a panel
    // sits on for months should look like the one somebody typed.
    const search = parsed.searchParams.toString().replace(/(^|&)kiosk=(?=&|$)/, '$1kiosk');
    this.url.replace(`${parsed.pathname}${search === '' ? '' : `?${search}`}${parsed.hash}`);

    return isPanelKey(value) ? value : undefined;
  }
}
