/**
 * P5 — the overlay layer (§5.6).
 *
 * The host owns one stack of dialogs, sheets and toasts. Widgets ask for an
 * overlay; they never put one in the document. That is what makes focus
 * trapping, scroll locking, Escape and the back button correct once instead of
 * per widget — the exact set of things Home Assistant users install browser_mod
 * to fix.
 *
 * **Content is a widget spec, not a DOM node**, so "tap opens a room control
 * sheet" is a config value rather than code (§5.6). A host-owned form — the
 * confirmation this stack also serves — is the exception, because nobody stores
 * it.
 *
 * **Native `<dialog>`, deliberately.** One browser target (§16) means
 * `showModal()` is simply there, and with it the focus trap, the inert
 * background, Escape, and the top layer — all of which are worse when
 * hand-built. What is left to do here is what the platform does not do: the
 * scroll lock, the back button, and the stack itself.
 */
import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { deriveDensity } from '../design/tokens.js';
import { tagFor } from '../core/registry.js';
import { mountWidget, type MountEnv, type MountTarget, type WidgetSpec } from './mount.js';

/** What an overlay shows. A spec is storable; a template is host chrome. */
export type OverlayContent = { widget: WidgetSpec } | { render: () => TemplateResult };

export interface OverlayOpts {
  /** Shown in the overlay's own header, with the close button. */
  title?: string;
}

export interface ConfirmRequest {
  text: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Draws the confirming button as the destructive one. */
  danger?: boolean;
}

export interface OverlayHandle {
  close(): void;
  /** Resolves when the overlay goes away, however it went. */
  readonly closed: Promise<void>;
}

export interface OverlayApi {
  sheet(content: OverlayContent, opts?: OverlayOpts): OverlayHandle;
  dialog(content: OverlayContent, opts?: OverlayOpts): OverlayHandle;
  toast(message: string, opts?: { kind?: 'info' | 'warn' }): void;
  confirm(req: ConfirmRequest): Promise<boolean>;
}

interface Entry {
  id: number;
  kind: 'sheet' | 'dialog';
  content: OverlayContent;
  opts: OverlayOpts;
  /** Built once, so a sheet's widget is not rebuilt on every host render. */
  node?: HTMLElement;
  done: () => void;
}

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'warn';
}

/** Marks a history entry as ours, so popstate can tell whose back this was. */
const BACK_MARK = 'hc-overlay';

/**
 * The step a panel is drawn at.
 *
 * **A dialog is a desk surface, not a wall.** The overlay lives beside the
 * page rather than inside it, so it never saw the density `hc-page` picks for
 * a composed layout and quietly took the skin's own — the comfortable step,
 * whose 44px control rows are right for a tablet on a wall and much too big
 * for a sheet somebody opened with a mouse. Every panel in the product came
 * out a third larger than the page behind it.
 *
 * Taken from `deriveDensity` rather than written out, so there is one place
 * these numbers live — the same reason `hc-page` imports it.
 */
const COMPACT = deriveDensity('compact');

