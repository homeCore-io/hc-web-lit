/**
 * The three §7.3 widgets core describes and this client did not draw.
 *
 * A page authored elsewhere can hold any type core validates, so an undrawn
 * one renders as a labelled placeholder — correct, and useless to the person
 * looking at it. These close the last three that §7.3 names by name.
 */
import { describe, expect, it } from 'vitest';
import { attachInspect } from '../src/widgets/hold.js';
import { HcDeviceGrid } from '../src/widgets/hc-device-grid.js';
import { HcLayoutShell } from '../src/sdk/shell.js';
import '../src/widgets/hc-fan.js';
import '../src/widgets/hc-keypad.js';
import { parseMarkdown, spansIn } from '../src/core/markdown.js';
import type { DeviceState } from '../src/core/device.js';
import { setPreferences } from '../src/core/i18n.js';
import '../src/widgets/hc-gauge.js';
import '../src/widgets/hc-markdown.js';
import '../src/widgets/hc-camera.js';

async function mount<T extends HTMLElement>(
  tag: string,
  props: Record<string, unknown>,
): Promise<T> {
  const el = document.createElement(tag) as T & { updateComplete: Promise<unknown> };
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

/**
 * What the widget says, without the stylesheet.
 *
 * jsdom has no adopted stylesheets, so Lit injects a `<style>` element into
 * every shadow root and `textContent` returns the CSS along with the words.
 */
const text = (el: HTMLElement): string =>
  [...(el.shadowRoot?.childNodes ?? [])]
    .filter((n) => (n as Element).tagName !== 'STYLE')
    .map((n) => n.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const sensor = (attrs: Record<string, unknown>, schema?: DeviceState['schema']): DeviceState => ({
  device_id: 'ecowitt_1',
  name: 'Indoor Sensor',
  plugin_id: 'ecowitt',
  available: true,
  attributes: attrs,
  last_seen: '2026-09-10T00:00:00Z',
  ...(schema !== undefined ? { schema } : {}),
});

describe('the gauge', () => {
  it('takes its range from what the plugin declared', async () => {
    // Asking somebody to type a range the schema already states is asking
    // them to get it wrong.
    const el = await mount('hc-gauge', {
      config: { attribute: 'battery' },
      device: sensor(
        { battery: 25 },
        { attributes: { battery: { kind: 'integer', min: 0, max: 200, unit: '%' } } },
      ),
    });
    const fill = el.shadowRoot?.querySelector('[part="indicator"]');
    // A quarter of 0..200 is an eighth of the sweep, not a quarter of 0..100.
    expect(fill?.getAttribute('d')).toContain('A');
    expect(text(el)).toContain('25%');
  });

  it('converts the value and its bounds together', async () => {
    // Half of a Fahrenheit range must still be half once it is Celsius, or
    // the needle points at a scale it is not on.
    setPreferences({ locale: 'en-US', temperature: 'C' });
    try {
      const el = await mount('hc-gauge', {
        config: { attribute: 'temperature', shape: 'bar', min: 32, max: 212 },
        device: sensor({ temperature: 122, temperature_unit: '°F' }),
      });
      expect(text(el)).toContain('50 °C');
      expect(el.shadowRoot?.querySelector<HTMLElement>('.fill')?.style.width).toBe('50%');
    } finally {
      setPreferences({});
    }
  });

  it('says what is missing rather than drawing an empty dial', async () => {
    expect(text(await mount('hc-gauge', { config: { attribute: 'battery' } }))).toContain(
      'No device',
    );
    const noAttr = await mount('hc-gauge', {
      config: { attribute: 'nonsense' },
      device: sensor({ battery: 25 }),
    });
    expect(text(noAttr)).toContain('Nothing to gauge');
  });

  it('gives each gauge its own gradient', async () => {
    // Two dials sharing a gradient id both draw whichever rendered last.
    const a = await mount('hc-gauge', {
      config: { attribute: 'battery', color: 'success' },
      device: sensor({ battery: 20 }),
    });
    const b = await mount('hc-gauge', {
      config: { attribute: 'battery', color: 'danger' },
      device: sensor({ battery: 20 }),
    });
    const idOf = (el: HTMLElement) => el.shadowRoot?.querySelector('[id^="hc-gauge-"]')?.id;
    expect(idOf(a)).not.toBe(idOf(b));
  });
});

describe('markdown, parsed rather than pasted', () => {
  it('reads the blocks a house note contains', () => {
    const blocks = parseMarkdown(
      ['# Boiler', '', 'Serviced *yearly*.', '', '- filter', '- pressure', '', '---'].join('\n'),
    );
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'rule']);
    const list = blocks[2];
    expect(list?.kind === 'list' && list.items.length).toBe(2);
  });

  it('joins consecutive items into one list', () => {
    const blocks = parseMarkdown('1. one\n2. two\n3. three');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind === 'list' && blocks[0].ordered).toBe(true);
  });

  it('refuses a scheme a link should not carry', () => {
    // The note is written by whoever can edit the dashboard, and device data
    // is interpolated into it before it renders.
    // The words survive; the link does not.
    expect(spansIn('[tap](javascript:alert(1))').some((s) => s.kind === 'link')).toBe(false);
    expect(spansIn('[tap](JaVaScRiPt:alert(1))').some((s) => s.kind === 'link')).toBe(false);
    expect(spansIn('[tap](data:text/html,x)').some((s) => s.kind === 'link')).toBe(false);
    expect(spansIn('[docs](https://example.com)')).toEqual([
      { kind: 'link', text: 'docs', href: 'https://example.com' },
    ]);
  });

  it('renders text as text, never as markup', async () => {
    const el = await mount('hc-markdown', {
      config: { markdown: '# Hi\n\n<img src=x onerror="boom()"> and **bold**' },
    });
    expect(el.shadowRoot?.querySelector('h1')?.textContent).toBe('Hi');
    expect(el.shadowRoot?.querySelector('strong')?.textContent).toBe('bold');
    // The angle brackets are characters somebody typed, not an element.
    expect(el.shadowRoot?.querySelector('img')).toBeNull();
    expect(text(el)).toContain('<img src=x');
  });

  it('draws an unwritten note as nothing at all', async () => {
    // Core allows the empty string here on purpose; a placeholder on a wall
    // panel is worse than a gap.
    const el = await mount('hc-markdown', { config: { markdown: '' } });
    expect(text(el)).toBe('');
  });
});

