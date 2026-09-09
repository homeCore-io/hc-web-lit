/**
 * What a person authored, kept by the client.
 *
 * Templates, icon rules, and whatever comes next are *user content*: things
 * somebody made, not facts about the house. They ended up in core because the
 * previous client compiled ahead of time and could not hold anything — core
 * grew `/assets` and `/dashboards/templates` to carry them — and that is
 * coming out of core once a client can do it. So nothing here reads those
 * endpoints; building on them would be asking for the removal to break this
 * client too.
 *
 * **Two adapters, and the difference between them matters.** hc-web-lit is a
 * self-contained system with storage of its own, so `ServerContent` is the
 * real one: content written on a phone is there on the wall tablet, because
 * there is one copy of it. `BrowserContent` keeps things per device, which is
 * right for a preference and wrong for content two devices should agree on —
 * it is the fallback for a deployment serving only static files, and the thing
 * that keeps the app working before the server is running.
 */

/** Somewhere to keep a small amount of JSON. */
export interface ContentStore {
  read<T>(key: string): T | undefined;
  write<T>(key: string, value: T): void;
  remove(key: string): void;
  keys(): string[];
}

/** The prefix, so this client's content is distinguishable from anything else's. */
const NS = 'hc.content.';

/**
 * The browser's own storage.
 *
 * Every operation is guarded. `localStorage` throws rather than returning
 * undefined in three ordinary situations — private browsing, a quota that is
 * full, and an administrator turning site data off — and a dashboard that
 * fails to start because it could not save a preference is a worse product
 * than one that forgets the preference.
 */
export class BrowserContent implements ContentStore {
  read<T>(key: string): T | undefined {
    try {
      const raw = globalThis.localStorage?.getItem(NS + key);
      return raw === null || raw === undefined ? undefined : (JSON.parse(raw) as T);
    } catch {
      // Unreadable or not JSON. Either way there is nothing to return, and a
      // corrupt entry should not be louder than a missing one.
      return undefined;
    }
  }

  write<T>(key: string, value: T): void {
    try {
      globalThis.localStorage?.setItem(NS + key, JSON.stringify(value));
    } catch {
      // Full, or disabled. The content still exists in memory for this
      // session; it simply will not be here next time.
    }
  }

  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(NS + key);
    } catch {
      // Nothing to do about it, and nothing worth stopping for.
    }
  }

  keys(): string[] {
    try {
      const store = globalThis.localStorage;
      if (store === undefined) return [];
      const out: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k !== null && k.startsWith(NS)) out.push(k.slice(NS.length));
      }
      return out;
    } catch {
      return [];
    }
  }
}

/** For tests, and for a browser that has said no. */
export class MemoryContent implements ContentStore {
  private readonly map = new Map<string, unknown>();

  read<T>(key: string): T | undefined {
    return this.map.get(key) as T | undefined;
  }

  write<T>(key: string, value: T): void {
    // Round-tripped through JSON so a caller cannot keep a live reference into
    // the store and change what is "saved" without saving it — the one way a
    // memory store behaves differently from a real one.
    this.map.set(key, JSON.parse(JSON.stringify(value)) as unknown);
  }

  remove(key: string): void {
    this.map.delete(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

/**
 * hc-web-lit's own storage, over its own HTTP API.
 *
 * **Read once, then served from memory.** A `ContentStore` is synchronous
 * because a widget asking for an icon rule cannot await one mid-render, so
 * this loads everything at startup and writes through in the background. That
 * is honest for what this holds — a household's rules and templates, kilobytes
 * of it, changing when somebody edits them — and would not be for anything
 * large or shared between writers.
 */
export class ServerContent implements ContentStore {
  private readonly cache = new Map<string, unknown>();
  private readonly base: string;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly token: () => string | undefined;

  constructor(
    opts: {
      base?: string;
      fetch?: typeof globalThis.fetch;
      /** Core's bearer, which this server checks with core (§8.2). */
      token?: () => string | undefined;
    } = {},
  ) {
    this.base = opts.base ?? '/api/content';
    this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.token = opts.token ?? (() => undefined);
  }

  /** The credential, read at call time: a session can be renewed under us. */
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const token = this.token();
    return token === undefined ? extra : { ...extra, authorization: `Bearer ${token}` };
  }

  /**
   * Load what the server holds.
   *
   * Returns whether it answered, so a host can fall back rather than start an
   * app that silently forgets everything: a deployment of static files has no
   * server here, and that is a supported way to run this.
   */
  async load(): Promise<boolean> {
    try {
      const res = await this.doFetch(this.base, { headers: this.headers() });
      if (!res.ok) return false;
      const { keys } = (await res.json()) as { keys?: string[] };
      for (const key of keys ?? []) {
        const one = await this.doFetch(`${this.base}/${key}`, { headers: this.headers() });
        if (one.ok) this.cache.set(key, await one.json());
      }
      return true;
    } catch {
      return false;
    }
  }

  read<T>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined;
  }

  write<T>(key: string, value: T): void {
    // In memory immediately, on disk when the round trip finishes. A person
    // who edits a rule sees it apply; a failed write costs the next reload,
    // not the edit.
    this.cache.set(key, value);
    void this.doFetch(`${this.base}/${key}`, {
      method: 'PUT',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(value),
    }).catch(() => undefined);
  }

  remove(key: string): void {
    this.cache.delete(key);
    void this.doFetch(`${this.base}/${key}`, {
      method: 'DELETE',
      headers: this.headers(),
    }).catch(() => undefined);
  }

  keys(): string[] {
    return [...this.cache.keys()];
  }
}
