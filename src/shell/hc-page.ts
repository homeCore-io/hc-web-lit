/**
 * A dashboard page: document in, laid-out elements out.
 *
 * Two modes, because the document has two (§14.1). A layout with a `frame` was
 * *composed* — every placement carries a `rect` in frame units and is positioned
 * absolutely, which is what a person meant when they put a reading over a
 * photograph. A layout without one is a *grid*, and CSS Grid draws it from the
 * normalised cells.
 *
 * Both go through `Engine.normalize` first, and that is not a formality: core
 * rejects the whole dashboard on the first illegal placement, so what is drawn
 * has to be what would be saved (§5.7).
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type {
  DashboardBreakpoint,
  DashboardDefinition,
  DashboardWidget,
} from '../core/dashboard.js';
import { gridItems, layoutFor } from '../core/dashboard.js';
import { Engine, type GridItem } from '../core/layout.js';
import type { SelectionContext } from '../core/selection.js';
import type { DeviceStore } from '../core/store.js';
import type { CommandRequest } from '../widgets/hc-controls.js';
import type { HistoryFetch } from '../widgets/hc-history-chart.js';
import { tagFor } from '../widgets/registry.js';

@customElement('hc-page')
export class HcPage extends LitElement {
  static override styles = css`
    :host {
      display: block;
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    .frame {
      position: relative;
      margin: 0 auto;
      /* A composed page states its own size; the viewport scales to it rather
         than reflowing it, because reflowing a composition is not a smaller
         version of it. */
      transform-origin: top left;
    }
    .grid {
      display: grid;
      align-content: start;
    }
    .placed {
      position: absolute;
      box-sizing: border-box;
      min-width: 0;
    }
    .cell {
      min-width: 0;
    }
    .unknown {
      display: grid;
      place-items: center;
      height: 100%;
      box-sizing: border-box;
      border: 1px dashed var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-md, 14px);
      color: var(--hc-ink-muted, #8b95a4);
      font-size: 0.75rem;
      text-align: center;
      padding: 0.25rem;
      overflow: hidden;
    }
    .empty {
      padding: 2rem;
      text-align: center;
      opacity: 0.6;
    }
  `;

  @property({ attribute: false }) doc: DashboardDefinition | undefined;
  @property({ type: String }) breakpoint: DashboardBreakpoint = 'desktop';
  @property({ attribute: false }) store: DeviceStore | undefined;
  /** Scale a composed page to this width. 0 means draw at natural size. */
  @property({ type: Number }) fitWidth = 0;
  /**
   * Where a widget's commands go.
   *
   * Passed down rather than reached for: a widget holds no token, no base URL
   * and no socket (§19.4), and the host is the one place a safety policy could
   * refuse an actuation (§5.10). This is the seed of `ctx.call`.
   */
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  /**
   * What `@room` and `@picked` mean on this page.
   *
   * **This is the placement seam.** A room page is one document reused for
   * every room — the widgets say `area_name: "@room"` and the page says which
   * room, so there is one saved page rather than one per room. Resolving it
   * here rather than inside each widget is what keeps the token out of the
   * widget vocabulary entirely.
   */
  @property({ attribute: false }) context: SelectionContext = {};

  /** The host's history reader — §5.9's `ctx.history`, passed rather than held. */
  @property({ attribute: false }) onFetch: HistoryFetch | undefined;

  @state() private tick = 0;

  private unsubscribe: (() => void) | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    // One subscription for the page, not one per card. Phase 0 redraws the
    // page on any change; per-widget binding is what P2 and §4.2 are for and
    // arrives with the widgets that declare bindings.
    this.unsubscribe = this.store?.subscribeAll(() => {
      this.tick += 1;
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  override render() {
    const doc = this.doc;
    if (doc === undefined) return html`<div class="empty">No dashboard.</div>`;

    const layout = layoutFor(doc, this.breakpoint);
    if (layout === undefined) {
      return html`<div class="empty">
        This page has no ${this.breakpoint} layout.
        ${
          (doc.layouts ?? []).length > 0
            ? html`It has ${(doc.layouts ?? []).map((l) => l.breakpoint).join(', ')}.`
            : nothing
        }
      </div>`;
    }

    const widgets = doc.widgets ?? [];
    const byId = new Map(widgets.map((w) => [w.id, w]));
    const engine = new Engine(layout.columns, layout.flow ?? 'packed');
    const items = engine.normalize(gridItems(layout, widgets));

    return layout.frame != null
      ? this.composed(items, byId, layout.frame, layout.gap)
      : this.grid(items, byId, layout.columns, layout.row_height, layout.gap);
  }

  private composed(
    items: readonly GridItem[],
    byId: Map<string, DashboardWidget>,
    frame: { width: number; height: number },
    _gap: number,
  ) {
    const scale = this.fitWidth > 0 ? this.fitWidth / frame.width : 1;
    return html`
      <div
        class="frame"
        style="width:${frame.width}px;height:${frame.height}px;transform:scale(${scale})"
      >
        ${items.map((item) => {
          const w = byId.get(item.id);
          const r = item.rect;
          if (w === undefined || r == null) return nothing;
          const z = w.config?.['z'];
          return html`<div
            class="placed"
            style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;${
              typeof z === 'number' ? `z-index:${z}` : ''
            }"
          >
            ${this.draw(w)}
          </div>`;
        })}
      </div>
    `;
  }

  private grid(
    items: readonly GridItem[],
    byId: Map<string, DashboardWidget>,
    columns: number,
    rowHeight: number,
    gap: number,
  ) {
    return html`
      <div
        class="grid"
        style="grid-template-columns:repeat(${columns},1fr);
               grid-auto-rows:${rowHeight}px;
               gap:${gap}px"
      >
        ${items.map((item) => {
          const w = byId.get(item.id);
          if (w === undefined) return nothing;
          return html`<div
            class="cell"
            style="grid-column:${item.x + 1}/span ${item.w};
                   grid-row:${item.y + 1}/span ${item.h}"
          >
            ${this.draw(w)}
          </div>`;
        })}
      </div>
    `;
  }

  /**
   * Draw one widget, or say plainly that we cannot.
   *
   * An unknown `type` is expected, not exceptional (see `widgets/registry.ts`):
   * core accepts types it has never heard of, so a client that treats one as an
   * error is a client that breaks whenever a plugin ships a card. The
   * placeholder names the type, which is also what makes it useful while the
   * widget family is still being written.
   */
  private draw(w: DashboardWidget) {
    const tag = tagFor(w.type);
    if (tag === undefined) return html`<div class="unknown" part="unknown">${w.type}</div>`;

    const el = document.createElement(tag) as HTMLElement & {
      config?: Record<string, unknown>;
      device?: unknown;
      devices?: readonly unknown[];
      context?: SelectionContext;
      onCommand?: (r: CommandRequest) => void;
      onFetch?: HistoryFetch;
    };
    el.config = w.config ?? {};

    // A widget that names one device gets it resolved; one that selects a set
    // gets the whole store and does its own selecting, because the selection is
    // live — a device appearing in a room has to appear in the list.
    const deviceId = w.config?.['device_id'];
    if (typeof deviceId === 'string') {
      el.device = this.store?.get(
        deviceId === '@picked' ? (this.context.picked ?? deviceId) : deviceId,
      );
    }
    if (this.store !== undefined) el.devices = this.store.list();
    el.context = this.context;
    if (this.onCommand !== undefined) el.onCommand = this.onCommand;
    if (this.onFetch !== undefined) el.onFetch = this.onFetch;
    el.style.height = '100%';
    return el;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-page': HcPage;
  }
}
