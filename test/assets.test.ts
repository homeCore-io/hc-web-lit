/**
 * What an uploaded file is, and what is safe to hand back (§9).
 *
 * The asset store serves a household's own pictures **from the origin the
 * session lives in** — and, since the panel path, the origin this device's
 * API key is stored in. So the type has to be right enough that an icon
 * renders, and the serving has to be safe enough that being able to render it
 * is not a way in.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { assetHeaders, sanitiseSvg, sniff } from '../server/assets.ts';
import { Store } from '../server/store.ts';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const svg = (inner: string): Buffer => Buffer.from(`<svg xmlns="x">${inner}</svg>`, 'utf8');

let store: Store;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hc-asset-'));
  store = new Store(root, {
    maxBytes: 1024 * 1024,
    maxTotalBytes: 0,
  });
});

describe('what a file actually is', () => {
  it('reads the bytes, not the name somebody sent', () => {
    // The extension is a claim by whoever is uploading. A .png that is really
    // an SVG must be treated as an SVG, or the sanitiser never runs on it.
    expect(sniff(png).type).toBe('image/png');
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0])).type).toBe('image/jpeg');
    expect(sniff(Buffer.from('GIF89a...')).type).toBe('image/gif');
    expect(sniff(Buffer.from('%PDF-1.7')).type).toBe('application/pdf');
    expect(sniff(svg('<rect/>')).type).toBe('image/svg+xml');
  });

  it('recognises an SVG behind a declaration or a comment', () => {
    expect(sniff(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="x"/>')).kind).toBe('svg');
    expect(sniff(Buffer.from('<!-- made by hand -->\n<svg xmlns="x"/>')).kind).toBe('svg');
  });

  it('is a download for anything it has no opinion about', () => {
    // Not an error — a household may keep a file this program does not render.
    // It simply never gets a type that would make a browser try.
    expect(sniff(Buffer.from('<html><script>alert(1)</script>'))).toEqual({
      kind: '',
      type: 'application/octet-stream',
    });
    expect(sniff(Buffer.from([0x00, 0x01, 0x02])).kind).toBe('');
  });
});

describe('taking the executable parts out of an SVG', () => {
  const clean = (inner: string): string => sanitiseSvg(`<svg xmlns="x">${inner}</svg>`);

  it('removes a script element, open or closed', () => {
    expect(clean('<script>alert(1)</script><rect/>')).not.toContain('alert');
    expect(clean('<script src="x.js"/><rect/>')).not.toContain('script');
    expect(clean('<SCRIPT >alert(1)</SCRIPT ><rect/>')).not.toContain('alert');
  });

  it('removes event handlers, including the bare and unquoted spellings', () => {
    // `onload` on the root runs with no interaction at all, which makes it
    // likelier than `<script>` and easier for a naive filter to miss.
    expect(sanitiseSvg('<svg onload="alert(1)"><rect/></svg>')).not.toContain('alert');
    expect(sanitiseSvg("<svg onload='alert(1)'><rect/></svg>")).not.toContain('alert');
    expect(sanitiseSvg('<svg onload=alert(1)><rect/></svg>')).not.toContain('alert');
    expect(clean('<a onmouseover="steal()"><rect/></a>')).not.toContain('steal');
  });

  it('removes javascript: however it is spelled', () => {
    // The browser strips whitespace, NULs and entities before deciding it is
    // a scheme, so matching the literal string is not enough.
    for (const url of [
      'javascript:alert(1)',
      'java\nscript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      '&#106;avascript:alert(1)',
      'java\u0000script:alert(1)',
      'java\u0009script:alert(1)',
    ]) {
      expect(clean(`<a href="${url}"><rect/></a>`)).not.toContain('alert');
    }
  });

  it('removes foreignObject, which is arbitrary HTML in disguise', () => {
    expect(clean('<foreignObject><iframe src="//evil"/></foreignObject>')).not.toContain('iframe');
  });

  it('removes a reference that reaches another origin', () => {
    expect(clean('<use href="https://evil.test/x.svg#a"/>')).not.toContain('evil');
    expect(clean('<image xlink:href="//evil.test/x.png"/>')).not.toContain('evil');
  });

  it('removes an animation that would put a handler back', () => {
    // `<set attributeName="onload" to="alert(1)">` writes an attribute the
    // passes above just removed.
    const out = clean('<set attributeName="onload" to="alert(1)"/>');
    expect(out).not.toContain('onload');
  });

  it('keeps the SVG that a real icon is made of', () => {
    // A sanitiser that breaks legitimate icons gets turned off.
    const icon =
      '<path d="M4 4 L20 20" stroke="currentColor" stroke-width="1.6"/>' +
      '<use href="#glyph"/><image href="data:image/png;base64,AAAA"/>' +
      '<style>.a{fill:red}</style><title>Garage</title>';
    const out = clean(icon);
    expect(out).toContain('M4 4 L20 20');
    expect(out).toContain('currentColor');
    // A fragment reference is how a sprite sheet works (§9).
    expect(out).toContain('href="#glyph"');
    expect(out).toContain('data:image/png;base64');
    expect(out).toContain('<title>Garage</title>');
  });
});

describe('storing an asset', () => {
  it('hashes what will be served, not what arrived', async () => {
    // Otherwise the same hostile file could be uploaded twice and produce one
    // id whose bytes are clean and another whose bytes are not.
    const hostile = svg('<script>alert(1)</script><rect/>');
    const put = await store.putAsset(hostile);
    const got = await store.getAsset(put.id);

    expect(got?.bytes.toString('utf8')).not.toContain('alert');
    expect(got?.bytes.byteLength).toBe(put.bytes);
    expect(put.kind).toBe('svg');
  });

  it('gives back a type a browser will render', async () => {
    const put = await store.putAsset(png);
    // Every asset used to come back as octet-stream, which is safe and means
    // an uploaded icon could never be shown — the store not doing its job.
    expect((await store.getAsset(put.id))?.type).toBe('image/png');
  });

  it('names the file by what it is, not by what was claimed', async () => {
    const put = await store.putAsset(png, 'icon.svg');
    expect((await store.getAsset(put.id))?.type).toBe('image/png');
  });
});

describe('the headers an asset is served with', () => {
  it('sandboxes it, so rendering it is not a way into this origin', () => {
    const h = assetHeaders('image/svg+xml');
    // The load-bearing half: a navigated document lands in an opaque origin,
    // so script that got past the sanitiser cannot reach the session or the
    // panel key. `<img>` is unaffected — an image is not a document context.
    expect(h['content-security-policy']).toContain('sandbox');
    expect(h['content-security-policy']).toContain("default-src 'none'");
    // And a browser must not decide for itself that an octet-stream is HTML.
    expect(h['x-content-type-options']).toBe('nosniff');
  });

  it('caches forever, which is only safe because the id is the hash', () => {
    expect(assetHeaders('image/png')['cache-control']).toContain('immutable');
  });
});

describe('what the store will say it holds (§9)', () => {
  it('is empty before anything is uploaded', async () => {
    // A household that has uploaded nothing is the ordinary first case, not a
    // failure — there is no directory yet.
    expect(await store.listAssets()).toEqual([]);
  });

  it('lists what was put in, by content hash and sniffed kind', async () => {
    const one = await store.putAsset(png);
    const two = await store.putAsset(svg('<rect/>'));
    const listed = await store.listAssets();

    expect(listed.map((a) => a.id).sort()).toEqual([one.id, two.id].sort());
    expect(listed.find((a) => a.id === one.id)?.kind).toBe('png');
    expect(listed.find((a) => a.id === two.id)?.kind).toBe('svg');
    expect(listed.every((a) => a.bytes > 0)).toBe(true);
  });

  it('does not grow when the same picture goes in twice', async () => {
    // The id is the hash of the stored bytes, which is what makes a household
    // store stop growing once it holds what it needs.
    await store.putAsset(png);
    await store.putAsset(png);
    expect(await store.listAssets()).toHaveLength(1);
  });

  it('reports the sanitised size, not the size that was sent', async () => {
    // An SVG is rewritten on the way in, so the bytes a listing reports have
    // to be the bytes that would come back out.
    const hostile = svg('<script>alert(1)</script><rect/>');
    const put = await store.putAsset(hostile);
    const listed = (await store.listAssets()).find((a) => a.id === put.id);
    expect(listed?.bytes).toBe(put.bytes);
    expect(listed?.bytes).toBeLessThan(hostile.byteLength);
  });

  it('skips a file in the directory that is not a stored asset', async () => {
    // The directory is a household's disk, and something else living in it is
    // not this program's to describe.
    const put = await store.putAsset(png);
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'assets', 'notes.txt'), 'mine');
    expect((await store.listAssets()).map((a) => a.id)).toEqual([put.id]);
  });
});
