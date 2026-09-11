/**
 * A household's own pictures, offered where a picture is asked for (§9).
 *
 * The store could hold a file and serve it back long before anything in the
 * GUI could reach it: a `url` field was a box you typed a URL into, so the one
 * place a household's photograph could come from was somewhere else on the
 * network.
 */
import { describe, expect, it, vi } from 'vitest';
import { AssetSource, assetUrl, isAssetUrl } from '../src/core/assets.js';
import { propertiesFor } from '../src/core/properties.js';
import fixture from './fixtures/vocabulary.json' with { type: 'json' };
import { readVocabulary, widgetSpec, type Vocabulary } from '../src/core/vocabulary.js';

const vocabulary = readVocabulary(fixture) as Vocabulary;
const hash = 'a'.repeat(64);

describe('where a stored picture lives', () => {
  it('is the store path, which is what a url field holds', () => {
    expect(assetUrl(hash)).toBe(`/api/assets/${hash}`);
    expect(isAssetUrl(assetUrl(hash))).toBe(true);
  });

  it('knows a link to somewhere else when it sees one', () => {
    expect(isAssetUrl('https://example.test/cat.png')).toBe(false);
    expect(isAssetUrl('/api/assets/nope')).toBe(false);
    expect(isAssetUrl(undefined)).toBe(false);
  });
});

describe('a field that takes a picture', () => {
  it('is offered the store, on every widget that has one', () => {
    for (const type of ['image', 'camera_video', 'web_embed', 'floor_plan']) {
      const url = propertiesFor(widgetSpec(vocabulary, type), {}).find((p) => p.name === 'url');
      expect(url, `${type} has no url field`).toBeDefined();
      expect(url?.suggest, `${type}.url offers nothing`).toBe('asset');
    }
  });

  it('still takes anything, because a suggestion is not a restriction', () => {
    // A household with a camera on its own network must be able to type its
    // address; the store is an offer, not the only answer.
    const url = propertiesFor(widgetSpec(vocabulary, 'image'), {
      url: 'https://example.test/cat.png',
    }).find((p) => p.name === 'url');
    expect(url?.form).toBe('text');
    expect(url?.options).toBeUndefined();
    expect(url?.problem).toBeUndefined();
  });
});

describe('reading and writing the store', () => {
  const listing = (assets: unknown): typeof globalThis.fetch =>
    vi.fn(async () => new Response(JSON.stringify({ assets }), { status: 200 })) as never;

  it('lists what is there', async () => {
    const source = new AssetSource({ fetch: listing([{ id: hash, kind: 'png', bytes: 2048 }]) });
    expect(await source.list()).toEqual([{ id: hash, kind: 'png', bytes: 2048 }]);
  });

  it('is empty rather than broken where there is no store', async () => {
    // This client runs against a plain static deployment too, and a picker
    // reporting an error there would report the absence of a server nobody was
    // promised.
    const dead = vi.fn(async () => {
      throw new Error('no server');
    }) as never;
    expect(await new AssetSource({ fetch: dead }).list()).toEqual([]);

    const refused = vi.fn(async () => new Response('', { status: 404 })) as never;
    expect(await new AssetSource({ fetch: refused }).list()).toEqual([]);
  });

  it('ignores a row that says nothing useful', async () => {
    const source = new AssetSource({ fetch: listing([{ kind: 'png' }, { id: hash }]) });
    expect(await source.list()).toEqual([{ id: hash, kind: '', bytes: 0 }]);
  });

  it('is empty for a body that is not a listing at all', async () => {
    expect(await new AssetSource({ fetch: listing('nope') }).list()).toEqual([]);
  });

  it('sends the bytes and reports where they landed', async () => {
    const sent: RequestInit[] = [];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(init);
      return new Response(JSON.stringify({ id: hash, kind: 'png', bytes: 3 }), { status: 201 });
    }) as never;

    const got = await new AssetSource({ fetch: fetcher, token: () => 'tok' }).upload(
      new Blob([new Uint8Array([1, 2, 3])]),
    );
    expect(got).toEqual({ id: hash, kind: 'png', bytes: 3 });
    expect(sent[0]?.method).toBe('POST');
    // The bytes go up raw: a filename and a declared type would both be claims
    // the store has no reason to believe, and it sniffs them anyway.
    expect((sent[0]?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/octet-stream',
    );
    expect((sent[0]?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('says so plainly when the store refuses', async () => {
    const refused = vi.fn(async () => new Response('', { status: 413 })) as never;
    await expect(new AssetSource({ fetch: refused }).upload(new Blob(['x']))).rejects.toThrow(
      'Not stored: 413',
    );
  });
});
