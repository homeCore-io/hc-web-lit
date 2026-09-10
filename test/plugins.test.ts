/**
 * What a plugin can be asked to do — P10's other half (§5.11).
 *
 * The fixtures are the reference house's own declarations, not invented ones.
 * §5.11's claim is that a client can offer these properly **without knowing
 * what Hue is**, so what these pin is that every decision comes from the
 * declaration: which control, whether it blocks a second run, whether it can
 * be stopped, and whether it is offered at all.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  actionsOf,
  describeItem,
  isFinal,
  labelOf,
  mayRun,
  nameOf,
  readEvent,
  readStart,
  type Plugin,
} from '../src/core/plugins.js';
import '../src/widgets/hc-plugin-actions.js';
import type { HcPluginActions } from '../src/widgets/hc-plugin-actions.js';

/** Exactly as `plugin.zwave` declares itself on the reference house. */
const zwave: Plugin = {
  plugin_id: 'plugin.zwave',
  status: 'active',
  capabilities: {
    actions: [
      {
        id: 'include_node',
        label: 'Include node',
        requires_role: 'admin',
        concurrency: 'single',
        cancelable: true,
        stream: true,
        timeout_ms: 300_000,
      },
      {
        id: 'rescan_nodes',
        label: 'Rescan nodes',
        requires_role: 'user',
        concurrency: 'multi',
        cancelable: false,
        stream: false,
        timeout_ms: null,
      },
    ],
  },
};

describe('reading what a plugin declared', () => {
  it('names it without the prefix every one of them carries', () => {
    expect(nameOf(zwave)).toBe('zwave');
  });

  it('prefers the plugin’s own label', () => {
    expect(labelOf(actionsOf(zwave)[0]!)).toBe('Include node');
    // And makes something readable when there is none, rather than showing a
    // snake_case identifier to a person.
    expect(labelOf({ id: 'refresh_effects_palettes' })).toBe('Refresh effects palettes');
  });

  it('has nothing to offer for a plugin that declares nothing', () => {
    expect(actionsOf({ plugin_id: 'plugin.quiet' })).toEqual([]);
  });
});

describe('who is offered which control', () => {
  const [admin, user] = actionsOf(zwave);

  it('offers an admin operation only to a session that may run it', () => {
    // §5.10's reasoning, one level up: a button whose only purpose is to say
    // "you may not" is worse than one that is not there.
    expect(mayRun(admin!, ['devices:read'])).toBe(false);
    expect(mayRun(admin!, ['plugins:admin'])).toBe(true);
  });

  it('always offers one that needs no role', () => {
    expect(mayRun(user!, ['devices:read'])).toBe(true);
  });

  it('offers everything when the scopes are unknown', () => {
    // An older core does not report them. Core is the authority either way,
    // and hiding everything would make the surface useless against a core
    // that works.
    expect(mayRun(admin!, undefined)).toBe(true);
  });
});

describe('the two shapes a command answers in', () => {
  it('reads a finished result, with the plugin’s fields at the top level', () => {
    const got = readStart({ status: 'ok', request_id: 'r1', count: 2, devices: [1, 2] });
    expect(got).toEqual({ kind: 'done', requestId: 'r1', result: { count: 2, devices: [1, 2] } });
  });

  it('reads an accepted command as one to follow', () => {
    expect(readStart({ status: 'accepted', request_id: 'r2', stream_topic: 'homecore/…' })).toEqual(
      { kind: 'streaming', requestId: 'r2' },
    );
  });

  it('believes `status`, not the declaration', () => {
    // A declaration that disagrees with what a plugin does is a thing that
    // happens (homeCore#40), and hanging on a stream that never opens is a
    // worse failure than either.
    expect(readStart({ status: 'ok', request_id: 'r3' })?.kind).toBe('done');
  });

  it('refuses a response it cannot read', () => {
    expect(readStart({ status: 'ok' })).toBeUndefined();
    expect(readStart(null)).toBeUndefined();
    expect(readStart('ok')).toBeUndefined();
  });
});

describe('the frames a running command sends', () => {
  it('reads progress', () => {
    const got = readEvent({
      stage: 'progress',
      label: 'starting',
      message: 'Running SSDP + manual-host discovery',
      percent: 10,
      request_id: 'r',
    });
    expect(got).toMatchObject({ stage: 'progress', percent: 10 });
  });

  it('reads an item', () => {
    const got = readEvent({ stage: 'item', op: 'add', data: { room_name: 'Living Room' } });
    expect(got?.stage).toBe('item');
    expect(describeItem(got?.data)).toBe('Living Room');
  });

  it('knows a final frame however it is phrased', () => {
    for (const stage of ['done', 'complete', 'error', 'cancelled']) {
      expect(isFinal({ stage })).toBe(true);
    }
    expect(isFinal({ stage: 'progress' })).toBe(false);
    expect(isFinal({})).toBe(false);
  });

  it('describes an item it has no name for, rather than showing nothing', () => {
    // A plugin sends whatever the item is, and nothing here knows what any of
    // it means. An unnameable item is still evidence the operation is working.
    expect(describeItem({ uuid: 'RINCON_123' })).toBe('RINCON_123');
    expect(describeItem({ weird: 1 })).toBe('{"weird":1}');
    expect(describeItem('a string')).toBe('a string');
  });
});

