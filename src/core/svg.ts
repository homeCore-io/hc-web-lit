/**
 * A drawing from a document, made safe to put in this page.
 *
 * The `svg` widget holds an SVG somebody typed into a dashboard, with device
 * values interpolated into it (§6). That is the same trust level as a markdown
 * note — whoever can edit the page, plus whatever a plugin publishes as a
 * device name — and the same answer applies: do not turn text into markup.
 *
 * **Parsed, not filtered.** `server/assets.ts` sanitises stored SVG assets with
 * a string filter because it runs in Node with no DOM, and a filter is a
 * sequence of guesses about how a browser will parse something. Here there is
 * a real parser, so the browser does the parsing and this walks the tree it
 * produced. A trick that survives a regex — `java&#x0a;script:`, a bare
 * `onload=` with no quotes, a nested `<svg><script>` — has already been
 * resolved into a node with a name and attributes by the time it reaches this.
 *
 * The two implementations are one policy, and `test/svg.test.ts` runs the same
 * hostile corpus through both so they cannot drift apart quietly.
 *
 * **An allowlist of shapes and paint, and nothing that fetches.** Every
 * element that can load something (`image`, `use`, `a`), run something
 * (`script`, `handler`, `foreignObject`), or *write an attribute later*
 * (`animate`, `set`, `animateTransform`) is out. That last family is what
 * makes an attribute allowlist insufficient on its own: `<set
 * attributeName="onload" to="…">` puts back exactly what was removed.
 */

/** What a drawing may be made of. Shapes, structure, paint. */
const ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'pattern',
  'marker',
  'filter',
  'fegaussianblur',
  'fedropshadow',
  'feoffset',
  'feblend',
  'femerge',
  'femergenode',
  'fecolormatrix',
  'fecomposite',
  'feflood',
]);

/**
 * Whether a `style` attribute is one to keep.
 *
 * CSS can fetch — `url(...)` — and a browser resolves what is inside those
 * brackets before anything here gets another look. Only a data URI for an
 * image is allowed through; everything else loses the whole declaration
 * rather than being edited, because editing CSS with a regex is the thing
 * this file exists to avoid doing.
 */
function safeStyle(value: string): boolean {
  const flat = value.toLowerCase().replace(/\s+/g, '');
  if (flat.includes('@import') || flat.includes('expression(')) return false;
  if (!flat.includes('url(')) return true;
  return [...flat.matchAll(/url\(([^)]*)\)/g)].every((m) =>
    (m[1] ?? '').replace(/['"]/g, '').startsWith('data:image/'),
  );
}

/** Attributes that are never kept, whatever they hold. */
function dropped(name: string): boolean {
  const lower = name.toLowerCase();
  // Event handlers, in every spelling a parser will accept.
  if (lower.startsWith('on')) return true;
  // Nothing in the allowlist above uses a link, so a link is either
  // decoration somebody left behind or an attempt at one.
  if (lower === 'href' || lower === 'xlink:href' || lower === 'src') return true;
  // A namespace this is not: `xlink:` beyond `href`, and anything else exotic.
  if (lower.startsWith('xmlns:') || lower.startsWith('xlink:')) return true;
  return false;
}

/**
 * The drawing, or nothing.
 *
 * `undefined` for anything that is not parseable as SVG, which includes the
 * empty string and includes HTML pretending to be a drawing. A caller should
 * draw nothing rather than fall back to text — text that was meant to be a
 * drawing is not a message anybody wants on a wall panel.
 */
export function sanitiseSvg(source: string): SVGElement | undefined {
  if (source.trim() === '') return undefined;
  if (typeof DOMParser === 'undefined') return undefined;

  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  // The parser reports a failure as a document containing `parsererror`, which
  // is the one element name that means "this was not the thing you said".
  if (parsed.getElementsByTagName('parsererror').length > 0) return undefined;

  const root = parsed.documentElement;
  if (root.tagName.toLowerCase() !== 'svg') return undefined;

  const clean = (el: Element): void => {
    for (const child of [...el.children]) {
      if (!ELEMENTS.has(child.tagName.toLowerCase())) {
        child.remove();
        continue;
      }
      clean(child);
    }

    for (const attr of [...el.attributes]) {
      if (dropped(attr.name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (attr.name.toLowerCase() === 'style' && !safeStyle(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  };

  clean(root);
  return root as unknown as SVGElement;
}
