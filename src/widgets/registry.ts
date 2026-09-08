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

/** The tag for this device, or `undefined` to use the generic card. */
export function tagForDevice(d: { ui_hint?: string; device_type?: string }): WidgetTag | undefined {
  return forDevice.get(d.ui_hint ?? d.device_type ?? '');
}