@customElement('hc-overlay')
export class HcOverlay extends LitElement implements OverlayApi {
  static override styles = css`
    dialog {
      --hc-density-row-height: ${unsafeCSS(COMPACT.rowHeight)}px;
      --hc-density-control-height: ${unsafeCSS(COMPACT.controlHeight)}px;
      --hc-density-min-tap: ${unsafeCSS(COMPACT.minTapTarget)}px;
      --hc-density-card-padding: ${unsafeCSS(COMPACT.cardPadding)}px;
      border: none;
      padding: 0;
      color: var(--hc-ink, #e9edf2);
      background: var(--hc-surface-raised, #141922);
      font-family: var(--hc-font-body, system-ui, sans-serif);
      box-shadow: var(--hc-elevation-overlay, 0 24px 60px rgb(0 0 0 / 0.5));
      max-height: 90dvh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    dialog::backdrop {
      background: var(--hc-scrim, rgb(0 0 0 / 0.55));
    }
    dialog.dialog {
      border-radius: var(--hc-radius-lg, 18px);
      width: min(28rem, calc(100vw - 2rem));
    }
    /* A sheet comes off the bottom edge on a phone and the side of a desk. */
    dialog.sheet {
      margin: auto auto 0;
      width: min(34rem, 100vw);
      border-radius: var(--hc-radius-lg, 18px) var(--hc-radius-lg, 18px) 0 0;
      max-height: 88dvh;
    }
    @media (min-width: 40rem) {
      dialog.sheet {
        margin: auto;
        border-radius: var(--hc-radius-lg, 18px);
      }
    }
    header {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: calc(var(--hc-space-unit, 8px) * 1.5) var(--hc-density-card-padding, 14px);
      border-bottom: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
    }
    /* **A panel whose content names itself gets no bar to name it in.** The
       header is a title and a way out; with no title it was a 60px empty band
       above every device sheet, with an ✕ adrift at the end of it, and the
       device's own name began below a rule that separated it from nothing.
       The way out stays — it just floats in the corner of what it closes. */
    header[data-bare] {
      position: absolute;
      top: 0;
      right: 0;
      padding: calc(var(--hc-space-unit, 8px) * 0.75);
      border-bottom: none;
      z-index: 1;
    }
    dialog {
      position: relative;
    }
    header[data-bare] button.close {
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-sunken, #0d1116);
      width: 1.75rem;
      min-height: 1.75rem;
      padding: 0;
      font-size: 11px;
    }
    h2 {
      margin: 0;
      margin-right: auto;
      font-size: var(--hc-text-subtitle-size, 16px);
      font-weight: 600;
    }
    .body {
      overflow: auto;
      padding: calc(var(--hc-density-card-padding, 14px) * 1.1);
      display: grid;
      gap: calc(var(--hc-space-unit, 8px));
    }
    /* A grid item's minimum is its content unless it is told otherwise, so one
       wide field inside a panel widened the panel rather than fitting it. */
    .body > * {
      min-width: 0;
    }
    .confirm p {
      margin: 0 0 1rem;
      line-height: 1.5;
    }
    .buttons {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }
    button {
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 calc(var(--hc-space-unit, 8px) * 1.5);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      cursor: pointer;
    }
    button.primary {
      background: var(--hc-accent-active, #ffb661);
      color: var(--hc-accent-on-primary, #06131f);
      border-color: transparent;
    }
    button.danger {
      background: var(--hc-status-danger, #ff6b6b);
      color: var(--hc-accent-on-primary, #06131f);
      border-color: transparent;
    }
    button.close {
      min-height: 32px;
      padding: 0 0.5rem;
      color: var(--hc-ink-muted, #8b95a4);
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    /* Toasts are not modal: they say something happened and go away. */
    .toasts {
      position: fixed;
      inset: auto 0 1rem;
      display: grid;
      justify-items: center;
      gap: 0.5rem;
      pointer-events: none;
      z-index: 1;
    }
    .toast {
      pointer-events: auto;
      max-width: min(30rem, calc(100vw - 2rem));
      padding: 0.75rem 1rem;
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-overlay, #1b2230);
      color: var(--hc-ink, #e9edf2);
      font-size: var(--hc-text-body-size, 13px);
      box-shadow: var(--hc-elevation-overlay, 0 24px 60px rgb(0 0 0 / 0.5));
      border-left: 3px solid var(--hc-accent-active, #ffb661);
    }
    .toast[data-kind='warn'] {
      border-left-color: var(--hc-status-warn, #ffc861);
    }
  `;

  /** What a mounted widget is given. The host sets this once. */
  env: MountEnv = { store: undefined, context: {} };

  @state() private stack: Entry[] = [];
  @state() private toasts: Toast[] = [];

  private seq = 0;
  private readonly onPop = (): void => {
    // Back closes the top overlay rather than leaving the page under it.
    if (this.stack.length > 0) this.drop(this.stack[this.stack.length - 1]!.id, false);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    globalThis.addEventListener('popstate', this.onPop);
  }

  override disconnectedCallback(): void {
    globalThis.removeEventListener('popstate', this.onPop);
    this.unlock();
    super.disconnectedCallback();
  }

  sheet(content: OverlayContent, opts: OverlayOpts = {}): OverlayHandle {
    return this.open('sheet', content, opts);
  }

  dialog(content: OverlayContent, opts: OverlayOpts = {}): OverlayHandle {
    return this.open('dialog', content, opts);
  }

