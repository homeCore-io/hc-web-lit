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
import { customElement, property, state } from 'lit/decorators.js';
import { controlsFor } from '../core/controls.js';
import type { DeviceState } from '../core/device.js';
import { formatReading, hasPowerState, readingOf } from '../core/facet.js';
import { effectiveName, isOn, levelOf, sceneKind } from '../core/present.js';
import { wantsChrome } from '../core/compose.js';
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
    /* Chrome, unless something else is already providing it (§5.5). A card
       inside a stack that draws its own border is the double border every
       "in-card" community card exists to suppress. */
    :host([data-nested]) .card,
    :host([data-nested][compact]) .card {
      padding: 0;
      border: 0;
      background: transparent;
    }
    .card {
      display: grid;
      align-content: start;
      gap: 0.75rem;
      /* A card is a surface. It had none outside compact mode, so a set of
         them drew transparently over each other and over whatever was behind
         — which looked like widgets escaping their placements and was really
         a card with no background. §5.5's chrome rule is about a *nested*
         widget; the outermost one carries its own. */
      box-sizing: border-box;
      padding: var(--hc-density-card-padding, 14px);
      border-radius: var(--hc-radius-md, 14px);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
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
      /* Toward the skin's own ink, which helps in both directions: on a dark
         skin the ink is light and the mark lifts off its tile, on a light one
         the ink is dark and the mark deepens. Measured at 3.01 against a lit
         tile in soft_home before this, which passes and is one rounding away
         from not. */
      color: color-mix(in srgb, var(--tile-colour) 85%, var(--hc-ink, #e9edf2));
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
    /* The row's own control, for the reason the working client has one: a
       list of switches you cannot switch is a list of labels. Only the primary
       one — a light's power, not its colour — because a row is a row and the
       rest of the schema belongs in the sheet behind a hold (§7.2). */
    .switch {
      flex: none;
      position: relative;
      width: 2.75rem;
      height: 1.6rem;
      margin-left: 0.75rem;
      padding: 0;
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-sunken, #0d1116);
      cursor: pointer;
      transition: background var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
    }
    .switch[aria-pressed='true'] {
      background: var(--hc-accent-active, #ffb661);
      border-color: transparent;
    }
    .switch:disabled {
      cursor: default;
      opacity: 0.5;
    }
    .switch:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .thumb {
      position: absolute;
      top: 50%;
      left: 0.18rem;
      width: 1.15rem;
      height: 1.15rem;
      border-radius: 50%;
      background: var(--hc-ink-muted, #8b95a4);
      transform: translate(0, -50%);
      transition: transform var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
    }
    .switch[aria-pressed='true'] .thumb {
      background: var(--hc-accent-on-primary, #06131f);
      transform: translate(1.05rem, -50%);
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

  /** Inside a container, so it draws no chrome of its own (§5.5). */
  @property({ attribute: false }) nested = false;

  override updated(): void {
    // Reflected so the rule above can be pure CSS, and so a theme can see it.
    this.toggleAttribute('data-nested', wantsChrome(this.config, this.nested) === false);
  }

  /** A card in a set takes no config of its own; a placed one may. */
  @property({ attribute: false }) config: Record<string, unknown> = {};

  /**
   * The switch the user moved, until the house confirms it.
   *
   * A command is accepted, not applied — the real value arrives on the stream.
   * Without this the switch snaps back under the finger for a round trip,
   * which reads as the control being broken.
   */
  @state() private pending: boolean | undefined;

  override willUpdate(changed: Map<string, unknown>): void {
    // Whatever the house says wins the moment it says it.
    if (changed.has('device')) this.pending = undefined;
  }

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
          <span class="trail" part="trailing">${this.trailing(d, on, level)}</span>
          ${this.toggle(d, on)}
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
   * The row's own switch, where the device has one to offer.
   *
   * Derived, like everything else: a writable `on` in the schema is a device
   * whose power is a state you set, and nothing here knows what a light is. A
   * sensor gets none, because it has no power state to command (§1.1), and a
   * device whose plugin published no schema gets none either — which is
   * ordinary rather than an error.
   */
  private toggle(d: DeviceState, on: boolean | undefined) {
    if (!this.compact) return nothing;
    const power = controlsFor(d).find((c) => c.form === 'toggle' && c.key === 'on');
    if (power === undefined) return nothing;

    const next = !(this.pending ?? on ?? false);
    return html`<button
      class="switch"
      part="toggle"
      role="switch"
      aria-pressed=${String(this.pending ?? on ?? false)}
      aria-label=${`${effectiveName(d)} power`}
      ?disabled=${this.onCommand === undefined}
      @click=${(e: Event) => {
        // The row is held to inspect and tapped to pick; the switch is its own
        // target and must not do either as well.
        e.stopPropagation();
        this.pending = next;
        this.onCommand?.({ deviceId: d.device_id, patch: { on: next } });
      }}
    >
      <span class="thumb"></span>
    </button>`;
  }

  /** What sits at the end of a row: the level, or the state in words. */
  private trailing(d: DeviceState, on: boolean | undefined, level: number | undefined) {
    // With a switch beside it, "Off" is the switch saying it twice. A dimmer's
    // level is worth the space; anything else says what it is doing.
    const hasSwitch =
      this.compact && controlsFor(d).some((c) => c.form === 'toggle' && c.key === 'on');
    if (!hasSwitch) return this.subtitle(d, on, level);
    if (!d.available) return 'Offline';
    return on === true && level !== undefined ? `${Math.round(level)}%` : nothing;
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
