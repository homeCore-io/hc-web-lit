/**
 * `web_embed` — somebody else's page, inside this one.
 *
 * A weather map, a printer's status page, a camera's own web UI: the things a
 * household already has a page for and does not want rebuilt as a widget.
 *
 * **The sandbox is the whole widget.** An embedded page runs in the panel's
 * browser, and §8.1's reasoning about code elements applies here with one
 * difference: this document is not something an admin installed, it is a URL
 * somebody typed into a dashboard. So the frame is sandboxed by default and
 * the profile core stores decides how far the sandbox opens:
 *
 * - `strict_isolated` — no scripts at all. A page that only has to be *read*.
 * - `readonly_embed` — scripts, in an opaque origin. It can run and draw and
 *   it cannot read this app's storage, cookies or DOM. The default, and the
 *   right answer for anything on the internet.
 * - `trusted_internal` — scripts *and* same-origin. This is not a stricter
 *   sandbox than no sandbox: a same-origin document with `allow-same-origin`
 *   and `allow-scripts` can remove its own sandbox attribute. It means "this
 *   is our own machine on our own network", and the profile exists so that
 *   choice is written down in the document rather than assumed.
 *
 * An unrecognised profile gets the strictest of the three rather than the
 * loosest, because the failure of guessing wrong in that direction is a page
 * that does not work rather than a page that reads the panel's session.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { registerWidget } from '../core/registry.js';

/** What each profile opens, as an iframe `sandbox` value. */
const SANDBOX: Record<string, string> = {
  strict_isolated: '',
  readonly_embed: 'allow-scripts',
  trusted_internal: 'allow-scripts allow-same-origin allow-forms allow-popups',
};

@customElement('hc-web-embed')
export class HcWebEmbed extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      min-width: 0;
    }
    .frame {
      display: grid;
      height: 100%;
      min-height: 3rem;
      border-radius: var(--hc-radius-md, 12px);
      overflow: hidden;
      background: var(--hc-surface-sunken, #0d1116);
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
    }
    .note {
      place-self: center;
      padding: 0.5rem;
      text-align: center;
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
    .warn {
      color: var(--hc-accent-warn, #ffc978);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};

  override render() {
    const url = typeof this.config['url'] === 'string' ? this.config['url'].trim() : '';
    if (url === '') {
      return html`<div class="frame" part="empty"><span class="note">No address set.</span></div>`;
    }

    // Only somewhere a browser will load a document from. A `javascript:` here
    // would run in this page's context, which is the one thing the sandbox
    // below cannot protect against.
    if (!/^(https?:)?\/\//i.test(url) && !url.startsWith('/')) {
      return html`<div class="frame" part="empty">
        <span class="note warn" part="note">That is not an address a page can be loaded from.</span>
      </div>`;
    }

    const profile =
      typeof this.config['sandbox_profile'] === 'string'
        ? this.config['sandbox_profile']
        : 'readonly_embed';
    const sandbox = SANDBOX[profile] ?? SANDBOX['strict_isolated'] ?? '';

    return html`<div class="frame" part="frame">
      <iframe
        part="frame"
        src=${url}
        sandbox=${sandbox}
        referrerpolicy="no-referrer"
        loading="lazy"
        title=${typeof this.config['label'] === 'string' ? this.config['label'] : 'Embedded page'}
      ></iframe>
    </div>`;
  }
}

registerWidget('web_embed', 'hc-web-embed');

declare global {
  interface HTMLElementTagNameMap {
    'hc-web-embed': HcWebEmbed;
  }
}
