/**
 * What the house is made of — `device_breakdown`.
 *
 * `group_by: "kind"`, `limit: 8`, `ink: "accent"`. A bar per group, longest
 * first, so the shape of the house is legible before any of the numbers are
 * read: this house is mostly scenes and switches, and that is a fact about it
 * worth seeing.
 *
 * **The tail is counted, not dropped.** A limit of 8 on twenty-three device
 * types would otherwise quietly hide half the house; the remainder gets its own
 * row, so the bars still add up to what the header claims.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { effectiveArea } from '../core/present.js';
import { icon, iconFor } from '../design/icons.js';
import { roleColor } from '../design/roles.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';

interface Group {
  /** What a person reads. */
  name: string;
  /** The declared word behind it, kept so the row can carry the kind's mark. */
  key: string;
  count: number;
}

@customElement('hc-device-breakdown')
export class HcDeviceBreakdown extends LitElement {
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
      gap: calc(var(--hc-space-unit, 8px) * 0.2);
    }
    li {
      display: grid;
      grid-template-columns: auto minmax(0, 7rem) 1fr auto;
      align-items: center;
      gap: 0.5rem;
      /* Tight, because the placement is a fixed box and the tail row is what
         makes the bars add up to the header's number. A design that pushed
         "15 more kinds" out of sight would be a prettier wrong answer. */
      min-height: 1.1rem;
      font-family: var(--hc-font-body, system-ui, sans-serif);
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
    }
    /* The kind's own mark, at the size a caption is. A column of these says
       what the house is made of before the words are read, which is the whole
       claim the widget makes. */
    .mark {
      display: grid;
      place-items: center;
      width: 0.85rem;
      height: 0.85rem;
      color: var(--hc-ink-muted, #8b95a4);
    }
    .mark svg {
      width: 100%;
      height: 100%;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--hc-ink, #e9edf2);
    }
    .bar {
      height: 6px;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-sunken, #0d1116);
      overflow: hidden;
    }
    .fill {
      display: block;
      height: 100%;
      border-radius: var(--hc-radius-pill, 999px);
      /* Fading toward the end, so a long bar reads as a quantity rather than
         as a block of colour with a number beside it. */
      opacity: 0.9;
    }
    .n {
      font-family: var(--hc-font-mono, ui-monospace, monospace);
      font-variant-numeric: tabular-nums;
      color: var(--hc-ink, #e9edf2);
      min-width: 2ch;
      text-align: right;
    }
    .rest {
      opacity: 0.6;
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];

  /**
   * How to group. `kind` is the device's own type — the plugin's word, not a
   * client's idea of a category — and a device that declares none is counted
   * as such rather than guessed at.
   */
  /**
   * The mark for a group.
   *
   * Only where the grouping is by kind: a room and a plugin are not things
   * this client has pictures of, and a generic mark repeated down the column
   * would be decoration standing in for information.
   */
  private mark(g: Group) {
    const by = this.config['group_by'];
    if (by === 'room' || by === 'plugin') return nothing;
    return icon(iconFor({ device_type: g.key }));
  }

  private groups(): Group[] {
    const by = this.config['group_by'];
    const key = (d: DeviceState): string => {
      switch (by) {
        case 'room':
          return effectiveArea(d) ?? 'no room';
        case 'plugin':
          return d.plugin_id.replace(/^plugin\./, '');
        default:
          return d.device_type ?? 'unclassified';
      }
    };

    const counts = new Map<string, number>();
    for (const d of this.devices) counts.set(key(d), (counts.get(key(d)) ?? 0) + 1);

    return [...counts.entries()]
      .map(([k, count]) => ({ name: humanise(k), key: k, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  override render() {
    const all = this.groups();
    if (all.length === 0) return html`<div class="empty" part="empty">Nothing here yet.</div>`;

    const limit = typeof this.config['limit'] === 'number' ? this.config['limit'] : all.length;
    const shown = all.slice(0, limit);
    const rest = all.slice(limit).reduce((sum, g) => sum + g.count, 0);
    const most = shown[0]?.count ?? 1;
    const ink = roleColor(
      typeof this.config['ink'] === 'string' ? this.config['ink'] : undefined,
      '--hc-accent-primary',
    );

    return html`<ul part="breakdown">
      ${shown.map(
        (g) =>
          html`<li part="group">
            <span class="mark" part="mark">${this.mark(g)}</span>
            <span class="name">${g.name}</span>
            <span class="bar"
              ><span
                class="fill"
                style="width:${(g.count / most) * 100}%;background:linear-gradient(90deg, ${ink}, color-mix(in srgb, ${ink} 55%, transparent))"
              ></span
            ></span>
            <span class="n">${g.count}</span>
          </li>`,
      )}
      ${
        rest > 0
          ? html`<li class="rest" part="rest">
              <span class="mark" part="mark">${icon('device')}</span>
              <span class="name">${all.length - shown.length} more kinds</span>
              <span class="bar"
                ><span
                  class="fill"
                  style="width:${(rest / most) * 100}%;background:linear-gradient(90deg, ${ink}, color-mix(in srgb, ${ink} 55%, transparent))"
                ></span
              ></span>
              <span class="n">${rest}</span>
            </li>`
          : nothing
      }
    </ul>`;
  }
}

registerWidget('device_breakdown', 'hc-device-breakdown');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-breakdown': HcDeviceBreakdown;
  }
}
