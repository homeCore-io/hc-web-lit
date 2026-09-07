/**
 * The generic device card — `hc-device` in §7.3, and the one that must be good.
 *
 * Three devices in the reference house declare no `device_type` at all, a fifth
 * of the rest declare something no type-specific widget will ever be written
 * for (`bridge`, `gateway`, `zwave`), and the next plugin will invent a type
 * nobody has seen. So this is not a fallback — it is the base case, and the
 * type-specific widgets are refinements of it.
 *
 * Everything it shows comes from the presentation primitive (§1.1), never from
 * its own reading of attributes: `isOn` is derived per device from whichever
 * attribute the plugin publishes, and every widget that re-derived it got it
 * wrong the same way.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { effectiveName, isOn, levelOf } from '../core/present.js';
import { registerWidget } from './registry.js';

@customElement('hc-device-card')
export class HcDeviceCard extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }
    .card {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      height: 100%;
      box-sizing: border-box;
      padding: 0.75rem;
      border-radius: var(--hc-radius, 10px);
      background: var(--hc-raised, #241c15);
      color: var(--hc-ink, #f5efe8);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    .dot {
      flex: none;
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      background: var(--hc-muted, #6b6259);
    }
    .dot[data-on] {
      background: var(--hc-accent, #ffb661);
    }
    .body {
      min-width: 0;
      display: grid;
      gap: 0.125rem;
    }
    .name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sub {
      font-size: 0.8125rem;
      opacity: 0.65;
      font-variant-numeric: tabular-nums;
    }
    .offline {
      opacity: 0.45;
    }
  `;

  @property({ attribute: false }) device: DeviceState | undefined;

  override render() {
    const d = this.device;
    if (d === undefined) return html`<div class="card"><span class="sub">No device</span></div>`;

    const on = isOn(d);
    const level = levelOf(d);

    return html`
      <div class="card ${d.available ? '' : 'offline'}" part="card">
        <span class="dot" part="indicator" ?data-on=${on}></span>
        <div class="body">
          <div class="name" part="name">${effectiveName(d)}</div>
          <div class="sub" part="state">${this.subtitle(d, on, level)}</div>
        </div>
      </div>
    `;
  }

  /**
   * What to say under the name.
   *
   * A level is worth showing only when the device is on: a dimmer that is off
   * still reports the brightness it will return to, and printing "43%" beside a
   * dark lamp is a lie the data invites (§1.1).
   */
  private subtitle(d: DeviceState, on: boolean, level: number | undefined) {
    if (!d.available) return 'Offline';
    if (on && level !== undefined) return `On · ${Math.round(level)}%`;
    if (on) return 'On';
    return d.device_type === undefined ? nothing : 'Off';
  }
}

registerWidget('device_tile', 'hc-device-card');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-card': HcDeviceCard;
  }
}
