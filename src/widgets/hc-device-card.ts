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
import { withoutRoom } from '../core/text.js';
import type { CommandRequest } from './hc-controls.js';
import './hc-controls.js';
import { icon, iconFor, metricVar } from '../design/icons.js';
import { inspect } from './hold.js';
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
      /* How lit the tile is, from the device's own level: a lamp at 10% reads
         dimmer than one at 100%, which is the style carrying real information
         rather than decorating over it.

         Zero by default, so an idle tile is the sunken surface and the mark is
         legible muted ink. The inactive accent is nearly the background, and
         painting an off icon in it makes the row a name and a smudge. */
      --tile-tint: 0%;
      --tile-colour: var(--hc-ink-muted, #8b95a4);
    }
    .card[data-on] {
      --tile-colour: var(--hc-accent-active, #ffb661);
    }

    /* A list row: a mark, a name, and the state at the far edge, on one line
       so thirteen of them can be scanned rather than read. */
    :host([compact]) .card {
      gap: 0;
      display: flex;
      align-items: center;
      box-sizing: border-box;
      height: 100%;
      min-height: var(--hc-density-row-height, 44px);
      padding: 0 calc(var(--hc-space-unit, 8px) * 1.25);
      border-radius: var(--hc-radius-md, 14px);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
      transition:
        background var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out),
        border-color var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
    }
    :host([compact]) .card:hover {
      background: var(--hc-surface-overlay, #1b2230);
      border-color: color-mix(in srgb, var(--tile-colour) 35%, transparent);
    }

    /* The mark, in a tile that carries the state. */
    .tile {
      flex: none;
      display: grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: var(--hc-radius-sm, 8px);
      background: color-mix(
        in srgb,
        var(--tile-colour) var(--tile-tint),
        var(--hc-surface-sunken, #0d1116)
      );
      color: var(--tile-colour);
      transition:
        background var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out),
        color var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out);
    }
    .card[data-on] .tile {
      box-shadow: 0 0 var(--hc-glow-radius, 0px)
        color-mix(in srgb, var(--tile-colour) 45%, transparent);
    }
    .tile svg {
      width: 1.25rem;
      height: 1.25rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
      flex: 1;
    }
    .body {
      min-width: 0;
      display: grid;
      gap: 0.125rem;
      flex: 1;
    }
    .name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sub {
      font-size: var(--hc-text-body-small-size, 12.5px);
      color: var(--hc-ink-muted, #8b95a4);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* On a row the state sits at the far edge, where a column of them lines
       up; in a card it sits under the name, where there is room. */
    :host([compact]) .body {
      display: block;
    }
    :host([compact]) .sub {
      display: none;
    }
    .trail {
      flex: none;
      font-size: var(--hc-text-body-small-size, 12.5px);
      color: var(--hc-ink-muted, #8b95a4);
      font-variant-numeric: tabular-nums;
      margin-left: 0.75rem;
    }
    .card[data-on] .trail {
      color: var(--hc-ink, #e9edf2);
    }
    :host(:not([compact])) .trail {
      display: none;
    }
    .offline {
      opacity: 0.45;
    }
  `;

  @property({ attribute: false }) device: DeviceState | undefined;
  /** The host's command sink. Absent means the card is read-only. */
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;
  /** Hold to inspect, without acting on it (§5.10). */
  @property({ attribute: false }) onDetails: ((deviceId: string) => void) | undefined;

  /**
   * One row, no inline controls.
   *
   * A `device_list` placement on the real room page is 60px tall and holds
   * thirteen devices in 420px — 32px each. A card with a generated control row
   * is 120px, so the controls were there and scrolled out of sight, which
   * looks like they are missing. A list row is a row; controls belong where
   * there is room for them, and on a tap once §5.6's overlay exists.
   */
  @property({ type: Boolean }) compact = false;

  /** The room this card is shown in, if the page is scoped to one. */
  @property({ attribute: false }) room: string | undefined;

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
      <div
        class="card ${d.available ? '' : 'offline'}"
        part="card"
        ?data-on=${on === true}
        style=${tileStyle(d, on, level)}
        ${inspect(() => this.onDetails?.(d.device_id))}
      >
        <div class="head">
          <span class="tile" part="indicator">${icon(iconFor(d))}</span>
          <div class="body">
            <div class="name" part="name">${withoutRoom(effectiveName(d), this.room)}</div>
            <div class="sub" part="state">${this.subtitle(d, on, level)}</div>
          </div>
          <span class="trail" part="trailing">${this.subtitle(d, on, level)}</span>
        </div>
        ${
          !this.compact && controls.length > 0
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

/**
 * The tile's colour and how strongly it is lit.
 *
 * A device you only read is not off — it has no power state at all (§1.1) — so
 * it takes its metric's colour rather than the on/off pair, and a thermometer
 * reads as an instrument instead of as a lamp somebody left off.
 */
function tileStyle(d: DeviceState, on: boolean | undefined, level: number | undefined): string {
  const parts: string[] = [];
  if (on === true) {
    // 12% at the bottom of the dimmer, 30% at the top: enough to see, never
    // enough to make a dim lamp look off.
    const lit = level === undefined ? 24 : 12 + Math.round((Math.min(level, 100) / 100) * 18);
    parts.push(`--tile-tint:${lit}%`);
  } else if (!hasPowerState(d)) {
    const metric = metricVar(iconFor(d));
    if (metric !== undefined) parts.push(`--tile-colour:var(${metric})`, '--tile-tint:14%');
  }
  return parts.join(';');
}
