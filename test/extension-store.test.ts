/**
 * The extension store on a disk (§ server/extensions.ts).
 *
 * This is the function that turns a string off the network into a file path,
 * so most of what is worth pinning here is what it refuses. The rest is the
 * listing behaviour an admin depends on when something they installed does
 * not appear.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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
