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
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.some((s) => s === `.${className}` || s.endsWith(` .${className}`))) continue;
    for (const decl of (match[2] ?? '').split(';')) {
      const [name, given] = decl.split(':').map((x) => x.trim());
      if (name === property && given !== undefined) value = given;
    }
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
});
