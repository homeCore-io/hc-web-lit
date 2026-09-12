/**
 * `device_reading` — one number, large.
 *
 * Core's fields: `device_id` (required), `attribute`, `unit`. With no
 * attribute named it shows the reading the device is *for*, which is
 * `primary` now that plugins declare it (homeCore#29) rather than whichever
 * attribute a map happened to yield first.
 */
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { formatReading, readingAt, readingOf } from '../core/facet.js';
import { registerWidget } from '../core/registry.js';
import { HcLayoutShell } from '../sdk/shell.js';
import { icon, iconFor, metricVar } from '../design/icons.js';

@customElement('hc-device-reading')
export class HcDeviceReading extends HcLayoutShell {
  static override styles = [
    HcLayoutShell.styles,
    css`
      /* The reading is the point, so it takes the primary line and the name
         goes underneath — the shell's two lines, used the other way up. */
      .primary {
        font-size: var(--hc-text-display-size, 28px);
        font-variant-numeric: tabular-nums;
        line-height: 1.05;
        font-weight: 600;
      }
      .secondary {
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: var(--hc-text-caption-size, 11px);
      }
      .none {
        font-size: var(--hc-text-caption-size, 11px);
        color: var(--hc-ink-muted, #8b95a4);
      }
    `,
  ];

  @property({ attribute: false }) device: DeviceState | undefined;

  override updated(): void {
    super.updated();
    const d = this.device;
    this.offline = d !== undefined && !d.available;
    // An instrument takes its metric's colour: a thermometer reads as a
    // thermometer rather than as something that happens to be off (§15).
    const metric = d === undefined ? undefined : metricVar(iconFor(d));
    this.style.setProperty(
      '--hc-shell-colour',
      metric === undefined ? 'var(--hc-ink-muted, #8b95a4)' : `var(${metric})`,
    );
    this.style.setProperty('--hc-shell-tint', metric === undefined ? '0%' : '14%');
  }

  protected override renderIcon() {
    return icon(iconFor(this.device));
  }

  protected override renderPrimary(): unknown {
    const r = this.reading();
    if (r === undefined) {
      return html`<span class="none" part="empty"
        >${this.device === undefined ? 'No device' : 'Nothing to read'}</span
      >`;
    }
    const unit = typeof this.config['unit'] === 'string' ? this.config['unit'] : undefined;
    return formatReading(unit === undefined ? r : { ...r, unit });
  }

  protected override renderSecondary(): unknown {
    return this.reading()?.label ?? nothing;
  }

  /**
   * What to show: the named attribute, or the reading the device is *for*.
   *
   * With no attribute named this is `primary` now that plugins declare it
   * (homeCore#29), rather than whichever attribute a map happened to yield
   * first.
   */
  private reading() {
    const d = this.device;
    if (d === undefined) return undefined;

    const named = this.config['attribute'];
    if (typeof named !== 'string' || named === '') return readingOf(d);

    // `readingAt`, not a reading built here. Resolving a unit is fiddlier than
    // it looks: it may be declared on the schema *or* published beside the
    // value as `<key>_unit`, and the published one wins (homeCore#40 — Hue
    // declares degrees Celsius on an attribute it publishes in Fahrenheit).
    // This built its own and read only the declared unit, so every Ecowitt
    // sensor in the house drew "72.5" with no unit at all: those plugins
    // publish the unit and declare nothing.
    return readingAt(d, named);
  }
}

registerWidget('device_reading', 'hc-device-reading');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-reading': HcDeviceReading;
  }
}
