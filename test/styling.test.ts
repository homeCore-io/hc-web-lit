/**
 * P7 — the styling contract, enforced (§5.8).
 *
 * §19.7 makes `part` names and custom property names ABI. That is a promise
 * about the future, and the only way a promise like it survives is if breaking
 * it fails something today: a widget shipped without hooks cannot be themed,
 * and a widget that invents a second word for an idea gives a theme author two
 * selectors where there should be one.
 *
 * Reads the sources rather than rendering, because the question is about what
 * the widgets *offer*, not what one instance happened to draw.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { knownParts } from '../src/design/parts.js';
import { deriveType } from '../src/design/tokens.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'widgets');
const files = readdirSync(dir).filter((f) => f.startsWith('hc-') && f.endsWith('.ts'));
const source = (f: string): string => readFileSync(join(dir, f), 'utf8');
const partsIn = (s: string): string[] => [
  ...new Set([...s.matchAll(/part="([a-z-]+)"/g)].map((m) => m[1]!)),
];

describe('the styling contract', () => {
  it('has widgets to check', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it.each(files)('%s exposes styling hooks', (file) => {
    const s = source(file);
    // A widget that extends another inherits its parts, and re-declaring them
    // would be two names for one element.
    if (/extends Hc[A-Z]/.test(s) && !/extends LitElement/.test(s)) return;
    expect(partsIn(s).length, `${file} exposes no ::part()`).toBeGreaterThan(0);
  });

  it.each(files)('%s uses only declared part names', (file) => {
    const known = knownParts();
    for (const p of partsIn(source(file))) {
      expect(known.has(p), `${file}: part="${p}" is not in design/parts.ts`).toBe(true);
    }
  });

  it('spells the shared ideas the same way everywhere', () => {
    // The failure this prevents: one widget's blank state is `empty` and the
    // next one's is `placeholder`, and a theme has to know which is which.
    const banned = /part="(placeholder|blank|none|title|icon-box|wrapper|container)"/;
    for (const file of files) {
      expect(banned.test(source(file)), `${file} invents a word for a shared idea`).toBe(false);
    }
  });
});

describe('the stylesheets themselves', () => {
  it('closes every css template where it means to', () => {
    // Third time: a backtick in a CSS comment closes the `css` tag early and
    // the file stops being TypeScript. The typecheck catches it, so it never
    // ships — but it costs a debugging pass each time, and the fix is to stop
    // writing them rather than to keep spotting them.
    //
    // A template ends at its first backtick, by definition. So the test is
    // whether that backtick is where a template *should* end: followed by a
    // separator. Anything else means it closed inside the CSS.
    const all = [...files.map((f) => join(dir, f)), join(dir, '..', 'sdk', 'shell.ts')];
    for (const path of all) {
      const text = readFileSync(path, 'utf8');
      for (const start of [...text.matchAll(/css`/g)].map((m) => m.index! + 4)) {
        const end = text.indexOf('`', start);
        expect(end, `${path}: unterminated css template`).toBeGreaterThan(-1);
        const after = text.slice(end + 1).replace(/^\s+/, '')[0];
        expect(
          [';', ',', ']'],
          `${path}: css template closes early, at "…${text
            .slice(Math.max(0, end - 40), end + 1)
            .split('\n')
            .pop()}"`,
        ).toContain(after);
      }
    }
  });
});

describe('the type scale, as the product actually uses it', () => {
  /** Every `var(--hc-text-…)` a widget reads, with the fallback it declares. */
  const uses = (): { token: string; fallback: string; file: string }[] => {
    const out: { token: string; fallback: string; file: string }[] = [];
    for (const file of files) {
      for (const m of source(file).matchAll(/var\(--hc-text-([a-z-]+?)-size,\s*([^)]+)\)/g)) {
        out.push({ token: m[1] as string, fallback: (m[2] as string).trim(), file });
      }
    }
    return out;
  };

  it('reads only roles the ramp actually defines', () => {
    // **An invented token is a hard-coded value wearing a token's clothes.**
    // `--hc-text-label-size` and `--hc-ink-dim` were both written here with a
    // literal behind them, so they rendered that literal on every skin and
    // followed none of them. A `var()` that never resolves is worse than the
    // number it hides, because it reads as if it were part of the system.
    const roles = new Set(Object.keys(deriveType(1)));
    for (const u of uses()) {
      const camel = u.token.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      expect(roles.has(camel), `${u.file}: --hc-text-${u.token}-size is not a role`).toBe(true);
    }
  });

  it('declares fallbacks that agree with the ramp', () => {
    // A fallback that disagrees is documentation that lies: `title` was
    // written as 16px, 18px and 20px in different widgets while the ramp said
    // one number, so reading any one of them told you the wrong thing.
    const ramp = deriveType(1) as unknown as Record<string, { size: number }>;
    for (const u of uses()) {
      const camel = u.token.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const want = ramp[camel]?.size;
      if (want === undefined) continue;
      expect(u.fallback, `${u.file}: --hc-text-${u.token}-size`).toBe(`${want}px`);
    }
  });
});

