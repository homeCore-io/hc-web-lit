/**
 * `icon` — a mark on its own.
 *
 * Core's fields: `device_id`, `facet`, `ink`, `backing`. Bound to a device it
 * takes that device's mark and lights with its state, which is what makes it
 * an indicator rather than a picture. Given a `facet` it is whatever that word
 * names; given neither it is the generic device mark, which says "a device"
 * rather than pretending to be something.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { isOn } from '../core/present.js';
import { icon, iconFor } from '../design/icons.js';
import { roleColor } from '../design/roles.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-icon')
export class HcIcon extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      place-items: center;
      height: 100%;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      color: var(--ink, var(--hc-ink, #e9edf2));
    }
    .mark[data-backing] {
      box-sizing: border-box;
      aspect-ratio: 1;
      width: auto;
      max-width: 100%;
      padding: 12%;
      border-radius: var(--hc-radius-md, 14px);
      background: color-mix(in srgb, currentColor 16%, var(--hc-surface-sunken, #0d1116));
    }
    svg {
      width: 100%;
      height: 100%;
      max-height: 3rem;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) device: DeviceState | undefined;

  override render() {
    const facet = this.config['facet'];
    const mark =
      typeof facet === 'string' && facet !== ''
        ? iconFor({ device_type: facet })
        : iconFor(this.device);

    // `ink` wins where a document named one, because an author who chose a
    // colour meant it; otherwise a bound device colours its own mark.
    const named = this.config['ink'];
    const ink =
      typeof named === 'string'
        ? roleColor(named)
        : this.device !== undefined && isOn(this.device) === true
          ? 'var(--hc-accent-active, #ffb661)'
          : 'var(--hc-ink-muted, #8b95a4)';

    return html`<span
      class="mark"
      part="indicator"
      ?data-backing=${this.config['backing'] === true}
      style="--ink:${ink}"
      >${icon(mark)}</span
    >`;
  }
}

registerWidget('icon', 'hc-icon');

declare global {
  interface HTMLElementTagNameMap {
    'hc-icon': HcIcon;
  }
}
