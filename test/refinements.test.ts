/**
 * The two type-specific widgets that earn their place (§7.2, §7.3).
 *
 * §7.2 allows a type-specific widget to override the generic card "where it
 * can do better". These are the two cases in the reference house where it can:
 * a lock whose writable is `locked` rather than `on`, so the card's switch
 * never appears; and a timer whose reading changes every second, which nothing
 * else here does.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import '../src/widgets/hc-lock.js';
import '../src/widgets/hc-timer.js';

const mount = async (tag: string, device: DeviceState, onCommand?: unknown) => {
  const el = document.createElement(tag) as HTMLElement & {
    device: DeviceState;
    onCommand?: unknown;
    updateComplete: Promise<unknown>;
  };
  el.device = device;
  if (onCommand !== undefined) el.onCommand = onCommand;
  document.body.append(el);
  await el.updateComplete;
  return el;
};

const lock = (over: Record<string, unknown> = {}, writable = true): DeviceState => ({
  device_id: 'yolink_1',
  name: 'Back Door',
  plugin_id: 'yolink',
  available: true,
  device_type: 'lock',
  last_seen: '2026-09-09T00:00:00Z',
  attributes: { locked: true, battery: 100, ...over },
  schema: { attributes: { locked: { kind: 'bool', writable } }, primary: ['locked'] },
});

describe('a lock', () => {
  it('offers two buttons, not a toggle', async () => {
    // §11.3: a lock never actuates from a plain tap. A toggle is one gesture
    // whose meaning depends on a state you may have misread; Lock and Unlock
    // each say what they do.
    const el = await mount('hc-lock', lock(), vi.fn());
    const buttons = [...(el.shadowRoot?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Lock', 'Unlock']);
  });

  it('disables the one it already is', async () => {
    const el = await mount('hc-lock', lock({ locked: true }), vi.fn());
    const [lockBtn, unlockBtn] = [
      ...(el.shadowRoot?.querySelectorAll('button') ?? []),
    ] as HTMLButtonElement[];
    expect(lockBtn?.disabled).toBe(true);
    expect(unlockBtn?.disabled).toBe(false);
  });

  it('writes the attribute the device declared', async () => {
    const sent = vi.fn();
    const el = await mount('hc-lock', lock({ locked: true }), sent);
    const unlock = [...(el.shadowRoot?.querySelectorAll('button') ?? [])][1] as HTMLButtonElement;
    unlock.click();
    // The confirmation is the host's, not this widget's — `safety.check`
    // returns one for any `locked` write, so nothing here can skip it.
    expect(sent).toHaveBeenCalledWith({ deviceId: 'yolink_1', patch: { locked: false } });
  });

  it('says when the bolt did not move', async () => {
    // A YoLink lock reports this, and it is the house saying something a state
    // alone cannot: the command was accepted and nothing happened.
    const el = await mount('hc-lock', lock({ last_alert: 'UnLockFailed' }), vi.fn());
    // The plugin's own word, shown as the plugin writes it. `humanise` splits
    // on separators and YoLink uses none, and inventing "Un lock failed" out
    // of camel case would read worse than the thing the device said (§1.1).
    expect(el.shadowRoot?.textContent).toContain('UnLockFailed');
    expect(el.shadowRoot?.querySelector('.alert')).toBeTruthy();
  });

  it('offers nothing where the plugin declared no writable', async () => {
    const el = await mount('hc-lock', lock({}, false), vi.fn());
    expect(el.shadowRoot?.querySelectorAll('button')).toHaveLength(0);
    expect(el.shadowRoot?.textContent).toContain('Locked');
  });
});

const timer = (over: Record<string, unknown>): DeviceState => ({
  device_id: 'timer_1',
  name: 'Bathroom Exhaust',
  plugin_id: 'core',
  available: true,
  device_type: 'timer',
  last_seen: '2026-09-09T00:00:00Z',
  attributes: { duration_secs: 300, repeat: false, ...over },
  schema: { primary: ['state', 'remaining_secs'] },
});

describe('a timer', () => {
  it('counts from the clock the device gave, not from its last snapshot', async () => {
    // `remaining_secs` is whatever was true when the device last spoke, so a
    // card showing it verbatim sits still and then jumps.
    const el = await mount(
      'hc-timer',
      timer({
        state: 'running',
        started_at: new Date(Date.now() - 60_000).toISOString(),
        remaining_secs: 300,
      }),
    );
    expect(el.shadowRoot?.querySelector('.badge')?.textContent?.trim()).toBe('4:00');
  });

  it('falls back to the reported figure when it is not running', async () => {
    const el = await mount('hc-timer', timer({ state: 'finished', remaining_secs: 0 }));
    expect(el.shadowRoot?.querySelector('.badge')?.textContent?.trim()).toBe('0:00');
    expect(el.shadowRoot?.textContent).toContain('Finished');
  });

  it('never counts past the end', async () => {
    const el = await mount(
      'hc-timer',
      timer({ state: 'running', started_at: new Date(Date.now() - 999_000).toISOString() }),
    );
    expect(el.shadowRoot?.querySelector('.badge')?.textContent?.trim()).toBe('0:00');
  });

  it('offers no controls, because the plugin declares none', async () => {
    // §7.3 imagined start/pause/reset. All four timers in the reference house
    // declare no writable attributes and no actions, and offering buttons
    // would be offering to do something the plugin never said it could.
    const el = await mount('hc-timer', timer({ state: 'running', remaining_secs: 120 }));
    expect(el.shadowRoot?.querySelectorAll('button')).toHaveLength(0);
  });

  it('leads with the label the rule that made it used', async () => {
    const el = await mount(
      'hc-timer',
      timer({ state: 'finished', remaining_secs: 0, label: 'Garage OH1 auto-close' }),
    );
    expect(el.shadowRoot?.textContent).toContain('Garage OH1 auto-close');
  });
});
