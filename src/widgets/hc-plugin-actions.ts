/**
 * What the plugins can be asked to do — P10's other half, on screen (§5.11).
 *
 * The reference house declares 31 operations across nine plugins and, until
 * this, not one was reachable from the UI. §5.11's claim is that a client can
 * offer them properly — progress, a disabled second run, cancel, and the
 * outcome — **without knowing what Hue is**, and this is that claim made
 * concrete: there is no plugin name in this file, no operation name, and no
 * table of either. Everything drawn is read from what the plugin declared.
 *
 * The four shapes the declarations produce, and what each one changes:
 *
 * - `stream:false` — the answer is in the response, so the button simply
 *   reports it.
 * - `concurrency:single` — a second run must not start, so the control is
 *   disabled while one is in flight. `multi` may overlap and is left alone.
 * - `stream:true` — progress arrives over SSE; without showing it, an
 *   operation is indistinguishable from a hang.
 * - `cancelable:true` — offer a way out.
 *
 * The row that makes this worth building carefully is `zwave include_node`:
 * `requires_role: admin`, `cancelable`, and a **five-minute** timeout, because
 * it means "go and press the button on the device now". A row of plain buttons
 * would show that as a frozen page for five minutes.
 *
 * **`requires_role` is checked before the control is offered**, not after it
 * is pressed — §5.10's reasoning about actions, applied here. A button whose
 * only purpose is to say "you may not" is worse than one that is absent. Core
 * remains the authority; this only decides what to draw.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  actionsOf,
  describeItem,
  isFinal,
  labelOf,
  mayRun,
  nameOf,
  readEvent,
  type CommandEvent,
  type Plugin,
  type PluginRunner,
  type PluginAction,
} from '../core/plugins.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';

/** What one running operation looks like while it runs. */
interface Running {
  key: string;
  label: string;
  percent: number | undefined;
  message: string | undefined;
  items: string[];
  stop: (() => void) | undefined;
  finished: string | undefined;
}

