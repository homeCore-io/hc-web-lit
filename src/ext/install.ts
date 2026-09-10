/**
 * Loading what is installed, at startup (§8.1, §18.2).
 *
 * `host.ts` loads *one* extension. This asks the server what is installed and
 * loads all of them — the step that turns a passing acceptance test into a
 * third party actually being able to ship a widget, which §18.2 names as the
 * first thing that has to be true before the Flutter client can be retired.
 *
 * **Before the first dashboard is drawn, and everything waits.** A widget type
 * that resolves a moment after the page is painted is worse than one that
 * never resolves: the placement renders as unknown, then silently becomes
 * something else, and an author watching it cannot tell whether their config
 * is wrong. So this runs to completion first, and a slow extension delays the
 * page rather than half-loading it.
 *
 * **One failure never costs the others.** Every load is caught
 * individually — an extension that throws, defines nothing, or names a tag it
 * never registered leaves the rest installed and the page intact. §8.1 is
 * explicit that this is what in-realm loading owes in exchange for not being
 * sandboxed: a wall display that goes blank because a widget somebody
 * installed has a typo is the failure mode that stops people installing
 * anything.
 */
import { loadExtension, type Importer, type LoadedExtension } from './host.js';

/** What a load round produced, for the shell to report. */
export interface InstalledExtensions {
  loaded: LoadedExtension[];
  /** Everything that did not load, each with a reason worth showing. */
  failed: { id: string; error: string }[];
}

export interface ExtensionSourceOptions {
  /** Where the store is. Same-origin in every real deployment. */
  base?: string;
  /** The app's bearer — the listing is behind the door, the modules are not. */
  token?: () => string | undefined;
  fetch?: typeof globalThis.fetch;
  /** Injectable, so a test needs neither a server nor a network. */
  load?: Importer;
}

/** A manifest as it arrives, before `readManifest` has had an opinion. */
interface RawListing {
  manifests?: unknown[];
  broken?: { id: string; error: string }[];
}

export class ExtensionSource {
  private readonly base: string;
  private readonly token: (() => string | undefined) | undefined;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly load: Importer | undefined;

  constructor(opts: ExtensionSourceOptions = {}) {
    this.base = (opts.base ?? '/api/extensions').replace(/\/+$/, '');
    this.token = opts.token;
    this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.load = opts.load;
  }

  /**
   * Load everything installed, and report what did not.
   *
   * A store that cannot be reached is not an error worth stopping for: this
   * client runs against a plain static deployment too, where there is no
   * extension store and never was. The first-party widgets are compiled in,
   * so the page is complete without any of this.
   */
  async installAll(): Promise<InstalledExtensions> {
    let listing: RawListing;
    try {
      const headers: Record<string, string> = {};
      const bearer = this.token?.();
      if (bearer !== undefined) headers['Authorization'] = `Bearer ${bearer}`;

      const res = await this.doFetch(this.base, { headers });
      if (!res.ok) return { loaded: [], failed: [] };
      listing = (await res.json()) as RawListing;
    } catch {
      return { loaded: [], failed: [] };
    }

    const loaded: LoadedExtension[] = [];
    // A directory the server could not read a manifest out of is already a
    // failure with a reason; it is carried through rather than re-derived.
    const failed = [...(listing.broken ?? [])];

    for (const raw of listing.manifests ?? []) {
      const id = idOf(raw);
      try {
        const result = await loadExtension(raw, `${this.base}/${id}`, this.load);
        if ('error' in result) failed.push({ id, error: result.error });
        else loaded.push(result);
      } catch (e) {
        // `loadExtension` catches the import itself; this is for the ways a
        // module can misbehave *after* it resolves — a top-level throw during
        // element registration, most likely.
        failed.push({ id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return { loaded, failed };
  }

  /**
   * Install an archive somebody was handed.
   *
   * §18.2's first retirement condition, from this side: the household picks a
   * `.tar.gz` and the widget is available. What the archive may contain is
   * `server/tar.ts`'s business — this only carries the bytes and the reason it
   * was refused.
   *
   * **It does not load what it installed.** A module that defines a custom
   * element cannot be loaded twice in one page — `customElements.define`
   * throws on a second registration — so an extension that arrives after
   * startup is available on the next reload and says so. Pretending otherwise
   * would mean a widget that works until somebody refreshes, or a page that
   * throws while installing.
   */
  async install(archive: ArrayBuffer | Uint8Array): Promise<{ id: string; files: number }> {
    const headers: Record<string, string> = { 'content-type': 'application/gzip' };
    const bearer = this.token?.();
    if (bearer !== undefined) headers['Authorization'] = `Bearer ${bearer}`;

    const res = await this.doFetch(this.base, {
      method: 'POST',
      headers,
      body: archive as BodyInit,
    });

    const said = (await res.json().catch(() => ({}))) as {
      id?: string;
      files?: number;
      error?: string;
    };
    if (!res.ok) throw new Error(said.error ?? `the store refused it (${res.status})`);
    return { id: said.id ?? '(unnamed)', files: said.files ?? 0 };
  }
}

/**
 * The id to serve from, before the manifest has been validated.
 *
 * `readManifest` runs inside `loadExtension` and is the authority, but the URL
 * has to be built first — and a manifest with no usable id gets a name here
 * only so the failure can be reported against something.
 */
function idOf(raw: unknown): string {
  const id = (raw as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id !== '' ? id : '(unnamed)';
}
