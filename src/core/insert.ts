/**
 * Putting the house on a page — device first.
 *
 * **A page is made of the house, not of widget types.** The first editor
 * offered the fifty-odd types the client can draw — lock, keypad, timer — and
 * a person building a page does not create a lock; homeCore already has one.
 * What they want is *the front door, here*. So the editor offers devices, and
 * this module answers the question that used to be the user's: which widget
 * draws this device, and at what size.
 *
 * The answer is a list rather than one type, because "how should the porch
 * light look" has more than one right answer — a card, a pill, a switch on its
 * own — and the inspector offers the rest as "Show as". The first is the one
 * the device gets when it is dropped, and it comes from the same dispatch a
 * device grid uses (`tagForDevice`), so a lock dropped on a page is drawn the
 * way the house already draws locks.
 */
import { canWrite, isDimmable, isSwitchable } from './capability.js';
import type { DeviceState } from './device.js';
import { readingOf } from './facet.js';
import { tagForDevice, typeForTag } from './registry.js';

/** The prefix a device tool carries: `device:<device_id>`. */
export const DEVICE_TOOL = 'device:';

export function deviceTool(id: string): string {
  return `${DEVICE_TOOL}${id}`;
}

/** The device a tool holds, or `undefined` for a widget-type tool. */
export function deviceOfTool(tool: string | undefined): string | undefined {
  return tool?.startsWith(DEVICE_TOOL) === true ? tool.slice(DEVICE_TOOL.length) : undefined;
}

/** How big a widget starts: pixels on a free page, cells on a packed one. */
export interface StartSize {
  free: { w: number; h: number };
  cells: { w: number; h: number };
}

/** One way to show a device. */
export interface Way {
  type: string;
  /** What the inspector calls it — "Card", "Switch". */
  label: string;
  /** The widget's config, `device_id` included. */
  config: Record<string, unknown>;
  size: StartSize;
}

const size = (w: number, h: number, cw: number, ch: number): StartSize => ({
  free: { w, h },
  cells: { w: cw, h: ch },
});

/**
 * Sizes for the types a device can become, chosen so each starts showing what
 * it is for — a lock big enough for its button, a pill a single row.
 */
const SIZES: Record<string, StartSize> = {
  device_tile: size(260, 150, 3, 2),
  device_pill: size(240, 56, 3, 1),
  device_reading: size(180, 100, 2, 1),
  device_details: size(360, 320, 4, 4),
  toggle: size(220, 72, 3, 1),
  slider: size(300, 80, 4, 1),
  colour_wheel: size(240, 260, 3, 3),
  warmth: size(300, 80, 4, 1),
  thermostat: size(240, 180, 3, 2),
  history_chart: size(360, 200, 4, 2),
  lock: size(220, 160, 3, 2),
  keypad: size(260, 280, 3, 3),
  timer: size(240, 160, 3, 2),
  fan: size(240, 180, 3, 2),
  contact: size(220, 110, 3, 1),
  presence: size(220, 110, 3, 1),
  scene_button: size(200, 72, 2, 1),
  media_tile: size(340, 200, 4, 2),
  media_player: size(340, 200, 4, 2),
};

/** The page's own furniture, sized for what each one usually holds. */
const PAGE_SIZES: Record<string, StartSize> = {
  heading: size(360, 56, 6, 1),
  text: size(320, 96, 4, 1),
  image: size(320, 220, 4, 3),
  icon: size(64, 64, 1, 1),
  shape: size(200, 200, 3, 3),
  line: size(240, 16, 4, 1),
  dashboard_link: size(220, 64, 3, 1),
  web_embed: size(480, 320, 6, 4),
};

const FALLBACK = size(360, 200, 6, 2);

/** How big a widget of this type starts. */
export function startSize(type: string): StartSize {
  return SIZES[type] ?? PAGE_SIZES[type] ?? FALLBACK;
}

