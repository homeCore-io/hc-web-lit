/**
 * `plugin_widget` — a card a plugin contributed (§4.6).
 *
 * The last of core's widget types this client could not draw, and the one that
 * needed a format rather than a widget: `plugin_widget` carries `{plugin_id,
 * widget_id}` and nothing else, so until `WidgetDescriptor` existed there was
 * nothing to draw *from*. The descriptors arrive with the vocabulary, so one
 * request tells this client every card that exists on this installation.
 *
 * **Instruments, not markup.** Each element kind says what is being shown —
 * a value in a range, a word, a mark — and this decides the pixels. That is
 * what lets the same declaration draw here and as a meter in a terminal, and
 * it is why nothing below reads a class name or a colour literal out of the
 * descriptor.
 *
 * **The render is drawn even when there is code.** §4.6 makes the portable
 * description mandatory precisely so it is always a correct thing to show; a
 * plugin's `code` attachment is a sandboxed document (§8.1) and drawing it
 * here would mean this widget silently doing two very different things. The
 * attachment is named on screen instead, so an author can see that this client
 * is showing the portable half.
 */
import { LitElement, css, html, nothing, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { TemplateResult } from 'lit';
import {
  portabilityOf,
  resolveBindings,
  validateDescriptor,
  type BoundValue,
  type RenderElement,
} from '../core/descriptor.js';
import type { DeviceState } from '../core/device.js';
import { quantity } from '../core/i18n.js';
import { registerWidget } from '../core/registry.js';
import { pluginWidget, type Vocabulary } from '../core/vocabulary.js';
import { arc } from '../design/arc.js';
import { icon } from '../design/icons.js';
import { roleColor } from '../design/roles.js';

/** Core's corner names are token sizes, not pixel values. */
const CORNER: Record<string, string> = {
  rectangle: '0',
  circle: '50%',
  pill: 'var(--hc-radius-pill, 999px)',
  octagon: 'var(--hc-radius-md, 14px)',
  path: '0',
};

/** One id per widget on the page, for the gradient its dial owns. */
let instances = 0;

@customElement('hc-plugin-widget')
export class HcPluginWidget extends LitElement {
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
    .title {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .row,
    .column,
    .stack {
      display: flex;
      min-width: 0;
    }
    .row {
      flex-direction: row;
    }
    .column {
      flex-direction: column;
    }
    .stack {
      position: relative;
    }
    .stack > * {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
    }
    .text {
      color: var(--hc-ink, #e9edf2);
      font-variant-numeric: tabular-nums;
      min-width: 0;
    }
    .mark {
      display: grid;
      place-items: center;
    }
    .mark svg {
      width: 1.25rem;
      height: 1.25rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .shape {
      min-width: 1rem;
      min-height: 1rem;
      flex: 1;
    }
    .dial {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 3rem;
      flex: 1;
    }
    .dial svg {
      width: 100%;
      height: 100%;
      max-height: 8rem;
      display: block;
    }
    .face {
      position: absolute;
      display: grid;
      justify-items: center;
      pointer-events: none;
      font-variant-numeric: tabular-nums;
    }
    .none {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
    .warn {
      color: var(--hc-accent-warn, #ffc978);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) vocabulary: Vocabulary | undefined;

  /** One id per instance, for the gradients a dial owns. */
  private readonly ids = `hc-pw-${(instances += 1)}`;

  private text(name: string): string {
    const v = this.config[name];
    return typeof v === 'string' ? v : '';
  }

  /**
   * The value a field refers to: a binding's reading, or the literal text.
   *
   * Not called `valueOf` — that is `Object`'s, and a private one shadowing it
   * makes the class assignable to nothing, which TypeScript reports as three
   * decorators failing and no mention of the name.
   */
  private bound(field: unknown, bound: Record<string, BoundValue>): BoundValue | undefined {
    if (typeof field !== 'string') return undefined;
    const direct = bound[field];
    if (direct !== undefined) return direct;
    // `{{name}}` inside a sentence, for a `content` that is mostly words.
    const filled = field.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, key: string) => {
      const got = bound[key];
      return got === undefined ? whole : this.formatted(got);
    });
    return { value: filled };
  }

  private formatted(v: BoundValue, unit?: string, decimals?: number): string {
    if (typeof v.value !== 'number') return String(v.value ?? '');
    const places = decimals ?? v.decimals;
    const shown = places === undefined ? v.value : Number(v.value.toFixed(places));
    return quantity(shown, unit ?? v.unit);
  }

  private draw(el: RenderElement, bound: Record<string, BoundValue>): TemplateResult {
    const children = (el.children ?? []).map((c) => this.draw(c, bound));
    const gap = typeof el['gap'] === 'number' ? el['gap'] : 6;
    const align = typeof el['align'] === 'string' ? el['align'] : 'stretch';

    switch (el.kind) {
      case 'row':
      case 'column':
        return html`<div
          class=${el.kind}
          part="set"
          style="gap:${gap}px;align-items:${align === 'start' || align === 'center' || align === 'end' ? align : 'stretch'}"
        >
          ${children}
        </div>`;

      case 'stack':
        return html`<div class="stack" part="set">${children}</div>`;

      case 'icon':
        return html`<span
          class="mark"
          part="indicator"
          style="color:${roleColor(typeof el['color'] === 'string' ? el['color'] : undefined)}"
          >${icon(typeof el['name'] === 'string' ? el['name'] : 'device')}</span
        >`;

      case 'shape': {
        const outline = typeof el['outline'] === 'string' ? el['outline'] : 'rectangle';
        return html`<div
          class="shape"
          part="shape"
          style="background:${roleColor(
            typeof el['color'] === 'string' ? el['color'] : 'surface',
            '--hc-surface-raised',
          )};
                 border-radius:${
                   typeof el['corner'] === 'number' ? `${el['corner']}px` : (CORNER[outline] ?? '0')
                 }"
        ></div>`;
      }

      case 'gauge':
        return this.dial(el, bound);

      default: {
        const value = this.bound(el['content'], bound);
        const size = typeof el['size_role'] === 'string' ? el['size_role'] : 'body';
        return html`<span
          class="text"
          part="text"
          style="text-align:${typeof el['align'] === 'string' ? el['align'] : 'start'};
                 font-size:var(--hc-text-${size}-size, 14px);
                 color:${roleColor(typeof el['color'] === 'string' ? el['color'] : undefined)}"
          >${
            value === undefined
              ? ''
              : this.formatted(
                  value,
                  typeof el['unit'] === 'string' ? el['unit'] : undefined,
                  typeof el['decimals'] === 'number' ? el['decimals'] : undefined,
                )
          }</span
        >`;
      }
    }
  }

  /** The `gauge` instrument, drawn with the dial `hc-gauge` already draws. */
  private dial(el: RenderElement, bound: Record<string, BoundValue>) {
    const reading = this.bound(el['value'], bound);
    const value = typeof reading?.value === 'number' ? reading.value : undefined;
    const min = typeof el['min'] === 'number' ? el['min'] : 0;
    const max = typeof el['max'] === 'number' ? el['max'] : 100;
    const span = max - min;
    const fraction =
      value === undefined || span === 0 ? 0 : Math.min(1, Math.max(0, (value - min) / span));

    const ink = roleColor(
      typeof el['color'] === 'string' ? el['color'] : 'accent',
      '--hc-accent-primary',
    );
    const inkTo = roleColor(
      typeof el['color_to'] === 'string'
        ? el['color_to']
        : typeof el['color'] === 'string'
          ? el['color']
          : 'accent',
      '--hc-accent-primary',
    );
    const thickness = typeof el['thickness'] === 'number' ? el['thickness'] : 10;
    const cap = el['round_cap'] === false ? 'butt' : 'round';
    const track = el['track'] !== false;
    const readout = el['readout'] !== 'none';
    const label = typeof el['label'] === 'string' ? el['label'] : '';

    const face = html`<div class="face">
      ${
        readout && reading !== undefined
          ? html`<span part="reading"
              >${this.formatted(
                reading,
                undefined,
                typeof el['decimals'] === 'number' ? el['decimals'] : undefined,
              )}</span
            >`
          : nothing
      }
      ${label === '' ? nothing : html`<span class="none" part="name">${label}</span>`}
    </div>`;

    if (el['shape'] === 'bar') {
      return html`<div class="dial" part="set">
        <div
          part="track"
          style="width:100%;height:${thickness}px;border-radius:${thickness}px;
                 background:${track ? 'var(--hc-surface-sunken, #0d1116)' : 'transparent'}"
        >
          <div
            part="indicator"
            style="width:${(fraction * 100).toFixed(2)}%;height:100%;border-radius:inherit;
                   background:linear-gradient(90deg, ${ink}, ${inkTo})"
          ></div>
        </div>
        ${face}
      </div>`;
    }

    const start = typeof el['start_degrees'] === 'number' ? el['start_degrees'] : 135;
    const sweep = typeof el['sweep_degrees'] === 'number' ? el['sweep_degrees'] : 270;
    const radius = 50 - thickness / 2;

    return html`<div class="dial" part="set">
      <svg viewBox="0 0 100 100" role="img" aria-label=${label === '' ? 'Gauge' : label}>
        <defs>
          ${svg`<linearGradient id=${this.ids} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color=${ink}></stop>
            <stop offset="100%" stop-color=${inkTo}></stop>
          </linearGradient>`}
        </defs>
        ${
          track
            ? svg`<path part="track" d=${arc(start, sweep, radius)} fill="none"
                stroke="var(--hc-surface-sunken, #0d1116)" stroke-width=${thickness}
                stroke-linecap=${cap}></path>`
            : nothing
        }
        ${svg`<path part="indicator" d=${arc(start, sweep * fraction, radius)} fill="none"
          stroke=${`url(#${this.ids})`} stroke-width=${thickness} stroke-linecap=${cap}></path>`}
      </svg>
      ${face}
    </div>`;
  }

  override render() {
    const pluginId = this.text('plugin_id');
    const widgetId = this.text('widget_id');
    const found = pluginWidget(this.vocabulary, pluginId, widgetId);

    if (found === undefined) {
      // The commonest reason by far is a plugin that is not running: its
      // widgets are declared on the capability manifest, which is published
      // per session. Saying which card is missing is what turns "a blank
      // square" into something an admin can act on.
      return html`<div class="card" part="empty">
        <span class="none warn" part="note">
          ${
            this.vocabulary === undefined
              ? 'Waiting for the list of plugin widgets.'
              : `No widget "${widgetId}" from ${pluginId === '' ? 'any plugin' : pluginId} — the plugin may not be running.`
          }
        </span>
      </div>`;
    }

    const verdict = validateDescriptor(found, this.vocabulary?.elements ?? []);
    if (!verdict.ok || found.render === undefined) {
      return html`<div class="card" part="empty">
        <span class="none warn" part="note"
          >${verdict.ok ? 'This widget has no portable render.' : verdict.reason}</span
        >
      </div>`;
    }

    const bound = resolveBindings(found.bindings ?? [], this.config, this.devices);

    return html`<div class="card" part="card">
      ${this.draw(found.render, bound)}
      ${
        portabilityOf(found) === 'web_only'
          ? html`<span class="none" part="note"
              >${found.title} also ships a web version; this is its portable render.</span
            >`
          : nothing
      }
    </div>`;
  }
}

registerWidget('plugin_widget', 'hc-plugin-widget');

declare global {
  interface HTMLElementTagNameMap {
    'hc-plugin-widget': HcPluginWidget;
  }
}
