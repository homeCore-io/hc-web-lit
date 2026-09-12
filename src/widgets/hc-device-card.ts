/**
 * The generic device card — `hc-device` in §7.3, and the one that must be good.
 *
 * Three devices in the reference house declare no `device_type` at all, a fifth
 * of the rest declare something no type-specific widget will ever be written
 * for (`bridge`, `gateway`, `zwave`), and the next plugin will invent a type
 * nobody has seen. So this is not a fallback — it is the base case, and the
 * type-specific widgets are refinements of it.
 *
 * **A thin specialisation of `HcLayoutShell`**, which is §7.2's claim made
 * true: the structure, the chrome rule, the row form and the styling hooks are
 * the shell's, and what is left here is what is specific to a *device* — which
 * mark, which words, and the one control a row can carry.
 *
 * Everything it shows comes from the presentation primitive (§1.1), never from
 * its own reading of attributes: `isOn` is derived per device from whichever
 * attribute the plugin publishes, and every widget that re-derived it got it
 * wrong the same way.
 */
import { isScene } from '../core/capability.js';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { controlsFor } from '../core/controls.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';
import { formatReading, hasPowerState, readingOf } from '../core/facet.js';
import { effectiveName, isOn, levelOf, sceneKind } from '../core/present.js';
import { withoutRoom } from '../core/text.js';
import { selectDevices, type SelectionContext } from '../core/selection.js';
import { icon, iconFor, metricVar } from '../design/icons.js';
import { registerWidget } from '../core/registry.js';
import { HcLayoutShell } from '../sdk/shell.js';
import { attachInspect } from './hold.js';
import './hc-controls.js';

@customElement('hc-device-card')
export class HcDeviceCard extends HcLayoutShell {
  static override styles = [
    HcLayoutShell.styles,
    css`
      /* The switch itself is the shell's (§7.2), so the card and the pill draw
         the same one. */
      .none {
        color: var(--hc-ink-muted, #8b95a4);
        font-size: var(--hc-text-caption-size, 11px);
      }
    `,
  ];

  /**
   * The device, when the host resolved one from `device_id`.
   *
   * Read through `chosen` rather than directly, because a `device_tile` in the
   * reference house does not carry `device_id` at all.
   */
  @property({ attribute: false }) device: DeviceState | undefined;

