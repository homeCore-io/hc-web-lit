/**
 * A keypad, a Pico, a VCRX — `keypad` (§7.3).
 *
 * **The worked example of why P10 exists.** Two device families, one widget,
 * and every difference between them is data the plugin declared:
 *
 * - a Lutron keypad publishes `available_buttons` as `[{name, number}]` with
 *   the engraving from the wall — "OH Door 1", "Lights" — and declares
 *   `press_button`, so its buttons are pressable;
 * - a Caséta Pico publishes `[2, 3, 4, 5, 6]` and declares **no actions at
 *   all**, because it transmits and cannot be pressed remotely.
 *
 * Nothing here knows any of that. The buttons come from the action's own
 * `options_from`, which binds a parameter to a live attribute of the same
 * device (§5.11), so a bridge that renames a button renames it here; and a
 * device that declares no `press_button` gets a list rather than controls,
 * because the declaration is the whole answer to "can this be pressed".
 *
 * LEDs are the same story from the other side: `led_N` is a reading, and a
 * keypad that reports one shows which button is lit.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { optionsForParam } from '../core/controls.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';
import { effectiveName } from '../core/present.js';
import { registerForDevice, registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';
import { icon } from '../design/icons.js';

/** One button, as the device describes it. */
interface Key {
  value: string;
  label: string;
  /** Whether the device reports this one lit. */
  lit: boolean;
}

