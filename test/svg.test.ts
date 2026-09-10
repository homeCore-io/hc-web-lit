/**
 * One policy, two implementations, one corpus.
 *
 * A drawing reaches this client twice by different routes: stored as an asset
 * and sanitised in Node by a string filter (`server/assets.ts`), or written
 * into a dashboard and sanitised in the browser by a parser
 * (`src/core/svg.ts`). Two implementations is not duplication for its own
 * sake — one of them has no DOM to parse with — but two implementations of one
 * policy drift, and drift is how the weaker one becomes the way in.
 *
 * So the hostile corpus is shared, and every case runs through both.
 */
import { describe, expect, it } from 'vitest';
import { sanitiseSvg as parse } from '../src/core/svg.js';
import { sanitiseSvg as filter } from '../server/assets.ts';
import '../src/widgets/hc-svg.js';

/** Things that must not survive, whichever route the drawing came by. */
const HOSTILE: { name: string; source: string }[] = [
  {
    name: 'a script element',
    source: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  },
  {
    name: 'a self-closing script',
    source: '<svg xmlns="http://www.w3.org/2000/svg"><script href="x.js"/></svg>',
  },
  {
    name: 'an event handler in quotes',
    source: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>',
  },
  {
    name: 'an event handler with no quotes',
    source: '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick=alert(1) width="1"/></svg>',
  },
  {
    name: 'foreign markup',
    source:
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror="alert(1)"/></body></foreignObject></svg>',
  },
  {
    name: 'a javascript link',
    source:
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
  },
  {
    name: 'a link that hides its scheme in entities',
    source:
      '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="java&#x0a;script:alert(1)"><rect/></a></svg>',
  },
  {
    name: 'an animation that writes a handler back',
    source:
      '<svg xmlns="http://www.w3.org/2000/svg"><rect><set attributeName="onload" to="alert(1)"/></rect></svg>',
  },
  {
    name: 'a use element pointing off-origin',
    source: '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.test/x.svg#a"/></svg>',
  },
  {
    name: 'an image fetching from elsewhere',
    source:
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/pixel.png"/></svg>',
  },
  {
    name: 'css that fetches',
    source:
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil.test/x)"/></svg>',
  },
];

/** What must be gone from the result, whichever shape the result takes. */
const forbidden = (text: string): string[] =>
  [
    /<\s*script/i,
    /\son[a-z]+\s*=/i,
    /javascript:/i,
    /foreignobject/i,
    /evil\.test/i,
    /attributeName\s*=\s*["']?on/i,
  ]
    .filter((r) => r.test(text))
    .map((r) => r.source);

describe('the parser this client uses on a drawing in a document', () => {
  it.each(HOSTILE)('strips $name', ({ source }) => {
    const node = parse(source);
    // Either it refused the document outright or what came back is inert.
    const text = node === undefined ? '' : node.outerHTML;
    expect(forbidden(text)).toEqual([]);
  });

  it('keeps a drawing that is only a drawing', () => {
    const node = parse(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red" style="opacity:0.5"/><title>Plan</title></svg>',
    );
    expect(node?.querySelector('rect')?.getAttribute('fill')).toBe('red');
    expect(node?.querySelector('rect')?.getAttribute('style')).toBe('opacity:0.5');
    expect(node?.getAttribute('viewBox')).toBe('0 0 10 10');
  });

  it('keeps a data-URI image in a style, which is the one url that fetches nothing', () => {
    const node = parse(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(data:image/png;base64,AA)"/></svg>',
    );
    expect(node?.querySelector('rect')?.getAttribute('style')).toContain('data:image/png');
  });

  it('is nothing for something that is not a drawing at all', () => {
    expect(parse('')).toBeUndefined();
    expect(parse('<html><body>hello</body></html>')).toBeUndefined();
    expect(parse('<svg><rect')).toBeUndefined();
  });
});

describe('the filter the asset store uses in Node', () => {
  it.each(HOSTILE)('strips $name', ({ source }) => {
    expect(forbidden(filter(source))).toEqual([]);
  });
});

describe('the widget', () => {
  const mount = async (config: Record<string, unknown>) => {
    const el = document.createElement('hc-svg');
    el.config = config;
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  it('draws the drawing', async () => {
    const el = await mount({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
    });
    expect(el.shadowRoot?.querySelector('circle')).not.toBeNull();
  });

  it('never puts a script in the page', async () => {
    const el = await mount({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
    });
    expect(el.shadowRoot?.querySelector('script')).toBeNull();
    expect(el.shadowRoot?.querySelector('svg')?.getAttribute('onload')).toBeNull();
  });

  it('says a drawing is not one rather than showing a blank rectangle', async () => {
    // A blank rectangle where somebody put a floor plan is indistinguishable
    // from a page that has not loaded.
    const el = await mount({ svg: '<not-a-drawing>' });
    expect(el.shadowRoot?.textContent).toContain('not a drawing');
  });

  it('parses once for a drawing that has not changed', async () => {
    // A page re-renders on every device event, and this house streams
    // constantly; parsing per frame is a wall panel's whole budget.
    const el = await mount({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
    });
    const first = el.shadowRoot?.querySelector('circle');
    el.requestUpdate();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('circle')).toBe(first);
  });
});
