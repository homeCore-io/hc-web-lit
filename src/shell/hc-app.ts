/**
 * The application shell.
 *
 * Deliberately thin. Routing, auth, the connection and theming land here (§3);
 * everything else is a widget, and widgets do not reach around this (§19.4).
 *
 * Phase 0's version: log in, load the device store and a dashboard, keep the
 * store fed from the event stream, and draw the page. No router yet.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HcApi, HcApiError } from '../core/api.js';
import { applyTokens } from '../design/css.js';
import { builtInSeeds, defaultSkin } from '../design/seeds.js';
import { deriveTokens } from '../design/tokens.js';
import type { DashboardBreakpoint, DashboardDefinition } from '../core/dashboard.js';
import { EventStream } from '../core/events.js';
import { check, checkAction } from '../core/safety.js';
import { DeviceStore } from '../core/store.js';
import type { CommandRequest } from '../widgets/hc-controls.js';
import './hc-page.js';
import '../widgets/hc-device-grid.js';
import '../widgets/hc-device-list.js';
import '../widgets/hc-history-chart.js';
import '../widgets/hc-line.js';
import '../widgets/hc-media.js';
import '../widgets/hc-mode-chips.js';
import '../widgets/hc-scene-row.js';
import '../widgets/hc-shape.js';
import '../widgets/hc-text.js';
import '../widgets/hc-device-card.js';

type Phase = 'idle' | 'connecting' | 'ready' | 'failed';

@customElement('hc-app')
export class HcApp extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-height: 100vh;
      background: var(--hc-surface-base, #0b0e13);
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--hc-stroke-hairline, #262d38);
      font-size: 0.875rem;
    }
    .brand {
      color: var(--hc-accent-active, #ffb661);
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .spacer {
      flex: 1;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      opacity: 0.75;
      font-variant-numeric: tabular-nums;
    }
    .dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--hc-accent-inactive, #2a313b);
    }
    .dot[data-live] {
      background: var(--hc-accent-success, #6fd1a6);
    }
    select {
      background: var(--hc-surface-raised, #141922);
      color: inherit;
      border: 1px solid var(--hc-stroke-hairline, #262d38);
      border-radius: 6px;
      padding: 0.25rem 0.5rem;
      font: inherit;
    }
    main {
      padding: 1rem;
    }
    .note {
      padding: 2rem;
      text-align: center;
      opacity: 0.7;
    }
    .error {
      color: var(--hc-accent-danger, #ff7b72);
    }
  `;

  /** Where core is. The shell's business, not any widget's. */
  @property({ type: String }) baseUrl = '/api/v1';

  @state() private phase: Phase = 'idle';
  @state() private message = '';
  @state() private live = false;
  @state() private docs: DashboardDefinition[] = [];
  @state() private current: DashboardDefinition | undefined;
  @state() private breakpoint: DashboardBreakpoint = 'desktop';
  @state() private skin = defaultSkin;

  private readonly store = new DeviceStore();
  private api: HcApi | undefined;
  private stream: EventStream | undefined;

  /**
   * Every command a widget asks for passes through here.
   *
   * The host dispatches, so the host is where the safety policy is a rule
   * rather than a convention (§5.10, §11.3) — a widget cannot opt out of a
   * confirmation by mishandling its own events, because it never had the
   * chance to send anything itself.
   */
  private readonly command = (r: CommandRequest): void => {
    const api = this.api;
    const device = this.store.get(r.deviceId);
    if (api === undefined || device === undefined) return;

    const verdict =
      r.action !== undefined ? checkAction(device, r.action.id) : check(device, r.patch ?? {});

    if ('allow' in verdict && !verdict.allow) return;
    if ('confirm' in verdict && !globalThis.confirm(verdict.confirm)) return;

    // Accepted, not applied: core answers 202 and the real state arrives on the
    // stream. A failure here is worth saying out loud rather than swallowing —
    // a control that silently does nothing is the worst kind.
    const sent =
      r.action !== undefined
        ? api.callAction(r.deviceId, r.action.id, r.action.params)
        : api.commandDevice(r.deviceId, r.patch ?? {});

    void sent.catch((e: unknown) => {
      this.message = e instanceof HcApiError ? e.message : String(e);
    });
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.paint();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stream?.stop();
  }

  /**
   * Tokens go on the document root, not on this element.
   *
   * A widget in a shadow root inherits custom properties through the tree, and
   * an overlay the host opens is not inside this element at all (§5.6). One
   * place, so a skin change repaints everything including third-party widgets
   * and floorplan layers (§15).
   */
  private paint(): void {
    const seeds = builtInSeeds[this.skin];
    if (seeds === undefined) return;
    applyTokens(document.documentElement, deriveTokens(seeds));
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('skin')) this.paint();
  }

  private async connect(username: string, password: string): Promise<void> {
    this.phase = 'connecting';
    this.message = '';
    try {
      const api = new HcApi({ baseUrl: this.baseUrl });
      await api.login(username, password);
      this.api = api;

      // Schemas inline: one request, and the controls a device offers are known
      // on first paint rather than after N more round trips (§5.11).
      this.store.reset(await api.listDevices({ includeSchema: true }));
      this.docs = (await api.listDashboards()) as DashboardDefinition[];
      this.current = this.docs[0];

      this.stream = new EventStream({
        url: api.streamUrl({ type: ['device_state_changed', 'device_availability_changed'] }),
        onEvent: (e) => this.store.apply(e),
        onStatus: (connected) => {
          this.live = connected;
        },
      });
      this.stream.start();

      this.phase = 'ready';
    } catch (e) {
      this.phase = 'failed';
      this.message =
        e instanceof HcApiError ? e.message : `Could not reach ${this.baseUrl} — ${String(e)}`;
    }
  }

  /**
   * History, read through the host like everything else (§19.4).
   *
   * A widget holding an API client would hold a token; this is the same shape
   * as the command sink and becomes `ctx.history` when the capability object
   * exists (§5.9).
   */
  private readonly history = async (
    deviceId: string,
    opts: { from: Date; to: Date; limit: number },
  ) => {
    if (this.api === undefined) return [];
    return this.api.deviceHistory(deviceId, opts);
  };

  override render() {
    return html`
      <header>
        <span class="brand">homeCore</span>
        ${
          this.phase === 'ready'
            ? html`
                <select
                  @change=${(e: Event) => {
                    const id = (e.target as HTMLSelectElement).value;
                    this.current = this.docs.find((d) => d.id === id);
                  }}
                >
                  ${this.docs.map((d) => html`<option value=${d.id}>${d.name}</option>`)}
                </select>
                <select
                  .value=${this.breakpoint}
                  @change=${(e: Event) => {
                    this.breakpoint = (e.target as HTMLSelectElement).value as DashboardBreakpoint;
                  }}
                >
                  ${(['mobile', 'tablet', 'desktop', 'tv'] as const).map(
                    (b) =>
                      html`<option value=${b} ?selected=${b === this.breakpoint}>${b}</option>`,
                  )}
                </select>
              `
            : nothing
        }
        <span class="spacer"></span>
        ${
          this.phase === 'ready'
            ? html`<span class="status">
                <span class="dot" ?data-live=${this.live}></span>
                ${this.live ? 'live' : 'reconnecting'} · ${this.store.size} devices
              </span>`
            : nothing
        }
      </header>
      <main>${this.body()}</main>
    `;
  }

  private body() {
    if (this.phase === 'idle') {
      return html`<div class="note">
        <button
          @click=${() => {
            void this.connect('admin', 'password');
          }}
        >
          Connect
        </button>
      </div>`;
    }
    if (this.phase === 'connecting') return html`<div class="note">Connecting…</div>`;
    if (this.phase === 'failed') return html`<div class="note error">${this.message}</div>`;

    return html`
      ${this.message !== '' ? html`<div class="note error">${this.message}</div>` : nothing}
      <hc-page
        .doc=${this.current}
        .store=${this.store}
        .onCommand=${this.command}
        .onFetch=${this.history}
        breakpoint=${this.breakpoint}
      ></hc-page>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-app': HcApp;
  }
}