describe('how high a thing sits', () => {
  it('takes its drop shadow from the elevation set, never from a literal', () => {
    // **A literal cannot follow a ground it has never heard of.** Six drop
    // shadows were written by hand across the widgets — a slider's thumb, a
    // colour wheel, a play button — several differing from each other only by
    // a decimal, and every one of them a dark-only `rgba(0,0,0,…)`. On the
    // light skin all six were a black smudge. The set derives `card`,
    // `overlay` and `control` per skin, which is the whole point of having it.
    const offenders: string[] = [];
    for (const file of files) {
      for (const m of source(file).matchAll(/box-shadow:([^;]+);/g)) {
        const decl = (m[1] as string).replace(/\s+/g, ' ');
        // An inset is a rim light or a hairline drawn inside the box, not a
        // height off the page — those stay literal on purpose.
        for (const layer of decl.split(/,(?![^()]*\))/)) {
          if (layer.includes('inset')) continue;
          if (/rgba?\(\s*0,\s*0,\s*0/.test(layer)) offenders.push(`${file}: ${layer.trim()}`);
        }
      }
    }
    expect(offenders, 'use --hc-elevation-card / -overlay / -control').toEqual([]);
  });
});

describe('the spacing scale', () => {
  /**
   * The steps the product uses, in rem: 2, 4, 6, 8, 12, 16, 24, 32px, plus the
   * zero and the two keywords a layout legitimately needs.
   */
  const STEPS = new Set([
    '0',
    '0px',
    'auto',
    'inherit',
    '0.125rem',
    '0.25rem',
    '0.375rem',
    '0.5rem',
    '0.75rem',
    '1rem',
    '1.25rem',
    '1.5rem',
    '2rem',
    '1px',
    '2px',
  ]);

  it('sets gaps and padding on the scale, or from the space unit', () => {
    // **123 raw spacing values against 31 using the token**, and fifteen of
    // them on no grid at all: 0.1rem, 0.2, 0.35, 0.4, 0.625, 0.7, and a 9px
    // and a 3px. Each was a judgement made once and never compared with its
    // neighbours — which is how a page ends up almost aligned everywhere.
    const off: string[] = [];
    const prop = /(?:^|\n)\s*(gap|row-gap|column-gap|padding|margin)(-[a-z]+)?:\s*([^;]+);/g;
    for (const file of files) {
      for (const m of source(file).matchAll(prop)) {
        const value = (m[3] as string).trim();
        // A calc from the space unit, a custom property or a percentage is the
        // system being used, not bypassed. Three more are exempt on purpose:
        // `em`, because prose spaces itself against its own type size and
        // `hc-markdown` is the one widget setting real prose; a negative
        // value, which centres something rather than spacing it; and a
        // template hole, which is a document's number and not a literal here.
        if (/var\(|calc\(|%|em\b|-[0-9]|\$\{/.test(value)) continue;
        for (const part of value.split(/\s+/)) {
          if (!STEPS.has(part)) off.push(`${file}: ${m[1] as string}: ${value}`);
        }
      }
    }
    expect([...new Set(off)]).toEqual([]);
  });
});
