/**
 * `thermostat` — what it is, and what it was asked for.
 *
 * Two numbers with different jobs: the temperature the room *is*, which is a
 * reading, and the temperature it was *told to be*, which is a control. Core's
 * config names both — `attribute` and `target` — and a thermostat that showed
 * one without the other would be either a sensor or a dial.
 *
 * **Neither attribute is guessed from the device type.** `attribute` defaults
 * to whatever the device says it is for (`primary`, homeCore#29) and `target`
 * to the writable number that is not the current one — derived from what the
 * plugin declared, so a thermostat whose setpoint is called `heating_setpoint`
 * works without anybody configuring it, and one with two setpoints is
 * configured rather than guessed at.
 *
 * The mode is deliberately absent: `mode_chips` is its own widget type and a
 * page that wants both places them both, which is the composition §5.5 exists
 * for rather than a widget that grows a second job.
 */
import { css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { readingAt, readingOf } from '../core/facet.js';
import { quantity } from '../core/i18n.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';
import { HcBoundControl } from './bound.js';

@customElement('hc-thermostat')
export class HcThermostat extends HcBoundControl {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      min-width: 0;
    }
    .card {
      display: grid;
      gap: 0.375rem;
      align-content: center;
      height: 100%;
      min-width: 0;
    }
    .now {
      display: flex;
      align-items: baseline;
      gap: 0.375rem;
      min-width: 0;
    }
    .reading {
      font-size: var(--hc-text-display-size, 28px);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      line-height: 1;
      color: var(--hc-ink, #e9edf2);
    }
    .name {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .target {
      display: flex;
      align-items: center;
      gap: 0.5rem;
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
      font-size: var(--hc-text-title-size, 20px);
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
    .setpoint {
      flex: 1;
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-size: var(--hc-text-title-size, 20px);
      font-weight: 600;
      color: var(--hc-accent-active, #ffc978);
    }
    .none {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  /**
   * The setpoint attribute: named, or the writable number that is not the
   * reading.
   *
   * A device with exactly one writable number and a reading has already said
   * which is which; one with two has not, and is configured rather than
   * guessed at — picking the alphabetically-first of `cooling_setpoint` and
   * `heating_setpoint` would be a client deciding what a house wants.
   */
  private targetKey(currentKey: string): string | undefined {
    const named = this.key('target');
    if (named !== '') return named;

    const attrs = this.device?.schema?.attributes ?? {};
    const writable = Object.entries(attrs).filter(
      ([k, a]) =>
        k !== currentKey &&
        a.writable === true &&
        (a.kind === 'integer' || a.kind === 'float') &&
        a.category !== 'diagnostic' &&
        a.category !== 'config',
    );
    return writable.length === 1 ? writable[0]?.[0] : undefined;
  }

  /**
   * What the room *is* — named, or what the device says it is for.
   *
   * `primary` and nothing else (homeCore#29): 170 of 184 devices declare it,
   * and it is declared precisely so a client does not have to hunt. Hunting
   * was tried — the first numeric attribute the device is not commanded by —
   * and on a lamp it produced `color_temp_mirek`, which is a client inventing
   * a headline out of housekeeping. Where the primary reading is not a number
   * this says so instead, because a thermostat pointed at something that
   * reports no temperature is a misconfiguration and should read like one.
   */
  override render() {
    const d = this.device;
    if (d === undefined) return html`<span class="none" part="empty">No device</span>`;

    const named = this.key();
    const reading = named === '' ? readingOf(d) : readingAt(d, named);
    const numeric = reading !== undefined && typeof reading.value === 'number';
    const currentKey = reading?.key ?? named;
    const targetKey = this.targetKey(currentKey);
    const label = this.text('label', reading?.label ?? humanise(currentKey));

    const target = targetKey === undefined ? undefined : this.current(targetKey);
    const declared = targetKey === undefined ? undefined : this.declared(targetKey);
    const step = declared?.step ?? 1;

    const to = (next: number): void => {
      if (targetKey === undefined) return;
      const places = String(step).includes('.') ? (String(step).split('.')[1]?.length ?? 0) : 0;
      this.write(targetKey, Number(next.toFixed(places)));
    };

    return html`<div class="card" part="card">
      <div class="now">
        ${
          numeric
            ? html`<span class="reading" part="reading"
                  >${quantity(reading.value as number, reading.unit)}</span
                >
                <span class="name" part="name">${label}</span>`
            : html`<span class="none" part="note">This device reports no reading to show.</span>`
        }
      </div>

      ${
        typeof target !== 'number'
          ? html`<span class="none" part="note"
              >${
                targetKey === undefined
                  ? 'No setpoint declared — name one in this widget’s target if the device has one.'
                  : 'Setpoint not reported yet.'
              }</span
            >`
          : html`<div class="target" part="controls">
              <button
                part="action"
                aria-label="Cooler"
                ?disabled=${
                  this.readOnly || (declared?.min !== undefined && target - step < declared.min)
                }
                @click=${() => to(target - step)}
              >
                −
              </button>
              <span class="setpoint" part="state"
                >${quantity(target, declared?.unit ?? reading?.unit)}</span
              >
              <button
                part="action"
                aria-label="Warmer"
                ?disabled=${
                  this.readOnly || (declared?.max !== undefined && target + step > declared.max)
                }
                @click=${() => to(target + step)}
              >
                +
              </button>
            </div>`
      }
    </div>`;
  }
}

registerWidget('thermostat', 'hc-thermostat');

declare global {
  interface HTMLElementTagNameMap {
    'hc-thermostat': HcThermostat;
  }
}
