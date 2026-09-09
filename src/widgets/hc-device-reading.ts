/**
 * `device_reading` — one number, large.
 *
 * Core's fields: `device_id` (required), `attribute`, `unit`. With no
 * attribute named it shows the reading the device is *for*, which is
 * `primary` now that plugins declare it (homeCore#29) rather than whichever
 * attribute a map happened to yield first.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { formatReading, readingOf } from '../core/facet.js';
import { humanise } from '../core/text.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-device-reading')
export class HcDeviceReading extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      align-content: center;
      gap: 0.15rem;
      height: 100%;
      font-family: var(--hc-font-body, system-ui, sans-serif);
      color: var(--hc-ink, #e9edf2);
    }
    .value {
      font-size: var(--hc-text-display-size, 30px);
      font-variant-numeric: tabular-nums;
      line-height: 1.05;
    }
    .unit {
      font-size: var(--hc-text-subtitle-size, 14px);
      color: var(--hc-ink-muted, #8b95a4);
      margin-left: 0.2em;
    }
    .label {
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .empty {
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) device: DeviceState | undefined;

  override render() {
    const d = this.device;
    if (d === undefined) return html`<span class="empty" part="empty">No device</span>`;

    const named = this.config['attribute'];
    const reading = typeof named === 'string' && named !== '' ? this.named(d, named) : readingOf(d);

    if (reading === undefined) {
      return html`<span class="empty" part="empty">Nothing to read</span>`;
    }

    const unit = typeof this.config['unit'] === 'string' ? this.config['unit'] : undefined;
    const shown = formatReading(unit === undefined ? reading : { ...reading, unit });

    return html`
      <span class="value" part="reading">${shown}</span>
      <span class="label" part="label">${reading.label}</span>
    `;
  }

  /** The named attribute, with whatever the schema says about it. */
  private named(d: DeviceState, key: string) {
    const value = d.attributes[key];
    if (value === undefined || value === null) return undefined;
    const declared = d.schema?.attributes?.[key];
    return {
      key,
      value,
      label: declared?.display_name ?? humanise(key),
      ...(declared?.unit !== undefined ? { unit: declared.unit } : {}),
      ...(declared?.states !== undefined ? { states: declared.states } : {}),
    };
  }
}

registerWidget('device_reading', 'hc-device-reading');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-reading': HcDeviceReading;
  }
}