@customElement('hc-plugin-actions')
export class HcPluginActions extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .plugin + .plugin {
      margin-top: calc(var(--hc-space-unit, 8px) * 1.5);
    }
    h3 {
      margin: 0 0 0.5rem;
      font-size: var(--hc-text-overline-size, 10px);
      font-weight: var(--hc-text-overline-weight, 600);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--hc-ink-muted, #8b95a4);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .dot {
      width: 0.4rem;
      height: 0.4rem;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-accent-inactive, #2a313b);
    }
    .dot[data-live] {
      background: var(--hc-accent-success, #6fd1a6);
    }
    .ops {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
    }
    button {
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 calc(var(--hc-space-unit, 8px) * 1.25);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      font-size: var(--hc-text-body-small-size, 12.5px);
      cursor: pointer;
    }
    button:hover:not(:disabled) {
      border-color: color-mix(in srgb, var(--hc-accent-active, #ffb661) 45%, transparent);
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .admin {
      border-style: dashed;
    }
    .run {
      margin-top: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
    }
    .bar {
      height: 3px;
      border-radius: 999px;
      background: var(--hc-accent-inactive, #2a313b);
      overflow: hidden;
      margin: 0.375rem 0;
    }
    .bar span {
      display: block;
      height: 100%;
      background: var(--hc-accent-active, #ffb661);
      transition: width var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out);
    }
    .items {
      margin: 0.25rem 0 0;
      padding-left: 1rem;
      color: var(--hc-ink, #e9edf2);
    }
    .cancel {
      min-height: auto;
      padding: 0.125rem 0.5rem;
      margin-left: 0.5rem;
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
    @media (prefers-reduced-motion: reduce) {
      .bar span {
        transition: none;
      }
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  /** The host's plugin surface. Absent means nothing to offer. */
  @property({ attribute: false }) runner: PluginRunner | undefined;
  /** What this session may do, for the `requires_role` check. */
  @property({ attribute: false }) scopes: readonly string[] | undefined;

  @state() private plugins: Plugin[] = [];
  @state() private running = new Map<string, Running>();
  @state() private trouble = '';

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // A stream left following a command nobody is watching is a socket held
    // open on a panel for as long as the plugin keeps talking.
    for (const run of this.running.values()) run.stop?.();
  }

  private async load(): Promise<void> {
    if (this.runner === undefined) return;
    try {
      this.plugins = await this.runner.list();
    } catch (e) {
      this.trouble = e instanceof Error ? e.message : String(e);
    }
  }

  private key(plugin: Plugin, action: PluginAction): string {
    return `${plugin.plugin_id}:${action.id}`;
  }

  private amend(key: string, patch: Partial<Running>): void {
    const next = new Map(this.running);
    const current = next.get(key);
    if (current === undefined) return;
    next.set(key, { ...current, ...patch });
    this.running = next;
  }

  private async start(plugin: Plugin, action: PluginAction): Promise<void> {
    const runner = this.runner;
    if (runner === undefined) return;
    const key = this.key(plugin, action);

    const next = new Map(this.running);
    next.set(key, {
      key,
      label: labelOf(action),
      items: [],
      percent: undefined,
      message: undefined,
      stop: undefined,
      finished: undefined,
    });
    this.running = next;

    try {
      const started = await runner.run(plugin.plugin_id, action.id);

      if (started.kind === 'done') {
        this.amend(key, { finished: summarise(started.result), percent: 100 });
        return;
      }

      const stop = runner.follow(plugin.plugin_id, started.requestId, (raw) => {
        const event = readEvent(raw);
        if (event === undefined) return;
        this.absorb(key, event);
      });
      this.amend(key, { stop });
    } catch (e) {
      this.amend(key, { finished: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Fold one stream frame into what is on screen. */
  private absorb(key: string, event: CommandEvent): void {
    const run = this.running.get(key);
    if (run === undefined) return;

    if (event.stage === 'item') {
      // Appended rather than counted: an operation that is finding things
      // should show what it found, which is the difference between "working"
      // and "working, and here is why that took a minute".
      this.amend(key, { items: [...run.items, describeItem(event.data)] });
      return;
    }

    const patch: Partial<Running> = {};
    if (event.percent !== undefined) patch.percent = event.percent;
    if (event.message !== undefined) patch.message = event.message;
    else if (event.label !== undefined) patch.message = humanise(event.label);

    if (isFinal(event)) {
      run.stop?.();
      patch.stop = undefined;
      patch.finished = event.message ?? humanise(event.stage ?? 'done');
      patch.percent = 100;
    }
    this.amend(key, patch);
  }

  private cancel(key: string): void {
    const run = this.running.get(key);
    run?.stop?.();
    // Stopping the stream is not stopping the *operation* — core owns that,
    // and nothing here pretends otherwise. Said plainly rather than showing a
    // cancelled state the house has not agreed to.
    this.amend(key, { stop: undefined, finished: 'Stopped watching' });
  }

  private renderRun(run: Running) {
    return html`<div class="run" part="note">
      <div>
        ${run.label}${run.message !== undefined ? ` — ${run.message}` : ''}
        ${
          run.stop !== undefined
            ? html`<button class="cancel" part="action" @click=${() => this.cancel(run.key)}>
                Stop
              </button>`
            : nothing
        }
      </div>
      ${
        run.percent !== undefined
          ? html`<div class="bar"><span style="width:${Math.min(100, run.percent)}%"></span></div>`
          : nothing
      }
      ${
        run.items.length > 0
          ? html`<ul class="items" part="set">
              ${run.items.map((i) => html`<li part="row">${i}</li>`)}
            </ul>`
          : nothing
      }
      ${run.finished !== undefined ? html`<div part="state">${run.finished}</div>` : nothing}
    </div>`;
  }

  override render() {
    if (this.runner === undefined) return nothing;
    if (this.trouble !== '') return html`<div class="empty" part="empty">${this.trouble}</div>`;
    if (this.plugins.length === 0) {
      return html`<div class="empty" part="empty">No plugins.</div>`;
    }

    return html`${this.plugins.map((plugin) => {
      const actions = actionsOf(plugin).filter((a) => mayRun(a, this.scopes));
      if (actions.length === 0) return nothing;

      return html`<div class="plugin" part="row">
        <h3 part="heading">
          <span class="dot" ?data-live=${plugin.status === 'active'}></span>
          ${humanise(nameOf(plugin))}
        </h3>
        <div class="ops" part="controls">
          ${actions.map((action) => {
            const key = this.key(plugin, action);
            const run = this.running.get(key);
            // `single` means a second run must wait; `multi` may overlap, and
            // disabling it would be this client inventing a restriction.
            const busy =
              run !== undefined && run.finished === undefined && action.concurrency === 'single';
            return html`<button
              part="action"
              class=${action.requires_role === 'admin' ? 'admin' : ''}
              ?disabled=${busy}
              title=${action.description ?? ''}
              @click=${() => void this.start(plugin, action)}
            >
              ${labelOf(action)}
            </button>`;
          })}
        </div>
        ${[...this.running.values()]
          .filter((r) => r.key.startsWith(`${plugin.plugin_id}:`))
          .map((r) => this.renderRun(r))}
      </div>`;
    })}`;
  }
}

/**
 * One line for a result that arrived whole.
 *
 * The plugin declared its own `result` fields and they differ per operation —
 * `{count, devices}` here, `{devices}` there — so this reports the shape it
 * was given rather than looking for names it expects.
 */
function summarise(result: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(result)) {
    if (Array.isArray(value)) parts.push(`${value.length} ${humanise(key).toLowerCase()}`);
    else if (typeof value === 'number' || typeof value === 'string') {
      parts.push(`${humanise(key).toLowerCase()} ${String(value)}`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : 'Done';
}

registerWidget('plugin_actions', 'hc-plugin-actions');

declare global {
  interface HTMLElementTagNameMap {
    'hc-plugin-actions': HcPluginActions;
  }
}
