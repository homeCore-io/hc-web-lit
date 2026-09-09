/**
 * Loading what is installed (§8.1, §18.2).
 *
 * `extension.test.ts` proves one extension can be loaded. This proves the step
 * that makes that matter: the app asks what is installed and loads all of it,
 * and **one bad extension never costs the others**. §8.1 says that is what
 * in-realm loading owes in exchange for not being sandboxed, so it is pinned
 * here rather than left to the shape of the code.
 */
import { describe, expect, it, vi } from 'vitest';
import { ExtensionSource } from '../src/ext/install.js';
import { tagFor } from '../src/core/registry.js';

const manifest = (over: Record<string, unknown> = {}) => ({
  id: 'com.example.one',
  name: 'One',
  version: '1.0.0',
  hcApiVersion: '1',
  entry: './one.js',
  provides: { widgets: [{ tag: 'ext-one', widget_id: 'one', name: 'One' }] },
  ...over,
});

/** A listing endpoint that answers with whatever this test wants. */
const serving = (body: unknown, ok = true) =>
  vi.fn(async () =>
    Promise.resolve({ ok, json: async () => Promise.resolve(body) } as unknown as Response),
  ) as unknown as typeof globalThis.fetch;

/** Defines the element the way a real module's top level would. */
const defines = (tag: string) => async () => {
  if (customElements.get(tag) === undefined) {
    customElements.define(tag, class extends HTMLElement {});
  }
};

describe('loading the store', () => {
  it('loads what is installed and registers its widget types', async () => {
    const source = new ExtensionSource({
      fetch: serving({ manifests: [manifest()], broken: [] }),
      load: defines('ext-one'),
    });

    const got = await source.installAll();
    expect(got.failed).toEqual([]);
    expect(got.loaded).toHaveLength(1);
    // The point of all of it: a document type that no first-party widget
    // implements now resolves to an element (§14.3 — `type` is a plain string
    // and core accepts ones it has never heard of).
    expect(tagFor('one')).toBe('ext-one');
  });

  it('asks the store from the right place, with the app’s bearer', async () => {
    const fetched = serving({ manifests: [], broken: [] });
    await new ExtensionSource({ fetch: fetched, token: () => 'tok' }).installAll();

    const [url, init] = (fetched as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/api/extensions');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('imports the entry under the extension’s own id, cache-busted by version', async () => {
    const load = vi.fn(defines('ext-two'));
    await new ExtensionSource({
      fetch: serving({ manifests: [manifest({ id: 'com.example.two', version: '2.3.4' })] }),
      load,
    }).installAll();

    // §8.1: the `?v=` keyed on manifest version is what makes an update take
    // effect on reload without service-worker gymnastics.
    expect(load).toHaveBeenCalledWith('/api/extensions/com.example.two/one.js?v=2.3.4');
  });
});

describe('one extension misbehaving', () => {
  it('does not stop the ones after it', async () => {
    const source = new ExtensionSource({
      fetch: serving({
        manifests: [
          manifest({ id: 'com.example.bad', entry: './bad.js' }),
          manifest({
            id: 'com.example.good',
            provides: { widgets: [{ tag: 'ext-good', widget_id: 'good', name: 'Good' }] },
          }),
        ],
      }),
      load: async (url) => {
        if (url.includes('bad.js')) throw new Error('boom');
        return defines('ext-good')();
      },
    });

    const got = await source.installAll();
    // A wall display that goes blank because a widget somebody installed has a
    // typo is the failure mode that stops people installing anything (§8.1).
    expect(got.loaded.map((l) => l.manifest.id)).toEqual(['com.example.good']);
    expect(got.failed).toHaveLength(1);
    expect(got.failed[0]?.id).toBe('com.example.bad');
    expect(got.failed[0]?.error).toContain('boom');
    expect(tagFor('good')).toBe('ext-good');
  });

  it('reports a version this host does not implement, by name', async () => {
    const got = await new ExtensionSource({
      fetch: serving({ manifests: [manifest({ id: 'com.example.future', hcApiVersion: '9' })] }),
      load: defines('ext-future'),
    }).installAll();

    expect(got.loaded).toEqual([]);
    // §4.3: the host refuses and says so, rather than half-loading.
    expect(got.failed[0]).toMatchObject({ id: 'com.example.future' });
    expect(got.failed[0]?.error).toContain('API version 9');
  });

  it('carries through a directory the server could not read a manifest from', async () => {
    const got = await new ExtensionSource({
      fetch: serving({
        manifests: [],
        broken: [{ id: 'half-copied', error: 'No hc-extension.json.' }],
      }),
    }).installAll();

    // The admin's real question is "why did nothing appear", and a directory
    // with no manifest is the commonest answer.
    expect(got.failed).toEqual([{ id: 'half-copied', error: 'No hc-extension.json.' }]);
  });
});

describe('a deployment with no extension store', () => {
  it('starts, and is simply a client with the first-party widgets', async () => {
    // A plain static deployment is supported (§ content.ts), and there is no
    // store there and never was. That is not an error to show anybody.
    const got = await new ExtensionSource({ fetch: serving({}, false) }).installAll();
    expect(got).toEqual({ loaded: [], failed: [] });

    const offline = new ExtensionSource({
      fetch: (() => Promise.reject(new Error('offline'))) as unknown as typeof globalThis.fetch,
    });
    expect(await offline.installAll()).toEqual({ loaded: [], failed: [] });
  });
});
