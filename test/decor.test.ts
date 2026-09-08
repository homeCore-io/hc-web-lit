import { describe, expect, it } from 'vitest';
import { cssVariables } from '../src/design/css.js';
import { knownRoles, roleColor, roleVar } from '../src/design/roles.js';
import { builtInSeeds } from '../src/design/seeds.js';
import { deriveTokens } from '../src/design/tokens.js';
import '../src/widgets/hc-line.js';
import '../src/widgets/hc-shape.js';
import '../src/widgets/hc-text.js';

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
