/**
 * Who is asking, answered by core.
 *
 * hc-web-lit holds a household's own content, and the household already has an
 * identity system: core issues the bearer, knows the roles and defines the
 * scopes. Verifying the token here would mean either sharing core's signing
 * key — a second place a secret lives — or inventing a second set of users,
 * which is how two systems come to disagree about who somebody is.
 *
 * So this asks. `GET /auth/me` with the caller's own token answers 200 with a
 * role or 401, and `GET /auth/roles` says what a role may do. Both are cached
 * briefly, because a page load reads several keys and a round trip to core per
 * key would make this server slower than the thing it is storing for.
 */

export interface Caller {
  id: string;
  username: string;
  role: string;
  scopes: string[];
}

/**
 * The scopes authored content sits under.
 *
 * Core defines eighteen, and none of them is about a client: the closest true
 * statement is that templates and icon rules are dashboard-shaped work, so
 * they take the dashboard scopes. Every role core ships can read dashboards;
 * `read_only`, `observer` and `device_operator` cannot write them, which is
 * exactly the line this content wants drawn.
 *
 * If core ever grows a scope for a client's own content, these two constants
 * are the whole change here.
 */
export const READ_SCOPE = 'dashboards:read';
export const WRITE_SCOPE = 'dashboards:write';

interface Cached<T> {
  value: T;
  until: number;
}

export class Auth {
  private readonly base: string;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly ttlMs: number;
  private readonly callers = new Map<string, Cached<Caller | undefined>>();
  private roles: Cached<Map<string, string[]>> | undefined;

  constructor(opts: { base?: string; fetch?: typeof globalThis.fetch; ttlMs?: number } = {}) {
    this.base = opts.base ?? process.env['HC_CORE_URL'] ?? 'http://10.0.10.150:8080';
    this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    // Short: long enough that a page load is one round trip, short enough that
    // revoking somebody takes effect while they are still looking at it.
    this.ttlMs = opts.ttlMs ?? 60_000;
  }

  /** The bearer in a request, or undefined. */
  static bearer(header: string | undefined): string | undefined {
    const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
    return m?.[1]?.trim();
  }

  private async scopesFor(role: string): Promise<string[]> {
    if (this.roles === undefined || this.roles.until < Date.now()) {
      const map = new Map<string, string[]>();
      try {
        const res = await this.doFetch(`${this.base}/api/v1/auth/roles`);
        if (res.ok) {
          const list = (await res.json()) as { role?: string; scopes?: string[] }[];
          for (const r of list) if (r.role !== undefined) map.set(r.role, r.scopes ?? []);
        }
      } catch {
        // Core is not answering. An empty map means no write is authorised,
        // which is the safe direction to fail in.
      }
      this.roles = { value: map, until: Date.now() + 5 * this.ttlMs };
    }
    return this.roles.value.get(role) ?? [];
  }

  /**
   * Who this token belongs to, or undefined.
   *
   * A rejection is cached like an acceptance, so a client retrying with a
   * stale token cannot turn this server into a way to hammer core's login.
   */
  async caller(token: string | undefined): Promise<Caller | undefined> {
    if (token === undefined || token === '') return undefined;

    const hit = this.callers.get(token);
    if (hit !== undefined && hit.until > Date.now()) return hit.value;

    let caller: Caller | undefined;
    try {
      const res = await this.doFetch(`${this.base}/api/v1/auth/me`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const me = (await res.json()) as { id?: string; username?: string; role?: string };
        if (me.role !== undefined) {
          caller = {
            id: me.id ?? '',
            username: me.username ?? '',
            role: me.role,
            scopes: await this.scopesFor(me.role),
          };
        }
      }
    } catch {
      // Unreachable core is not an authorisation. Nothing is served.
      caller = undefined;
    }

    this.callers.set(token, { value: caller, until: Date.now() + this.ttlMs });
    return caller;
  }

  /** Forget everything, for a test or a signal. */
  clear(): void {
    this.callers.clear();
    this.roles = undefined;
  }
}
