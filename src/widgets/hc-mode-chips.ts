/**
 * The house's modes — `mode_day`, `mode_night` and whatever else `core.mode`
 * provides.
 *
 * Five placements across the real dashboards, and the config is empty on every
 * one: a mode row shows the modes, and there is nothing to select. So the
 * selection is "devices from the mode plugin", which is the one place a plugin
 * id is the right thing to match on — modes are core's own concept, not a
 * device type somebody might reuse.
 *
 * A solar mode carries when it turns over: `effective_on` 06:41,
 * `effective_off` 19:29. Showing that is the difference between a chip that
 * says "Night" and one that tells you night ends at 06:41.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { effectiveName, isOn } from '../core/present.js';
import type { CommandRequest } from '../core/widget.js';
import { registerWidget } from '../core/registry.js';

/**
 * The mode provider's id, **both spellings**.
 *
 * A device from the Caséta plugin reports `plugin_id: "plugin.caseta"`; a mode
 * device reports `"core.mode"`, with no prefix. Core's own providers are not
 * prefixed the way installed plugins are, and matching only the prefixed form
 * is why this widget said "No modes." on a house with two.
 */
const MODE_PLUGINS = new Set(['core.mode', 'plugin.core.mode']);

@customElement('hc-mode-chips')
export class HcModeChips extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: calc(var(--hc-space-unit, 8px) * 0.75);
      align-items: center;
    }
    .chip {
      display: inline-flex;
      align-items: baseline;
      gap: 0.4rem;
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 calc(var(--hc-space-unit, 8px) * 1.25);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
    }
    .chip[data-on] {
      background: var(--hc-accent-active, #ffb661);
      color: var(--hc-accent-on-primary, #06131f);
      border-color: transparent;
    }
    .when {
      font-size: var(--hc-text-caption-size, 11px);
      opacity: 0.75;
      font-variant-numeric: tabular-nums;
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  override render() {
    const modes = this.devices.filter((d) => MODE_PLUGINS.has(d.plugin_id));
    if (modes.length === 0) return html`<div class="empty" part="empty">No modes.</div>`;

    return html`<div class="row" part="row">
      ${modes.map((m) => {
        const on = isOn(m) === true;
        return html`<span class="chip" part="chip" ?data-on=${on}>
          <span>${effectiveName(m)}</span>
          ${this.turnover(m, on)}
        </span>`;
      })}
    </div>`;
  }

  /**
   * When it turns over, for a mode that knows.
   *
   * A `solar` mode has real times; a `boolean` one is switched by a rule and
   * has nothing to say. Showing "until 06:41" on the mode that is on, and
   * "from" on the one that is off, is the reading somebody wants: not which
   * mode it is — the highlight already says that — but when it changes.
   */
  private turnover(m: DeviceState, on: boolean) {
    const at = on ? m.attributes['effective_off'] : m.attributes['effective_on'];
    if (typeof at !== 'string' || at === '') return nothing;
    return html`<span class="when">${on ? 'until' : 'from'} ${at}</span>`;
  }
}

registerWidget('mode_chips', 'hc-mode-chips');

declare global {
  interface HTMLElementTagNameMap {
    'hc-mode-chips': HcModeChips;
  }
}
