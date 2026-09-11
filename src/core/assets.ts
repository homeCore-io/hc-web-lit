/**
 * A household's own pictures (§9).
 *
 * The store has been able to hold a file and serve it back since the panel
 * path landed, and nothing in the GUI could reach it: a `url` field was a box
 * you typed a URL into, so the one place a household's own photograph could
 * come from was somewhere else on the network. That is the same shape of gap
 * `layer` had — a capability complete in every part except the one that lets a
 * person use it.
 *
 * **Reads and writes go through the host, not the widget** (§19.4). A widget
 * holds no token and no base URL; the panel is handed a list and a way to add
 * to it, and has no idea where either came from.
 */

/** One file in the store, as the listing describes it. */
export interface StoredAsset {
  id: string;
  /** What `sniff` decided it was — `png`, `svg`, and so on. */
  kind: string;
  bytes: number;
}

export interface AssetSourceOptions {
  base?: string;
  token?: () => string | undefined;
  fetch?: typeof globalThis.fetch;
}

/** Where a stored asset is served from, which is what a `url` field holds. */
export function assetUrl(id: string, base = '/api/assets'): string {
  return `${base.replace(/\/+$/, '')}/${id}`;
}

/** Whether a value already points at the store rather than out of it. */
export function isAssetUrl(value: unknown): boolean {
  return typeof value === 'string' && /^\/api\/assets\/[0-9a-f]{64}$/.test(value);
}

export class AssetSource {
  private readonly base: string;
  private readonly token: (() => string | undefined) | undefined;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(opts: AssetSourceOptions = {}) {
    this.base = (opts.base ?? '/api/assets').replace(/\/+$/, '');
    this.token = opts.token;
    this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private headers(): Record<string, string> {
    const bearer = this.token?.();
    return bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` };
  }

  /**
   * What is in the store.
   *
   * **An empty list rather than a failure.** This client runs against a plain
   * static deployment too, where there is no store and never was — and a
   * picker that reported an error there would be reporting the absence of a
   * server nobody was promised.
   */
  async list(): Promise<StoredAsset[]> {
    try {
      const res = await this.doFetch(this.base, { headers: this.headers() });
      if (!res.ok) return [];
      const body = (await res.json()) as { assets?: unknown };
      if (!Array.isArray(body.assets)) return [];
      return body.assets.flatMap((a) => {
        const row = a as Partial<StoredAsset>;
        return typeof row.id === 'string'
          ? [{ id: row.id, kind: String(row.kind ?? ''), bytes: Number(row.bytes ?? 0) }]
          : [];
      });
    } catch {
      return [];
    }
  }

  /**
   * Put a file in the store, and say where it now lives.
   *
   * The bytes go up raw rather than as a form: the store sniffs what they are
   * and names the file from the hash of them (`server/store.ts`), so a
   * filename and a declared type would both be claims it has no reason to
   * believe. Uploading the same picture twice is the same id, which is what
   * makes a household's store stop growing once it holds what it needs.
   */
  async upload(file: Blob): Promise<StoredAsset> {
    const res = await this.doFetch(this.base, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/octet-stream' },
      // The blob itself, not its bytes read into memory first: `fetch` streams
      // it, and a household's photograph should not have to fit in a string on
      // the way to a store that is usually on the same machine.
      body: file,
    });
    if (!res.ok) throw new Error(`Not stored: ${res.status}`);
    const got = (await res.json()) as Partial<StoredAsset>;
    if (typeof got.id !== 'string') throw new Error('The store said nothing useful.');
    return { id: got.id, kind: String(got.kind ?? ''), bytes: Number(got.bytes ?? 0) };
  }
}