describe('the camera', () => {
  it('names the source type it cannot play', async () => {
    // A broken image icon is indistinguishable from a camera that is down,
    // and somebody goes and checks the camera.
    const el = await mount('hc-camera', {
      config: { source_type: 'webrtc', url: 'https://cam.local/stream' },
    });
    expect(text(el)).toContain('cannot play webrtc');
    expect(text(el)).toContain('the player is missing');
  });

  it('asks for a new picture rather than the one already held', async () => {
    const el = await mount('hc-camera', {
      config: { source_type: 'image_refresh', url: 'https://cam.local/still.jpg', refresh_secs: 5 },
    });
    expect(el.shadowRoot?.querySelector('img')?.getAttribute('src')).toBe(
      'https://cam.local/still.jpg?hc=0',
    );
  });

  it('streams an mjpeg without a cache-buster', async () => {
    const el = await mount('hc-camera', {
      config: { source_type: 'mjpeg', url: 'https://cam.local/stream.mjpg' },
    });
    expect(el.shadowRoot?.querySelector('img')?.getAttribute('src')).toBe(
      'https://cam.local/stream.mjpg',
    );
  });

  it('refuses an address a picture cannot come from', async () => {
    const el = await mount('hc-camera', {
      config: { source_type: 'image_refresh', url: 'javascript:alert(1)' },
    });
    expect(el.shadowRoot?.querySelector('img')).toBeNull();
    expect(text(el)).toContain('not an address');
  });
});

