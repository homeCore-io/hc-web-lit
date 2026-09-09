/**
 * hc-web-lit's own storage.
 *
 * The client is a self-contained system, so what a household authored lives
 * here rather than in core. These drive the store directly — the HTTP layer
 * around it is thin, and what is worth pinning is the part that touches a
 * disk.
 */
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../server/store.ts';
import { ServerContent } from '../src/core/content.js';

let store: Store;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hc-store-'));
  store = new Store(root, { maxBytes: 1024, maxTotalBytes: 0 });
});

describe('content on a disk', () => {
  it('round-trips', async () => {
    await store.writeContent('icon-rules', [{ match: 'holiday', icon: 'light' }]);
    expect(await store.readContent('icon-rules')).toEqual([{ match: 'holiday', icon: 'light' }]);
    expect(await store.keys()).toEqual(['icon-rules']);
  });

  it('is a directory somebody can read', async () => {
    // Files rather than a database, because a household is one household and
    // a directory is inspectable and backed up by copying.
    await store.writeContent('templates', []);
    expect(await readdir(join(root, 'content'))).toEqual(['templates.json']);
  });

  it('refuses a key that would wander out of the store', async () => {
    await expect(store.writeContent('../../etc/passwd', {})).rejects.toThrow();
    expect(await store.readContent('../../etc/passwd')).toBeUndefined();
  });

  it('refuses something larger than the limit', async () => {
    await expect(store.writeContent('big', { x: 'y'.repeat(2000) })).rejects.toThrow('too large');
  });

  it('reads a corrupt file as a missing one', async () => {
    await store.writeContent('ok', {});
    await writeFile(join(root, 'content', 'broken.json'), 'not json');
    expect(await store.readContent('broken')).toBeUndefined();
  });

  it('has nothing to say about a store that was never written to', async () => {
    expect(await store.keys()).toEqual([]);
    expect(await store.readContent('anything')).toBeUndefined();
  });
});

describe('assets', () => {
  it('addresses bytes by their hash, so the same file twice is one file', async () => {
    const bytes = Buffer.from('hello');
    const a = await store.putAsset(bytes);
    const b = await store.putAsset(Buffer.from('hello'));
    expect(a.id).toBe(b.id);
    expect(await readdir(join(root, 'assets'))).toHaveLength(1);
    expect((await store.getAsset(a.id))?.toString()).toBe('hello');
  });

  it('has nothing for an id that is not one', async () => {
    expect(await store.getAsset('../../etc/passwd')).toBeUndefined();
    expect(await store.getAsset('a'.repeat(64))).toBeUndefined();
  });
});

describe('the client adapter', () => {
  const responses = (map: Record<string, unknown>) =>
    ((url: string) => {
      const key = String(url);
      if (!(key in map)) return Promise.resolve(new Response(null, { status: 404 }));
      return Promise.resolve(
        new Response(JSON.stringify(map[key]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof globalThis.fetch;

  it('loads everything once, so a render never awaits', async () => {
    // A widget asking for an icon rule cannot await one mid-render, which is
    // why the interface is synchronous and this reads ahead.
    const c = new ServerContent({
      fetch: responses({
        '/api/content': { keys: ['icon-rules'] },
        '/api/content/icon-rules': [{ match: 'fan', icon: 'fan' }],
      }),
    });
    expect(await c.load()).toBe(true);
    expect(c.read('icon-rules')).toEqual([{ match: 'fan', icon: 'fan' }]);
    expect(c.keys()).toEqual(['icon-rules']);
  });

  it('says so when there is no server, rather than pretending to be empty', async () => {
    // A deployment of static files is supported, and the host falls back to
    // the browser's own storage — but only if it can tell the difference.
    const c = new ServerContent({
      fetch: (() =>
        Promise.reject(new Error('nothing there'))) as unknown as typeof globalThis.fetch,
    });
    expect(await c.load()).toBe(false);
  });

  it('applies a write immediately and posts it behind', async () => {
    const seen: string[] = [];
    const c = new ServerContent({
      fetch: ((url: string, init?: RequestInit) => {
        seen.push(`${init?.method ?? 'GET'} ${String(url)}`);
        return Promise.resolve(new Response(null, { status: 204 }));
      }) as unknown as typeof globalThis.fetch,
    });
    c.write('icon-rules', [1]);
    // A person who edits a rule sees it apply; a failed write costs the next
    // reload, not the edit.
    expect(c.read('icon-rules')).toEqual([1]);
    expect(seen).toEqual(['PUT /api/content/icon-rules']);
  });
});
