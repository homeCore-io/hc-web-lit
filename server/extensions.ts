/**
 * The extension store — the reason this project exists (§2, §18.2).
 *
 * The Flutter client could not do this at all: Flutter compiles the widget
 * graph ahead of time, so a third-party widget meant recompiling and
 * redeploying the whole app. The web platform loads modules at runtime, and
 * this is the directory those modules live in.
 *
 * **A directory per extension, and installing is putting one there.** No
 * database, no manifest index to keep in step, no unpack step in the read
 * path. An admin drops a folder in, or `install` below unpacks an archive
 * into one; either way the store is what is on the disk, so a broken install
 * is visible with `ls` rather than only through this program.
 *
 * ```
 * <content>/extensions/
 *   io.homecore.button/
 *     hc-extension.json     the manifest — id, version, entry, provides
 *     button.js             the ESM module the browser imports
 *     icons/dial.svg        anything the manifest lists under assets
 * ```
 *
 * **What this deliberately does not do is decide whether to trust it.** §8.1
 * settles that: install is an admin act, homeCore plugins are native binaries
 * supervised as processes, and hardening the browser layer while that door
 * stands is defence pointed away from the risk. This serves bytes; the host
 * decides what to do with them.
 */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { readTarGz, unwrapped, type Limits as TarLimits } from './tar.ts';

/**
 * An extension id is a directory name, so it may not wander out of the store.
 *
 * Reverse-DNS is the convention (`io.homecore.button`) and dots are therefore
 * allowed — but never two in a row, which is what stops `..` and every
 * variation on it before the path is ever built.
 */
const SAFE_ID = /^[a-z0-9](?:[a-z0-9-]|\.(?!\.)){0,62}[a-z0-9]$/i;

/**
 * A path within an extension: segments of the same shape, no leading slash.
 *
 * `entry` in a manifest is conventionally `./button.js`, so a caller strips
 * the prefix before asking. Everything is checked again here regardless —
 * this is the function that turns a string from the network into a file path,
 * and it is the last place a mistake is cheap.
 */
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/i;

export const MANIFEST = 'hc-extension.json';

/** What a browser is told a file is. Anything unlisted is not served. */
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.riv': 'application/octet-stream',
};

export interface ExtensionFile {
  bytes: Buffer;
  type: string;
}

/** A manifest that would not parse, kept rather than dropped. */
export interface BrokenExtension {
  id: string;
  error: string;
}

export interface Listing {
  /** Manifests as read off the disk. The client validates; this does not. */
  manifests: unknown[];
  /**
   * Directories that look like an extension and are not one.
   *
   * Reported rather than skipped, because the failure this exists for is an
   * admin who installed something and cannot see it. "Nothing appeared" sends
   * them to the wrong place; "this one has no manifest" does not.
   */
  broken: BrokenExtension[];
}

export class Extensions {
  private readonly root: string;

  constructor(contentDir: string) {
    this.root = resolve(join(contentDir, 'extensions'));
  }

  /** Where an extension's files are, or undefined if the id is not one. */
  private dir(id: string): string | undefined {
    if (!SAFE_ID.test(id)) return undefined;
    const full = resolve(join(this.root, id));
    // The id pattern already forbids it; a path that escaped the store would
    // be the worst bug in this file, so it is checked twice.
    return full.startsWith(`${this.root}/`) ? full : undefined;
  }

  /**
   * Every installed extension's manifest.
   *
   * One read per directory on every call, deliberately. A household has a
   * handful of these and they are read once at page load; a cache would be a
   * second copy of the truth, and the failure it introduces — an extension
   * that was updated and did not appear to be — is exactly the one an admin
   * cannot diagnose.
   */
  async list(): Promise<Listing> {
    let entries: string[];
    try {
      entries = (await readdir(this.root, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      // No store yet. An installation with no extensions is the normal state,
      // not an error to report.
      return { manifests: [], broken: [] };
    }

    const manifests: unknown[] = [];
    const broken: BrokenExtension[] = [];

    for (const id of entries) {
      const dir = this.dir(id);
      if (dir === undefined) {
        broken.push({ id, error: 'Not a usable extension id.' });
        continue;
      }
      try {
        manifests.push(JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')) as unknown);
      } catch (e) {
        broken.push({
          id,
          error:
            e instanceof Error && 'code' in e && e.code === 'ENOENT'
              ? `No ${MANIFEST}.`
              : `${MANIFEST} is not valid JSON.`,
        });
      }
    }

    return { manifests, broken };
  }

  /**
   * One file out of one extension.
   *
   * Undefined covers every way this can fail — bad id, bad path, missing file,
   * a type nobody should be served — on purpose: a caller that could tell
   * "no such extension" from "that extension has no such file" would be
   * telling anyone who asks what is installed.
   */
  async file(id: string, path: string): Promise<ExtensionFile | undefined> {
    const dir = this.dir(id);
    if (dir === undefined || !SAFE_PATH.test(path)) return undefined;

    const type = TYPES[extname(path).toLowerCase()];
    if (type === undefined) return undefined;

    const full = resolve(join(dir, path));
    if (!full.startsWith(`${dir}/`)) return undefined;

    try {
      // A directory read as a file throws on some platforms and returns its
      // contents on none of them; check rather than rely on that.
      if (!(await stat(full)).isFile()) return undefined;
      return { bytes: await readFile(full), type };
    } catch {
      return undefined;
    }
  }
  /**
   * Unpack an archive into the store, and say what it was called.
   *
   * §18.2's first retirement condition, and the reason the project exists: a
   * third party ships a `.tar.gz`, a household installs it without rebuilding
   * anything, and the widget is then placed and configured like any other.
   *
   * **The manifest decides the directory, not the file name.** An extension's
   * id is inside it; taking the name from the archive would mean two files of
   * the same bytes installing to different places, and an admin looking for
   * `io.homecore.button` finding `widget-final-2`.
   *
   * **Written beside and renamed**, so a failure halfway leaves the previous
   * version rather than half of the new one — the same rule the content store
   * keeps, for the same reason. An install that replaces an extension is
   * ordinary: it is how an update arrives.
   */
  async install(archive: Buffer, limits: TarLimits): Promise<{ id: string; files: number }> {
    const entries = unwrapped(readTarGz(archive, limits));

    const manifest = entries.find((e) => e.path === MANIFEST);
    if (manifest === undefined) {
      throw new Error(`the archive has no ${MANIFEST} at its root`);
    }

    let id: unknown;
    try {
      id = (JSON.parse(manifest.bytes.toString('utf8')) as { id?: unknown }).id;
    } catch {
      throw new Error(`${MANIFEST} is not valid JSON`);
    }
    if (typeof id !== 'string' || !SAFE_ID.test(id)) {
      throw new Error(`${MANIFEST} has no usable id`);
    }
    // Checked again against the paths it will build, because this is the last
    // place a mistake is cheap.
    for (const entry of entries) {
      if (!SAFE_PATH.test(entry.path)) throw new Error(`refused path: ${entry.path}`);
    }

    const final = this.dir(id);
    // `SAFE_ID` has already passed, so this is the second check rather than
    // the first — and the one that would catch a difference between the two.
    if (final === undefined) throw new Error(`refused id: ${id}`);
    const staging = `${final}.installing`;
    await rm(staging, { recursive: true, force: true });

    for (const entry of entries) {
      const file = join(staging, entry.path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, entry.bytes);
    }

    await rm(final, { recursive: true, force: true });
    await rename(staging, final);
    return { id, files: entries.length };
  }
}