describe('a set is the object, and a row in it is not', () => {
  const css = [HcDeviceGrid.styles].flat().map(String).join('\n');
  const shell = [HcLayoutShell.styles].flat().map(String).join('\n');

  it('lets a caller take the chrome off a shell, as three hooks', () => {
    // §5.8 and ABI under §19.7. Custom properties cross the shadow boundary
    // and a part does not, which is why this is a property rather than a
    // second row form.
    expect(shell).toMatch(/--hc-shell-surface:/);
    expect(shell).toMatch(/--hc-shell-edge:/);
    expect(shell).toMatch(/--hc-shell-radius:/);
    expect(shell).toMatch(/background:\s*var\(--hc-shell-surface\)/);
    expect(shell).toMatch(/border:\s*var\(--hc-shell-edge\)/);
  });

  it('takes it off every row of a list', () => {
    // Thirteen bordered boxes stacked in a column read as thirteen things when
    // the point is one list. A pill keeps its own chrome: four lights you
    // choose between are four objects, and that is the whole difference
    // between the two sets.
    expect(css).toMatch(/\.list > \*\s*\{[^}]*--hc-shell-edge:\s*0/);
    expect(css).toMatch(/\.list > \*\s*\{[^}]*--hc-shell-radius:\s*0/);
  });

  it('draws a list in one column, because that is what a list is', () => {
    // The list type is the grid type in one column — its own tag says so — and
    // it had drifted into flowing across as many columns as the width would
    // take, which made it the grid type with extra steps. The room page names
    // the list type for every section it has, so the household had already
    // said which they wanted.
    expect(css).toMatch(/\.list\s*\{[^}]*grid-template-columns:\s*1fr/);
  });

  it('still flows a grid, which is the type for that', () => {
    // The argument for flowing is real where it applies: thirteen sensors down
    // one column is a page of scrolling. It is the grid type's argument.
    expect(css).toMatch(/\.flowing\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit/);
  });

  it('draws a line between the rows and none around them', () => {
    // A box around every row is a table, and reads as one. A list is rows with
    // a line between them — in one column, every row but the first. Inset, so
    // it costs no layout, which is why the ring it replaces was a shadow too.
    expect(css).toMatch(/\.list > \* \+ \*\s*\{[^}]*box-shadow:\s*inset[^;]*hairline/);
    // **And the set paints, not the rows.** A background per row is a claim
    // per row, and a row is not an object — the set is. The old reason for
    // doing it the other way round was a wrapping grid painting an empty
    // half-width box beside the only leak sensor in the house; a list is one
    // column now, so the surface is exactly as wide as its rows.
    expect(css).toMatch(/\.list\s*\{[^}]*background:\s*var\(--hc-surface-raised/);
    expect(css).toMatch(/\.list > \*\s*\{[^}]*--hc-shell-surface:\s*transparent/);
  });
});

describe('a widget that is one line of a room rather than the subject of a page', () => {
  const mount = async <T extends HTMLElement>(tag: string, device: DeviceState, row: boolean) => {
    const el = document.createElement(tag) as T & { device?: DeviceState; row?: boolean };
    el.device = device;
    el.row = row;
    document.body.append(el);
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    return el;
  };

  const fan: DeviceState = {
    device_id: 'fan',
    name: 'Ceiling Fan',
    plugin_id: 'x',
    available: true,
    device_type: 'fan',
    attributes: { on: false, speed: 'off', speed_pct: 0 },
    last_seen: '2026-09-11T00:00:00Z',
    schema: {
      attributes: {
        speed: {
          kind: 'enum',
          writable: true,
          options: ['off', 'low', 'medium', 'medium_high', 'high'],
        },
      },
    },
  };

  it('gives a fan the enum’s control, not one button per speed', async () => {
    // Five segmented buttons need about two hundred pixels and a row in a
    // two-column set has about two hundred and fifty for everything, so
    // "Off / Low / Medium / Medium high / High" grew through the fan's name.
    const row = await mount('hc-fan', fan, true);
    expect(row.shadowRoot?.querySelector('select')).not.toBeNull();
    expect(row.shadowRoot?.querySelectorAll('.speeds button')).toHaveLength(0);
  });

  it('keeps the speeds as speeds on a card of its own', async () => {
    const card = await mount('hc-fan', fan, false);
    expect(card.shadowRoot?.querySelector('select')).toBeNull();
    expect(card.shadowRoot?.querySelectorAll('.speeds button')).toHaveLength(5);
  });

  const pico: DeviceState = {
    device_id: 'pico',
    name: 'Overhead',
    plugin_id: 'lutron',
    available: true,
    device_type: 'pico_remote',
    attributes: { available_buttons: [2, 3, 4, 5, 6], last_button_name: 'On' },
    last_seen: '2026-09-11T00:00:00Z',
  };

  it('gives a keypad one line in a set and keeps its keys for its own page', async () => {
    // The living room has three of these and their buttons came to four
    // hundred pixels under a heading about how the room is wired.
    const row = await mount('hc-keypad', pico, true);
    expect(row.shadowRoot?.querySelector('.keys')).toBeNull();
    expect(row.shadowRoot?.textContent).toContain('Overhead');

    const card = await mount('hc-keypad', pico, false);
    expect(card.shadowRoot?.querySelectorAll('.keys .key')).toHaveLength(5);
  });
});

describe('opening a device, and the controls that must not', () => {
  /** A row with a control in it, wired the way a set wires one. */
  const row = (): { el: HTMLElement; opened: string[] } => {
    const el = document.createElement('div');
    el.innerHTML = '<span class="primary">Ceiling Fan</span><select><option>Off</option></select>';
    document.body.append(el);
    const opened: string[] = [];
    attachInspect(el, () => opened.push('sheet'));
    return { el, opened };
  };

  const press = (target: Element, type: string): void => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, button: 0 }));
  };

  it('does not open when a press lands on a control', async () => {
    // **The way the household found it.** A native select opens its popup on
    // pointerdown and the platform keeps the pointer, so no pointerup ever
    // comes back to cancel the hold — the speed menu opened, and half a second
    // later the details sheet opened on top of it.
    const { el, opened } = row();
    const select = el.querySelector('select') as HTMLElement;
    press(select, 'pointerdown');
    await new Promise((r) => setTimeout(r, 700));
    expect(opened, 'the menu is the menu').toEqual([]);
  });

  it('does not open when a control is clicked', async () => {
    const { el, opened } = row();
    const select = el.querySelector('select') as HTMLElement;
    press(select, 'pointerdown');
    press(select, 'pointerup');
    press(select, 'click');
    expect(opened, 'a flicked switch is not a request to read about it').toEqual([]);
  });

  it('opens on a tap on the row itself', async () => {
    // Hold was the whole gesture, which made the only way to a device's
    // details a gesture with no affordance: nothing on a row says "press me
    // for half a second".
    const { el, opened } = row();
    const name = el.querySelector('.primary') as HTMLElement;
    press(name, 'pointerdown');
    press(name, 'pointerup');
    press(name, 'click');
    expect(opened).toEqual(['sheet']);
  });

  it('opens once for a hold, not again for the click behind it', async () => {
    const { el, opened } = row();
    const name = el.querySelector('.primary') as HTMLElement;
    press(name, 'pointerdown');
    await new Promise((r) => setTimeout(r, 700));
    press(name, 'click');
    expect(opened).toEqual(['sheet']);
  });

  it('leaves a row whose tap already means something', async () => {
    // A light pill aims the colour wheel at whatever you touch, and the page
    // says so in words right above it.
    const el = document.createElement('div');
    el.innerHTML = '<span class="primary">Desk Lamp</span>';
    document.body.append(el);
    const opened: string[] = [];
    attachInspect(el, () => opened.push('sheet'), { tap: false });
    const name = el.querySelector('.primary') as HTMLElement;
    press(name, 'pointerdown');
    press(name, 'pointerup');
    press(name, 'click');
    expect(opened).toEqual([]);
  });
});
