/**
 * `heading` — a section title.
 *
 * Core's fields: `text` (required), `level`, `align`. `level` is a plain
 * string rather than an enum, so it is read as a size rather than mapped to
 * an `h1`–`h6`: a dashboard has no document outline, and promising one by
 * emitting heading tags would be a lie a screen reader acts on.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { registerWidget } from '../core/registry.js';

const SIZE: Record<string, string> = {
  '1': 'var(--hc-text-display-size, 30px)',
  '2': 'var(--hc-text-title-size, 18px)',
  '3': 'var(--hc-text-subtitle-size, 14px)',
  overline: 'var(--hc-text-overline-size, 10px)',
};

@customElement('hc-heading')
export class HcHeading extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    p {
      margin: 0;
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
      font-weight: 600;
      line-height: 1.2;
      text-wrap: balance;
    }
    p[data-overline] {
      color: var(--hc-ink-muted, #8b95a4);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};

  override render() {
    const level = String(this.config['level'] ?? '2');
    const align = String(this.config['align'] ?? 'start');
    return html`<p
      part="heading"
      ?data-overline=${level === 'overline'}
      style="font-size:${SIZE[level] ?? SIZE['2']};text-align:${align}"
    >
      ${String(this.config['text'] ?? '')}
    </p>`;
  }
}

registerWidget('heading', 'hc-heading');

declare global {
  interface HTMLElementTagNameMap {
    'hc-heading': HcHeading;
  }
}
