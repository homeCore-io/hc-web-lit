import { describe, expect, it, vi } from 'vitest';
import { HcApi, HcApiError } from '../src/core/api.js';

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  ) as unknown as typeof globalThis.fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const api = (fetch: typeof globalThis.fetch, token?: string) =>
  new HcApi({
    baseUrl: 'http://host:8080/api/v1',
    fetch,
    ...(token !== undefined ? { token } : {}),
  });

describe('HcApi', () => {
  it('logs in and keeps the token for later calls', async () => {
    const seen: string[] = [];
    const fetch = stubFetch((url, init) => {
      seen.push(`${init?.method} ${url}`);
      const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
      if (url.endsWith('/auth/login')) return json({ token: 'jwt-1', token_type: 'Bearer' });
      expect(auth).toBe('Bearer jwt-1');
      return json([]);
    });

    const client = api(fetch);
    expect(client.authenticated).toBe(false);
    await client.login('admin', 'password');
    expect(client.authenticated).toBe(true);
    await client.listDevices();

    expect(seen).toEqual([
      'POST http://host:8080/api/v1/auth/login',
      'GET http://host:8080/api/v1/devices',
    ]);
  });

  it('asks for schemas inline rather than N+1', async () => {
    let asked = '';
    const client = api(
      stubFetch((url) => {
        asked = url;
        return json([]);
      }),
      'jwt',
    );
    await client.listDevices({ includeSchema: true, deviceType: 'light' });
    expect(asked).toContain('device_type=light');
    expect(asked).toContain('include_schema=true');
  });

  it('reports core error bodies rather than just a status line', async () => {
    const client = api(
      stubFetch(() => json({ error: 'schema not found' }, 404)),
      'jwt',
    );
    await expect(client.commandDevice('x', { on: true })).rejects.toThrow(/schema not found/);
  });

  it('turns a missing schema into undefined, since most devices have none', async () => {
    const client = api(
      stubFetch(() => json({ error: 'schema not found' }, 404)),
      'jwt',
    );
    await expect(client.getDeviceSchema('lutron_28')).resolves.toBeUndefined();
  });

  it('flags an auth failure so the shell can re-login rather than retry', async () => {
    const client = api(
      stubFetch(() => json({ error: 'invalid token' }, 401)),
      'jwt',
    );
    await expect(client.listDevices()).rejects.toSatisfy(
      (e) => e instanceof HcApiError && e.isAuthFailure,
    );
  });

  it('accepts 202 from a command without trying to parse a body', async () => {
    const client = api(
      stubFetch(() => new Response(null, { status: 202 })),
      'jwt',
    );
    await expect(client.commandDevice('a', { on: true })).resolves.toBeUndefined();
  });

  it('builds a ws:// stream url with the token in the query', () => {
    const client = api(
      stubFetch(() => json({})),
      'jwt-9',
    );
    const url = client.streamUrl({ type: ['device_state_changed'] });
    expect(url).toBe('ws://host:8080/api/v1/events/stream?token=jwt-9&type=device_state_changed');
  });

  it('refuses to build a stream url with no token', () => {
    expect(() => api(stubFetch(() => json({}))).streamUrl()).toThrow(/not authenticated/);
  });
});

describe('relative base urls', () => {
  it('resolves a relative base against the page for the stream', () => {
    // The base is relative in every real deployment: core sends no CORS
    // headers, so a browser client is always same-origin behind whatever
    // serves it, exactly as hc-web-flutter is behind nginx.
    const client = new HcApi({
      baseUrl: '/api/v1',
      token: 'jwt-2',
      fetch: stubFetch(() => json({})),
    });
    const url = client.streamUrl();
    expect(url).toBe(
      `${globalThis.location.origin.replace(/^http/, 'ws')}/api/v1/events/stream?token=jwt-2`,
    );
  });

  it('still honours an absolute base', () => {
    const client = new HcApi({
      baseUrl: 'https://house.example/api/v1',
      token: 't',
      fetch: stubFetch(() => json({})),
    });
    expect(client.streamUrl()).toBe('wss://house.example/api/v1/events/stream?token=t');
  });
});