/** The words for a type when it is one way of showing a device. */
const WAY_NAMES: Record<string, string> = {
  device_tile: 'Card',
  device_pill: 'Pill',
  device_reading: 'Reading',
  device_details: 'Everything about it',
  toggle: 'Switch',
  slider: 'Brightness slider',
  colour_wheel: 'Colour wheel',
  warmth: 'Warmth slider',
  history_chart: 'Chart',
  lock: 'Lock',
  keypad: 'Keypad',
  timer: 'Timer',
  fan: 'Fan',
  contact: 'Open / closed',
  presence: 'Presence',
  scene_button: 'Scene button',
  media_tile: 'Media player',
  media_player: 'Media controls',
};

/**
 * How each type names its device, beyond `device_id`.
 *
 * Core's vocabulary is the authority on what a type requires, and two of these
 * name the device their own way: a scene button by `scene_id`, and a card by
 * a manual selection (the plural `device_ids`, as the house's own pages store
 * it). `device_id` is written too, because that is what the host resolves —
 * so the widget draws its device and the inspector has nothing to complain of.
 */
const NAMED: Record<string, (id: string) => Record<string, unknown>> = {
  scene_button: (id) => ({ scene_id: id }),
  device_tile: (id) => ({ selection_mode: 'manual', device_ids: [id] }),
};

function way(type: string, device: DeviceState, extra: Record<string, unknown> = {}): Way {
  const id = device.device_id;
  return {
    type,
    label: WAY_NAMES[type] ?? type,
    config: { device_id: id, ...NAMED[type]?.(id), ...extra },
    size: startSize(type),
  };
}

/**
 * Every way this device can be shown, the one it gets when dropped first.
 *
 * Only ways the device can fill: a switch for something that declares a
 * writable `on`, a brightness slider for something that dims, a chart for a
 * reading that is a number. Offering a colour wheel for a door sensor would be
 * a choice that draws an empty control.
 */
export function waysToShow(d: DeviceState): Way[] {
  const ways: Way[] = [];
  const tag = tagForDevice(d);
  const own = tag === undefined ? undefined : typeForTag(tag);
  if (own !== undefined && own !== 'device_tile') ways.push(way(own, d));

  ways.push(way('device_tile', d));
  if (isSwitchable(d)) ways.push(way('toggle', d, { attribute: 'on' }));
  if (isDimmable(d)) {
    const attribute = canWrite(d, 'brightness_pct') ? 'brightness_pct' : 'brightness';
    ways.push(way('slider', d, { attribute }));
  }
  if (canWrite(d, 'color_temp')) ways.push(way('warmth', d, { attribute: 'color_temp' }));
  if (canWrite(d, 'color_xy')) ways.push(way('colour_wheel', d, { attribute: 'color_xy' }));
  ways.push(way('device_pill', d));

  const reading = readingOf(d);
  if (reading !== undefined) {
    ways.push(way('device_reading', d));
    if (typeof reading.value === 'number') {
      ways.push(way('history_chart', d, { attribute: reading.key }));
    }
  }
  ways.push(way('device_details', d));
  return ways;
}

/** The way a device is drawn when it is dropped on a page. */
export function firstWay(d: DeviceState): Way {
  return waysToShow(d)[0]!;
}

/**
 * Which of a device's ways a widget already is.
 *
 * Matched on type and, where a type serves twice, the attribute — a slider on
 * brightness and a slider on warmth are different ways.
 */
export function wayIndex(ways: readonly Way[], type: string, config: Record<string, unknown>) {
  const exact = ways.findIndex(
    (w) =>
      w.type === type &&
      (w.config['attribute'] === undefined || w.config['attribute'] === config['attribute']),
  );
  return exact >= 0 ? exact : ways.findIndex((w) => w.type === type);
}

/**
 * The widget types a device brings with it, and so are not offered on their
 * own: nobody places "a lock" — they place the front door.
 */
export const DEVICE_TYPES: ReadonlySet<string> = new Set([
  ...Object.keys(SIZES),
  'stepper',
  'gauge',
  'plugin_actions',
  'room_field',
  'property_panel',
  'unknown',
]);

/** The drag data type the rail sets, so the page knows a drag is one of ours. */
export const DRAG_TOOL = 'application/x-hc-tool';
