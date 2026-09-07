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
