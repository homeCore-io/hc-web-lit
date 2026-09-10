/**
 * `markdown` — a note on a dashboard (§7.3).
 *
 * The one widget whose whole content is written by a person, and the one place
 * on a page where device data (§6's interpolation) and typed text meet. It
 * renders a parsed tree rather than an HTML string, so there is no path from
 * the note to markup at all — see `core/markdown.ts` for why that is the
 * shape rather than an escaping rule.
 *
 * An empty note is a note somebody has not written yet, which is why core
 * allows the empty string on a required field. It draws as nothing rather than
 * as a message about being empty: a placeholder on a wall panel is worse than
 * a gap.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { parseMarkdown, type Block, type Inline } from '../core/markdown.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-markdown')
export class HcMarkdown extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-width: 0;
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
      margin: 0.5em 0 0.25em;
      line-height: 1.2;
      font-weight: 600;
    }
    h1 {
      font-size: var(--hc-text-title-size, 18px);
    }
    h2 {
      font-size: var(--hc-text-body-size, 14px);
    }
    h3,
    h4,
    h5,
    h6 {
      font-size: var(--hc-text-body-small-size, 12.5px);
      color: var(--hc-ink-muted, #8b95a4);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    p,
    ul,
    ol,
    pre,
    blockquote {
      margin: 0 0 0.5em;
    }
    :last-child {
      margin-bottom: 0;
    }
    ul,
    ol {
      padding-left: 1.25em;
    }
    li {
      margin: 0.125em 0;
    }
    blockquote {
      padding-left: 0.75em;
      border-left: 2px solid var(--hc-stroke-hairline, #262d38);
      color: var(--hc-ink-muted, #8b95a4);
    }
    code {
      font-family: var(--hc-font-mono, ui-monospace, monospace);
      font-size: 0.92em;
      background: var(--hc-surface-sunken, #0d1116);
      border-radius: var(--hc-radius-sm, 8px);
      padding: 0.05em 0.3em;
    }
    pre {
      background: var(--hc-surface-sunken, #0d1116);
      border-radius: var(--hc-radius-sm, 8px);
      padding: 0.5em 0.625em;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
    }
    hr {
      border: none;
      border-top: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      margin: 0.75em 0;
    }
    a {
      color: var(--hc-accent-primary, #7cc4ff);
    }
    a:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};

  private spans(spans: readonly Inline[]): unknown {
    return spans.map((s) => {
      switch (s.kind) {
        case 'strong':
          return html`<strong>${s.text}</strong>`;
        case 'em':
          return html`<em>${s.text}</em>`;
        case 'code':
          return html`<code part="text">${s.text}</code>`;
        case 'link':
          // A link off a wall panel opens somewhere the panel cannot come back
          // from, so it opens beside rather than instead.
          return html`<a part="action" href=${s.href} target="_blank" rel="noreferrer noopener"
            >${s.text}</a
          >`;
        default:
          return s.text;
      }
    });
  }

  private block(b: Block): unknown {
    switch (b.kind) {
      case 'heading': {
        const spans = this.spans(b.spans);
        // One element per level rather than a computed tag, because building a
        // tag name from input is the sort of thing this file exists to avoid.
        if (b.level === 1) return html`<h1 part="heading">${spans}</h1>`;
        if (b.level === 2) return html`<h2 part="heading">${spans}</h2>`;
        if (b.level === 3) return html`<h3 part="heading">${spans}</h3>`;
        if (b.level === 4) return html`<h4 part="heading">${spans}</h4>`;
        if (b.level === 5) return html`<h5 part="heading">${spans}</h5>`;
        return html`<h6 part="heading">${spans}</h6>`;
      }
      case 'list': {
        const items = b.items.map((i) => html`<li part="row">${this.spans(i)}</li>`);
        return b.ordered
          ? html`<ol part="set">
              ${items}
            </ol>`
          : html`<ul part="set">
              ${items}
            </ul>`;
      }
      case 'quote':
        return html`<blockquote part="note">${this.spans(b.spans)}</blockquote>`;
      case 'code':
        return html`<pre part="text"><code>${b.text}</code></pre>`;
      case 'rule':
        return html`<hr part="rule" />`;
      default:
        return html`<p part="text">${this.spans(b.spans)}</p>`;
    }
  }

  override render() {
    const source = this.config['markdown'];
    if (typeof source !== 'string' || source.trim() === '') return nothing;
    return parseMarkdown(source).map((b) => this.block(b));
  }
}

registerWidget('markdown', 'hc-markdown');

declare global {
  interface HTMLElementTagNameMap {
    'hc-markdown': HcMarkdown;
  }
}
