/**
 * What an uploaded file is, and what is safe to hand back (§9).
 *
 * The asset store is the capability Flutter's build-time `AssetManifest` made
 * impossible: a household adds an icon or a floorplan image and it is a
 * first-class asset with no rebuild. For that to be true the bytes have to
 * come back with a type a browser will *render* — and the moment that is true,
 * the store is serving user-supplied documents from the app's own origin,
 * which is where the app's session and this device's panel key live.
 *
 * So the type and the safety are one problem and are solved here together.
 *
 * **The type is sniffed, never taken from the uploader.** The file name and
 * any declared extension are a claim by whoever is uploading; the first bytes
 * are what the file is. Anything not on the list below is stored but served as
 * an octet-stream download, which is the honest answer for a format this
 * program has no opinion about.
 *
 * **SVG is an executable document, and gets two separate defences.**
 *
 * 1. *Sanitised on the way in* — §9's requirement, and the one that makes the
 *    stored file itself boring. It is textual and therefore, unavoidably,
 *    pattern-based: Node ships no XML parser, and a regex does not parse XML.
 *    It removes what is actually used in practice, and it is deliberately not
 *    the thing being relied on.
 * 2. *Served under a `sandbox` CSP* — the load-bearing half. A response with
 *    `Content-Security-Policy: sandbox` is loaded into an **opaque origin**
 *    when it is navigated to, so script in a file that got past the first
 *    defence still cannot reach this origin's storage, cookies or session.
 *    `<img>` is unaffected: an image is not a document context, so an icon
 *    renders exactly as before.
 *
 * Two defences because the first one cannot be complete and the second one
 * cannot be selective.
 */

/** What this program will name a type for. Everything else is a download. */
const RENDERABLE: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  woff2: 'font/woff2',
};

export interface Sniffed {
  /** The canonical extension, or '' for something unrecognised. */
  kind: string;
  type: string;
}

const DOWNLOAD: Sniffed = { kind: '', type: 'application/octet-stream' };

const starts = (b: Buffer, sig: number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/**
 * What these bytes actually are.
 *
 * Magic numbers only, in the order that avoids the ambiguous cases: RIFF/WEBP
 * needs two checks at different offsets, and SVG is text, so it is tested last
 * and only against a real root element rather than against "looks like XML".
 */
export function sniff(bytes: Buffer): Sniffed {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'png', type: RENDERABLE['png']! };
  }
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { kind: 'jpeg', type: RENDERABLE['jpeg']! };
  if (starts(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: 'gif', type: RENDERABLE['gif']! };
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { kind: 'webp', type: RENDERABLE['webp']! };
  }
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: 'pdf', type: RENDERABLE['pdf']! };
  if (starts(bytes, [0x77, 0x4f, 0x46, 0x32])) return { kind: 'woff2', type: RENDERABLE['woff2']! };

  // Text, and only if it really opens an SVG. A leading BOM, an XML
  // declaration, a doctype or comments may come first, so look at the head
  // rather than at byte zero — but bound it, so a 10MB file is not scanned.
  const head = bytes.subarray(0, 1024).toString('utf8');
  if (/<svg[\s>]/i.test(head)) return { kind: 'svg', type: RENDERABLE['svg']! };

  return DOWNLOAD;
}

/**
 * Take the executable parts out of an SVG (§9).
 *
 * What it removes, and why each one is here rather than being a guess:
 *
 * - `<script>` — the obvious one, and the only one most people think of.
 * - `on*` attributes — `onload` on the root element runs with no interaction
 *   at all, which makes it the more likely vector of the two.
 * - `javascript:` in any URL, however it is spelled. The characters between
 *   the letters can be whitespace, NULs or HTML entities, all of which the
 *   browser strips before deciding it is a scheme, so they are stripped here
 *   before matching rather than matched around.
 * - `<foreignObject>` — arbitrary HTML inside an SVG, including `<iframe>`.
 * - `<use href="http…">` and external `xlink:href` — a reference that reaches
 *   another origin, which is both a leak and a way to pull in markup this
 *   never saw. Fragment (`#id`) and `data:image/` references are kept, since
 *   those are how a legitimate icon sheet works (§9's sprite).
 * - `<set>` / `<animate>` targeting an event or href attribute — animation is
 *   allowed to write attributes, which is a way to reintroduce one of the
 *   above after this has run.
 *
 * **This is the weaker of the two defences and is meant to be.** It is text
 * manipulation on a format that needs a parser, so it is the sandbox CSP in
 * `assetHeaders` that is relied on. Both, because neither alone is right.
 */
export function sanitiseSvg(source: string): string {
  let out = source;

  // Elements that carry code or foreign markup, with or without a closing tag.
  out = out.replace(/<\s*(script|foreignObject|handler)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  out = out.replace(/<\s*(script|foreignObject|handler)\b[^>]*\/?>/gi, '');

  // Event handlers. Quoted, single-quoted, and bare — the last is legal in
  // HTML-parsed SVG and is the spelling a naive filter misses.
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');

  // Any URL-bearing attribute whose value resolves to script or to another
  // origin. The value is normalised before it is judged, because the browser
  // normalises too.
  out = out.replace(
    /\s(href|xlink:href|src|from|to|values|begin|attributeName)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (whole, attr: string, _q: string, dq?: string, sq?: string, bare?: string) => {
      const raw = dq ?? sq ?? bare ?? '';
      const flat = raw
        .replace(/&#x?[0-9a-f]+;?/gi, '')
        // A browser strips these before resolving a URL, so a filter that
        // does not strip them too is walked straight past by
        // `java<NUL>script:`. The control characters are the whole point.
        // eslint-disable-next-line no-control-regex
        .replace(/[\s\u0000-\u001f]/g, '')
        .toLowerCase();

      if (flat.startsWith('javascript:') || flat.startsWith('vbscript:')) return '';
      // An animation that writes an event handler or a href puts back exactly
      // what the passes above took out.
      if (/^(attributename)$/i.test(attr) && /^(on[a-z]+|href|xlink:href)$/.test(flat)) return '';
      if (/^(href|xlink:href|src)$/i.test(attr)) {
        const external = /^[a-z][a-z0-9+.-]*:/.test(flat) && !flat.startsWith('data:image/');
        if (external || flat.startsWith('//')) return '';
      }
      return whole as string;
    },
  );

  return out;
}

/**
 * The headers an asset is served with.
 *
 * `sandbox` is doing the real work — an opaque origin for anything navigated
 * to, so a document that got past the sanitiser has nothing of this origin's
 * to reach. `nosniff` stops a browser deciding for itself that an
 * octet-stream is really HTML. The immutable cache is safe because the id
 * *is* the sha256 of the bytes, so the URL cannot come to mean anything else.
 */
export function assetHeaders(type: string): Record<string, string> {
  return {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'public, max-age=31536000, immutable',
  };
}
