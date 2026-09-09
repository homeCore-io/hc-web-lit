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
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

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

  async writeContent(key: string, value: unknown): Promise<void> {
    if (!SAFE_KEY.test(key)) throw new Error('bad key');
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > this.limits.maxBytes) throw new Error('too large');

    const file = this.path('content', `${key}.json`);
    await mkdir(dirname(file), { recursive: true });
    // Written beside and renamed, so a crash halfway through leaves the old
    // content rather than half the new content.
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, body);
    await rm(file, { force: true });
    await writeFile(file, body);
    await rm(tmp, { force: true });
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
  async putAsset(bytes: Buffer, ext = ''): Promise<{ id: string; bytes: number }> {
    if (bytes.byteLength > this.limits.maxBytes) throw new Error('too large');
    const id = createHash('sha256').update(bytes).digest('hex');
    const file = this.path('assets', id + (extname(ext) || ''));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return { id, bytes: bytes.byteLength };
  }

  async getAsset(id: string): Promise<Buffer | undefined> {
    if (!SAFE_ID.test(id)) return undefined;
    try {
      const dir = this.path('assets');
      const found = (await readdir(dir)).find((f) => f.startsWith(id));
      return found === undefined ? undefined : await readFile(join(dir, found));
    } catch {
      return undefined;
    }
  }
}
