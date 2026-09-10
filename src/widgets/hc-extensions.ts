/**
 * What is installed, and how something else gets installed (§18.2).
 *
 * The first condition for retiring the other client, in its own words: "a
 * third party can ship a widget — install a `.tar.gz`, place the widget,
 * configure it in the GUI, no rebuild. This is the reason the project exists,
 * and no amount of parity substitutes for it." Placing and configuring are the
 * property panel's; this is the installing, and it is the last of the three to
 * arrive.
 *
 * **What did not load is the point of the list.** An extension that does not
 * appear is the hardest thing in this design to diagnose from outside: the
 * symptom is a placement drawn as unknown, which looks exactly like a typo in
 * a dashboard. So a directory the store could not read, a manifest wanting an
 * API version this host does not implement, and a module that threw on load
 * are all shown here with their reason, beside the ones that worked.
 *
 * **A new extension is not loaded into the running page**, and the widget says
 * so rather than appearing to work. A module that defines a custom element
 * cannot be registered twice, so the honest offer is "installed; reload to use
 * it" — a widget that worked until somebody refreshed would be worse than a
 * sentence asking them to.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { InstalledExtensions } from '../ext/install.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-extensions')
export class HcExtensions extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      color: var(--hc-ink, #e9edf2);
      font-size: var(--hc-text-body-small-size, 12.5px);
    }
    .row {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      padding: 0.375rem 0;
      border-bottom: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
    }
    .name {
      font-weight: 600;
    }
    .id,
    .version {
      color: var(--hc-ink-muted, #8b95a4);
      font-family: var(--hc-font-mono, ui-monospace, monospace);
      font-size: var(--hc-text-caption-size, 11px);
    }
    .why {
      color: var(--hc-accent-warn, #ffc978);
      font-size: var(--hc-text-caption-size, 11px);
      flex: 1 1 100%;
    }
    .foot {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding-top: 0.75rem;
    }
    label.pick {
      min-height: var(--hc-density-min-tap, 44px);
      display: inline-flex;
      align-items: center;
      padding: 0 0.75rem;
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-raised, #141922);
      cursor: pointer;
    }
    label.pick:focus-within {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    input[type='file'] {
      display: none;
    }
    .note {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
    .note.warn {
      color: var(--hc-accent-warn, #ffc978);
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      padding: 0.5rem 0;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  /** What loaded and what did not, from the host's own startup round. */
  @property({ attribute: false }) extensions: InstalledExtensions = { loaded: [], failed: [] };
  /** Install an archive. Absent means this session may not write content. */
  @property({ attribute: false }) onInstallExtension:
    ((archive: ArrayBuffer) => Promise<{ id: string; files: number }>) | undefined;

  @state() private busy = false;
  @state() private said = '';
  @state() private trouble = '';

  private async take(file: File | undefined): Promise<void> {
    if (file === undefined || this.onInstallExtension === undefined) return;
    this.busy = true;
    this.said = '';
    this.trouble = '';
    try {
      const got = await this.onInstallExtension(await file.arrayBuffer());
      this.said = `Installed ${got.id} — ${got.files} ${got.files === 1 ? 'file' : 'files'}. Reload to use it.`;
    } catch (e) {
      this.trouble = `Not installed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.busy = false;
    }
  }

  override render() {
    const { loaded, failed } = this.extensions;

    return html`
      ${
        loaded.length === 0 && failed.length === 0
          ? html`<div class="empty" part="empty">Nothing installed yet.</div>`
          : nothing
      }
      ${loaded.map(
        (e) =>
          html`<div class="row" part="row">
            <span class="name" part="name">${e.manifest.name}</span>
            <span class="id" part="state">${e.manifest.id}</span>
            <span class="version" part="state">${e.manifest.version}</span>
          </div>`,
      )}
      ${failed.map(
        (f) =>
          html`<div class="row" part="row">
            <span class="name" part="name">${f.id}</span>
            <span class="why" part="note">${f.error}</span>
          </div>`,
      )}

      <div class="foot" part="controls">
        ${
          this.onInstallExtension === undefined
            ? html`<span class="note">This session may not install extensions.</span>`
            : html`<label class="pick" part="action">
                ${this.busy ? 'Installing…' : 'Install a .tar.gz'}
                <input
                  type="file"
                  accept=".tgz,.gz,.tar,application/gzip,application/x-tar"
                  aria-label="Install a .tar.gz"
                  ?disabled=${this.busy}
                  @change=${(e: Event) => {
                    const input = e.target as HTMLInputElement;
                    void this.take(input.files?.[0]);
                    // Cleared, so installing the same file twice — which is
                    // what fixing one and rebuilding it looks like — fires the
                    // change a second time.
                    input.value = '';
                  }}
                />
              </label>`
        }
        ${this.said === '' ? nothing : html`<span class="note" part="note">${this.said}</span>`}
        ${
          this.trouble === ''
            ? nothing
            : html`<span class="note warn" part="note">${this.trouble}</span>`
        }
      </div>
    `;
  }
}

registerWidget('extensions', 'hc-extensions');

declare global {
  interface HTMLElementTagNameMap {
    'hc-extensions': HcExtensions;
  }
}
