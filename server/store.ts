/**
 * The bytes hc-web-lit keeps.
 *
 * hc-web-lit is a self-contained system: it serves itself and holds what a
 * household authored — templates, icon rules, images — as small or as large as
 * the end user decides. That is the arrangement the previous client could not
 * have, and the reason core grew `/assets` and `/dashboards/templates` at all.
 * Those are coming out; this is where their contents belong.
 *
 * **Files on a disk, not a database.** Everything here is small JSON and a few
 * images, a household is one household, and a directory is inspectable,
 * backed up by copying, and survives this program being replaced. A database
 * would be a dependency bought with nothing.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { sanitiseSvg, sniff } from './assets.ts';

/** A key is a file name, so it may not wander out of the directory. */
const SAFE_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** An asset is addressed by the sha256 of its bytes, like core's. */
const SAFE_ID = /^[0-9a-f]{64}$/;

export interface Limits {
  /** Refuse a single item larger than this. */
  maxBytes: number;
  /** Refuse a write that would take the whole store past this. 0 is no cap. */
  maxTotalBytes: number;
}

export class Store {
  /**
   * Plain fields, not constructor parameter properties.
   *
   * Node runs TypeScript by *stripping* types, which erases annotations and
   * transforms nothing — and a parameter property is the one piece of TS
   * syntax that emits code. Using them would mean this server needs a build
   * step, which is most of what "self-contained" was supposed to avoid.
   */
  private readonly root: string;
  readonly limits: Limits;

  constructor(root: string, limits: Limits) {
    this.root = root;
    this.limits = limits;
  }

  private path(...parts: string[]): string {
    const full = resolve(join(this.root, ...parts));
    // Belt and braces: the key patterns already forbid it, and a path that
    // escaped the root would be the worst bug this file could have.
    if (!full.startsWith(resolve(this.root))) throw new Error('outside the store');
    return full;
  }

  async readContent(key: string): Promise<unknown | undefined> {
    if (!SAFE_KEY.test(key)) return undefined;
    try {
      return JSON.parse(await readFile(this.path('content', `${key}.json`), 'utf8')) as unknown;
    } catch {
      // Absent, or not JSON. A caller asking for something that is not there
      // is ordinary; a caller asking for something corrupt gets the same
      // answer, because there is nothing useful to hand back either way.
      return undefined;
    }
  }

  /**
   * One write at a time, per key.
   *
   * Two writes to the same key in flight together is not a hypothetical: a
   * settings widget that clears two fields in the same gesture sends two, and
   * this store held `{}temperature":"C"}` afterwards — the shorter body
   * written over the front of the longer one. A household's icon rules go
   * through here too.
   */
  private readonly writing = new Map<string, Promise<void>>();

  async writeContent(key: string, value: unknown): Promise<void> {
    if (!SAFE_KEY.test(key)) throw new Error('bad key');
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > this.limits.maxBytes) throw new Error('too large');

    // Queued behind whatever is already writing this key, so the file holds
    // one of the bodies rather than a blend of two. A failed write must not
    // block the next one, hence the caught predecessor.
    const after = (this.writing.get(key) ?? Promise.resolve()).catch(() => undefined);
    const mine = after.then(() => this.replace(this.path('content', `${key}.json`), body));
    this.writing.set(key, mine);
    try {
      await mine;
    } finally {
      if (this.writing.get(key) === mine) this.writing.delete(key);
    }
  }

  /**
   * Put these bytes there, or leave what was there alone.
   *
   * **Written beside and renamed**, which the previous version said it did
   * and did not: it wrote a temporary file, deleted the target, wrote the
   * target directly and deleted the temporary — so the window where the file
   * did not exist, or held half a body, was real. `rename` over an existing
   * file is atomic, so a reader sees the old content or the new one and never
   * neither.
   *
   * The temporary name is unique per write as well as per process: a shared
   * one is two concurrent writes using the same scratch file, which is the
   * bug this pair of functions exists to close.
   */
  private async replace(file: string, body: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, body);
      await rename(tmp, file);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  async removeContent(key: string): Promise<void> {
    if (!SAFE_KEY.test(key)) return;
    await rm(this.path('content', `${key}.json`), { force: true });
  }

  async keys(): Promise<string[]> {
    try {
      const files = await readdir(this.path('content'));
      return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  }

  /** Store bytes, addressed by their hash — the same id twice is one file. */
  /**
   * Store a file, by the hash of what is actually stored.
   *
   * **Sniffed, not trusted, and sanitised before hashing.** The extension a
   * caller sends is a claim; the first bytes are the fact (§ assets.ts). An
   * SVG is cleaned on the way in and the *cleaned* bytes are what gets
   * hashed — so the id names what will be served rather than what arrived,
   * and uploading the same hostile file twice cannot produce one id that is
   * clean and another that is not.
   */
  async putAsset(bytes: Buffer, ext = ''): Promise<{ id: string; bytes: number; kind: string }> {
    if (bytes.byteLength > this.limits.maxBytes) throw new Error('too large');

    const seen = sniff(bytes);
    const stored =
      seen.kind === 'svg' ? Buffer.from(sanitiseSvg(bytes.toString('utf8')), 'utf8') : bytes;

    const id = createHash('sha256').update(stored).digest('hex');
    // The sniffed kind names the file, so what is on the disk says what it is
    // even to somebody reading the directory without this program. `ext` is
    // kept only as a fallback for a format not on the list.
    const suffix = seen.kind !== '' ? `.${seen.kind}` : extname(ext) || '';
    const file = this.path('assets', id + suffix);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, stored);
    return { id, bytes: stored.byteLength, kind: seen.kind };
  }

  /**
   * The bytes and what they are.
   *
   * Sniffed again on the way out rather than inferred from the file name: the
   * name is only a convenience for a person reading the directory, and a
   * content type derived from a string is a content type somebody can choose.
   */
  async getAsset(id: string): Promise<{ bytes: Buffer; type: string } | undefined> {
    if (!SAFE_ID.test(id)) return undefined;
    try {
      const dir = this.path('assets');
      const found = (await readdir(dir)).find((f) => f.startsWith(id));
      if (found === undefined) return undefined;
      const bytes = await readFile(join(dir, found));
      return { bytes, type: sniff(bytes).type };
    } catch {
      return undefined;
    }
  }
}