  toast(message: string, opts: { kind?: 'info' | 'warn' } = {}): void {
    const id = ++this.seq;
    this.toasts = [...this.toasts, { id, message, kind: opts.kind ?? 'info' }];
    globalThis.setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    }, 4000);
  }

  confirm(req: ConfirmRequest): Promise<boolean> {
    return new Promise((resolve) => {
      let answered = false;
      const answer = (ok: boolean): void => {
        answered = true;
        handle.close();
        resolve(ok);
      };
      const handle = this.open(
        'dialog',
        {
          render: () =>
            html`<div class="confirm">
              <p>${req.text}</p>
              <div class="buttons">
                <button @click=${() => answer(false)}>${req.cancelLabel ?? 'Cancel'}</button>
                <button
                  class=${req.danger === true ? 'danger' : 'primary'}
                  @click=${() => answer(true)}
                >
                  ${req.confirmLabel ?? 'Confirm'}
                </button>
              </div>
            </div>`,
        },
        {},
      );
      // Escape, the backdrop, or the back button all mean no.
      void handle.closed.then(() => {
        if (!answered) resolve(false);
      });
    });
  }

  private open(
    kind: 'sheet' | 'dialog',
    content: OverlayContent,
    opts: OverlayOpts,
  ): OverlayHandle {
    const id = ++this.seq;
    let done!: () => void;
    const closed = new Promise<void>((r) => {
      done = r;
    });
    this.stack = [...this.stack, { id, kind, content, opts, done }];
    // One history entry per overlay, so back peels one off (§5.6).
    globalThis.history.pushState({ [BACK_MARK]: id }, '');
    this.lock();
    return { close: () => this.drop(id, true), closed };
  }

  /**
   * Take one overlay off the stack.
   *
   * `unwind` says whether this close should also spend the history entry the
   * open pushed. A close we chose to do should; a close the back button already
   * caused must not, or the page navigates twice for one gesture.
   */
  private drop(id: number, unwind: boolean): void {
    const entry = this.stack.find((e) => e.id === id);
    if (entry === undefined) return;
    this.stack = this.stack.filter((e) => e.id !== id);
    entry.done();
    if (this.stack.length === 0) this.unlock();
    if (unwind && globalThis.history.state?.[BACK_MARK] === id) globalThis.history.back();
  }

  private lock(): void {
    document.documentElement.style.overflow = 'hidden';
  }

  private unlock(): void {
    document.documentElement.style.overflow = '';
  }

  override updated(): void {
    // A `<dialog>` is inert until it is told to be modal, and it only exists
    // once Lit has rendered it.
    for (const el of this.renderRoot.querySelectorAll('dialog')) {
      if (!el.open) el.showModal();
    }
  }

  override render() {
    return html`
      ${this.stack.map(
        (e) =>
          html`<dialog
            class=${e.kind}
            part=${e.kind}
            @cancel=${() => this.drop(e.id, true)}
            @click=${(ev: MouseEvent) => this.backdrop(ev, e.id)}
          >
            <!-- Always a way out, even when the content names itself. A title
               here plus a name in the content is the same thing said twice. -->
            <header ?data-bare=${e.opts.title === undefined}>
              ${e.opts.title === undefined ? nothing : html`<h2>${e.opts.title}</h2>`}
              <button class="close" aria-label="Close" @click=${() => this.drop(e.id, true)}>
                ✕
              </button>
            </header>
            <div class="body">${this.body(e)}</div>
          </dialog>`,
      )}
      <div class="toasts" part="toasts" role="status" aria-live="polite">
        ${this.toasts.map(
          (t) => html`<div class="toast" data-kind=${t.kind} part="toast">${t.message}</div>`,
        )}
      </div>
    `;
  }

  private body(e: Entry) {
    if ('render' in e.content) return e.content.render();
    // Built once and kept: rebuilding it on every host render would restart
    // whatever the widget was doing, which for a chart is a history fetch.
    if (e.node === undefined) {
      const tag = tagFor(e.content.widget.type);
      if (tag === undefined) return html`<div>No widget for ${e.content.widget.type}.</div>`;
      e.node = document.createElement(tag);
    }
    mountWidget(e.node as MountTarget, e.content.widget, this.env);
    return e.node;
  }

  /** A click on the backdrop is a click on the dialog outside its own box. */
  private backdrop(ev: MouseEvent, id: number): void {
    const el = ev.currentTarget as HTMLDialogElement;
    if (ev.target !== el) return;
    const r = el.getBoundingClientRect();
    const inside =
      ev.clientX >= r.left &&
      ev.clientX <= r.right &&
      ev.clientY >= r.top &&
      ev.clientY <= r.bottom;
    if (!inside) this.drop(id, true);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-overlay': HcOverlay;
  }
}
