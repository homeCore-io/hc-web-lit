/**
 * `svg` — a drawing somebody made, with the house in it.
 *
 * Core stores the drawing as a string and says so plainly in its own comment:
 * "core validates that the drawing is a string and leaves its contents alone.
 * It is not an SVG parser and should not become one." So the parsing, and the
 * safety, are entirely this side (`core/svg.ts`).
 *
 * **The house arrives already in it.** `svg` shares its selection fields with
 * `code` (§4.6), which makes the selection a *grant* rather than a set to
 * draw, and the values come through `bindings` and `{{ }}` interpolation at
 * the placement seam — so by the time the drawing reaches this widget the
 * temperature is in the text and the widget has nothing to resolve. That is
 * the same arrangement every other widget has with `@room`, and it is why a
 * drawing needs no API of its own.
 *
 * **It is re-parsed when the drawing changes and not otherwise.** A page
 * re-renders on every device event, and this house streams constantly;
 * parsing an SVG per frame would be a wall panel's whole budget. Keyed on the
 * text, which is what interpolation changes when a value changes.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { sanitiseSvg } from '../core/svg.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-svg')
export class HcSvg extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      min-width: 0;
    }
    .drawing {
      display: grid;
      place-items: center;
      height: 100%;
      min-width: 0;
      overflow: hidden;
    }
    .drawing > svg {
      max-width: 100%;
      max-height: 100%;
      display: block;
    }
    .none {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      text-align: center;
      padding: 0.5rem;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};

  /** The parsed drawing, and the text it came from. */
  private drawn: { source: string; node: SVGElement | undefined } = {
    source: '',
    node: undefined,
  };

  private node(source: string): SVGElement | undefined {
    if (source !== this.drawn.source) this.drawn = { source, node: sanitiseSvg(source) };
    return this.drawn.node;
  }

  override render() {
    const source = typeof this.config['svg'] === 'string' ? this.config['svg'] : '';
    if (source.trim() === '') return nothing;

    const node = this.node(source);
    if (node === undefined) {
      // Not a drawing. Said out loud, because the alternative is a blank
      // rectangle where somebody put a floor plan, and a blank rectangle is
      // indistinguishable from a page that has not loaded.
      return html`<div class="drawing" part="empty">
        <span class="none" part="note">This is not a drawing a browser can read.</span>
      </div>`;
    }

    return html`<div class="drawing" part="image">${node}</div>`;
  }
}

registerWidget('svg', 'hc-svg');

declare global {
  interface HTMLElementTagNameMap {
    'hc-svg': HcSvg;
  }
}
