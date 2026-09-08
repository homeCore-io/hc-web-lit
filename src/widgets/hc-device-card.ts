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
import { controlsFor } from '../core/controls.js';
import type { DeviceState } from '../core/device.js';
import { formatReading, hasPowerState, readingOf } from '../core/facet.js';
import { effectiveName, isOn, levelOf, sceneKind } from '../core/present.js';
import type { CommandRequest } from './hc-controls.js';
import './hc-controls.js';
import { registerWidget } from './registry.js';

@customElement('hc-device-card')
export class HcDeviceCard extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }
    .card {
      display: grid;
      align-content: start;
      gap: 0.75rem;
      height: 100%;
      box-sizing: border-box;
      padding: 0.75rem;
      border-radius: var(--hc-radius-md, 14px);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }
    .dot {
      flex: none;
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      background: var(--hc-accent-inactive, #2a313b);
    }
    .dot[data-on] {
      background: var(--hc-accent-active, #ffb661);
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
  /** The host's command sink. Absent means the card is read-only. */
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  override render() {
    const d = this.device;
    if (d === undefined) return html`<div class="card"><span class="sub">No device</span></div>`;

    const on = isOn(d);
    const level = levelOf(d);

    // Generated from what the plugin declared, not from what this widget
    // assumes a device type can do (§5.11). Empty for the 77 devices in a real
    // house whose plugins publish no schema, which is ordinary rather than an
    // error.
    const controls = controlsFor(d);

    return html`
      <div class="card ${d.available ? '' : 'offline'}" part="card">
        <div class="head">
          <span
            class="dot"
            part="indicator"
            ?data-on=${on === true}
            ?data-unknown=${on === undefined}
          ></span>
          <div class="body">
            <div class="name" part="name">${effectiveName(d)}</div>
            <div class="sub" part="state">${this.subtitle(d, on, level)}</div>
          </div>
        </div>
        ${
          controls.length > 0
            ? html`<hc-controls
                part="controls"
                .device=${d}
                .controls=${controls}
                .onCommand=${this.onCommand}
              ></hc-controls>`
            : nothing
        }
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
  /**
   * What to say under the name — and the question depends on what the device is
   * (§5.11).
   *
   * A device you can command reports a power state. A device you only read
   * reports its reading: `21.5 °C`, not "Off", because a thermometer cannot be
   * turned off and saying so invents a fact.
   */
  private subtitle(d: DeviceState, on: boolean | undefined, level: number | undefined) {
    if (!d.available) return 'Offline';

    // A scene that gives no feedback has no state to show. Lutron marks some
    // scenes on so you can tell when they are off; others report nothing, and
    // activating one of those is a thing you do rather than a state you read.
    if (d.device_type === 'scene' && sceneKind(d) === 'momentary') return nothing;

    if (!hasPowerState(d)) {
      const reading = readingOf(d);
      return reading === undefined ? nothing : formatReading(reading);
    }

    if (on === undefined) return nothing;
    if (on && level !== undefined) return `On · ${Math.round(level)}%`;
    return on ? 'On' : 'Off';
  }
}

registerWidget('device_tile', 'hc-device-card');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-card': HcDeviceCard;
  }
}
