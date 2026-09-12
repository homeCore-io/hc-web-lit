/**
 * `rooms` — the house by room, as a row of tiles.
 *
 * `room_field` answers the same question as a treemap, where the *area* of a
 * room carries how much is in it; this is the plain list, which is what a
 * phone and a narrow column want, and what a page wants when the rooms should
 * be in the order somebody chose rather than the order that packs best.
 *
 * **The count is of the selection, not of everything.** A `rooms` widget with
 * `facet: light` is a row of rooms with lights in them, and the number on each
 * tile is that room's lights — so `hide_empty` has something to hide. Without
 * a selection it counts everything the house puts in that room.
 *
 * Order is `room_order` first, then whatever is left, alphabetically: a
 * partial order is a real thing to want (the three rooms that matter, then the
 * rest) and dropping the remainder would be answering a different question.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { isScene } from '../core/capability.js';
import { effectiveArea, isOn, normalizeAreaName } from '../core/present.js';
import { selectDevices, type SelectionConfig } from '../core/selection.js';
import { number as formatNumber } from '../core/i18n.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';

interface Room {
  key: string;
  name: string;
  total: number;
  /**
   * How many of them on-ness is a question about (§1.1).
   *
   * Not the same as the total, and the difference is the caption: a room of
   * three temperature sensors is not "0 of 3 on", because none of them can be
   * off. Counted rather than assumed, so a room of lights reads as lights and
   * a room of sensors reads as a number.
   */
  answerable: number;
  on: number;
}

@customElement('hc-rooms')
export class HcRooms extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-width: 0;
      height: 100%;
      overflow: auto;
    }
    .set {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      align-content: flex-start;
    }
    button {
      display: grid;
      gap: 0.125rem;
      justify-items: start;
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0.375rem 0.75rem;
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-md, 12px);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .name {
      white-space: nowrap;
    }
    .count {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      font-variant-numeric: tabular-nums;
    }
    .lit {
      color: var(--hc-accent-active, #ffc978);
    }
    .none {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) onOpenRoom:
    ((room: string, page: string | undefined) => void) | undefined;

  private list(name: string): string[] {
    const raw = this.config[name];
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  }

  private rooms(): Room[] {
    const config = this.config as SelectionConfig;
    // A selection mode of `facet` or `query` narrows what is counted; without
    // one, every device that is not a scene counts.
    const chosen =
      config.selection_mode === 'facet' || config.selection_mode === 'query'
        ? selectDevices(config, this.devices)
        : this.devices.filter((d) => !isScene(d));

    const by = new Map<string, Room>();
    for (const d of chosen) {
      const area = effectiveArea(d);
      const key = normalizeAreaName(area);
      // A device in no room is not in a room called "none".
      if (key === '') continue;
      const room = by.get(key) ?? {
        key,
        name: humanise(area ?? key),
        total: 0,
        answerable: 0,
        on: 0,
      };
      room.total += 1;
      const on = isOn(d);
      if (on !== undefined) room.answerable += 1;
      if (on === true) room.on += 1;
      by.set(key, room);
    }

    const named = this.config['rooms_mode'] === 'named' ? this.list('rooms') : [];
    if (named.length > 0) {
      for (const name of named) {
        const key = normalizeAreaName(name);
        // A named room with nothing in it is still a room somebody asked for.
        if (!by.has(key)) {
          by.set(key, { key, name: humanise(name), total: 0, answerable: 0, on: 0 });
        }
      }
      for (const key of [...by.keys()]) {
        if (!named.some((n) => normalizeAreaName(n) === key)) by.delete(key);
      }
    }

    const order = this.list('room_order').map((r) => normalizeAreaName(r));
    const rank = (r: Room): number => {
      const at = order.indexOf(r.key);
      return at === -1 ? order.length : at;
    };

    const rooms = [...by.values()].sort(
      (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
    );
    return this.config['hide_empty'] === true ? rooms.filter((r) => r.total > 0) : rooms;
  }

  override render() {
    const rooms = this.rooms();
    if (rooms.length === 0) {
      return html`<span class="none" part="empty">No rooms to show.</span>`;
    }

    const page =
      typeof this.config['room_page'] === 'string' ? this.config['room_page'] : undefined;

    return html`<div class="set" part="set">
      ${rooms.map(
        (r) =>
          html`<button
            part="room"
            aria-label="${r.name}, ${r.total} devices, ${r.on} on. Open this room."
            @click=${() => this.onOpenRoom?.(r.key, page)}
          >
            <span class="name" part="name">${r.name}</span>
            <span class="count" part="state">
              ${
                r.answerable > 0
                  ? html`<b class=${r.on > 0 ? 'lit' : ''}>${formatNumber(r.on)}</b> of
                      ${formatNumber(r.answerable)} on`
                  : `${formatNumber(r.total)} ${r.total === 1 ? 'device' : 'devices'}`
              }
            </span>
          </button>`,
      )}
    </div>`;
  }
}

registerWidget('rooms', 'hc-rooms');

declare global {
  interface HTMLElementTagNameMap {
    'hc-rooms': HcRooms;
  }
}