/** Mount the widget with a runner that answers however a test wants. */
async function mount(
  plugins: Plugin[],
  over: Partial<Parameters<typeof Object.assign>[0]> = {},
  scopes?: string[],
): Promise<HcPluginActions> {
  const el = document.createElement('hc-plugin-actions') as HcPluginActions;
  el.runner = Object.assign(
    {
      list: async () => Promise.resolve(plugins),
      run: async () => Promise.resolve({ kind: 'done' as const, result: { count: 0 } }),
      follow: () => () => undefined,
    },
    over,
  );
  if (scopes !== undefined) el.scopes = scopes;
  document.body.append(el);
  await el.updateComplete;
  // The list is fetched on connect, so the first paint has nothing in it.
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

describe('the surface', () => {
  it('draws a control for each declared operation', async () => {
    const el = await mount([zwave]);
    const buttons = [...(el.shadowRoot?.querySelectorAll('.ops button') ?? [])];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Include node', 'Rescan nodes']);
  });

  it('does not draw one this session may not run', async () => {
    const el = await mount([zwave], {}, ['devices:read']);
    const buttons = [...(el.shadowRoot?.querySelectorAll('.ops button') ?? [])];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Rescan nodes']);
  });

  it('reports a result that arrived whole', async () => {
    const el = await mount([zwave], {
      run: async () => Promise.resolve({ kind: 'done' as const, result: { devices: [1, 2, 3] } }),
    });
    (el.shadowRoot?.querySelector('.ops button') as HTMLElement | null)?.click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el.shadowRoot?.textContent).toContain('3 devices');
  });

  it('disables a second run of a single-concurrency operation', async () => {
    // And only that one: `multi` may overlap, and disabling it would be this
    // client inventing a restriction the plugin did not ask for.
    let settle: (v: unknown) => void = () => undefined;
    const el = await mount([zwave], {
      run: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    });
    const buttons = [...(el.shadowRoot?.querySelectorAll('.ops button') ?? [])] as HTMLElement[];
    buttons[0]?.click();
    buttons[1]?.click();
    await el.updateComplete;

    const after = [...(el.shadowRoot?.querySelectorAll('.ops button') ?? [])];
    expect((after[0] as HTMLButtonElement).disabled).toBe(true);
    expect((after[1] as HTMLButtonElement).disabled).toBe(false);
    settle({ kind: 'done', result: {} });
  });

  it('shows progress and the items a streaming operation finds', async () => {
    let emit: (e: unknown) => void = () => undefined;
    const el = await mount([zwave], {
      run: async () => Promise.resolve({ kind: 'streaming' as const, requestId: 'r1' }),
      follow: (_p: string, _r: string, onEvent: (e: unknown) => void) => {
        emit = onEvent;
        return () => undefined;
      },
    });

    (el.shadowRoot?.querySelector('.ops button') as HTMLElement | null)?.click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    emit({ stage: 'progress', message: 'Waiting for the button', percent: 20 });
    emit({ stage: 'item', op: 'add', data: { name: 'Kitchen switch' } });
    await el.updateComplete;

    // Without this an operation with a five-minute timeout is
    // indistinguishable from a hang.
    expect(el.shadowRoot?.textContent).toContain('Waiting for the button');
    expect(el.shadowRoot?.textContent).toContain('Kitchen switch');
    expect(el.shadowRoot?.querySelector('.bar span')?.getAttribute('style')).toContain('20%');
  });

  it('offers a way to stop watching, and stops', async () => {
    const stop = vi.fn();
    const el = await mount([zwave], {
      run: async () => Promise.resolve({ kind: 'streaming' as const, requestId: 'r1' }),
      follow: () => stop,
    });

    (el.shadowRoot?.querySelector('.ops button') as HTMLElement | null)?.click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    const cancel = el.shadowRoot?.querySelector('.cancel') as HTMLElement | null;
    expect(cancel).not.toBeNull();
    cancel?.click();
    await el.updateComplete;

    expect(stop).toHaveBeenCalled();
    // Said plainly: stopping the stream is not stopping the operation, and
    // core owns that.
    expect(el.shadowRoot?.textContent).toContain('Stopped watching');
  });

  it('lets go of a stream when it is taken off the page', async () => {
    const stop = vi.fn();
    const el = await mount([zwave], {
      run: async () => Promise.resolve({ kind: 'streaming' as const, requestId: 'r1' }),
      follow: () => stop,
    });
    (el.shadowRoot?.querySelector('.ops button') as HTMLElement | null)?.click();
    await new Promise((r) => setTimeout(r, 0));

    el.remove();
    // A socket held open on a panel for as long as the plugin keeps talking.
    expect(stop).toHaveBeenCalled();
  });
});
