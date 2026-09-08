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
