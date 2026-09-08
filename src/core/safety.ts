/**
 * The interaction safety policy (§11.3), enforced where nothing can opt out.
 *
 * **This lives in the host, not in widgets.** §5.10's whole argument: if each
 * widget decided when to confirm, a third-party widget could simply decide not
 * to — and the one that unlocks a door on a stray tap would be the one nobody
 * reviewed. The host dispatches every command, so the host is where a rule
 * about locks is a rule rather than a convention.
 *
 * Adopted from houseplan-card because it is correct, and stated as data so it
 * can be read, tested and argued with.
 */
import type { DeviceState } from './device.js';
import { humanise } from './text.js';

export type Verdict = { allow: true } | { allow: false; reason: string } | { confirm: string };

/**
 * Device types that are never actuated casually.
 *
 * Not a list of dangerous devices — a list of devices where the *cost of being
 * wrong is asymmetric*. Turning a lamp on by accident is a lamp; unlocking a
 * door by accident is a door that is now unlocked, and nobody is standing
 * there to notice.
 */
const GUARDED = new Set(['lock', 'alarm', 'valve', 'garage', 'gate']);

/** Attributes whose write is the guarded act, whatever the device type says. */
const GUARDED_ATTRIBUTES = new Set(['locked', 'armed', 'arm_mode']);

/** What the device is for the purposes of this policy — `ui_hint` wins. */
function facet(d: DeviceState): string {
  return d.ui_hint ?? d.device_type ?? '';
}

/**
 * Whether a command may go out as asked.
 *
 * Three answers, not two. `confirm` is the interesting one: the command is
 * legitimate and the person should be asked, which is different from refusing
 * it and different from letting it through.
 */
export function check(device: DeviceState, patch: Record<string, unknown>): Verdict {
  const kind = facet(device);
  const keys = Object.keys(patch);

  const guardedByType = GUARDED.has(kind);
  const guardedByAttribute = keys.some((k) => GUARDED_ATTRIBUTES.has(k));
  if (!guardedByType && !guardedByAttribute) return { allow: true };

  // Unlocking is the direction that matters. Locking a door, closing a valve
  // and arming an alarm are all the safe direction, and asking about them
  // trains people to click through the question that matters.
  const opening = patch['locked'] === false || patch['open'] === true || patch['armed'] === false;

  const name = device.name_override ?? device.name;
  if (opening) return { confirm: `Unlock ${name}?` };

  return { confirm: `${kind === 'lock' ? 'Lock' : 'Change'} ${name}?` };
}

/** Whether an action needs asking about. Same policy, applied to actions. */
export function checkAction(device: DeviceState, actionId: string): Verdict {
  if (!GUARDED.has(facet(device))) return { allow: true };
  return { confirm: `${humanise(actionId)} on ${device.name_override ?? device.name}?` };
}
