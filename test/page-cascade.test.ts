/**
 * What the stylesheet *resolves* to, not what it mentions somewhere.
 *
 * jsdom does not apply adopted stylesheets, so `getComputedStyle` here reports
 * the empty string whether a rule exists or not — which is why the existing
 * checks match the CSS text. Matching text is not enough on its own: the
 * property that broke a composed page was declared correctly and then
 * overridden by a later rule that named the same class for another reason.
 * These read the cascade instead.
 */
import { describe, expect, it } from 'vitest';
import { HcPage } from '../src/shell/hc-page.js';

const css = [HcPage.styles].flat().map(String).join('\n');

/**
 * The value a class ends up with, given every rule that names it.
 *
 * Declaration order decides it, because every selector here is one class and
 * so every one has the same specificity — which is exactly the trap: a rule
 * added later for an unrelated reason silently wins.
 */
function resolved(className: string, property: string): string | undefined {
  let value: string | undefined;
  let depth = 0;
  let selector = '';
  let body = '';
  let inBody = false;

  // Comments first: a block comment sitting above a rule would otherwise be
  // swallowed into its selector, and `/* … */ .cell` matches no class name.
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Hand-walked rather than matched, because a naive `{...}` regex mis-parses
  // the first nested at-rule and then everything after it. Only rules at the
  // top level count: an `@container` override is a condition, not what the
  // class resolves to by default, and the conditional cases are asserted on
  // their own below.
  for (const ch of clean) {
    if (ch === '{') {
      depth++;
      if (depth === 1) inBody = true;
      else if (inBody) body += ch;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const names = selector.split(',').map((x) => x.trim());
        if (names.some((n) => n === `.${className}`)) {
          for (const decl of body.split(';')) {
            const [name, given] = decl.split(':').map((x) => x.trim());
            if (name === property && given !== undefined) value = given;
          }
        }
        selector = '';
        body = '';
        inBody = false;
      } else if (inBody) body += ch;
      continue;
    }
    if (depth === 0) selector += ch;
    else if (inBody) body += ch;
  }
  return value;
}

describe('a composed placement', () => {
  it('ends up absolutely positioned, whatever else names it', () => {
    // It is positioned by `left`/`top` in frame units. As `relative` it falls
    // back into document flow: the page draws as one tall column of stacked
    // boxes, and the largest shape — a full-page background — covers
    // everything under it. That is what a household saw, and counting DOM
    // nodes did not notice.
    expect(resolved('placed', 'position')).toBe('absolute');
  });

  it('leaves the grid cell relative, which is what the handles need there', () => {
    expect(resolved('cell', 'position')).toBe('relative');
  });

  it('clips the widget and not the box holding the handles', () => {
    expect(resolved('body', 'overflow')).toBe('hidden');
    expect(resolved('placed', 'overflow')).toBeUndefined();
  });

  it('keeps the frame a containing block for what it positions', () => {
    expect(resolved('frame', 'position')).toBe('relative');
  });

  it('lets a placement that fits its content out of the clip', () => {
    // The exception, asserted as one: a card told to be as tall as what is in
    // it is the one thing the body must not cut off.
    expect(css).toMatch(/\.placed\[data-fits\]\s*>\s*\.body\s*\{[^}]*overflow:\s*visible/);
  });
});

describe('density for a placement that has no drawn height', () => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('keeps size containment off the placements that grow', () => {
    // A size container is size-contained, so its children stop contributing to
    // its height — fatal on the very boxes that exist to be as tall as their
    // contents. Asserted on the selector because that is where it was got
    // wrong, and because jsdom lays nothing out to catch it afterwards.
    expect(clean).toMatch(
      /\.placed:not\(\[data-fits\]\),\s*\n?\s*\.cell\s*\{[^}]*container-type:\s*size/,
    );
  });

  it('gives one an answer anyway, from the column it is in', () => {
    // With no box to query, every grown list fell back to the comfortable step
    // and two lists side by side disagreed about how tall a row is.
    const rule = /\.stack \.placed\[data-fits\] > \.body\s*\{([^}]*)\}/.exec(clean);
    expect(rule, 'no compact rule for a grown placement in a column').not.toBeNull();
    expect(rule?.[1]).toContain('--hc-density-row-height');
    expect(rule?.[1]).toContain('--hc-density-min-tap');
  });

  it('says it after the query, so it is the one that wins', () => {
    // Same specificity is not the question — one is inside a condition and one
    // is not — but a reader has to be able to see which came last.
    expect(clean.indexOf('.stack .placed[data-fits] > .body')).toBeGreaterThan(
      clean.indexOf('@container (max-height:'),
    );
  });
});

describe('what a container paints', () => {
  it('paints nothing, so what is on it keeps its contrast', () => {
    // Every device row is the raised surface. A container of the same colour
    // behind them leaves them with only a hairline to be seen by, and takes
    // the section rules with it. The page's ground is a shape the author drew.
    expect(resolved('stack', 'background')).toBeUndefined();
    expect(resolved('stack', 'background-color')).toBeUndefined();
  });

  it('is still a positioned box, or nothing inside it knows where it is', () => {
    expect(resolved('stack', 'position')).toBe('absolute');
  });
});

describe('what the surface does with pointer events while arranging', () => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('takes them before the widget sees them', () => {
    // §14.2. Dragging a card that contains a slider moves the card; it does
    // not set brightness — and pressing the toggle in a device row while the
    // page was being arranged switched a real outlet.
    expect(clean).toMatch(
      /\.frame\[data-editing\] \.body,\s*\n?\s*\.grid\[data-editing\] \.body\s*\{[^}]*pointer-events:\s*none/,
    );
  });

  it('leaves the handles alone, which are not in the body', () => {
    // The move grip, the eight resize grips and the turn are siblings of the
    // body inside the placement, which is why the rule is on the body and not
    // on the placement.
    expect(resolved('grab', 'pointer-events')).toBeUndefined();
    expect(resolved('grip', 'pointer-events')).toBeUndefined();
  });
});
