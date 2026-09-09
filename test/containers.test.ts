/**
 * Containers built on P4 — `tabs`, `accordion`, `swipe` (§5.5, §7.3).
 *
 * §5.1 lists stack-in-card, vertical-stack-in-card and swipe-card as Home
 * Assistant community cards that exist only because the host had no
 * composition primitive. These are the primitive, so what is worth pinning is
 * the part a wrapper card cannot do: children that survive a re-render, and
 * controls a person can reach without a finger.
 */
import { describe, expect, it } from 'vitest';
import '../src/widgets/hc-tabs.js';
import '../src/widgets/hc-accordion.js';
import '../src/widgets/hc-swipe.js';
import '../src/widgets/hc-text.js';
import { DeviceStore } from '../src/core/store.js';
import type { MountEnv } from '../src/sdk/host.js';

const env = (): MountEnv => ({ store: new DeviceStore(), context: {} });

const text = (t: string) => ({ type: 'text', config: { text: t } });

/** A container element, as much of one as a test needs to drive. */
type Container = HTMLElement & {
  config: Record<string, unknown>;
  env: MountEnv | undefined;
  requestUpdate: () => void;
  updateComplete: Promise<unknown>;
};

async function mount(tag: string, config: Record<string, unknown>): Promise<Container> {
  const el = document.createElement(tag) as Container;
  el.config = config;
  el.env = env();
  document.body.append(el);
  await el.updateComplete;
  return el;
}

/** Force a re-render the way a device update would, and wait for it. */
async function again(el: Container): Promise<void> {
  el.requestUpdate();
  await el.updateComplete;
}

const sections = {
  slots: ['lights', 'media'],
  lights: [text('a lamp')],
  media: [text('a speaker')],
};

