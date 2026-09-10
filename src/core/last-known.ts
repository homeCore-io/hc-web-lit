/**
 * The house as it was, for a panel that came back before the network did.
 *
 * §16 asks the UI to "survive a LAN blip with cached shell + last-known device
 * state and a clear stale indicator". The service worker does the first part
 * and the staleness badge does the third; this is the middle one, and without
 * it the other two combine into a panel that boots perfectly and then says it
 * cannot reach anything.
 *
 * **The blip that matters is the reload, not the disconnection.** While the
 * page is up, the event stream is already reconnecting and the screen still
 * shows what it last heard. The failure this exists for is narrower and worse:
 * a wall tablet reboots — a power cut, a Chrome tab discarded after a month —
 * and comes back while the house is still unreachable. The shell loads from
 * cache, the first request fails, and a dashboard somebody relies on is an
 * error message.
 *
 * **Schemas are kept, at four times the size.** A snapshot without them is
 * 118KB instead of 287KB and restores a house whose lights have no brightness
 * control and whose fans have no speeds — a screen that looks broken in a new
 * way rather than an old screen honestly labelled. Both fit localStorage's
 * budget many times over, so the smaller one buys nothing worth having.
 *
 * **Written rarely and deliberately.** A panel that persisted 300KB on every
 * device event would write hundreds of megabytes a day to a tablet's flash to
 * defend against an outage that may never come. Once every few minutes, plus
 * once when the page is going away, costs nothing and is at most a few minutes
 * out of date — and the restored view says how old it is rather than pretending
 * otherwise.
 */
import type { DeviceState } from './device.js';
import type { DashboardDefinition } from './dashboard.js';

/** Where it lives. Per device, like the panel key and unlike shared content. */
const SLOT = 'hc.last-known';

/** What is worth keeping to draw a page with nothing available. */
export interface Snapshot {
  /** When this was true, in epoch milliseconds. */
  at: number;
  devices: DeviceState[];
  dashboards: DashboardDefinition[];
}

export interface LastKnownOptions {
  /** How often a save is allowed. Default five minutes. */
  everyMs?: number;
  /** Injectable clock, so a test does not have to wait. */
  now?: () => number;
}

export class LastKnown {
  private readonly everyMs: number;
  private readonly now: () => number;
  /**
   * Negative infinity, not zero: "never written" is not "written at time
   * zero". With a real clock the difference never shows, because `Date.now()`
   * is a number no interval comes near — which is exactly why it would have
   * sat here being wrong, and why the test uses a clock that starts at 0.
   */
  private lastWrite = Number.NEGATIVE_INFINITY;

  constructor(opts: LastKnownOptions = {}) {
    this.everyMs = opts.everyMs ?? 5 * 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Keep this, unless it is too soon since the last one.
   *
   * Returns whether it wrote, which is only of interest to a test — a caller
   * offers a snapshot whenever it has one and lets this decide.
   */
  save(devices: readonly DeviceState[], dashboards: readonly DashboardDefinition[]): boolean {
    const at = this.now();
    if (at - this.lastWrite < this.everyMs) return false;
    return this.write({ at, devices: [...devices], dashboards: [...dashboards] });
  }

  /**
   * Keep this now, whatever the interval says.
   *
   * For `pagehide`: the tab is going away and this is the last chance to
   * record what it knew. A power cut gives no such warning, which is why the
   * periodic save exists as well.
   */
  saveNow(devices: readonly DeviceState[], dashboards: readonly DashboardDefinition[]): boolean {
    return this.write({ at: this.now(), devices: [...devices], dashboards: [...dashboards] });
  }

  /**
   * What was last known, if anything.
   *
   * No age limit here. How old is too old is the caller's question and depends
   * on what it is for — a dashboard four hours stale is still the best thing
   * available to somebody standing in front of a dark panel, as long as it says
   * so. This returns the timestamp and lets them decide.
   */
  load(): Snapshot | undefined {
    try {
      const raw = globalThis.localStorage?.getItem(SLOT);
      if (raw === null || raw === undefined) return undefined;
      const parsed = JSON.parse(raw) as Partial<Snapshot>;
      if (
        typeof parsed.at !== 'number' ||
        !Array.isArray(parsed.devices) ||
        !Array.isArray(parsed.dashboards)
      ) {
        return undefined;
      }
      return { at: parsed.at, devices: parsed.devices, dashboards: parsed.dashboards };
    } catch {
      // Unreadable, unparseable, or storage refused. A panel with no snapshot
      // is the situation this existed to improve, not one to fail over.
      return undefined;
    }
  }

  forget(): void {
    try {
      globalThis.localStorage?.removeItem(SLOT);
    } catch {
      // Nothing to do about it.
    }
  }

  private write(snapshot: Snapshot): boolean {
    try {
      globalThis.localStorage?.setItem(SLOT, JSON.stringify(snapshot));
      this.lastWrite = snapshot.at;
      return true;
    } catch {
      // Quota, private browsing, or site data turned off. Recorded as attempted
      // so a full disk does not mean retrying 300KB on every device event.
      this.lastWrite = snapshot.at;
      return false;
    }
  }
}

/** How old, in the words the staleness badge already uses. */
export function ageOf(snapshot: Snapshot, now = Date.now()): number {
  return Math.max(0, now - snapshot.at);
}

/**
 * Which pages a restored panel should draw.
 *
 * **A document beats a photograph of one.** The snapshot is taken every few
 * minutes to survive an outage; a page is a thing somebody edited, possibly
 * since. Restoring the snapshot's copy over the stored one would quietly undo
 * yesterday's edit on a panel that came back after a power cut, and the panel
 * would look perfectly fine while doing it.
 *
 * The snapshot's copy still matters, for the case it was written for: this
 * client's own store unreachable too, which on a static deployment is the same
 * outage.
 */
export function pagesToShow<T>(stored: readonly T[], snapshot: readonly T[]): readonly T[] {
  return stored.length > 0 ? stored : snapshot;
}
