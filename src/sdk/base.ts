/**
 * `HcWidgetBase` — what an extension author extends (§4.5).
 *
 * A Lit element with the context wired and subscription teardown handled,
 * because the teardown is the part everyone forgets: a widget that subscribes
 * in `connectedCallback` and never unsubscribes keeps a listener alive for
 * every device it ever watched, on a page that runs for months.
 *
 * Deliberately thin. §4.1 keeps the widget interface to three things —
 * `setConfig`, `connect`, `getSize` — and a base class that did more would be
 * making decisions on behalf of authors who did not ask.
 */
import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { HcContext, Unsubscribe } from './context.js';

export abstract class HcWidgetBase extends LitElement {
  /** The placement's config, with bindings and tokens already resolved. */
  @property({ attribute: false }) config: Record<string, unknown> = {};

  /** The capability object. Set by the host before the first render. */
  @property({ attribute: false }) ctx: HcContext | undefined;

  private readonly held: Unsubscribe[] = [];

  /**
   * Watch some devices, and stop when this element goes.
   *
   * The teardown is registered here rather than returned, so forgetting it is
   * not possible — which is the whole reason to have a base class.
   */
  protected watch(deviceIds: readonly string[], cb: (states: DeviceState[]) => void): void {
    const off = this.ctx?.subscribe(deviceIds, cb);
    if (off !== undefined) this.held.push(off);
  }

  override disconnectedCallback(): void {
    for (const off of this.held.splice(0)) off();
    super.disconnectedCallback();
  }

  /**
   * Preferred size, in the units the host is asking about (§4.1).
   *
   * Cells in grid mode, frame units in free mode. The default is a guess a
   * host may override with a placement; a widget with an opinion says so.
   */
  getSize(_mode: 'grid' | 'free'): { w: number; h: number } {
    return { w: 2, h: 2 };
  }
}
