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
 * **Persistence is an adapter, and the choice is not settled.** A browser can
 * keep this per device, which is right for a preference and wrong for content:
 * a wall tablet and a phone would each hold their own idea of what the icon
 * rules are. What is certain is the shape — read, write, remove, list — so
 * that is what is built, with a browser adapter that works today and a memory
 * one for tests and for a device where storage is switched off.
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
