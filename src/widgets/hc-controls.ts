/**
 * The generated control row (§7.2, §5.11).
 *
 * Draws whatever `controlsFor` produced and nothing else. It knows about
 * *kinds* — a bool is a toggle, an integer with a range is a slider — and
 * nothing about lights, fans or keypads, which is the point: a device type
 * nobody wrote a widget for still gets its controls.
 *
 * **Commands go out through a callback, never through the API client.** A
 * widget does not hold a token, a base URL or a socket (§19.4); the host does,
 * and this is the seed of `ctx.call` (§4.2). It also means the host is the
 * single place a safety policy could refuse an actuation (§5.10, §11.3) rather
 * than each widget being trusted to.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { optionLabel } from '../core/api.js';
import type { Control } from '../core/controls.js';
import { optionsForParam } from '../core/controls.js';
import type { DeviceState } from '../core/device.js';
import './hc-slider.js';
import './hc-colour-wheel.js';

/** What the host is asked to do. Data, so it can be logged, queued or refused. */
export interface CommandRequest {
  deviceId: string;
  /** An attribute write. */
  patch?: Record<string, unknown>;
  /** An action, with its declared parameters. */
  action?: { id: string; params: Record<string, unknown> };
}

@customElement('hc-controls')
export class HcControls extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    .row {
      display: grid;
      gap: calc(var(--hc-space-unit, 8px) * 0.75);
    }
    .control {
      display: grid;
      grid-template-columns: minmax(0, 7rem) 1fr;
      align-items: center;
      gap: calc(var(--hc-space-unit, 8px));
      min-height: var(--hc-density-control-height, 44px);
    }
    label {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    button {
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 calc(var(--hc-space-unit, 8px) * 1.5);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      cursor: pointer;
      transition: background var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
    }
    /* A wash and a lit border, for the reason a scene chip gets one: an
       attribute that is on is a state the house is in, and a slab of accent
       reads as the primary button on the page — a louder claim than the one
       being made. */
    button[aria-pressed='true'] {
      background: color-mix(in srgb, var(--hc-accent-active, #ffb661) 18%, transparent);
      border-color: color-mix(in srgb, var(--hc-accent-active, #ffb661) 55%, transparent);
      color: var(--hc-ink, #e9edf2);
    }
    button:hover:not(:disabled) {
      border-color: color-mix(in srgb, var(--hc-accent-active, #ffb661) 40%, transparent);
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    input[type='range'] {
      width: 100%;
      accent-color: var(--hc-accent-active, #ffb661);
      min-height: var(--hc-density-min-tap, 44px);
    }
    select {
      min-height: var(--hc-density-control-height, 44px);
      background: var(--hc-surface-sunken, #0d1116);
      color: inherit;
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      font: inherit;
      padding: 0 0.5rem;
    }
    .value {
      font-variant-numeric: tabular-nums;
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      min-width: 3.5rem;
      text-align: right;
    }
    /* A drawn control brings its own label and value, so it takes the row. */
    .control.wide {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.5rem;
    }
    hc-colour-wheel {
      max-width: 12rem;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .unsupported {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ attribute: false }) controls: Control[] = [];
  /** The host's command sink. Absent means read-only, and controls say so. */
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  /**
   * Values the user has moved but the house has not confirmed yet.
   *
   * A command is accepted (202), not applied — the real value arrives on the
   * event stream. Without this a slider snaps back under the finger for the
   * length of a round trip, which reads as the control being broken.
   */
  @state() private pending: Record<string, unknown> = {};

  override willUpdate(changed: Map<string, unknown>): void {
    // Whatever the house says wins the moment it says it.
    if (changed.has('device')) this.pending = {};
  }

  private send(r: CommandRequest): void {
    this.onCommand?.(r);
  }

  private write(key: string, value: unknown): void {
    const id = this.device?.device_id;
    if (id === undefined) return;
    this.pending = { ...this.pending, [key]: value };
    this.send({ deviceId: id, patch: { [key]: value } });
  }

  private current(key: string, live: unknown): unknown {
    return key in this.pending ? this.pending[key] : live;
  }

  override render() {
    if (this.controls.length === 0) return nothing;
    const readOnly = this.onCommand === undefined;

    return html`
      <div class="row" part="controls">${this.controls.map((c) => this.draw(c, readOnly))}</div>
    `;
  }

  private draw(c: Control, readOnly: boolean) {
    switch (c.form) {
      case 'toggle': {
        const on = this.current(c.key, c.value) === true;
        return html`<div class="control">
          <label>${c.label}</label>
          <div>
            <button
              part="toggle"
              aria-pressed=${on ? 'true' : 'false'}
              ?disabled=${readOnly}
              @click=${() => this.write(c.key, !on)}
            >
              ${capitalise(on ? (c.onLabel ?? 'On') : (c.offLabel ?? 'Off'))}
            </button>
          </div>
        </div>`;
      }

      case 'slider':
      case 'colorTemp':
        // The drawn track, not a range input. `hc-slider` already carries the
        // label, the live value, the held-until-confirmed behaviour and the
        // cool fill a colour temperature wants — and it is what the room page
        // shows two inches away, so a generated control that looked different
        // would be the same control drawn two ways.
        return html`<div class="control wide">
          <hc-slider
            part="slider"
            .config=${{ attribute: c.key, label: c.label, min: c.min, max: c.max }}
            .device=${this.device}
            .onCommand=${readOnly ? undefined : this.onCommand}
          ></hc-slider>
        </div>`;

      case 'color':
        // Declared, and now drawn: the wheel the SETS panel uses.
        return html`<div class="control wide">
          <label>${c.label}</label>
          <hc-colour-wheel
            part="colour"
            .config=${{ attribute: c.key }}
            .device=${this.device}
            .onCommand=${readOnly ? undefined : this.onCommand}
          ></hc-colour-wheel>
        </div>`;

      case 'select':
        return html`<div class="control">
          <label>${c.label}</label>
          <select
            part="select"
            ?disabled=${readOnly}
            @change=${(e: Event) => this.write(c.key, (e.target as HTMLSelectElement).value)}
          >
            ${c.options.map(
              (o) =>
                html`<option value=${o.value} ?selected=${o.value === this.current(c.key, c.value)}>
                  ${optionLabel(o)}
                </option>`,
            )}
          </select>
        </div>`;

      case 'action': {
        // A parameterised action needs a picker per parameter, and the options
        // come from the device itself (§5.11). Nothing here knows what a
        // keypad is; it reads what the plugin bound the parameter to.
        const params = c.action.params ?? [];
        return html`<div class="control">
          <label>${c.label}</label>
          <div class="actions">
            ${
              params.length === 0
                ? html`<button
                    part="action"
                    ?disabled=${readOnly}
                    @click=${() =>
                      this.device !== undefined &&
                      this.send({
                        deviceId: this.device.device_id,
                        action: { id: c.action.id, params: {} },
                      })}
                  >
                    ${c.action.label}
                  </button>`
                : params.map((p) => {
                    const options = this.device ? optionsForParam(this.device, p) : [];
                    return options.map(
                      (o) =>
                        html`<button
                          part="action"
                          ?disabled=${readOnly}
                          title=${c.action.sentence ?? c.action.label}
                          @click=${() =>
                            this.device !== undefined &&
                            this.send({
                              deviceId: this.device.device_id,
                              action: { id: c.action.id, params: { [p.name]: o.value } },
                            })}
                        >
                          ${o.label}
                        </button>`,
                    );
                  })
            }
          </div>
        </div>`;
      }

      case 'text':
        // Declared, but no control here yet. Saying so is better than a broken
        // one, and better than silence — the device does offer it.
        return html`<div class="control">
          <label>${c.label}</label>
          <span class="unsupported">no control yet</span>
        </div>`;
    }
  }
}

/**
 * A device's own word, as a label reads.
 *
 * `states.when_false.label` is `"off"` on a Hue light — a value, spelled the way
 * a value is spelled. A button is a label, so it gets a label's capital, and the
 * device still supplies the word.
 */
const capitalise = (s: string): string => s.replace(/^./, (c) => c.toUpperCase());

declare global {
  interface HTMLElementTagNameMap {
    'hc-controls': HcControls;
  }
}
