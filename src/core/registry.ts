import type { DeviceState } from './device.js';

/**
 * Which element draws a widget `type`.
 *
 * **The set is open and stays open.** `DashboardWidget.type` is a plain string
 * and core accepts types it has never heard of — it was an enum every client
 * mirrored by hand until the mirror cracked (§14.3). So an unknown type is a
 * normal thing to meet, not an error: it renders as a labelled placeholder that
 * says what it wanted to be, and the document round-trips untouched.
 *
 * That is also what makes a plugin's own card work without a core release, and
 * later what makes an extension's work without a rebuild (§19.8).
 */
export type WidgetTag = string;

const registry = new Map<string, WidgetTag>();

export function registerWidget(type: string, tag: WidgetTag): void {
  registry.set(type, tag);
}

export function tagFor(type: string): WidgetTag | undefined {
  return registry.get(type);
}

export function knownTypes(): string[] {
  return [...registry.keys()].sort();
}

/** The smallest a widget of this type is worth drawing, in frame units. */
export interface LeastSize {
  w?: number;
  h?: number;
}

/**
 * How small a resize may pull a widget of this type.
 *
 * §14.2's third complaint about a generic transformer: it knows nothing about
 * per-element minimums, and a slider that loses its knob below 64 should not be
 * draggable to 48. The floor is a property of the *type* rather than of the
 * drawn element, deliberately — every designer gesture has to work from the
 * placement alone (§14.2), so a host that measured the element to find its
 * minimum would work for a first-party card and fail on the sandboxed one.
 *
 * Declared rather than assumed: a type that says nothing gets the flat floor
 * in `core/geometry.ts`, which is the honest answer for most of them.
 */
const floors = new Map<string, LeastSize>();

export function registerLeast(type: string, least: LeastSize): void {
  floors.set(type, least);
}

export function leastFor(type: string): LeastSize | undefined {
  return floors.get(type);
}

/**
 * Which element draws a *device*, when a type-specific one exists.
 *
 * §7.2's division, made operational: the schema offers everything a device can
 * do and a type-specific widget curates. A Roku declares 34 actions and four
 * writable attributes, so a generic card built from the schema draws 27
 * controls — every one of them real, and the card unusable. `hc-media` picks
 * transport and volume; a set of media players should get that rather than the
 * generic card, without the set widget knowing what a media player is.
 *
 * Keyed on the presentation facet (`ui_hint` first, then `device_type`), so a
 * switch hinted as a light is drawn as a light.
 */
const forDevice = new Map<string, WidgetTag>();

export function registerForDevice(facet: string, tag: WidgetTag): void {
  forDevice.set(facet, tag);
}

/**
 * Widgets that can be chosen from what a device *declares*, when its name
 * does not name them.
 *
 * A list rather than a map, because order is the tie-break and there is no
 * other place to state it: a device that is both lockable and switchable is a
 * lock, and drawing it as a switch would put a plain toggle on a door.
 *
 * Registered by the widget itself alongside its type registration, so a
 * widget's two ways of being chosen live together and neither is a table
 * somewhere else.
 */
const byCapability: { test: (d: DeviceState) => boolean; tag: WidgetTag }[] = [];

export function registerForCapability(test: (d: DeviceState) => boolean, tag: WidgetTag): void {
  byCapability.push({ test, tag });
}

/**
 * Every hint this client draws differently.
 *
 * **Derived from what is registered, not a list somebody typed.** The legal
 * set of `ui_hint` values is defined nowhere (homeCore#30), so this client is
 * in no position to publish one — but it *can* say honestly which values
 * change what it draws, because that is exactly what this map holds. A picker
 * offering anything else would be offering a choice with no effect.
 *
 * Sorted, so a person reading the list twice reads the same list: registration
 * order is import order, which is nobody's idea of an order.
 */
export function drawableHints(): string[] {
  return [...forDevice.keys()].sort();
}

/**
 * The tag for this device, or `undefined` to use the generic card.
 *
 * **The hint wins, then the type, then what the device declared.** That order
 * is deliberate and is the one §1.1 asks for: `ui_hint` exists so a person can
 * correct a plugin, and a capability check that overrode it would make the
 * override cosmetic. The declaration comes last precisely because it is the
 * one nobody typed — it is there to catch what no name reached.
 *
 * What it catches: a device whose registration is stale or wrong. The front
 * door on the reference house reported `device_type: "zwave"` — as every
 * Z-Wave node did — until a `rescan_nodes` re-registered it as `lock`. For
 * however long that had been true, a name-based dispatch drew a door as a
 * generic card with a `locked` toggle in its control row, openable by one tap.
 * Its writable `locked` said what it was the entire time.
 */
export function tagForDevice(d: {
  ui_hint?: string;
  device_type?: string;
  schema?: DeviceState['schema'];
}): WidgetTag | undefined {
  const named = forDevice.get(d.ui_hint ?? d.device_type ?? '');
  if (named !== undefined) return named;

  // Only a full device can be asked what it declares; several callers pass a
  // bare `{device_type}` to ask "what would this type draw as".
  if (d.schema === undefined) return undefined;
  return byCapability.find((c) => c.test(d as DeviceState))?.tag;
}
