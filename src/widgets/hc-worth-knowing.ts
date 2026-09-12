/**
 * What is worth knowing — low batteries, water, unlocked doors, offline gear.
 *
 * The list a person scans before leaving the house. `watch` says which kinds to
 * notice and `low_battery` where the line is, so the widget decides nothing
 * about urgency; `core/attention.ts` derives the notices and this draws them.
 *
 * **Empty is the good case and says so.** A list that renders nothing looks
 * broken, and "nothing worth knowing" is the most reassuring thing a house
 * dashboard can say.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { noticesFor, type Notice } from '../core/attention.js';
import type { DeviceState } from '../core/device.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';
import { icon } from '../design/icons.js';

/** How loud each kind is. Water is a flood; a battery is a chore. */
/**
 * What each kind of notice looks like.
 *
 * The tone below says how much it matters; this says what it is. Both are
 * presentation, and both belong beside each other rather than one in a widget
 * and one in a stylesheet.
 */
const MARK: Record<string, string> = {
  batteries: 'battery',
  water: 'water',
  locks: 'lock',
  offline: 'hub',
  faults: 'lightning',
  open: 'door',
};

const TONE: Record<string, string> = {
  water: '--hc-accent-danger',
  faults: '--hc-accent-danger',
  locks: '--hc-accent-warn',
  offline: '--hc-accent-offline',
  open: '--hc-accent-warn',
  batteries: '--hc-ink-muted',
};

@customElement('hc-worth-knowing')
export class HcWorthKnowing extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: calc(var(--hc-space-unit, 8px) * 0.5);
    }
    li {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      min-width: 0;
      padding: calc(var(--hc-space-unit, 8px) * 0.375) 0;
      font-family: var(--hc-font-body, system-ui, sans-serif);
      color: var(--hc-ink, #e9edf2);
    }
    /* The same tile the device rows use, in the notice's own tone. A list of
       identical dots says four things need attention; a lock, a lock and two
       batteries says which four, before a word is read. */
    .mark {
      flex: none;
      display: grid;
      place-items: center;
      width: 1.75rem;
      height: 1.75rem;
      border-radius: var(--hc-radius-xs, 6px);
      background: color-mix(in srgb, var(--tone) 16%, var(--hc-surface-sunken, #0d1116));
      /* Toward the skin's own ink, which helps in both directions: on a dark
         skin the ink is light and the mark lifts off its tile, on a light one
         the ink is dark and the mark deepens. Measured at 3.01 against a lit
         tile in soft_home before this, which passes and is one rounding away
         from not. */
      color: color-mix(in srgb, var(--tone) 85%, var(--hc-ink, #e9edf2));
    }
    .mark svg {
      width: 1rem;
      height: 1rem;
    }
    .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail {
      margin-left: auto;
      flex: none;
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      font-variant-numeric: tabular-nums;
    }
    .room {
      flex: none;
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
    }
    .clear {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) context: { room?: string } = {};

  override render() {
    const notices = noticesFor(this.config, this.devices, this.context.room);

    if (notices.length === 0) {
      return html`<div class="clear" part="empty">Nothing worth knowing.</div>`;
    }

    return html`<ul part="notices">
      ${notices.map((n) => this.row(n))}
    </ul>`;
  }

  private row(n: Notice) {
    // A room is worth naming only when the list spans more than one. On a room
    // page every notice is in that room and repeating it is noise.
    const showRoom = this.config['area_name'] === undefined && n.area !== undefined;

    return html`<li part="notice">
      <span class="mark" part="mark" style="--tone:var(${TONE[n.kind] ?? '--hc-ink-muted'})">
        ${icon(MARK[n.kind] ?? 'device')}
      </span>
      <span class="name">${n.name}</span>
      ${showRoom ? html`<span class="room">${humanise(n.area ?? '')}</span>` : ''}
      <span class="detail">${n.detail}</span>
    </li>`;
  }
}

registerWidget('worth_knowing', 'hc-worth-knowing');

declare global {
  interface HTMLElementTagNameMap {
    'hc-worth-knowing': HcWorthKnowing;
  }
}
