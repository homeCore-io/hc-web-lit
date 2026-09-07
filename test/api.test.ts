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
