/**
 * The styling contract — `::part()` names, declared (§5.8, §19.7).
 *
 * card-mod exists because Home Assistant's cards are shadow-DOM encapsulated
 * with no styling hooks, so thousands of dashboards now depend on injecting CSS
 * into other people's internals. The way out is not to forbid the injection, it
 * is to make it unnecessary: every meaningful element carries a `part`, and
 * those names are ABI — renaming one is a breaking change (§19.7).
 *
 * **A list rather than a convention**, because a convention drifts. One widget
 * calling its blank state `empty` and the next calling it `placeholder` gives a
 * theme author two selectors for one idea, and neither is wrong enough for
 * anyone to fix. Adding a name here is the deliberate act that a new piece of
 * ABI should be; `styling.test.ts` fails on a part that is not in this list.
 *
 * Taken from what the widgets already expose, not invented ahead of them.
 */

/** Names any widget may use, because they mean the same thing everywhere. */
export const SHARED_PARTS = [
  /** The widget's outermost box, where it draws one. */
  'card',
  /** Nothing to show, and the widget saying so. */
  'empty',
  /** The state-carrying mark: a tile, a dot, a lit icon. */
  'indicator',
  /** What the thing is called. */
  'name',
  /** What it is doing, in words. */
  'state',
  /** The headline reading, in the device's own units. */
  'reading',
  /** A section title inside a widget. */
  'heading',
  /** One item in a list of them. */
  'row',
  /** A run of rows or items. */
  'set',
  /** Something the user can press. */
  'action',
  /** A generated or drawn control. */
  'controls',
  /** An explanation the widget offers when it cannot show the usual thing. */
  'note',
  /** The shell's top region: mark, names and badge (§7.2). */
  'head',
  /** The number at the far edge: a level, a count, a reading. */
  'trailing',
] as const;

/** Names that belong to one widget family and mean nothing outside it. */
export const OWN_PARTS = [
  // Text and decoration.
  'text',
  'shape',
  'rule',
  'image',
  'spacer',
  // Sets of devices.
  'pill',
  'group',
  'mark',
  'rest',
  'breakdown',
  // Controls.
  'toggle',
  'slider',
  'select',
  'colour',
  'track',
  'fill',
  'knob',
  'label',
  'strip',
  'wheel',
  'value',
  // Charts.
  'chart',
  'plot',
  // Rooms and the house.
  'field',
  'room',
  'hero',
  'headline',
  'section',
  'head',
  // Scenes, modes, media.
  'scene',
  'chip',
  'player',
  'players',
  'now',
  // Notices and activity.
  'notice',
  'notices',
  'event',
  'feed',
] as const;

export function knownParts(): Set<string> {
  return new Set<string>([...SHARED_PARTS, ...OWN_PARTS]);
}
