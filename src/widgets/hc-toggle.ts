/**
 * `toggle` — one switch, bound to one attribute.
 *
 * Not the generic card's control row (§5.11) and not a device tile: a page
 * that wants a single switch, in a spot the author chose, with the words the
 * device uses for its own two states.
 *
 * **The words come from the device.** A contact sensor's `open` is not
 * "On/Off", and `AttributeSchema.states` exists to say so; `formatReading` is
 * already the one place that decides, so this asks it rather than deciding
 * again (§1.1).
 */
import { css, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { formatReading } from '../core/facet.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';
import { roleColor } from '../design/roles.js';
import { HcBoundControl } from './bound.js';

@customElement('hc-toggle')
export class HcToggle extends HcBoundControl {
  static override styles = css`
    :host {
      display: block;
      min-width: 0;
    }
    button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      width: 100%;
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 0.75rem;
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-md, 12px);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      cursor: pointer;
    }
    button[disabled] {
      cursor: default;
      opacity: 0.6;
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .switch {
      flex: none;
      width: 2.25rem;
      height: 1.25rem;
      border-radius: 1rem;
      background: var(--hc-surface-sunken, #0d1116);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      position: relative;
      transition: background 120ms ease;
    }
    .knob {
      position: absolute;
      top: 50%;
      left: 0.15rem;
      width: 0.9rem;
      height: 0.9rem;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-ink-muted, #8b95a4);
      transform: translate(0, -50%);
      transition:
        transform 120ms ease,
        background 120ms ease;
    }
    [data-on] .knob {
      transform: translate(1rem, -50%);
      background: var(--hc-surface-base, #0b0e13);
    }
    .state {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
    .none {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  override render() {
    const key = this.key();
    const d = this.device;
    if (d === undefined || key === '') {
      return html`<span class="none" part="empty"
        >${d === undefined ? 'No device' : 'No attribute to switch'}</span
      >`;
    }

    const declared = this.declared(key);
    const value = this.current(key);
    const on = value === true;
    const ink = roleColor(this.text('ink', 'accent'), '--hc-accent-primary');

    const label = this.text('label', declared?.display_name ?? humanise(key));
    // The device's own words, through the one function that knows them.
    const state = formatReading({
      key,
      value: value ?? false,
      label,
      ...(declared?.states !== undefined ? { states: declared.states } : {}),
    });

    return html`<button
      part="toggle"
      ?data-on=${on}
      ?disabled=${this.readOnly || declared?.writable === false}
      role="switch"
      aria-checked=${on ? 'true' : 'false'}
      aria-label=${label}
      @click=${() => this.write(key, !on)}
    >
      <span class="name" part="name">${label}</span>
      <span class="state" part="state">${state}</span>
      <span
        class="switch"
        part="indicator"
        style=${on ? `background:${ink};border-color:${ink}` : nothing}
      >
        <span class="knob"></span>
      </span>
    </button>`;
  }
}

registerWidget('toggle', 'hc-toggle');

declare global {
  interface HTMLElementTagNameMap {
    'hc-toggle': HcToggle;
  }
}
