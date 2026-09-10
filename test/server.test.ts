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
import { Auth, WRITE_SCOPE, mayRead, mayWrite } from '../server/auth.ts';
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

  it('survives two writes to one key at the same time', async () => {
    // Not hypothetical: a settings widget clearing two fields in one gesture
    // sent two writes, and the file was left holding `{}temperature":"C"}` —
    // the shorter body written over the front of the longer one, which is
    // neither of the things anybody asked to store. The household's icon
    // rules go through the same function.
    await Promise.all([
      store.writeContent('prefs', { temperature: 'C', locale: 'de-DE' }),
      store.writeContent('prefs', {}),
      store.writeContent('prefs', { locale: 'fr-FR' }),
    ]);

    // One of the three, whole. Which one is a race and not worth pinning;
    // that it is one of them, and readable, is the property.
    const got = await store.readContent('prefs');
    expect([{ temperature: 'C', locale: 'de-DE' }, {}, { locale: 'fr-FR' }]).toContainEqual(got);
  });

  it('leaves no scratch files behind', async () => {
    // A shared temporary name is two concurrent writes using one scratch
    // file, which is half of how the corruption above happened.
    await Promise.all([
      store.writeContent('a', { n: 1 }),
      store.writeContent('a', { n: 2 }),
      store.writeContent('b', { n: 3 }),
    ]);
    expect((await readdir(join(root, 'content'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('leaves the old content alone when a write is refused', async () => {
    await store.writeContent('keep', { good: true });
    await expect(store.writeContent('keep', { x: 'y'.repeat(2000) })).rejects.toThrow();
    expect(await store.readContent('keep')).toEqual({ good: true });
  });
});

describe('assets', () => {
  it('addresses bytes by their hash, so the same file twice is one file', async () => {
    const bytes = Buffer.from('hello');
    const a = await store.putAsset(bytes);
    const b = await store.putAsset(Buffer.from('hello'));
    expect(a.id).toBe(b.id);
    expect(await readdir(join(root, 'assets'))).toHaveLength(1);
    expect((await store.getAsset(a.id))?.bytes.toString()).toBe('hello');
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

describe('who may read and write', () => {
  const coreSaying = (me: unknown, roles: unknown) =>
    ((url: string) => {
      const s = String(url);
      if (s.endsWith('/auth/me')) {
        return Promise.resolve(
          me === undefined
            ? new Response(null, { status: 401 })
            : new Response(JSON.stringify(me), { status: 200 }),
        );
      }
      if (s.endsWith('/auth/roles')) {
        return Promise.resolve(new Response(JSON.stringify(roles), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as unknown as typeof globalThis.fetch;

  const admin = { id: 'u', username: 'admin', role: 'admin' };
  const roles = [
    { role: 'admin', scopes: ['dashboards:read', 'dashboards:write'] },
    { role: 'viewer', scopes: ['dashboards:read'] },
  ];

  it('finds the bearer, and only a bearer', () => {
    expect(Auth.bearer('Bearer abc')).toBe('abc');
    expect(Auth.bearer('bearer abc')).toBe('abc');
    expect(Auth.bearer('Basic abc')).toBeUndefined();
    expect(Auth.bearer(undefined)).toBeUndefined();
  });

  it('takes core’s word for who somebody is, and what they may do', () => {
    // Verifying the token here would mean sharing core's signing key or
    // inventing a second set of users. Asking is the whole design.
    const auth = new Auth({ fetch: coreSaying(admin, roles) });
    return auth.caller('good').then((caller) => {
      expect(caller?.role).toBe('admin');
      expect(caller?.scopes).toContain(WRITE_SCOPE);
    });
  });

  it('gives a reader no write scope', async () => {
    const auth = new Auth({ fetch: coreSaying({ ...admin, role: 'viewer' }, roles) });
    expect((await auth.caller('good'))?.scopes).not.toContain(WRITE_SCOPE);
  });

  it('refuses a token core refuses', async () => {
    const auth = new Auth({ fetch: coreSaying(undefined, roles) });
    expect(await auth.caller('stale')).toBeUndefined();
  });

  it('authorises nobody when core cannot be reached', async () => {
    // An unreachable core is not an authorisation, and failing closed is the
    // only safe direction.
    const auth = new Auth({
      fetch: (() => Promise.reject(new Error('down'))) as unknown as typeof globalThis.fetch,
    });
    expect(await auth.caller('anything')).toBeUndefined();
  });

  it('asks once per token, not once per key', async () => {
    // A page load reads several keys, and a round trip to core for each would
    // make this server slower than the thing it stores for.
    let asked = 0;
    const auth = new Auth({
      fetch: ((url: string) => {
        if (String(url).endsWith('/auth/me')) asked += 1;
        return coreSaying(admin, roles)(url as unknown as RequestInfo);
      }) as unknown as typeof globalThis.fetch,
    });
    await auth.caller('t');
    await auth.caller('t');
    await auth.caller('t');
    expect(asked).toBe(1);
  });

  it('caches a rejection too', async () => {
    // Otherwise a client retrying with a stale token turns this server into a
    // way to hammer core.
    let asked = 0;
    const auth = new Auth({
      fetch: ((url: string) => {
        if (String(url).endsWith('/auth/me')) asked += 1;
        return Promise.resolve(new Response(null, { status: 401 }));
      }) as unknown as typeof globalThis.fetch,
    });
    await auth.caller('stale');
    await auth.caller('stale');
    expect(asked).toBe(1);
  });
});

describe('which scope decides', () => {
  it('prefers a content scope where core has one', () => {
    // So a core that grows them needs no flag day here.
    expect(mayWrite(['content:write'])).toBe(true);
    expect(mayRead(['content:read'])).toBe(true);
  });

  it('accepts the dashboard scopes where core has not', () => {
    // Not a stopgap: it is the honest existing statement about who may edit
    // dashboard-shaped things, and templates and icon rules are that.
    expect(mayWrite(['dashboards:write'])).toBe(true);
    expect(mayRead(['dashboards:read'])).toBe(true);
  });

  it('refuses a reader either way', () => {
    expect(mayWrite(['dashboards:read', 'content:read'])).toBe(false);
    expect(mayRead([])).toBe(false);
  });
});

describe('an API key is not its owner', () => {
  const coreWith = (me: Record<string, unknown>) =>
    ((url: string) => {
      const s = String(url);
      if (s.endsWith('/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify(me), { status: 200 }));
      }
      if (s.endsWith('/auth/roles')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([{ role: 'admin', scopes: ['dashboards:read', 'dashboards:write'] }]),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as unknown as typeof globalThis.fetch;

  it('takes the scopes the credential carries', async () => {
    // A key names its owner, so `role` is the owner's. A panel's read-only key
    // belonging to an admin must not inherit the admin's write access.
    const auth = new Auth({
      fetch: coreWith({ id: 'u', username: 'admin', role: 'admin', scopes: ['content:read'] }),
    });
    const caller = await auth.caller('hc_sk_panel');
    expect(caller?.role).toBe('admin');
    expect(mayRead(caller?.scopes ?? [])).toBe(true);
    expect(mayWrite(caller?.scopes ?? [])).toBe(false);
  });

  it('falls back to the role against a core that does not report scopes', async () => {
    // Older cores answer `/auth/me` without them, and refusing every caller
    // would be a worse failure than the one this guards against.
    const auth = new Auth({ fetch: coreWith({ id: 'u', username: 'admin', role: 'admin' }) });
    expect(mayWrite((await auth.caller('t'))?.scopes ?? [])).toBe(true);
  });
});
