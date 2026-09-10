/**
 * `stepper` — a number, changed a step at a time.
 *
 * The control for a value somebody nudges rather than drags: a volume, a
 * setpoint, a brightness on a panel where a slider under a thumb is a value
 * nobody meant. Two buttons and a reading.
 *
 * **The bounds are the plugin's, not the config's.** A step past `max` is a
 * command core will refuse, so the button that would send it is disabled
 * instead — §5.10's rule about not offering what cannot happen, applied to a
 * number. The step is the declared one where there is one, because a device
 * that moves in halves should not be nudged in whole units.
 */
import { css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { quantity } from '../core/i18n.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';
import { roleColor } from '../design/roles.js';
import { HcBoundControl } from './bound.js';

@customElement('hc-stepper')
export class HcStepper extends HcBoundControl {
  static override styles = css`
    :host {
      display: block;
      min-width: 0;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-height: var(--hc-density-min-tap, 44px);
    }
    button {
      flex: none;
      width: var(--hc-density-min-tap, 44px);
      height: var(--hc-density-min-tap, 44px);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-md, 12px);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      font-size: var(--hc-text-title-size, 18px);
      line-height: 1;
      cursor: pointer;
    }
    button[disabled] {
      opacity: 0.35;
      cursor: default;
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .middle {
      flex: 1;
      display: grid;
      justify-items: center;
      min-width: 0;
    }
    .value {
      font-variant-numeric: tabular-nums;
      font-size: var(--hc-text-title-size, 18px);
      font-weight: 600;
      line-height: 1.1;
    }
    .name {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }
    .none {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  override render() {
    const key = this.key();
    const d = this.device;
    const value = this.current(key);

    if (d === undefined || key === '' || typeof value !== 'number') {
      return html`<span class="none" part="empty"
        >${d === undefined ? 'No device' : 'Nothing to step here'}</span
      >`;
    }

    const declared = this.declared(key);
    const step = this.number('step', declared?.step ?? 1);
    const min = declared?.min;
    const max = declared?.max;
    const label = this.text('label', declared?.display_name ?? humanise(key));
    const ink = roleColor(this.text('ink', 'foreground'));

    const to = (next: number): void => {
      // Rounded to the step's own precision: 20.5 + 0.1 is 20.599999999999998,
      // and a setpoint core stores to that many places is a setpoint nobody
      // typed.
      const places = String(step).includes('.') ? (String(step).split('.')[1]?.length ?? 0) : 0;
      this.write(key, Number(next.toFixed(places)));
    };

    const down = min !== undefined && value - step < min;
    const up = max !== undefined && value + step > max;

    return html`<div class="row" part="controls">
      <button
        part="action"
        aria-label="Less ${label}"
        ?disabled=${this.readOnly || down}
        @click=${() => to(value - step)}
      >
        −
      </button>
      <span class="middle">
        <span class="value" part="reading" style="color:${ink}"
          >${quantity(value, declared?.unit)}</span
        >
        <span class="name" part="name">${label}</span>
      </span>
      <button
        part="action"
        aria-label="More ${label}"
        ?disabled=${this.readOnly || up}
        @click=${() => to(value + step)}
      >
        +
      </button>
    </div>`;
  }
}

registerWidget('stepper', 'hc-stepper');

declare global {
  interface HTMLElementTagNameMap {
    'hc-stepper': HcStepper;
  }
}
