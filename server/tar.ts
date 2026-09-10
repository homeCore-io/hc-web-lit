/**
 * Reading a `.tar.gz`, strictly, so an extension can be installed from a file.
 *
 * §18.2's first retirement condition is "a third party can ship a widget —
 * install a `.tar.gz`, place the widget, configure it in the GUI, no rebuild",
 * and it says of itself that this is the reason the project exists. The
 * placing and the configuring are built; this is the shipping.
 *
 * **Written out rather than depended on.** A tar reader is a hundred lines of
 * fixed-width fields, and every one of the interesting bugs is a refusal this
 * file has to get right anyway — a dependency would not remove the need to
 * decide what an archive is allowed to contain, it would only move the
 * decision somewhere nobody reads. Node brings the gunzip.
 *
 * **It refuses nearly everything.** An archive is a list of paths and modes
 * from a stranger, unpacked by a program with write access to a household's
 * disk, and the format has thirty years of ways to say "somewhere else":
 *
 * - absolute paths, `..` in any segment, and backslashes
 * - symlinks, hardlinks, devices, fifos — anything that is not a plain file
 *   or a directory. A symlink is how an archive writes outside the directory
 *   it was unpacked into *after* every path check has passed
 * - GNU/pax long-name extensions, which is a second place a name can come
 *   from and therefore a second place a check can be skipped
 * - a file, or a total, larger than the caller allows
 *
 * What survives is a flat list of ordinary files with ordinary names, which is
 * all an extension has ever been (§ extensions.ts).
 */
import { gunzipSync } from 'node:zlib';

/** One file out of an archive. Directories are implied by the paths. */
export interface Entry {
  path: string;
  bytes: Buffer;
}

export interface Limits {
  /** Refuse a single file larger than this. */
  maxBytes: number;
  /** Refuse an archive whose contents come to more than this. */
  maxTotalBytes: number;
  /** Refuse an archive with more files than this. */
  maxFiles: number;
}

const BLOCK = 512;

/** A NUL-terminated field, as tar writes them. */
function field(header: Buffer, at: number, length: number): string {
  const raw = header.subarray(at, at + length);
  const end = raw.indexOf(0);
  return raw
    .subarray(0, end === -1 ? raw.length : end)
    .toString('utf8')
    .trim();
}

/** An octal field. Empty means zero, which is what tar means by it. */
function octal(header: Buffer, at: number, length: number): number {
  const text = field(header, at, length).replace(/[^0-7]/g, '');
  return text === '' ? 0 : Number.parseInt(text, 8);
}

/**
 * Whether the header's own checksum agrees with its bytes.
 *
 * The cheapest way to notice that this is not a tar at all — a `.zip` renamed,
 * a truncated download — and to say so as "not an archive" rather than as
 * whatever a misread field would produce.
 */
function checksumOk(header: Buffer): boolean {
  const stated = octal(header, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    // The checksum field itself counts as spaces.
    sum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0);
  }
  return sum === stated;
}

/** A path an archive is allowed to write. */
function safePath(path: string): boolean {
  if (path === '' || path.length > 200) return false;
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return false;
  if (path.includes('\\') || path.includes('\0')) return false;
  return path
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..' && !part.startsWith('-'));
}

/**
 * The files in a gzipped tar, or a refusal saying which rule stopped it.
 *
 * Whole-archive rather than streaming: an extension is small by construction —
 * a module, a manifest and some icons — and a streaming unpack that refuses
 * halfway has already written half an extension onto a disk.
 */
export function readTarGz(archive: Buffer, limits: Limits): Entry[] {
  let tar: Buffer;
  try {
    // A gzip member starts 1f 8b; anything else is not the thing it claims.
    tar = archive[0] === 0x1f && archive[1] === 0x8b ? gunzipSync(archive) : archive;
  } catch {
    throw new Error('not a gzip archive');
  }

  // Shorter than a single header is not an archive with nothing in it, it is
  // not an archive — and saying which is the difference between "your file is
  // empty" and "your file is not what you think it is".
  if (tar.length < BLOCK) throw new Error('not a tar archive');

  const entries: Entry[] = [];
  let total = 0;

  for (let at = 0; at + BLOCK <= tar.length;) {
    const header = tar.subarray(at, at + BLOCK);
    // Two empty blocks end an archive; one is enough to stop reading.
    if (header.every((b) => b === 0)) break;
    if (!checksumOk(header)) throw new Error('not a tar archive');

    const name = field(header, 0, 100);
    const size = octal(header, 124, 12);
    const type = field(header, 156, 1) === '' ? '0' : field(header, 156, 1);
    const prefix = field(header, 345, 155);
    const path = prefix === '' ? name : `${prefix}/${name}`;

    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    // A directory is implied by the files inside it, so it is skipped rather
    // than refused — an archive that lists its folders is an ordinary archive.
    if (type === '5') {
      if (!safePath(path.replace(/\/$/, ''))) throw new Error(`refused path: ${path}`);
      continue;
    }
    if (type !== '0' && type !== '\0') {
      // '1' hardlink, '2' symlink, '3'/'4' devices, '6' fifo, 'L'/'K' GNU long
      // names, 'x'/'g' pax headers. Each is either a way out of the directory
      // or a second source of names; an extension needs none of them.
      throw new Error(`refused entry type '${type}' in ${path || 'the archive'}`);
    }
    if (!safePath(path)) throw new Error(`refused path: ${path}`);
    if (size > limits.maxBytes) throw new Error(`${path} is too large`);

    total += size;
    if (total > limits.maxTotalBytes) throw new Error('the archive is too large');
    if (entries.length >= limits.maxFiles) throw new Error('the archive has too many files');

    const start = at - Math.ceil(size / BLOCK) * BLOCK;
    if (start + size > tar.length) throw new Error('the archive ends in the middle of a file');
    entries.push({ path, bytes: tar.subarray(start, start + size) });
  }

  if (entries.length === 0) throw new Error('the archive has no files in it');
  return entries;
}

/**
 * The same files with a single wrapping directory removed.
 *
 * `tar czf x.tgz my-widget/` and `tar czf x.tgz -C my-widget .` produce
 * archives that differ only in a prefix, and a household should not have to
 * know which one they were given. One shared root is dropped; two roots are
 * left alone, because that is a different archive and not a wrapper.
 */
export function unwrapped(entries: readonly Entry[]): Entry[] {
  const roots = new Set(entries.map((e) => e.path.split('/')[0] ?? ''));
  if (roots.size !== 1 || entries.every((e) => !e.path.includes('/'))) return [...entries];
  return entries.map((e) => ({ ...e, path: e.path.slice(e.path.indexOf('/') + 1) }));
}
