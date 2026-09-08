import { describe, expect, it } from 'vitest';
import { builtInSeeds } from '../src/design/seeds.js';
import { cssVariables } from '../src/design/css.js';
import {
  deriveDensity,
  deriveMetrics,
  deriveMotion,
  deriveTokens,
  deriveType,
  scaleCorners,
} from '../src/design/tokens.js';

const skins = Object.keys(builtInSeeds);

describe('the four built-in skins', () => {
  it('is four of them', () => {
    expect(skins).toEqual(['midnight', 'ambient_glass', 'control_room', 'soft_home']);
  });

  for (const name of skins) {
    it(`${name} derives without losing its palette`, () => {
      const seeds = builtInSeeds[name]!;
      const t = deriveTokens(seeds);

      // The chosen half must survive derivation untouched — the whole point of
      // seeding a palette rather than computing one.
      expect(t.surface.base).toBe(seeds.ground);
      expect(t.surface.raised).toBe(seeds.raised);
      expect(t.surface.sunken).toBe(seeds.sunken);
      expect(t.accent.primary).toBe(seeds.accent);
      expect(t.accent.active).toBe(seeds.active);
      expect(t.accent.danger).toBe(seeds.danger);
      expect(t.stroke.hairline).toBe(seeds.hairline);
      expect(t.radius.md).toBe(seeds.corners[2]);
    });
  }
});

describe('the rules', () => {
  it('gives Control Room no card shadow, and an overlay one anyway', () => {
    // A modal has to separate from the page whatever the skin thinks about
    // depth. This is what makes Control Room read as flat panels.
    const t = deriveTokens(builtInSeeds['control_room']!);
    expect(t.elevation.card).toBe('none');
    expect(t.elevation.overlay).not.toBe('none');
  });

  it('gives a light ground two card shadows, not one', () => {
    // One blur on a light ground reads as a grey smudge: a tight contact
    // shadow plus a wide soft one.
    const t = deriveTokens(builtInSeeds['soft_home']!);
    expect(t.elevation.card.split('),').length).toBe(2);
  });

  it('blurs only a frosted skin, and tints both kinds of glass', () => {
    const frosted = deriveTokens(builtInSeeds['ambient_glass']!);
    const tinted = deriveTokens(builtInSeeds['soft_home']!);
    const none = deriveTokens(builtInSeeds['midnight']!);

    expect(frosted.surface.glassBlur).toBe(24);
    expect(tinted.surface.glassBlur).toBe(0);
    expect(tinted.surface.glassTint).not.toBe('transparent');
    expect(none.surface.glassTint).toBe('transparent');
  });

  it('veils a dark ground with white and a light ground with black', () => {
    // Glass is a scattering of the room's own light, not a colour of its own.
    expect(deriveTokens(builtInSeeds['ambient_glass']!).surface.glassTint).toContain('255,255,255');
    expect(deriveTokens(builtInSeeds['soft_home']!).surface.glassTint).toContain('0,0,0');
  });

  it('derives three metric tints from the palette and fixes three', () => {
    const s = builtInSeeds['midnight']!;
    const m = deriveMetrics(s);
    expect(m.co2).toBe(s.success);
    expect(m.power).toBe(s.active);
    expect(m.reading).toBe(s.accent);
    // Temperature is warm, humidity cool, light yellow — no accent implies them.
    expect(m.temperature).toBe('#FF8A5B');
  });

  it('lets a skin override the rule where it wants to', () => {
    // Soft Home wants a roomier density and a slightly quicker motion than its
    // presets give; the override is the escape hatch, and it must win.
    const t = deriveTokens(builtInSeeds['soft_home']!);
    expect(t.density).toEqual({
      rowHeight: 56,
      controlHeight: 48,
      minTapTarget: 48,
      cardPadding: 18,
    });
    expect(t.motion.fast).toBe(130);
    expect(deriveDensity('comfortable').rowHeight).toBe(52);
    expect(deriveMotion('standard').fast).toBe(140);
  });

  it('takes the focus ring from the accent unless the skin names one', () => {
    expect(deriveTokens(builtInSeeds['midnight']!).stroke.focus).toBe(
      builtInSeeds['midnight']!.accent,
    );
    expect(deriveTokens(builtInSeeds['soft_home']!).stroke.focus).toBe('#C2603F');
  });

  it('sizes the whole ramp from one number', () => {
    const at1 = deriveType(1);
    const at115 = deriveType(1.15);
    expect(at1.display.size).toBe(26);
    expect(at115.display.size).toBeCloseTo(29.9);
    // Weights and line heights are not scaled — only sizes are.
    expect(at115.display.weight).toBe(at1.display.weight);
    expect(at115.body.height).toBe(at1.body.height);
  });

  it('keeps a skin s corner proportions when rescaled from md', () => {
    // Midnight is 4/8/14/22. Doubling the card radius should keep the shape.
    expect(scaleCorners([4, 8, 14, 22], 28)).toEqual([8, 16, 28, 44]);
  });

  it('falls back to a ramp rather than multiplying zero', () => {
    expect(scaleCorners([0, 0, 0, 0], 10)).toEqual([3, 6, 10, 14]);
  });

  it('gives no motion preset an overshoot on crisp', () => {
    // An instrument does not bounce.
    const crisp = deriveMotion('crisp');
    expect(crisp.curve).toBe(crisp.emphasized);
  });
});

describe('css variables', () => {
  it('emits every token as an --hc- custom property', () => {
    const vars = cssVariables(deriveTokens(builtInSeeds['midnight']!));
    expect(vars['--hc-surface-base']).toBe('#0B0E13');
    expect(vars['--hc-accent-active']).toBe('#FFB661');
    expect(vars['--hc-radius-md']).toBe('14px');
    expect(vars['--hc-motion-base']).toBe('260ms');
    expect(vars['--hc-text-display-size']).toBe('26px');
    expect(vars['--hc-text-overline-tracking']).toBe('1.1px');
    // Every name is ABI (§19.7); none may be bare.
    for (const k of Object.keys(vars)) expect(k.startsWith('--hc-')).toBe(true);
  });

  it('produces a different sheet for every skin', () => {
    const sheets = skins.map((n) => JSON.stringify(cssVariables(deriveTokens(builtInSeeds[n]!))));
    expect(new Set(sheets).size).toBe(skins.length);
  });
});

describe('the names widgets actually use exist', () => {
  it('every --hc- name a component references is one the derivation emits', () => {
    // Token names are ABI (§19.7). A component that reaches for a name nothing
    // emits does not fail — CSS falls back to the literal in the var() and the
    // skin silently stops applying to that one property, which is the worst
    // kind of styling bug because it looks deliberate.
    const emitted = new Set(Object.keys(cssVariables(deriveTokens(builtInSeeds['midnight']!))));

    // Kept in step by hand rather than by scanning the filesystem: a test that
    // greps source is a test that passes when the source is empty.
    const used = [
      '--hc-surface-base',
      '--hc-surface-raised',
      '--hc-ink',
      '--hc-ink-muted',
      '--hc-accent-primary',
      '--hc-accent-active',
      '--hc-accent-inactive',
      '--hc-accent-success',
      '--hc-accent-danger',
      '--hc-stroke-hairline',
      '--hc-radius-md',
      '--hc-font-body',
    ];

    for (const name of used) expect(emitted).toContain(name);
  });
});