  /** The store, for a placement that selects rather than names (§5.3). */
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) override config: Record<string, unknown> = {};
  @property({ attribute: false }) context: SelectionContext = {};

  /**
   * Which device this card is about.
   *
   * **`device_id` is not the only way a placement names one.** The real house
   * stores its `device_tile` as
   *
   *     { selection_mode: "manual", device_ids: ["hue_…_42efbca0…"] }
   *
   * — the plural, because `dashboard_vocabulary`'s naming ratchet requires
   * `device_ids` for a reference *list*, and a manual selection of one is
   * still a list. `mountWidget` resolves the singular only, so that placement
   * arrived with no device and the card drew "No device" on a page somebody
   * had authored and was presumably looking at.
   *
   * Resolved with `selectDevices`, which is the primitive the sets already use
   * — a second interpretation of `selection_mode` here is how two widgets come
   * to disagree about what a document means (§5.7's reasoning, one level down).
   *
   * A tile draws one device, so a manual selection of several shows the first.
   * That is a choice worth stating: `device_grid` is the widget for many, and
   * silently drawing one of five would otherwise look like the other four had
   * gone missing.
   */
  private get chosen(): DeviceState | undefined {
    if (this.device !== undefined) return this.device;
    if (this.devices.length === 0) return undefined;
    return selectDevices(this.config, this.devices, this.context)[0];
  }
  /** The host's command sink. Absent means the card is read-only. */
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;
  /** Hold to inspect, without acting on it (§5.10). */
  @property({ attribute: false }) onDetails: ((deviceId: string) => void) | undefined;

  /**
   * One row, no inline controls.
   *
   * A `device_list` placement on the real room page is 60px tall and holds
   * thirteen devices — a card with a generated control row is 120px, so the
   * controls were there and scrolled out of sight, which looks like they are
   * missing. The shell's row form is the same idea, so this is now an alias
   * for it rather than a second flag.
   */
  @property({ type: Boolean, reflect: true }) compact = false;

  /** The room this card is shown in, if the page is scoped to one. */
  @property({ attribute: false }) room: string | undefined;

  /**
   * The switch the user moved, until the house confirms it.
   *
   * A command is accepted, not applied — the real value arrives on the stream.
   * Without this the switch snaps back under the finger for a round trip,
   * which reads as the control being broken.
   */
  @state() private pending: boolean | undefined;

  override firstUpdated(): void {
    // Hold to inspect (§5.10). On the host rather than in the template,
    // because the shell owns the markup now — and once, because the gesture
    // is the element's and not the render's.
    attachInspect(this, () => {
      const id = this.chosen?.device_id;
      if (id !== undefined) this.onDetails?.(id);
    });
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // Whatever the house says wins the moment it says it.
    if (changed.has('device')) this.pending = undefined;
    // `compact` is this widget's older word for the shell's row form. One
    // flag, two names, and the shell's is the one the structure reads.
    this.row = this.compact;
  }

  override updated(): void {
    super.updated();
    const d = this.chosen;
    this.offline = d !== undefined && !d.available;

    // The widget says what state it is in; the shell owns what a state looks
    // like. A device you only *read* is not off — it has no power state at all
    // (§1.1) — so it takes its metric's colour rather than the on/off pair,
    // and a thermometer reads as an instrument instead of a lamp left off.
    if (d === undefined) return;
    const on = isOn(d);
    const level = levelOf(d);
    if (on === true) {
      // 12% at the bottom of the dimmer, 30% at the top: enough to see, never
      // enough to make a dim lamp look off.
      const lit = level === undefined ? 24 : 12 + Math.round((Math.min(level, 100) / 100) * 18);
      this.style.setProperty('--hc-shell-colour', 'var(--hc-accent-active, #ffb661)');
      this.style.setProperty('--hc-shell-tint', `${lit}%`);
      return;
    }
    const metric = hasPowerState(d) ? undefined : metricVar(iconFor(d));
    this.style.setProperty(
      '--hc-shell-colour',
      metric === undefined ? 'var(--hc-ink-muted, #8b95a4)' : `var(${metric})`,
    );
    this.style.setProperty('--hc-shell-tint', metric === undefined ? '0%' : '14%');
  }

  protected override renderIcon() {
    return icon(iconFor(this.chosen), this.chosen !== undefined && isOn(this.chosen) === true);
  }

  protected override renderPrimary(): unknown {
    const d = this.chosen;
    if (d === undefined) return html`<span class="none">No device</span>`;
    return withoutRoom(effectiveName(d), this.room);
  }

  protected override renderSecondary(): unknown {
    const d = this.chosen;
    return d === undefined ? nothing : this.words(d);
  }

  protected override renderBadge(): unknown {
    const d = this.chosen;
    if (d === undefined) return nothing;
    const on = isOn(d);
    const level = levelOf(d);
    const power = controlsFor(d).find((c) => c.form === 'toggle' && c.key === 'on');

    // With a switch beside it, "Off" is the switch saying it twice. A dimmer's
    // level is worth the space; anything else says what it is doing.
    const words =
      this.compact && power !== undefined
        ? d.available
          ? on === true && level !== undefined
            ? `${Math.round(level)}%`
            : nothing
          : 'Offline'
        : this.compact
          ? this.words(d)
          : nothing;

    return html`${words}${this.compact ? this.toggle(d, on, power !== undefined) : nothing}`;
  }

  protected override renderControls(): unknown {
    const d = this.chosen;
    if (d === undefined || this.compact) return nothing;
    // Generated from what the plugin declared, not from what this widget
    // assumes a device type can do (§5.11). Empty for a device whose plugin
    // publishes no schema, which is ordinary rather than an error.
    const controls = controlsFor(d);
    if (controls.length === 0) return nothing;
    return html`<hc-controls
      .device=${d}
      .controls=${controls}
      .onCommand=${this.onCommand}
    ></hc-controls>`;
  }

  /**
   * The row's own switch, where the device has one to offer.
   *
   * Derived, like everything else: a writable `on` in the schema is a device
   * whose power is a state you set. A sensor gets none, because it has no
   * power state to command (§1.1), and a device whose plugin published no
   * schema gets none either — which is ordinary rather than an error.
   */
  private toggle(d: DeviceState, on: boolean | undefined, offered: boolean) {
    if (!offered) return nothing;
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

  /**
   * What to say about a device — and the question depends on what it is
   * (§5.11).
   *
   * A device you can command reports a power state. A device you only read
   * reports its reading: `21.5 °C`, not "Off", because a thermometer cannot be
   * turned off and saying so invents a fact.
   */
  private words(d: DeviceState): unknown {
    if (!d.available) return 'Offline';

    // A scene that gives no feedback has no state to show. Lutron marks some
    // scenes on so you can tell when they are off; others report nothing, and
    // activating one of those is a thing you do rather than a state you read.
    if (isScene(d) && sceneKind(d) === 'momentary') return nothing;

    if (!hasPowerState(d)) {
      const reading = readingOf(d);
      return reading === undefined ? nothing : formatReading(reading);
    }

    const on = isOn(d);
    if (on === undefined) return nothing;
    const level = levelOf(d);
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