describe('a session that outlives its token', () => {
  const session = (over: Record<string, unknown> = {}) => ({
    token: 'first',
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: 'r1',
    refresh_expires_in: 86400,
    user: { id: 'u', username: 'admin', role: 'admin', created_at: '' },
    ...over,
  });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('renews once and retries, so an expired panel keeps working', async () => {
    // The ordinary state of a wall panel that has been up for a month, not an
    // error to show somebody.
    const calls: string[] = [];
    let expired = true;
    const api = new HcApi({
      baseUrl: '/api/v1',
      fetch: ((url: string, init?: RequestInit) => {
        const path = String(url);
        calls.push(`${init?.method ?? 'GET'} ${path}`);
        if (path.endsWith('/auth/login')) return Promise.resolve(json(session()));
        if (path.endsWith('/auth/refresh')) {
          expired = false;
          return Promise.resolve(json(session({ token: 'second', refresh_token: 'r2' })));
        }
        return Promise.resolve(expired ? json({ error: 'expired' }, 401) : json([]));
      }) as unknown as typeof globalThis.fetch,
    });

    await api.login('admin', 'password');
    await api.listDevices();

    expect(calls).toEqual([
      'POST /api/v1/auth/login',
      'GET /api/v1/devices',
      'POST /api/v1/auth/refresh',
      'GET /api/v1/devices',
    ]);
    expect(api.bearer()).toBe('second');
  });

  it('refreshes once for many requests that expire together', async () => {
    // Core: "presenting an already-used token is treated as theft and revokes
    // the entire token chain." Two concurrent refreshes would not lose a
    // request — they would log the house out.
    let refreshes = 0;
    let expired = true;
    const api = new HcApi({
      baseUrl: '/api/v1',
      fetch: ((url: string) => {
        const path = String(url);
        if (path.endsWith('/auth/login')) return Promise.resolve(json(session()));
        if (path.endsWith('/auth/refresh')) {
          refreshes += 1;
          expired = false;
          return Promise.resolve(json(session({ token: 'second', refresh_token: 'r2' })));
        }
        return Promise.resolve(expired ? json({ error: 'expired' }, 401) : json([]));
      }) as unknown as typeof globalThis.fetch,
    });

    await api.login('admin', 'password');
    await Promise.all([api.listDevices(), api.listDashboards(), api.listEvents({ limit: 1 })]);
    expect(refreshes).toBe(1);
  });

  it('gives up rather than presenting a credential core has revoked', async () => {
    // A client that keeps offering a dead refresh token looks to core exactly
    // like the theft the rotation exists to detect.
    const api = new HcApi({
      baseUrl: '/api/v1',
      fetch: ((url: string) => {
        const path = String(url);
        if (path.endsWith('/auth/login')) return Promise.resolve(json(session()));
        if (path.endsWith('/auth/refresh')) return Promise.resolve(json({ error: 'no' }, 401));
        return Promise.resolve(json({ error: 'expired' }, 401));
      }) as unknown as typeof globalThis.fetch,
    });

    await api.login('admin', 'password');
    await expect(api.listDevices()).rejects.toThrow();
    expect(api.bearer()).toBeUndefined();
  });

  it('does not try to renew the login itself', async () => {
    // A bad password is a refusal, not an expiry, and retrying it with a
    // refresh token would be answering a question nobody asked.
    const seen: string[] = [];
    const api = new HcApi({
      baseUrl: '/api/v1',
      fetch: ((url: string) => {
        seen.push(String(url));
        return Promise.resolve(json({ error: 'bad credentials' }, 401));
      }) as unknown as typeof globalThis.fetch,
    });
    await expect(api.login('admin', 'wrong')).rejects.toThrow();
    expect(seen).toEqual(['/api/v1/auth/login']);
  });
});
