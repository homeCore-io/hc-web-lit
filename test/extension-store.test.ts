/**
 * The extension store on a disk (§ server/extensions.ts).
 *
 * This is the function that turns a string off the network into a file path,
 * so most of what is worth pinning here is what it refuses. The rest is the
 * listing behaviour an admin depends on when something they installed does
 * not appear.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Extensions } from '../server/extensions.ts';

let root: string;
let ext: Extensions;

const install = async (id: string, files: Record<string, string>): Promise<void> => {
  const dir = join(root, 'extensions', id);
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const at = join(dir, name);
    await mkdir(join(at, '..'), { recursive: true });
    await writeFile(at, body);
  }
};

const manifest = (id: string): string =>
  JSON.stringify({ id, name: 'X', version: '1.0.0', hcApiVersion: '1', entry: './x.js' });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hc-ext-'));
  ext = new Extensions(root);
});

describe('listing what is installed', () => {
  it('is empty rather than an error before anything is installed', async () => {
    // Every deployment starts here, and it is not a problem to report.
    expect(await ext.list()).toEqual({ manifests: [], broken: [] });
  });

  it('reads each manifest, in a stable order', async () => {
    await install('io.example.b', { 'hc-extension.json': manifest('io.example.b') });
    await install('io.example.a', { 'hc-extension.json': manifest('io.example.a') });

    const got = await ext.list();
    expect(got.manifests.map((m) => (m as { id: string }).id)).toEqual([
      'io.example.a',
      'io.example.b',
    ]);
  });

  it('names a directory it could not read a manifest out of', async () => {
    // The admin's question is "why did nothing appear". Skipping these
    // silently answers it wrongly; this is a half-finished copy, and saying so
    // is the difference between a two-minute fix and an afternoon.
    await install('io.example.half', { 'button.js': 'export {}' });
    await install('io.example.broken', { 'hc-extension.json': '{ not json' });

    const got = await ext.list();
    expect(got.manifests).toEqual([]);
    expect(got.broken).toEqual([
      { id: 'io.example.broken', error: 'hc-extension.json is not valid JSON.' },
      { id: 'io.example.half', error: 'No hc-extension.json.' },
    ]);
  });
});

describe('serving one file', () => {
  beforeEach(async () => {
    await install('io.example.one', {
      'hc-extension.json': manifest('io.example.one'),
      'button.js': 'export const hello = 1;',
      'icons/dial.svg': '<svg/>',
    });
  });

  it('serves a module with a type a browser will execute', async () => {
    const got = await ext.file('io.example.one', 'button.js');
    // A module served as octet-stream is refused by the browser's module
    // loader with an error that names neither the extension nor the reason.
    expect(got?.type).toBe('text/javascript; charset=utf-8');
    expect(got?.bytes.toString('utf8')).toBe('export const hello = 1;');
  });

  it('serves an asset from a subdirectory', async () => {
    expect((await ext.file('io.example.one', 'icons/dial.svg'))?.type).toBe('image/svg+xml');
  });

  it('refuses a file type nobody should be handed', async () => {
    await install('io.example.one', { 'secrets.env': 'TOKEN=1' });
    expect(await ext.file('io.example.one', 'secrets.env')).toBeUndefined();
  });

  it('is undefined for anything missing, without saying which kind of missing', async () => {
    // Telling "no such extension" from "no such file in it" would tell anyone
    // who asks what is installed.
    expect(await ext.file('io.example.one', 'nope.js')).toBeUndefined();
    expect(await ext.file('io.example.absent', 'button.js')).toBeUndefined();
  });

  it('does not serve a directory as a file', async () => {
    expect(await ext.file('io.example.one', 'icons')).toBeUndefined();
  });
});

describe('what it refuses to turn into a path', () => {
  beforeEach(async () => {
    await install('io.example.one', { 'button.js': 'export {}' });
    await writeFile(join(root, 'outside.js'), 'export const stolen = 1;');
  });

  it('refuses to climb out of an extension', async () => {
    for (const path of [
      '../outside.js',
      '../../outside.js',
      'icons/../../outside.js',
      './../outside.js',
      '/etc/passwd',
      'a//b.js',
    ]) {
      expect(await ext.file('io.example.one', path)).toBeUndefined();
    }
  });

  it('refuses to climb out of the store', async () => {
    for (const id of ['..', '../..', '.', 'a/b', '', 'io..example', '/abs']) {
      expect(await ext.file(id, 'button.js')).toBeUndefined();
    }
  });

  it('allows the dots a reverse-DNS id actually needs', async () => {
    // The restriction has to stop `..` without stopping `io.homecore.button`,
    // which is the convention every real id follows.
    await install('io.homecore.button', { 'button.js': 'export {}' });
    expect(await ext.file('io.homecore.button', 'button.js')).toBeDefined();
  });
});

describe('installing from an archive', () => {
  const LIMITS = { maxBytes: 1024 * 64, maxTotalBytes: 1024 * 128, maxFiles: 20 };

  /** A `.tar.gz` of the given files, as `tar czf` would produce. */
  const archive = (files: Record<string, string>, under = ''): Buffer => {
    const blocks: Buffer[] = [];
    for (const [name, body] of Object.entries(files)) {
      const bytes = Buffer.from(body, 'utf8');
      const block = Buffer.alloc(512);
      block.write(`${under}${name}`, 0, 'utf8');
      block.write('000644 \0', 100);
      block.write('000000 \0', 108);
      block.write('000000 \0', 116);
      block.write(`${bytes.byteLength.toString(8).padStart(11, '0')} `, 124);
      block.write('00000000000 ', 136);
      block.write('        ', 148);
      block.write('0', 156);
      block.write('ustar\u000000', 257);
      let sum = 0;
      for (const b of block) sum += b;
      block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);

      blocks.push(block);
      const padded = Buffer.alloc(Math.ceil(bytes.byteLength / 512) * 512);
      bytes.copy(padded);
      if (padded.byteLength > 0) blocks.push(padded);
    }
    blocks.push(Buffer.alloc(1024));
    return gzipSync(Buffer.concat(blocks));
  };

  it('unpacks it into a directory named by the manifest', async () => {
    // Taking the name from the file would mean two archives of the same bytes
    // installing to different places, and an admin looking for
    // `io.homecore.button` finding `widget-final-2`.
    const got = await ext.install(
      archive({
        'hc-extension.json': manifest('io.example.dial'),
        'dial.js': 'export const hello = 1;',
      }),
      LIMITS,
    );

    expect(got).toEqual({ id: 'io.example.dial', files: 2 });
    expect((await ext.file('io.example.dial', 'dial.js'))?.bytes.toString('utf8')).toBe(
      'export const hello = 1;',
    );
    expect((await ext.list()).manifests).toHaveLength(1);
  });

  it('takes an archive that wraps its files in a folder', async () => {
    await ext.install(
      archive({ 'hc-extension.json': manifest('io.example.dial'), 'dial.js': 'x' }, 'my-widget/'),
      LIMITS,
    );
    expect(await ext.file('io.example.dial', 'dial.js')).toBeDefined();
  });

  it('replaces what was there, which is how an update arrives', async () => {
    await ext.install(
      archive({ 'hc-extension.json': manifest('io.example.dial'), 'old.js': 'x' }),
      LIMITS,
    );
    await ext.install(
      archive({ 'hc-extension.json': manifest('io.example.dial'), 'new.js': 'y' }),
      LIMITS,
    );

    expect(await ext.file('io.example.dial', 'new.js')).toBeDefined();
    // The previous version's files are gone rather than left beside the new
    // ones, which is what makes an update an update.
    expect(await ext.file('io.example.dial', 'old.js')).toBeUndefined();
  });

  it('refuses an archive with no manifest at its root', async () => {
    await expect(ext.install(archive({ 'dial.js': 'x' }), LIMITS)).rejects.toThrow(
      /no hc-extension.json/,
    );
    expect((await ext.list()).manifests).toEqual([]);
  });

  it('refuses a manifest with no usable id', async () => {
    await expect(
      ext.install(archive({ 'hc-extension.json': '{"name":"no id"}' }), LIMITS),
    ).rejects.toThrow(/no usable id/);
    await expect(
      ext.install(archive({ 'hc-extension.json': '{ not json' }), LIMITS),
    ).rejects.toThrow(/not valid JSON/);
    await expect(
      ext.install(archive({ 'hc-extension.json': '{"id":"../elsewhere"}' }), LIMITS),
    ).rejects.toThrow(/no usable id/);
  });

  it('leaves nothing behind when it refuses', async () => {
    // Written beside and renamed: a failure halfway leaves the previous
    // version rather than half of the new one.
    await ext.install(
      archive({ 'hc-extension.json': manifest('io.example.dial'), 'good.js': 'x' }),
      LIMITS,
    );
    await expect(
      ext.install(archive({ 'hc-extension.json': manifest('io.example.dial') }), {
        ...LIMITS,
        maxTotalBytes: 1,
      }),
    ).rejects.toThrow();

    expect(await ext.file('io.example.dial', 'good.js')).toBeDefined();
  });
});
