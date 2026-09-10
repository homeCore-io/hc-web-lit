/**
 * Installing an extension from the page (§18.2).
 *
 * "A third party can ship a widget — install a `.tar.gz`, place the widget,
 * configure it in the GUI, no rebuild. This is the reason the project exists,
 * and no amount of parity substitutes for it." What the archive may contain is
 * `tar.test.ts`; this is the client half.
 */
import { describe, expect, it, vi } from 'vitest';
import { ExtensionSource } from '../src/ext/install.js';
import '../src/widgets/hc-extensions.js';
import type { HcExtensions } from '../src/widgets/hc-extensions.js';

describe('carrying the archive to the store', () => {
  const source = (fetching: typeof globalThis.fetch): ExtensionSource =>
    new ExtensionSource({ fetch: fetching, token: () => 'a-bearer' });

  it('posts the bytes, with the session behind it', async () => {
    const fetching = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'io.example.dial', files: 3 }), { status: 201 }),
    );
    const got = await source(fetching as unknown as typeof globalThis.fetch).install(
      new Uint8Array([1, 2, 3]),
    );

    expect(got).toEqual({ id: 'io.example.dial', files: 3 });
    const [url, init] = fetching.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/extensions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer a-bearer');
  });

  it('says why the store refused it, in the store’s own words', async () => {
    // The refusals are the interesting half — "refused entry type '2'" tells
    // an author what to change; "install failed" does not.
    const fetching = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "refused entry type '2' in escape.js" }), {
          status: 400,
        }),
    );
    await expect(
      source(fetching as unknown as typeof globalThis.fetch).install(new Uint8Array([1])),
    ).rejects.toThrow(/refused entry type/);
  });

  it('still says something when the store says nothing', async () => {
    const fetching = vi.fn(async () => new Response('not json', { status: 500 }));
    await expect(
      source(fetching as unknown as typeof globalThis.fetch).install(new Uint8Array([1])),
    ).rejects.toThrow(/refused it \(500\)/);
  });
});

describe('the widget that shows what is installed', () => {
  const mount = async (props: Record<string, unknown>): Promise<HcExtensions> => {
    const el = document.createElement('hc-extensions');
    Object.assign(el, props);
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  /**
   * A file as the browser hands one over.
   *
   * jsdom's `File` has no `arrayBuffer` — it predates it — while every
   * browser this client targets has had it since Chrome 76. Stubbed rather
   * than worked around in the widget: a `FileReader` fallback would be code
   * that only ever runs in a test.
   */
  const chosen = (bytes: number[]): File =>
    ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }) as unknown as File;

  /** `File.arrayBuffer` is a real await; three renders are not enough. */
  const settle = async (el: HcExtensions): Promise<void> => {
    await new Promise((done) => setTimeout(done, 0));
    await el.updateComplete;
  };

  const words = (el: HTMLElement): string =>
    [...(el.shadowRoot?.childNodes ?? [])]
      .filter((n) => (n as Element).tagName !== 'STYLE')
      .map((n) => n.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  it('shows what did not load, with the reason', async () => {
    // An extension that does not appear is the hardest thing here to diagnose
    // from outside: the symptom is a placement drawn as unknown, which looks
    // exactly like a typo in a dashboard.
    const el = await mount({
      extensions: {
        loaded: [{ manifest: { id: 'io.homecore.button', name: 'Button', version: '1.1.0' } }],
        failed: [{ id: 'io.example.old', error: 'Wants API version 0; this host implements 1.' }],
      },
    });

    expect(words(el)).toContain('Button');
    expect(words(el)).toContain('1.1.0');
    expect(words(el)).toContain('io.example.old');
    expect(words(el)).toContain('Wants API version 0');
  });

  it('asks for a reload rather than pretending it is live', async () => {
    // A module that defines a custom element cannot be registered twice, so a
    // widget that worked until somebody refreshed would be worse than a
    // sentence asking them to.
    const el = await mount({
      extensions: { loaded: [], failed: [] },
      onInstallExtension: async () => ({ id: 'io.example.dial', files: 3 }),
    });

    const input = el.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [chosen([1, 2, 3])],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await settle(el);

    expect(words(el)).toContain('Installed io.example.dial');
    expect(words(el)).toContain('Reload to use it');
  });

  it('says why an install did not happen, and keeps the chooser', async () => {
    const el = await mount({
      extensions: { loaded: [], failed: [] },
      onInstallExtension: async () => {
        throw new Error('the archive has no hc-extension.json at its root');
      },
    });

    const input = el.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [chosen([1])],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await settle(el);

    expect(words(el)).toContain('no hc-extension.json');
    expect(el.shadowRoot?.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('offers nothing to install without a host that can', async () => {
    const el = await mount({ extensions: { loaded: [], failed: [] } });
    expect(el.shadowRoot?.querySelector('input[type="file"]')).toBeNull();
    expect(words(el)).toContain('may not install');
  });
});
