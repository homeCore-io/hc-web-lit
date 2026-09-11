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
