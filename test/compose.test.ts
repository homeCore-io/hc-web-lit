/**
 * P4 — composition without chrome (§5.5).
 *
 * The rule that matters is the one the whole primitive exists for: a nested
 * widget draws no surface of its own. Home Assistant has three community cards
 * whose entire purpose is suppressing a double border, and §5.1 counts them as
 * a missing host primitive rather than as features.
 */
import { describe, expect, it } from 'vitest';
import { childrenOf, gapOf, slotsOf, wantsChrome } from '../src/core/compose.js';
import { DeviceStore } from '../src/core/store.js';
import '../src/widgets/hc-stack.js';
import '../src/widgets/hc-grid.js';
import '../src/widgets/hc-device-card.js';
import '../src/widgets/hc-text.js';
import type { MountEnv } from '../src/shell/mount.js';

const env = (): MountEnv => ({ store: new DeviceStore(), context: {} });

describe('the chrome rule', () => {
  it('gives the outermost widget its surface and takes it from a nested one', () => {
    expect(wantsChrome({}, false)).toBe(true);
    expect(wantsChrome({}, true)).toBe(false);
  });

  it('lets a document override in both directions', () => {
    // Both cases are real: a card deliberately inside a card wants `always`,
    // and a container that is itself the surface wants `never` at the top.
    expect(wantsChrome({ chrome: 'always' }, true)).toBe(true);
    expect(wantsChrome({ chrome: 'never' }, false)).toBe(false);
  });
});

describe('reading a container', () => {
  it('takes the children that are widgets and ignores what is not', () => {
    expect(childrenOf({ children: [{ type: 'text' }, 'nonsense', null, { config: {} }] })).toEqual([
      { type: 'text' },
    ]);
    expect(childrenOf({})).toEqual([]);
  });

  it('has one slot unless a container names more', () => {
    expect(slotsOf({})).toEqual(['children']);
    expect(slotsOf({ slots: ['head', 'body'] })).toEqual(['head', 'body']);
  });

  it('separates chrome-less children, or they are one block', () => {
    expect(gapOf({})).toBe(8);
    expect(gapOf({ gap: 0 })).toBe(0);
    expect(gapOf({ gap: 'wide' })).toBe(8);
  });
});

describe('a container drawing its children', () => {
  const mount = async (tag: string, config: Record<string, unknown>) => {
    const el = document.createElement(tag) as HTMLElement & {
      config: Record<string, unknown>;
      env: MountEnv;
      updateComplete: Promise<unknown>;
    };
    el.config = config;
    el.env = env();
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  it('mounts each child as an ordinary widget', async () => {
    const el = await mount('hc-stack', {
      direction: 'row',
      children: [
        { type: 'text', config: { text: 'one' } },
        { type: 'text', config: { text: 'two' } },
      ],
    });
    expect(el.shadowRoot?.querySelectorAll('hc-text')).toHaveLength(2);
  });

  it('tells a child it is nested, so the child drops its surface', async () => {
    const el = await mount('hc-grid', { children: [{ type: 'device_tile' }] });
    const child = el.shadowRoot?.querySelector('hc-device-card');
    expect((child as unknown as { nested: boolean } | null)?.nested).toBe(true);
  });

  it('draws nothing rather than failing on a type it does not know', async () => {
    // Core accepts types it has never heard of, so a container meeting one is
    // ordinary.
    const el = await mount('hc-stack', { children: [{ type: 'sankey_from_the_future' }] });
    expect(el.shadowRoot?.querySelector('hc-text')).toBeNull();
  });

  it('waits for its env rather than guessing at one', async () => {
    // A container without the host's env cannot mount anything, and drawing
    // half a page would be worse than drawing none of it.
    const el = document.createElement('hc-stack') as HTMLElement & {
      config: Record<string, unknown>;
      updateComplete: Promise<unknown>;
    };
    el.config = { children: [{ type: 'text', config: { text: 'x' } }] };
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('hc-text')).toBeNull();
  });
});
