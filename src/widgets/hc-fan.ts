/**
 * A fan — `fan` ×4 (§7.3).
 *
 * §7.3 asks for "percentage slider, named speeds", and the reference house
 * says which of those is the real control. All four fans declare **both**:
 *
 *     speed      enum  ["off", "low", "medium", "medium-high", "high"]
 *     speed_pct  int   0–100
 *
 * and a fan on `medium` reads `speed_pct: 50.6`. That number is derived from
 * the named speed, not the other way round — the hardware has four steps, and
 * 50.6 is what four steps produce. So the named speeds are the control and the
 * percentage is a reading.
 *
 * **A slider here would be the generated-control mistake.** §7.2's rule builds
 * a control per writable attribute by kind, which turns `speed_pct` into a
 * continuous 0–100 slider: 101 positions for a device with four, most of them
 * landing on a value it cannot hold and will round away from. That is exactly
 * the case §7.2 means by "a type-specific widget overrides that where it can
 * do better" — and the improvement is not a nicer slider, it is knowing that
 * the slider was never the right shape.
 *
 * **The speed names are the plugin's, never a table here.** `low` and
 * `medium-high` are what this bridge calls them; another will say something
 * else, and a client that mapped them to its own vocabulary would be wrong on
 * the second plugin. They are read from `options` and humanised for display
 * only (§1.1 — the naming ratchet applies to what is sent, not to what is
 * shown).
 *
 * A fan with no declared `speed` enum — a plugin that only exposes a
 * percentage — falls back to the generated controls, which is the right answer
 * rather than a special case: the schema said what it has.
 */
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';
import { effectiveName, isOn, levelOf } from '../core/present.js';
import { registerForDevice, registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';
import { icon } from '../design/icons.js';
import { HcLayoutShell } from '../sdk/shell.js';

@customElement('hc-fan')
export class HcFan extends HcLayoutShell {
  static override styles = [
    HcLayoutShell.styles,
    css`
      .speeds {
        display: flex;
        gap: 0.25rem;
        flex-wrap: wrap;
      }
      button {
        flex: 1 1 auto;
        min-height: var(--hc-density-min-tap, 44px);
        min-width: 3.5rem;
        padding: 0 calc(var(--hc-space-unit, 8px));
        border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
        border-radius: var(--hc-radius-sm, 8px);
        background: var(--hc-surface-sunken, #0d1116);
        color: var(--hc-ink-muted, #8b95a4);
        font: inherit;
        font-size: var(--hc-text-body-small-size, 12.5px);
        cursor: pointer;
        transition:
          background var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out),
          color var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out);
      }
      button[aria-pressed='true'] {
        background: color-mix(in srgb, var(--hc-accent-active, #ffb661) 22%, transparent);
        border-color: color-mix(in srgb, var(--hc-accent-active, #ffb661) 45%, transparent);
        color: var(--hc-ink, #e9edf2);
      }
      button:focus-visible {
        outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
        outline-offset: 2px;
      }
      /* One line in a row, where thirteen of these are scanned not read. */
      :host([data-row]) .speeds {
        flex-wrap: nowrap;
      }
      :host([data-row]) button {
        min-width: 2.5rem;
      }
      /* **A named speed is an enum, and a narrow row gets the enum's control.**
         Five segmented buttons need about two hundred pixels and a row in a
         two-column set has about two hundred and fifty for everything — so
         "Off / Low / Medium / Medium high / High" grew straight through the
         fan's own name. A select is the control §5.11 names for the kind, it
         says which speed is set, and it is the same width whatever the plugin
         called the speeds. */
      select {
        max-width: 8rem;
        padding: 0 0.25rem;
        border-radius: var(--hc-radius-xs, 6px);
        border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
        background: var(--hc-surface-sunken, #0d1116);
        color: var(--hc-ink, #e9edf2);
        font: inherit;
        font-size: var(--hc-text-caption-size, 11px);
        height: var(--hc-density-min-tap, 44px);
      }
      select:focus-visible {
        outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
        outline-offset: 2px;
      }
    `,
  ];

  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  /** The speeds this fan says it has, in the order it lists them. */
  private get speeds(): string[] {
    const declared = this.device?.schema?.attributes?.['speed'];
    const options = declared?.options;
    return Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string') : [];
  }

  private get current(): string | undefined {
    const v = this.device?.attributes?.['speed'];
    return typeof v === 'string' ? v : undefined;
  }

  protected override renderIcon() {
    return icon('fan');
  }

  protected override renderPrimary() {
    return this.device === undefined ? 'Fan' : effectiveName(this.device);
  }

  protected override renderSecondary() {
    const speed = this.current;
    if (speed !== undefined) return humanise(speed);
    // No named speed: say what is actually known rather than nothing.
    const on = this.device === undefined ? undefined : isOn(this.device);
    return on === undefined ? nothing : on ? 'On' : 'Off';
  }

  protected override renderBadge() {
    // The percentage is a reading here, not the control — shown because it is
    // the number somebody compares two fans by, and `levelOf` is the host
    // primitive that knows a fan publishes `speed_pct` (§1.1).
    const level = this.device === undefined ? undefined : levelOf(this.device);
    return level === undefined ? nothing : `${Math.round(level)}%`;
  }

  protected override renderControls() {
    const speeds = this.speeds;
    if (speeds.length === 0 || this.device === undefined) return nothing;
    const current = this.current;

    // Narrow by construction: a set draws rows, and a row has room for one
    // control rather than one per option.
    if (this.row) {
      return html`<select
        part="controls"
        aria-label="Speed"
        .value=${current ?? ''}
        @click=${(e: Event) => e.stopPropagation()}
        @change=${(e: Event) => {
          e.stopPropagation();
          this.set((e.target as HTMLSelectElement).value);
        }}
      >
        ${speeds.map(
          (s) => html`<option value=${s} ?selected=${s === current}>${humanise(s)}</option>`,
        )}
      </select>`;
    }

    return html`<div class="speeds" part="controls">
      ${speeds.map(
        (s) =>
          html`<button
            part="action"
            aria-pressed=${s === current ? 'true' : 'false'}
            @click=${(e: Event) => {
              // The card behind this carries a tap of its own (§5.10); a press
              // on a speed is not also a press on the card.
              e.stopPropagation();
              this.set(s);
            }}
          >
            ${humanise(s)}
          </button>`,
      )}
    </div>`;
  }

  private set(speed: string): void {
    const id = this.device?.device_id;
    if (id === undefined) return;
    // The plugin's own word, sent back unchanged. `humanise` is for the label.
    this.onCommand?.({ deviceId: id, patch: { speed } });
  }

  override updated(): void {
    super.updated();
    const on = this.device === undefined ? undefined : isOn(this.device);
    const level = this.device === undefined ? undefined : levelOf(this.device);
    this.style.setProperty('--hc-shell-colour', 'var(--hc-accent-active, #ffb661)');
    // Lit in proportion to how hard it is running, which is what a fan's tile
    // should say at a glance across a row of four.
    this.style.setProperty(
      '--hc-shell-tint',
      on === true ? `${Math.max(18, Math.round((level ?? 100) * 0.4))}%` : '0%',
    );
  }
}

registerWidget('fan', 'hc-fan');
registerForDevice('fan', 'hc-fan');

declare global {
  interface HTMLElementTagNameMap {
    'hc-fan': HcFan;
  }
}
