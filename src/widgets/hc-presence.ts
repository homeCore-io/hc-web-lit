/**
 * Presence — `occupancy_sensor` ×5 and `motion_sensor` (§7.3).
 *
 * Two device families that answer the same question and publish it under
 * different names, which is the whole reason this is one widget rather than
 * two. The reference house:
 *
 *     Kitchen Occupancy   occupancy_sensor  { occupancy, occupied }
 *     Office Motion       motion_sensor     { motion, illuminance, temperature, … }
 *
 * **`isOn` already reconciles them** — `motion`, `occupancy` and `occupied`
 * are all on-ness attributes (§1.1) — so this widget asks the host rather than
 * keeping a list of its own. The occupancy sensors publish `occupancy` *and*
 * `occupied`, two names for one fact, and the derivation is why that costs
 * nothing here.
 *
 * **The word differs even though the fact does not.** A motion sensor detects
 * motion and goes quiet a moment later; an occupancy sensor holds a room
 * occupied while somebody is in it. "Motion" and "Occupied" are not
 * interchangeable to a reader, so the widget says whichever the device is —
 * from `device_type`, which is the one thing here that is a presentation
 * choice rather than a derivation, and is a word rather than a behaviour.
 *
 * **A Hue motion sensor is also a light meter and a thermometer.** It declares
 * `illuminance` and `temperature` in `primary`, they are real readings, and a
 * card that showed only "Clear" would be hiding two thirds of what the device
 * is for. They are shown when present and never invented when not.
 *
 * **No duration**, for the same reason as `hc-contact`: `last_change` is
 * provenance rather than transition time (homeCore#39), so "clear for 40
 * minutes" is not something this client can currently say truthfully.
 */
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { effectiveName, isOn } from '../core/present.js';
import { formatReading, readingAt } from '../core/facet.js';
import { registerForDevice, registerWidget } from '../core/registry.js';
import { icon, iconFor } from '../design/icons.js';
import { HcLayoutShell } from '../sdk/shell.js';

@customElement('hc-presence')
export class HcPresence extends HcLayoutShell {
  static override styles = [
    HcLayoutShell.styles,
    css`
      .also {
        display: flex;
        gap: 0.75rem;
        font-size: var(--hc-text-caption-size, 11px);
        color: var(--hc-ink-muted, #8b95a4);
        font-variant-numeric: tabular-nums;
      }
      /* A row is scanned, so the extra readings are a card-only luxury. */
      :host([data-row]) .also {
        display: none;
      }
    `,
  ];

  @property({ attribute: false }) device: DeviceState | undefined;

  private get present(): boolean | undefined {
    return this.device === undefined ? undefined : isOn(this.device);
  }

  /** Motion or occupancy — the same fact, and not the same word. */
  private get kind(): 'motion' | 'occupancy' {
    return (this.device?.device_type ?? '').includes('motion') ? 'motion' : 'occupancy';
  }

  protected override renderIcon() {
    return icon(iconFor(this.device), this.device !== undefined && isOn(this.device) === true);
  }

  protected override renderPrimary() {
    return this.device === undefined ? 'Presence' : effectiveName(this.device);
  }

  protected override renderSecondary() {
    const present = this.present;
    if (present === undefined) return nothing;
    if (this.kind === 'motion') return present ? 'Motion' : 'No motion';
    return present ? 'Occupied' : 'Clear';
  }

  protected override renderControls() {
    // What else this device happens to measure. A Hue motion sensor is three
    // instruments in one housing and says so in its schema.
    const extra: string[] = [];
    for (const key of ['temperature', 'illuminance'] as const) {
      if (this.device === undefined) break;
      const reading = readingAt(this.device, key);
      if (reading !== undefined) extra.push(formatReading(reading));
    }
    if (extra.length === 0) return nothing;
    return html`<div class="also" part="reading">
      ${extra.map((e) => html`<span>${e}</span>`)}
    </div>`;
  }

  override updated(): void {
    super.updated();
    const present = this.present;
    this.style.setProperty(
      '--hc-shell-colour',
      present === true ? 'var(--hc-accent-active, #ffb661)' : 'var(--hc-ink-muted, #8b95a4)',
    );
    this.style.setProperty('--hc-shell-tint', present === true ? '30%' : '0%');
  }
}

registerWidget('presence', 'hc-presence');
registerForDevice('occupancy_sensor', 'hc-presence');
registerForDevice('motion_sensor', 'hc-presence');

declare global {
  interface HTMLElementTagNameMap {
    'hc-presence': HcPresence;
  }
}
