import { describe, expect, it } from 'vitest';
import { cssVariables } from '../src/design/css.js';
import { knownRoles, roleColor, roleVar } from '../src/design/roles.js';
import { builtInSeeds } from '../src/design/seeds.js';
import { deriveTokens } from '../src/design/tokens.js';
import '../src/widgets/hc-line.js';
import '../src/widgets/hc-shape.js';
import '../src/widgets/hc-text.js';
import { HcText } from '../src/widgets/hc-text.js';

async function mount<T extends HTMLElement & { config: Record<string, unknown> }>(
  tag: string,
  config: Record<string, unknown>,
): Promise<T> {
  const el = document.createElement(tag) as T;
  el.config = config;
  document.body.append(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

describe('colour roles', () => {
  it('every role a document can name resolves to a token that exists', () => {
    // A stored page says `ink: "hairline"` — a role, never a colour. If a role
    // mapped to a name nothing emits, CSS would fall back silently and the skin
    // would stop applying to that one property.
    const emitted = new Set(Object.keys(cssVariables(deriveTokens(builtInSeeds['midnight']!))));
    for (const role of knownRoles()) expect(emitted).toContain(roleVar(role));
  });

  it('falls back to the body ink for a role it has not learned', () => {
    // Dim, not invisible and not garish.
    expect(roleVar('some_future_role')).toBe('--hc-ink');
    expect(roleColor(undefined, '--hc-surface-raised')).toBe('var(--hc-surface-raised)');
  });
});

describe('hc-shape', () => {
  it('fills with the role the document named', async () => {
    const el = await mount('hc-shape', { shape: 'rectangle', fill: 'surface', opacity: 100 });
    const div = el.shadowRoot?.querySelector('.shape') as HTMLElement;
    expect(div.style.background).toContain('--hc-surface-raised');
    expect(div.style.opacity).toBe('1');
  });

  it('reads a corner name as a radius token, not a pixel value', async () => {
    const el = await mount('hc-shape', { corner: 'lg' });
    const div = el.shadowRoot?.querySelector('.shape') as HTMLElement;
    expect(div.style.borderRadius).toContain('--hc-radius-lg');
  });

  it('becomes a gradient when a second colour is named', async () => {
    const el = await mount('hc-shape', { fill: 'surface', fill_to: 'accent', fill_angle: 90 });
    const div = el.shadowRoot?.querySelector('.shape') as HTMLElement;
    expect(div.style.background).toContain('linear-gradient(90deg');
    expect(div.style.background).toContain('--hc-accent-primary');
  });

  it('draws no border unless the document asked for one', async () => {
    const bare = await mount('hc-shape', { fill: 'page' });
    expect((bare.shadowRoot?.querySelector('.shape') as HTMLElement).style.border).toBe('');

    const outlined = await mount('hc-shape', { fill: 'page', stroke: 'hairline', stroke_width: 1 });
    const div = outlined.shadowRoot?.querySelector('.shape') as HTMLElement;
    expect(div.style.border).toContain('--hc-stroke-hairline');
  });

  it('dims to the opacity the document set', async () => {
    const el = await mount('hc-shape', { fill: 'surface', opacity: 40 });
    expect((el.shadowRoot?.querySelector('.shape') as HTMLElement).style.opacity).toBe('0.4');
  });
});

describe('hc-line', () => {
  it('takes its colour from the ink role and its size from the placement', async () => {
    // No orientation flag: the placement already says which way it runs, and a
    // 1px-tall box is a horizontal rule without anything declaring it.
    const el = await mount('hc-line', { ink: 'hairline', thickness: 1 });
    const div = el.shadowRoot?.querySelector('.rule') as HTMLElement;
    expect(div.style.background).toContain('--hc-stroke-hairline');
    expect(div.style.minHeight).toBe('1px');
  });

  it('grows with a thicker rule', async () => {
    const el = await mount('hc-line', { thickness: 4 });
    expect((el.shadowRoot?.querySelector('.rule') as HTMLElement).style.minHeight).toBe('4px');
  });
});

describe('hc-text', () => {
  it('resolves ink through the same shared role map', async () => {
    const el = await mount('hc-text', { text: 'EVERY ROOM', ink: 'accent', scale: 88 });
    const p = el.shadowRoot?.querySelector('p') as HTMLElement;
    expect(p.textContent?.trim()).toBe('EVERY ROOM');
    expect(p.style.color).toContain('--hc-accent-primary');
  });
});

describe('the keys a text element was being given and not reading', () => {
  // The most-used widget in the product — 38 of the widgets on the household's
  // two pages — and four of the keys its own documents carry did nothing.
  const text = (config: Record<string, unknown>) =>
    mount<HTMLElement & { config: Record<string, unknown> }>('hc-text', config);
  const para = (el: HTMLElement) => el.shadowRoot?.querySelector('p') as HTMLElement;

  it('draws a mono face in the mono family, not in the body one', async () => {
    // Eight elements on the household's own pages ask for mono — every one a
    // number or the unit beside one — and all eight rendered in Inter.
    const el = await text({ text: '73', face: 'mono' });
    expect(para(el).dataset['face']).toBe('mono');
  });

  it('leaves anything else in the body face', async () => {
    const el = await text({ text: 'EVERY ROOM' });
    expect(para(el).dataset['face']).toBe('text');
  });

  it('turns the words a document writes into weights CSS knows', async () => {
    // Three of the four are not CSS at all: the declaration was dropped and
    // every one of them rendered 400, which is right for `regular` by accident
    // and wrong for the other two.
    const weights = await Promise.all(
      ['regular', 'medium', 'bold', 'black'].map((w) => text({ text: 'x', weight: w })),
    );
    expect(weights.map((el) => para(el).style.fontWeight)).toEqual(['400', '500', '700', '900']);
  });

  it('passes through a weight it does not know, rather than flattening it', async () => {
    const el = await text({ text: 'x', weight: '600' });
    expect(para(el).style.fontWeight).toBe('600');
  });

  it('measures the scale against the step the document named', async () => {
    // `scale` is a percentage *of the step*. A page that asked for display was
    // drawn at body and silently shrunk by two thirds.
    const el = await text({ text: 'x', size: 'display', scale: 200 });
    expect(para(el).style.fontSize).toBe('calc(var(--hc-text-display-size, 28px) * 2)');
  });

  it('stays on body when the document names no step, which is every page here', async () => {
    const el = await text({ text: 'x', scale: 85 });
    expect(para(el).style.fontSize).toBe('calc(var(--hc-text-body-size, 13px) * 0.85)');
  });

  it('puts the words where the box says, vertically', async () => {
    const el = await text({ text: 'x', vertical: 'middle' });
    expect(el.getAttribute('data-vertical')).toBe('middle');
    const plain = await text({ text: 'x' });
    expect(plain.hasAttribute('data-vertical'), 'an attribute for the default').toBe(false);
  });

  it('keeps figures from shuffling as they change', async () => {
    // A designed page is full of numbers that update in place — a temperature
    // at 350% of body — and proportional figures make every one of them twitch.
    //
    // Read off the sheet rather than off a computed style: jsdom resolves
    // neither, and a test that asserted the empty string it returns would pass
    // whatever the widget declared.
    const sheet = (HcText as unknown as { styles: { cssText: string } }).styles.cssText;
    expect(sheet).toContain('font-variant-numeric: tabular-nums');
  });
});
