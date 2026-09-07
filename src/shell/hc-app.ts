/**
 * The application shell.
 *
 * Deliberately thin. Routing, auth, the connection and theming land here
 * (§3); everything else is a widget, and widgets do not reach around this
 * (§19.4). Right now it renders the one honest thing it knows: that nothing is
 * connected yet.
 */
import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';

@customElement('hc-app')
export class HcApp extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-height: 100vh;
      /* Tokens, not literals (§15). The DTCG file replaces these defaults in
         Phase 1; the fallbacks are here so the shell renders before it. */
      background: var(--hc-ground, #16120e);
      color: var(--hc-ink, #f5efe8);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    main {
      display: grid;
      place-items: center;
      min-height: 100vh;
      gap: 0.5rem;
      text-align: center;
    }
    .brand {
      color: var(--hc-accent, #ffb661);
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .muted {
      opacity: 0.65;
      font-size: 0.875rem;
    }
  `;

  @state() private connected = false;

  override render() {
    return html`
      <main>
        <div class="brand">homeCore</div>
        <div class="muted">
          ${this.connected ? 'Connected.' : 'Not connected — no API client yet.'}
        </div>
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-app': HcApp;
  }
}
