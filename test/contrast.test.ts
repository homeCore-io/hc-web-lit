/**
 * Every skin has to hold the design, not just the one it was drawn in.
 *
 * The widgets tint their marks with `color-mix()` against tokens, which lands
 * wherever a skin's surfaces are. Five ship and one is light, so this walks the
 * same mixes the stylesheets ask for and pins them above WCAG's floors — 4.5
 * for text, 3 for a shape.
 *
 * Measured in a real browser first (Chrome, all five skins, both pages); these
 * are the same numbers, computed, so a sixth skin cannot quietly break it.
 */
import { describe, expect, it } from 'vitest';
import { builtInSeeds } from '../src/design/seeds.js';
import { deriveTokens } from '../src/design/tokens.js';
import { READABLE, VISIBLE, contrast, mix } from '../src/design/contrast.js';

const skins = Object.keys(builtInSeeds);

describe('contrast, in every skin', () => {
  it.each(skins)('%s keeps body text readable', (name) => {
    const t = deriveTokens(builtInSeeds[name]!);
    for (const [where, surface] of [
      ['base', t.surface.base],
      ['raised', t.surface.raised],
      ['sunken', t.surface.sunken],
      ['overlay', t.surface.overlay],
    ] as const) {
      expect(contrast(t.surface.onBase, surface), `ink on ${where}`).toBeGreaterThanOrEqual(
        READABLE,
      );
    }
  });

  it.each(skins)('%s keeps the muted ink readable on a card', (name) => {
    const t = deriveTokens(builtInSeeds[name]!);
    // The state at the end of a device row, the room beside a notice, the
    // axis on a chart — all of it is this colour on this surface.
    expect(contrast(t.surface.onBaseMuted, t.surface.raised)).toBeGreaterThanOrEqual(READABLE);
  });

  it.each(skins)('%s keeps a lit mark visible on its own tile', (name) => {
    const t = deriveTokens(builtInSeeds[name]!);
    // What `hc-device-pill` paints: the tile is the active accent mixed into
    // the sunken surface, and the mark is that accent nudged toward the ink.
    const tile = mix(t.accent.active, t.surface.sunken, 32)!;
    const mark = mix(t.accent.active, t.surface.onBase, 85)!;
    expect(contrast(mark, tile)).toBeGreaterThanOrEqual(VISIBLE);
  });

  it.each(skins)('%s keeps an idle mark visible on its own tile', (name) => {
    const t = deriveTokens(builtInSeeds[name]!);
    // The unlit case: no tint at all, so the tile is the sunken surface and the
    // mark is muted ink. This is most of what is on screen.
    const mark = mix(t.surface.onBaseMuted, t.surface.onBase, 85)!;
    expect(contrast(mark, t.surface.sunken)).toBeGreaterThanOrEqual(VISIBLE);
  });

  it.each(skins)('%s keeps a notice mark visible in its own tone', (name) => {
    const t = deriveTokens(builtInSeeds[name]!);
    for (const tone of [t.accent.danger, t.accent.warn, t.accent.success, t.accent.offline]) {
      const tile = mix(tone, t.surface.sunken, 16)!;
      const mark = mix(tone, t.surface.onBase, 85)!;
      expect(contrast(mark, tile)).toBeGreaterThanOrEqual(VISIBLE);
    }
  });

  it.each(skins)('%s keeps an applied scene distinguishable from an idle one', (name) => {
    const t = deriveTokens(builtInSeeds[name]!);
    // A wash rather than a fill only works if the wash is actually visible
    // against the chip beside it.
    const applied = mix(t.accent.active, t.surface.raised, 18)!;
    expect(contrast(applied, t.surface.raised)).toBeGreaterThan(1.08);
  });

  it('is arithmetic anyone can check', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrast('#000000', '#000000')).toBeCloseTo(1, 5);
    // Half way between black and white, in sRGB.
    expect(mix('#ffffff', '#000000', 50)).toEqual([0.5, 0.5, 0.5]);
  });
});
