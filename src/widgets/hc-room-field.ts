/**
 * The house as a field of rooms — `room_field`.
 *
 * Each room is a cell sized by how many devices it holds, glowing in proportion
 * to how many of its lights are on. The page's own caption is the legend:
 * *"Brighter is more of it on · tap one to open it"*.
 *
 * **The glow is the data.** Not a badge, not a number — the room that is lit
 * looks lit, so the whole house reads at a glance from across a room, which is
 * what a wall panel is for. The count is there underneath for when somebody
 * actually wants it.
 */
import { isScene } from '../core/capability.js';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { effectiveArea, isOn, normalizeAreaName } from '../core/present.js';
import { squarify } from '../core/treemap.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';

interface Room {
  key: string;
  name: string;
  /** Devices in the room — the cell's area. */
  value: number;
  lights: number;
  on: number;
}

@customElement('hc-room-field')
export class HcRoomField extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .field {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 120px;
    }
    button {
      position: absolute;
      appearance: none;
      text-align: left;
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      padding: 9px 10px;
      overflow: hidden;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      transition: border-color 0.16s ease;
    }
    /* The glow. Rises from the bottom of the cell like light in a room, and
       takes the skin's active colour so a blue_hour house glows blue. */
    button::before {
      content: '';
      position: absolute;
      inset: -30%;
      background: radial-gradient(
        circle at 50% 100%,
        color-mix(in srgb, var(--hc-accent-active, #ffb661) calc(var(--lum, 0) * 100%), transparent)
          0%,
        transparent 68%
      );
      pointer-events: none;
    }
    button:hover {
      border-color: var(--hc-accent-inactive, #39414f);
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .rn {
      position: relative;
      font-size: 11.5px;
      font-weight: 500;
      line-height: 1.15;
      text-wrap: balance;
    }
    .rc {
      position: relative;
      font-family: var(--hc-font-mono, ui-monospace, monospace);
      font-size: 10px;
      color: var(--hc-ink-muted, #8b95a4);
      margin-top: 3px;
      font-variant-numeric: tabular-nums;
    }
    .lit {
      color: var(--hc-accent-active, #ffb661);
      font-weight: 500;
    }
    /* A cell too small for a count keeps only its name; a truncated number is
       worse than no number. */
    button[data-tiny] {
      padding: 6px 7px;
    }
    button[data-tiny] .rn {
      font-size: 10px;
    }
    button[data-tiny] .rc {
      display: none;
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  /** Where a tap goes — the room page this field opens. */
  @property({ attribute: false }) onOpenRoom:
    ((room: string, page: string | undefined) => void) | undefined;

  @state() private size = { w: 0, h: 0 };
  private observer: ResizeObserver | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    // A treemap needs pixels, and it has none until it is laid out. Measuring
    // rather than assuming is also what keeps it right when the page reflows.
    this.observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box !== undefined) this.size = { w: box.width, h: box.height };
    });
    this.observer.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.observer?.disconnect();
    this.observer = undefined;
  }

  /** Rooms, from what the devices say they are in. */
  private rooms(): Room[] {
    const by = new Map<string, Room>();
    for (const d of this.devices) {
      if (isScene(d)) continue;
      const area = effectiveArea(d);
      const key = normalizeAreaName(area);
      // Devices with no room are the caption's "32 in none" — real, and not a
      // room, so they are counted there rather than given a cell here.
      if (key === '') continue;

      const room = by.get(key) ?? {
        key,
        name: humanise(area ?? key),
        value: 0,
        lights: 0,
        on: 0,
      };
      room.value += 1;
      if ((d.ui_hint ?? d.device_type) === 'light') {
        room.lights += 1;
        if (isOn(d) === true) room.on += 1;
      }
      by.set(key, room);
    }
    return [...by.values()];
  }

  override render() {
    const rooms = this.rooms();
    const { w, h } = this.size;
    if (rooms.length === 0) return html`<div class="empty">No rooms yet.</div>`;
    if (w === 0 || h === 0) return html`<div class="field"></div>`;

    const pad = 5;
    const page =
      typeof this.config['room_page'] === 'string' ? this.config['room_page'] : undefined;

    return html`<div class="field" part="field">
      ${squarify(rooms, w, h).map((c) => {
        const r = c.item;
        const tiny = c.w < 168 || c.h < 96;
        // The mockup's ramp: a room with every light on sits at 0.62, never 1,
        // because a cell at full strength stops reading as a surface.
        const lum = r.lights > 0 ? 0.1 + 0.52 * (r.on / r.lights) : 0;

        return html`<button
          part="room"
          ?data-tiny=${tiny}
          style="left:${c.x + pad / 2}px;top:${c.y + pad / 2}px;
                 width:${Math.max(0, c.w - pad)}px;height:${Math.max(0, c.h - pad)}px;
                 --lum:${lum.toFixed(3)}"
          aria-label="${r.name}, ${r.value} devices${
            r.lights > 0 ? `, ${r.on} of ${r.lights} lights on` : ''
          }. Open this room."
          @click=${() => this.onOpenRoom?.(r.key, page)}
        >
          <span class="rn">${r.name}</span>
          <span class="rc">
            ${
              r.lights > 0
                ? html`<b class="lit">${r.on}</b>/${r.lights} lit · ${r.value}`
                : `${r.value} devices`
            }
          </span>
        </button>`;
      })}
    </div>`;
  }
}

registerWidget('room_field', 'hc-room-field');

declare global {
  interface HTMLElementTagNameMap {
    'hc-room-field': HcRoomField;
  }
}