describe('tabs', () => {
  it('names its sections from the slots, humanised', async () => {
    const el = await mount('hc-tabs', { slots: ['living_room', 'media'] });
    const labels = [...(el.shadowRoot?.querySelectorAll('button') ?? [])].map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(['Living room', 'Media']);
  });

  it('prefers labels the author wrote', async () => {
    const el = await mount('hc-tabs', { slots: ['a', 'b'], labels: ['Downstairs', 'Upstairs'] });
    const labels = [...(el.shadowRoot?.querySelectorAll('button') ?? [])].map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(['Downstairs', 'Upstairs']);
  });

  it('is a real tablist, because a kiosk is not the only thing that opens a dashboard', async () => {
    const el = await mount('hc-tabs', sections);
    const strip = el.shadowRoot?.querySelector('[role=tablist]');
    const tabs = [...(el.shadowRoot?.querySelectorAll('[role=tab]') ?? [])];
    const panels = [...(el.shadowRoot?.querySelectorAll('[role=tabpanel]') ?? [])];

    expect(strip).not.toBeNull();
    expect(tabs).toHaveLength(2);
    // Roving tabindex: one stop for the whole strip, arrows for the rest.
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1']);
    expect(tabs[0]?.getAttribute('aria-controls')).toBe(panels[0]?.id);
    expect(panels[0]?.getAttribute('aria-labelledby')).toBe(tabs[0]?.id);
  });

  it('shows one section and keeps the other mounted', async () => {
    // Unmounting would restart a hidden child on every switch — a history
    // chart refetching six hours because somebody looked at the other tab.
    const el = await mount('hc-tabs', sections);
    const panels = [...(el.shadowRoot?.querySelectorAll('[role=tabpanel]') ?? [])] as HTMLElement[];

    expect(panels[0]?.hidden).toBe(false);
    expect(panels[1]?.hidden).toBe(true);
    expect(panels[1]?.querySelector('hc-text')).not.toBeNull();
  });

  it('moves with the arrow keys, and wraps', async () => {
    const el = await mount('hc-tabs', sections);
    const strip = el.shadowRoot?.querySelector('[role=tablist]');
    const press = async (key: string) => {
      strip?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await el.updateComplete;
    };

    await press('ArrowRight');
    expect(el.shadowRoot?.querySelectorAll('[role=tab]')[1]?.getAttribute('aria-selected')).toBe(
      'true',
    );
    // A strip is a ring; stopping at the end is a dead key nobody expects.
    await press('ArrowRight');
    expect(el.shadowRoot?.querySelectorAll('[role=tab]')[0]?.getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('keeps the same child elements across a re-render', async () => {
    // The reason `mountChildren` exists: the page re-renders on every device
    // change, and rebuilding would flicker and discard whatever a child holds.
    const el = await mount('hc-tabs', sections);
    const before = el.shadowRoot?.querySelector('hc-text');

    await again(el);

    expect(el.shadowRoot?.querySelector('hc-text')).toBe(before);
  });

  it('does not point past the end when the config shrinks', async () => {
    const el = await mount('hc-tabs', { slots: ['a', 'b', 'c'] });
    el.config = { slots: ['a'] };
    await again(el);

    expect(el.shadowRoot?.querySelectorAll('[role=tab]')).toHaveLength(1);
    expect(el.shadowRoot?.querySelector('[role=tab]')?.getAttribute('aria-selected')).toBe('true');
  });
});

describe('accordion', () => {
  it('uses the browser’s own disclosure widget', async () => {
    // `<details>` brings the role, the keyboard handling and — the part
    // usually missed — find-in-page opening a closed section.
    const el = await mount('hc-accordion', sections);
    expect(el.shadowRoot?.querySelectorAll('details')).toHaveLength(2);
    expect(el.shadowRoot?.querySelectorAll('summary')).toHaveLength(2);
  });

  it('opens the first section, so the page is not blank', async () => {
    const el = await mount('hc-accordion', sections);
    const all = [...(el.shadowRoot?.querySelectorAll('details') ?? [])];
    expect(all.map((d) => d.open)).toEqual([true, false]);
  });

  it('takes the author’s word about what starts open', async () => {
    expect(
      [
        ...((
          await mount('hc-accordion', { ...sections, open: 'all' })
        ).shadowRoot?.querySelectorAll('details') ?? []),
      ].map((d) => d.open),
    ).toEqual([true, true]);

    expect(
      [
        ...((
          await mount('hc-accordion', { ...sections, open: 'none' })
        ).shadowRoot?.querySelectorAll('details') ?? []),
      ].map((d) => d.open),
    ).toEqual([false, false]);

    expect(
      [
        ...((
          await mount('hc-accordion', { ...sections, open: ['media'] })
        ).shadowRoot?.querySelectorAll('details') ?? []),
      ].map((d) => d.open),
    ).toEqual([false, true]);
  });

  it('remembers what the reader opened, across a re-render', async () => {
    // `<details>` holds this in the DOM, and Lit re-renders the attribute from
    // state — so without mirroring the toggle the next device update slams the
    // section shut under whoever just opened it.
    const el = await mount('hc-accordion', sections);
    const second = [...(el.shadowRoot?.querySelectorAll('details') ?? [])][1] as HTMLDetailsElement;

    second.open = true;
    second.dispatchEvent(new Event('toggle'));
    await again(el);

    expect([...(el.shadowRoot?.querySelectorAll('details') ?? [])].map((d) => d.open)).toEqual([
      true,
      true,
    ]);
  });
});

describe('swipe', () => {
  const pages = { children: [text('one'), text('two'), text('three')] };

  it('lays pages out for scroll snap rather than a gesture handler', async () => {
    // The platform already has momentum, rubber-banding and cancellation, and
    // runs them on the compositor. A hand-written handler reimplements all
    // three and fights the browser for the same events.
    const el = await mount('hc-swipe', pages);
    // Asserted against the stylesheet, because jsdom does not apply adopted
    // styles — `getComputedStyle` here would report the empty string whether
    // the rule existed or not, which is a test that cannot fail.
    const sheet = String(
      (el.constructor as unknown as { styles: { cssText?: string } }).styles.cssText ?? '',
    );
    expect(sheet).toContain('scroll-snap-type: x mandatory');
    expect(sheet).toContain('scroll-snap-align: start');
  });

  it('gives every page a dot that is a button', async () => {
    // Somebody on a keyboard, or a kiosk with no touchscreen, needs a way to
    // reach page three.
    const el = await mount('hc-swipe', pages);
    const dots = [...(el.shadowRoot?.querySelectorAll('.dots button') ?? [])];
    expect(dots).toHaveLength(3);
    expect(dots[0]?.getAttribute('aria-current')).toBe('true');
    expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual(['Page 1', 'Page 2', 'Page 3']);
  });

  it('lights a dot the moment it is pressed, observer or not', async () => {
    // The observer is the better truth — a finger can scroll without asking —
    // but it reports on its own schedule and jsdom has none at all. A dot that
    // does not light until the scroll settles reads as a dead control.
    const el = await mount('hc-swipe', pages);
    const dots = [...(el.shadowRoot?.querySelectorAll('.dots button') ?? [])] as HTMLElement[];
    dots[2]?.click();
    await el.updateComplete;

    const after = [...(el.shadowRoot?.querySelectorAll('.dots button') ?? [])];
    expect(after.map((d) => d.getAttribute('aria-current'))).toEqual(['false', 'false', 'true']);
  });

  it('offers no dots for a single page', async () => {
    const el = await mount('hc-swipe', { children: [text('only')] });
    expect(el.shadowRoot?.querySelectorAll('.dots button')).toHaveLength(0);
  });

  it('says which page is which, for a screen reader', async () => {
    const el = await mount('hc-swipe', pages);
    const groups = [...(el.shadowRoot?.querySelectorAll('.page') ?? [])];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['1 of 3', '2 of 3', '3 of 3']);
  });

  it('keeps its children across a re-render', async () => {
    const el = await mount('hc-swipe', pages);
    const before = el.shadowRoot?.querySelector('hc-text');
    await again(el);
    expect(el.shadowRoot?.querySelector('hc-text')).toBe(before);
  });
});
