/**
 * What a device can do, from what it declared — not from what it is called.
 *
 * §1.1 has said since the beginning that behaviour comes from declarations and
 * never from a `device_type` table, and `roleOf` has done that for one
 * question. These are the rest, and they exist because core moved the same way:
 * presentation is becoming a predicate over declared capabilities, with
 * `device_type` demoted to a hint.
 *
 * **Each one replaces a type check that was measurably wrong.** Every
 * predicate below was compared against the check it replaces across all 184
 * devices in the reference house before anything was deleted, and every
 * disagreement is a case where the *type* was wrong:
 *
 * | predicate | agreed | what the type check got wrong |
 * |---|---|---|
 * | `isScene` | 184/184 | nothing — exact |
 * | `isDimmable` | 182/184 | two Lutron switches hinted `light` that can only turn on |
 * | `isSwitchable` | 175/184 | fans, modes and Rokus, none of them on the closed list |
 * | `isReadable` | 169/184 | pico remotes, gateways, a weather station — §1.1's own examples |
 * | `isLockable` | 184/184 | nothing *now* — see below |
 *
 * That table is the argument. A predicate that agreed 180 times out of 184
 * would not be a replacement, it would be four silent regressions; these
 * disagree only where the old answer was wrong.
 *
 * **And `isLockable` earned its place by a disagreement that has since
 * healed**, which is a better argument than the one it replaced. Measured an
 * hour earlier, the house had a lock the type check could not see: every
 * Z-Wave node reported `device_type: "zwave"`, including the front door.
 * Running `zwave rescan_nodes` made the plugin re-register, and those nine
 * devices now type as `lock`, `contact_sensor`, `motion_sensor`, `gateway` and
 * `switch`. The name was wrong until something unrelated corrected it, and a
 * client that had trusted the name was wrong for exactly that long. The
 * declaration was right the whole time.
 *
 * ## Two kinds of question, and only one takes the type as a fallback
 *
 * `device_type` **demotes to a hint**; it is not deleted. Which means the
 * fallback is allowed exactly where the type is evidence, and the two cases
 * are not the same:
 *
 * - **"What kind of thing is this?"** — scene, lock, read-only device. A name
 *   is real evidence here, and a plugin that has not restarted since schemas
 *   became universal publishes none. So the declaration answers first and the
 *   type answers when it is silent. Dropping the fallback broke five scene
 *   tests on the first attempt, which is what a scene with no schema looks
 *   like: not a scene any more.
 * - **"What can it physically do?"** — dim, switch. A name is *not* evidence
 *   here, and that is the whole finding: two Lutron switches in the reference
 *   house are hinted `light`, are lights, and cannot dim. Falling back to the
 *   type would reintroduce exactly the wrong answer this replaced, so these
 *   stay declaration-only and answer `false` when nothing was declared —
 *   §1.1's rule, that an undeclared capability is not drawn.
 */
import type { DeviceState } from './device.js';
import type { AttributeSchema } from './api.js';

function attributes(d: DeviceState): Record<string, AttributeSchema> {
  return d.schema?.attributes ?? {};
}

/**
 * What the device is *called*, hint first.
 *
 * Used only as a fallback, and only by the predicates above that answer "what
 * kind of thing is this". `ui_hint` leads because that is the field's purpose:
 * a switch a person hinted as a light is a light (§1.1).
 */
function facet(d: DeviceState): string {
  return d.ui_hint ?? d.device_type ?? '';
}

/** Attributes a caller may write. The set of things you can *set*. */
export function writableAttributes(d: DeviceState): string[] {
  return Object.entries(attributes(d))
    .filter(([, a]) => a.writable === true)
    .map(([k]) => k);
}

/** Whether the device declares this attribute as writable. */
export function canWrite(d: DeviceState, attribute: string): boolean {
  return attributes(d)[attribute]?.writable === true;
}

/** Whether the device declares this action. */
export function declaresAction(d: DeviceState, id: string): boolean {
  return (d.schema?.actions ?? []).some((a) => a.id === id);
}

/**
 * A scene: something you *do*, which does not meaningfully turn off.
 *
 * **All 58 scenes in the reference house declare `activate`, and nothing else
 * declares it.** So this is exact rather than approximate, and it is the one
 * predicate that needed no adjusting: the first attempt — "declares `activate`
 * *and nothing readable*" — was wrong on 52 of them, because a Hue scene
 * declares `active` and a Lutron one declares `on` and `led_component` once
 * its LED query answers. Those readings are how a scene reports whether it is
 * applied (§7.3), so requiring their absence excluded exactly the scenes that
 * work best.
 */
export function isScene(d: DeviceState): boolean {
  return declaresAction(d, 'activate') || facet(d) === 'scene';
}

/**
 * A device you can dim, as opposed to one you can only switch.
 *
 * The two Lutron switches this disagrees with are the case §1.1 opens with:
 * switches wired to lights, corrected by hand with `ui_hint: "light"`. The
 * hint is right — they *are* lights, and should be drawn as lights — and they
 * still cannot dim, because all they declare writable is `on`. Offering a
 * brightness slider for them was drawing a control the hardware does not have.
 */
export function isDimmable(d: DeviceState): boolean {
  return canWrite(d, 'brightness_pct') || canWrite(d, 'brightness');
}

/** A device you can turn on and off. */
export function isSwitchable(d: DeviceState): boolean {
  return canWrite(d, 'on');
}

/**
 * A device you can lock.
 *
 * The two agree on every device in the house *today*. They did not an hour
 * ago: the front door reported `device_type: "zwave"`, like every other node,
 * and a `rescan_nodes` re-registered it as `lock`. Nothing about the house
 * changed — a stale registration was corrected — and for however long it had
 * been stale, a name-based check called a lock a generic Z-Wave device while
 * its writable `locked` said otherwise the whole time.
 */
export function isLockable(d: DeviceState): boolean {
  return canWrite(d, 'locked') || facet(d) === 'lock';
}

/**
 * A device that reports and takes no orders.
 *
 * `roleOf`'s `readable`, as a predicate: a schema, at least one attribute, no
 * writable attribute and no action. That last clause is what separates this
 * from "has nothing writable" — a scene has no writable attribute either, and
 * a scene is emphatically something you command.
 *
 * The seventeen it finds that `device_type.endsWith('_sensor')` misses include
 * eight pico remotes, which is §1.1's worked example: a Pico transmits and
 * cannot be pressed remotely, while a keypad declares `press_button`. Same
 * shape of hardware, opposite answers, and the plugins already said so.
 */
export function isReadable(d: DeviceState): boolean {
  if (d.schema == null) return facet(d).endsWith('_sensor');
  return (
    Object.keys(attributes(d)).length > 0 &&
    writableAttributes(d).length === 0 &&
    (d.schema.actions ?? []).length === 0
  );
}
