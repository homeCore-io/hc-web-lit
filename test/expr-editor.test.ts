/**
 * Writing an expression, rather than only running one (§6).
 *
 * `resolveConfig` has evaluated `$expr` and `{{ … }}` on every config key
 * since P1 landed, and nothing in the panel could author one — so the feature
 * worked everywhere and was reachable from nowhere.
 */
import { describe, expect, it } from 'vitest';
import '../src/widgets/hc-property-panel.js';
import type { HcPropertyPanel } from '../src/widgets/hc-property-panel.js';
import type { DeviceState } from '../src/core/device.js';
import { resolveConfig } from '../src/core/bindings.js';

const lamp: DeviceState = {
  device_id: 'hue_1',
  name: 'Kitchen Lamp',
  plugin_id: 'hue',
  available: true,
  attributes: { on: true, brightness_pct: 40 },
  last_seen: '2026-09-11T00:00:00Z',
};

async function panel(config: Record<string, unknown>): Promise<HcPropertyPanel> {
  const el = document.createElement('hc-property-panel');
  el.config = { widget: { type: 'heading', config }, edits: 'w' };
  el.devices = [lamp];
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const rowFor = (el: HcPropertyPanel, label: string): Element | undefined =>
  [...(el.shadowRoot?.querySelectorAll('.row') ?? [])].find((r) =>
    (r.querySelector('.name')?.textContent ?? '').includes(label),
  );

describe('the ƒx toggle', () => {
  it('is offered without a host having wired an edit callback', async () => {
    // `commit` writes to the draft and fires `hc-widget-change` regardless, so
    // gating the toggle on `onEditWidget` hid it in the one place it matters:
    // the page's own panel, which saves through `onSaveWidget` instead.
    const el = await panel({ text: 'Hall' });
    expect(el.onEditWidget).toBeUndefined();
    expect(rowFor(el, 'Text')?.querySelector('.fx')).not.toBeNull();
  });

  it('is offered on a value-shaped field', async () => {
    const el = await panel({ text: 'Hall' });
    expect(rowFor(el, 'Text')?.querySelector('.fx')).not.toBeNull();
  });

  it('is not offered on a gesture, which is its own editor', async () => {
    const el = await panel({ text: 'Hall' });
    expect(rowFor(el, 'On tap')?.querySelector('.fx')).toBeNull();
  });

  it('starts from the value already there, not from an empty box', async () => {
    // A field that said `Hall` and now says nothing has lost what it said, and
    // the commonest expression anybody writes starts from the value there.
    const el = await panel({ text: 'Hall' });
    let written: Record<string, unknown> | undefined;
    el.onEditWidget = (next) => {
      written = next.config as Record<string, unknown>;
    };
    (rowFor(el, 'Text')?.querySelector('.fx') as HTMLButtonElement).click();
    expect(written?.['text']).toEqual({ $expr: '"Hall"' });
  });

  it('keeps what the expression comes to when it is turned off', async () => {
    // Turning it off must not be a way to blank a card by accident.
    const el = await panel({ text: { $expr: '"Hall " + 2' } });
    let written: Record<string, unknown> | undefined;
    el.onEditWidget = (next) => {
      written = next.config as Record<string, unknown>;
    };
    (rowFor(el, 'Text')?.querySelector('.fx') as HTMLButtonElement).click();
    expect(written?.['text']).toBe('Hall 2');
  });
});

describe('the expression field', () => {
  it('replaces the ordinary control and shows the source', async () => {
    const el = await panel({ text: { $expr: 'device.name' } });
    const input = rowFor(el, 'Text')?.querySelector('.expr input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('device.name');
  });

  it('previews against the real house, not a sample of it', async () => {
    // The whole point is finding out that an attribute is undefined on *this*
    // lamp before saving a card that draws nothing.
    const el = await panel({ device_id: 'hue_1', text: { $expr: 'device.name' } });
    expect(rowFor(el, 'Text')?.querySelector('.resolved')?.textContent).toContain('Kitchen Lamp');
  });

  it('spells out an expression that comes to nothing', async () => {
    // The one a person most needs to see: it compiles, it evaluates, and it
    // draws a blank card. A preview showing nothing would look like one that
    // had not run.
    const el = await panel({ device_id: 'hue_1', text: { $expr: 'device.attributes.nope' } });
    expect(rowFor(el, 'Text')?.querySelector('.resolved')?.textContent).toContain('nothing');
  });

  it('reports a SyntaxError instead of a preview', async () => {
    const el = await panel({ text: { $expr: 'device.(' } });
    const row = rowFor(el, 'Text');
    expect(row?.querySelector('.problem')).not.toBeNull();
    expect(row?.querySelector('.resolved')).toBeNull();
  });

  it('keeps a half-typed expression on screen and out of the document', async () => {
    // Every expression is malformed while it is half written, so refusing the
    // keystroke would be an editor you cannot type into.
    const el = await panel({ text: { $expr: 'device.name' } });
    const writes: unknown[] = [];
    el.onEditWidget = (next) => writes.push(next);

    const input = rowFor(el, 'Text')?.querySelector('.expr input') as HTMLInputElement;
    input.value = 'device.(';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;

    expect(writes).toHaveLength(0);
    expect(rowFor(el, 'Text')?.querySelector('.problem')).not.toBeNull();
  });

  it('saves on blur once it compiles', async () => {
    const el = await panel({ text: { $expr: 'device.name' } });
    let written: Record<string, unknown> | undefined;
    el.onEditWidget = (next) => {
      written = next.config as Record<string, unknown>;
    };

    const input = rowFor(el, 'Text')?.querySelector('.expr input') as HTMLInputElement;
    input.value = 'device.name + "!"';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    (rowFor(el, 'Text')?.querySelector('.expr input') as HTMLInputElement).dispatchEvent(
      new Event('blur', { bubbles: true }),
    );

    expect(written?.['text']).toEqual({ $expr: 'device.name + "!"' });
  });

  it('does not save a broken one on blur', async () => {
    const el = await panel({ text: { $expr: 'device.name' } });
    const writes: unknown[] = [];
    el.onEditWidget = (next) => writes.push(next);

    const input = rowFor(el, 'Text')?.querySelector('.expr input') as HTMLInputElement;
    input.value = 'device.(';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    (rowFor(el, 'Text')?.querySelector('.expr input') as HTMLInputElement).dispatchEvent(
      new Event('blur', { bubbles: true }),
    );
    expect(writes).toHaveLength(0);
  });
});

describe('what the renderer then does with it', () => {
  it('draws what the panel previewed', async () => {
    // The preview is only worth anything if it is the same evaluation the
    // card will do, so this pins the two against each other.
    const config = { device_id: 'hue_1', text: { $expr: 'device.name' } };
    const el = await panel(config);
    const previewed = rowFor(el, 'Text')?.querySelector('.resolved')?.textContent ?? '';
    const drawn = resolveConfig(config, [lamp], {});
    expect(previewed).toContain(String(drawn['text']));
  });
});

describe('getting back out of an expression', () => {
  it('still offers the toggle once a field holds one', async () => {
    // An `$expr` is an object, so the form derived from the stored value stops
    // being value-shaped the moment the toggle is used. That took the toggle
    // away and left no way back to a plain value except by hand.
    const el = await panel({ text: { $expr: '"Hall"' } });
    expect(rowFor(el, 'Text')?.querySelector('.fx')).not.toBeNull();
    expect(rowFor(el, 'Text')?.querySelector('.fx')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('is a round trip: value in, expression, value out', async () => {
    const el = await panel({ text: 'Hall' });
    const writes: Record<string, unknown>[] = [];
    el.onEditWidget = (next) => writes.push(next.config as Record<string, unknown>);

    (rowFor(el, 'Text')?.querySelector('.fx') as HTMLButtonElement).click();
    expect(writes.at(-1)?.['text']).toEqual({ $expr: '"Hall"' });

    // The panel is driven by its config, so feed back what it just wrote.
    el.config = { widget: { type: 'heading', config: writes.at(-1)! }, edits: 'w' };
    await el.updateComplete;

    (rowFor(el, 'Text')?.querySelector('.fx') as HTMLButtonElement).click();
    expect(writes.at(-1)?.['text']).toBe('Hall');
  });
});
