/**
 * Reading a `.tar.gz`, and refusing most of one.
 *
 * §18.2's first retirement condition is that a third party can ship a widget
 * as an archive, and this is the code that opens it: a list of paths and modes
 * from a stranger, unpacked by a program with write access to a household's
 * disk. Every test below that starts "refuses" is the point of the file.
 *
 * The archives are built here rather than checked in, so what is being read is
 * visible in the test that reads it.
 */
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readTarGz, unwrapped, type Entry } from '../server/tar.ts';

const LIMITS = { maxBytes: 1024 * 64, maxTotalBytes: 1024 * 128, maxFiles: 20 };

/** One tar header, with the checksum computed the way tar computes it. */
function header(path: string, size: number, type = '0'): Buffer {
  const block = Buffer.alloc(512);
  block.write(path.slice(0, 100), 0, 'utf8');
  block.write('000644 \0', 100); // mode
  block.write('000000 \0', 108); // uid
  block.write('000000 \0', 116); // gid
  block.write(`${size.toString(8).padStart(11, '0')} `, 124);
  block.write('00000000000 ', 136); // mtime
  block.write('        ', 148); // checksum, spaces while it is computed
  block.write(type, 156);
  block.write('ustar\0' + '00', 257);

  let sum = 0;
  for (const b of block) sum += b;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

/** A tar of the given files, gzipped, as `tar czf` would produce. */
function archive(files: { path: string; body?: string; type?: string }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const bytes = Buffer.from(file.body ?? '', 'utf8');
    blocks.push(header(file.path, bytes.byteLength, file.type ?? '0'));
    if (bytes.byteLength > 0) {
      const padded = Buffer.alloc(Math.ceil(bytes.byteLength / 512) * 512);
      bytes.copy(padded);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(1024)); // the two empty blocks that end an archive
  return gzipSync(Buffer.concat(blocks));
}

const paths = (entries: Entry[]): string[] => entries.map((e) => e.path);

describe('what it reads', () => {
  it('reads the files an extension is made of', () => {
    const got = readTarGz(
      archive([
        { path: 'hc-extension.json', body: '{"id":"io.example.dial"}' },
        { path: 'dial.js', body: 'export const hello = 1;' },
        { path: 'icons/dial.svg', body: '<svg/>' },
      ]),
      LIMITS,
    );

    expect(paths(got)).toEqual(['hc-extension.json', 'dial.js', 'icons/dial.svg']);
    expect(got[1]?.bytes.toString('utf8')).toBe('export const hello = 1;');
  });

  it('skips the directories an archive lists', () => {
    // An archive that lists its folders is an ordinary archive; the files
    // inside imply them.
    const got = readTarGz(
      archive([
        { path: 'icons/', type: '5' },
        { path: 'icons/dial.svg', body: '<svg/>' },
      ]),
      LIMITS,
    );
    expect(paths(got)).toEqual(['icons/dial.svg']);
  });

  it('reads a plain tar as well as a gzipped one', () => {
    const plain = Buffer.concat([
      header('a.js', 1),
      Buffer.concat([Buffer.from('x'), Buffer.alloc(511)]),
      Buffer.alloc(1024),
    ]);
    expect(paths(readTarGz(plain, LIMITS))).toEqual(['a.js']);
  });
});

describe('what it refuses', () => {
  const refuses = (files: { path: string; body?: string; type?: string }[], why: RegExp): void => {
    expect(() => readTarGz(archive(files), LIMITS)).toThrow(why);
  };

  it('refuses a path that starts at the root', () => {
    refuses([{ path: '/etc/passwd', body: 'x' }], /refused path/);
  });

  it('refuses a path that climbs out', () => {
    refuses([{ path: '../outside.js', body: 'x' }], /refused path/);
    refuses([{ path: 'icons/../../outside.js', body: 'x' }], /refused path/);
  });

  it('refuses a windows path, which is not the separator this splits on', () => {
    refuses([{ path: 'a\\..\\..\\outside.js', body: 'x' }], /refused path/);
    refuses([{ path: 'c:/outside.js', body: 'x' }], /refused path/);
  });

  it('refuses a symlink, which is how an archive escapes after every check', () => {
    refuses([{ path: 'link.js', type: '2' }], /refused entry type/);
    refuses([{ path: 'link.js', type: '1' }], /refused entry type/);
  });

  it('refuses a device, a fifo, and the long-name extensions', () => {
    for (const type of ['3', '4', '6', 'L', 'x']) {
      refuses([{ path: 'thing', type }], /refused entry type/);
    }
  });

  it('refuses a file larger than it was told to allow', () => {
    expect(() =>
      readTarGz(archive([{ path: 'big.js', body: 'x'.repeat(200) }]), { ...LIMITS, maxBytes: 100 }),
    ).toThrow(/too large/);
  });

  it('refuses an archive larger than it was told to allow', () => {
    expect(() =>
      readTarGz(
        archive([
          { path: 'a.js', body: 'x'.repeat(80) },
          { path: 'b.js', body: 'x'.repeat(80) },
        ]),
        { ...LIMITS, maxTotalBytes: 100 },
      ),
    ).toThrow(/archive is too large/);
  });

  it('refuses an archive with more files than it was told to allow', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.js`, body: 'x' }));
    expect(() => readTarGz(archive(many), { ...LIMITS, maxFiles: 3 })).toThrow(/too many files/);
  });

  it('refuses something that is not an archive at all', () => {
    expect(() => readTarGz(gzipSync(Buffer.from('not a tar')), LIMITS)).toThrow(/not a tar/);
    expect(() => readTarGz(Buffer.from('PK\u0003\u0004 a zip, really'), LIMITS)).toThrow(
      /not a tar/,
    );
  });

  it('refuses an empty archive rather than installing nothing', () => {
    expect(() => readTarGz(gzipSync(Buffer.alloc(1024)), LIMITS)).toThrow(/no files/);
  });
});

describe('the wrapping directory', () => {
  it('is dropped, because both ways of making an archive are ordinary', () => {
    // `tar czf x.tgz my-widget/` and `tar czf x.tgz -C my-widget .` differ
    // only in this prefix, and a household should not have to know which one
    // they were handed.
    const wrapped: Entry[] = [
      { path: 'my-widget/hc-extension.json', bytes: Buffer.alloc(0) },
      { path: 'my-widget/dial.js', bytes: Buffer.alloc(0) },
    ];
    expect(paths(unwrapped(wrapped))).toEqual(['hc-extension.json', 'dial.js']);
  });

  it('is left alone when there is more than one root', () => {
    // Two roots is a different archive, not a wrapper.
    const two: Entry[] = [
      { path: 'a/one.js', bytes: Buffer.alloc(0) },
      { path: 'b/two.js', bytes: Buffer.alloc(0) },
    ];
    expect(paths(unwrapped(two))).toEqual(['a/one.js', 'b/two.js']);
  });

  it('leaves a flat archive flat', () => {
    const flat: Entry[] = [{ path: 'hc-extension.json', bytes: Buffer.alloc(0) }];
    expect(paths(unwrapped(flat))).toEqual(['hc-extension.json']);
  });
});