@customElement('hc-keypad')
export class HcKeypad extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .card {
      display: grid;
      gap: 0.75rem;
      padding: var(--hc-density-card-padding, 14px);
      /* The same chrome hooks a shell widget reads (§5.8), so a set can take
         the box away from this one too. It does not extend the shell — it
         draws a panel of keys rather than a headline and a control row — but
         "who owns the surface" is a question about composition, and it gets
         the same answer whatever the widget is made of. */
      border-radius: var(--hc-shell-radius, var(--hc-radius-md, 14px));
      border: var(
        --hc-shell-edge,
        var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38)
      );
      background: var(--hc-shell-surface, var(--hc-surface-raised, #141922));
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    /* **In a set, a keypad is a row like everything else.** Its keys are the
       point of a placement that names one device; in a list of what is in a
       room they are twenty rows that push the room off the screen — the living
       room has three of these and they came to four hundred pixels of buttons
       under a heading about how the room is wired. The name and what was last
       pressed is what a list wants, and holding it still opens the whole
       thing. */
    :host([data-row]) {
      height: auto;
      overflow: visible;
    }
    :host([data-row]) .card {
      display: flex;
      align-items: center;
      min-height: var(--hc-density-row-height, 44px);
      padding: 0 calc(var(--hc-space-unit, 8px) * 1.25);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }
    .tile {
      flex: none;
      display: grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink-muted, #8b95a4);
    }
    .tile svg {
      width: 1.25rem;
      height: 1.25rem;
    }
    .lines {
      min-width: 0;
      display: grid;
      gap: 0.125rem;
      flex: 1 1 auto;
    }
    .name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sub {
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
    }
    .keys {
      display: grid;
      gap: 0.375rem;
    }
    .key {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 calc(var(--hc-space-unit, 8px) * 1.25);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      text-align: left;
      transition: border-color var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
    }
    button.key {
      cursor: pointer;
    }
    button.key:hover {
      border-color: color-mix(in srgb, var(--hc-accent-active, #ffb661) 45%, transparent);
    }
    button.key:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    /* The LED the device reports, not a state this widget invented. */
    .led {
      flex: none;
      width: 0.5rem;
      height: 0.5rem;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-accent-inactive, #2a313b);
    }
    .led[data-lit] {
      background: var(--hc-accent-active, #ffb661);
      box-shadow: 0 0 var(--hc-glow-radius, 6px) var(--hc-accent-active, #ffb661);
    }
    .label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  /** In a set, where the room is the subject and this is one line of it. */
  @property({ type: Boolean, reflect: true, attribute: 'data-row' }) row = false;

  override render() {
    const d = this.device;
    if (d === undefined) return html`<div class="empty" part="empty">No device</div>`;

    // The declaration, not the attribute: `press_button` binds its parameter
    // to a live attribute of this device, so the labels are the bridge's.
    const press = (d.schema?.actions ?? []).find((a) => a.id === 'press_button');
    const keys = this.keys(d, press);

    return html`<div class="card" part="card">
      <div class="head" part="head">
        <span class="tile" part="indicator">${icon('remote')}</span>
        <span class="lines">
          <span class="name" part="name">${effectiveName(d)}</span>
          <span class="sub" part="state"
            >${this.subtitle(d, press !== undefined, keys.length)}</span
          >
        </span>
      </div>
      ${
        keys.length === 0 || this.row
          ? nothing
          : html`<div class="keys" part="set">
              ${keys.map((k) => this.key(d, k, press !== undefined))}
            </div>`
      }
    </div>`;
  }

  /**
   * What the device says its buttons are.
   *
   * Through `optionsForParam`, which resolves the action's declared
   * `options_from` against this device — the same path the generated control
   * row uses. A Pico declares no action, so its buttons come from the
   * attribute directly: it still *has* five buttons, it simply cannot be told
   * to press one.
   */
  private keys(d: DeviceState, press: { params?: unknown[] } | undefined): Key[] {
    const param = (press?.params ?? [])[0];
    const declared =
      param === undefined ? [] : optionsForParam(d, param as Parameters<typeof optionsForParam>[1]);

    const raw = declared.length > 0 ? declared : this.fromAttribute(d);
    const renames = d.attributes['button_names'];

    return raw.map((o) => {
      // The user's rename wins over the bridge's engraving, which wins over
      // "Button 3" — the order §7.3 gives, and each step is somebody being
      // more specific than the last.
      const named =
        typeof renames === 'object' && renames !== null
          ? (renames as Record<string, unknown>)[o.value]
          : undefined;
      return {
        value: o.value,
        label: typeof named === 'string' && named !== '' ? named : o.label,
        lit: d.attributes[`led_${o.value}`] === 1 || d.attributes[`led_${o.value}`] === true,
      };
    });
  }

  /** A device with no declared action still lists its buttons. */
  private fromAttribute(d: DeviceState): { value: string; label: string }[] {
    const raw = d.attributes['available_buttons'];
    if (!Array.isArray(raw)) return [];
    return raw.map((b) => {
      if (typeof b === 'number' || typeof b === 'string') {
        return { value: String(b), label: `Button ${String(b)}` };
      }
      const o = b as { name?: unknown; number?: unknown };
      const value = String(o.number ?? '');
      return {
        value,
        label: typeof o.name === 'string' && o.name !== '' ? o.name : `Button ${value}`,
      };
    });
  }

  private subtitle(d: DeviceState, pressable: boolean, count: number) {
    const last = d.attributes['last_button_name'];
    if (typeof last === 'string' && last !== '') return `Last pressed ${last}`;
    if (!pressable) {
      // Not a failure and not a missing feature: a remote transmits. Saying so
      // is better than showing buttons that quietly do nothing.
      return count === 0 ? 'No buttons reported' : 'Sends only';
    }
    return `${count} ${count === 1 ? 'button' : 'buttons'}`;
  }

  private key(d: DeviceState, k: Key, pressable: boolean) {
    const led = html`<span class="led" ?data-lit=${k.lit}></span>`;
    if (!pressable) {
      return html`<div class="key" part="row">${led}<span class="label">${k.label}</span></div>`;
    }
    return html`<button
      class="key"
      part="action"
      title=${humanise(`press ${k.label}`)}
      @click=${() =>
        this.onCommand?.({
          deviceId: d.device_id,
          action: { id: 'press_button', params: { button: k.value } },
        })}
    >
      ${led}<span class="label">${k.label}</span>
    </button>`;
  }
}

registerWidget('keypad', 'hc-keypad');

// A set containing one draws this rather than a generic card with the whole
// schema on it (§7.2).
registerForDevice('keypad', 'hc-keypad');
registerForDevice('pico_remote', 'hc-keypad');
registerForDevice('vcrx', 'hc-keypad');

declare global {
  interface HTMLElementTagNameMap {
    'hc-keypad': HcKeypad;
  }
}
