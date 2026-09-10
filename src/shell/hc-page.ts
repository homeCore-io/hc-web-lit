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
import { gridItems, layoutToDraw } from '../core/dashboard.js';
import { Engine, type GridItem } from '../core/layout.js';
import type { SelectionContext } from '../core/selection.js';
import { isVisible } from '../core/visibility.js';
import type { DeviceStore } from '../core/store.js';
import type { CommandRequest } from '../core/widget.js';
import type { EventFetch } from '../widgets/hc-event-feed.js';
import type { HistoryFetch } from '../widgets/hc-history-chart.js';
import { tagFor } from '../core/registry.js';
import type { ActionConfig } from '../core/actions.js';
import type { TemplateStore } from '../core/templates.js';
import { mountWidget, specFor, type MountEnv, type MountTarget } from './mount.js';

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
      /* A placement is the size the author drew, and a widget does not get to
         disagree. A device set of twelve full cards in a short box escaped its
         rect and drew over three neighbours — which is not a widget that needs
         more room, it is a page that has stopped being the arrangement
         somebody saved. Widgets that scroll (a set, a feed) do it inside
         this. */
      overflow: hidden;
    }
    .cell {
      min-width: 0;
      overflow: hidden;
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
  /** Hold to inspect, everywhere — the non-actuating path (§5.10). */
  @property({ attribute: false }) onDetails: ((deviceId: string) => void) | undefined;

  /** What a placement's `on_tap` does. Dispatched by the host (§5.10). */
  @property({ attribute: false }) onAction: ((a: ActionConfig) => void) | undefined;

  /** Where widget templates come from (§5.4). */
  @property({ attribute: false }) templates: TemplateStore | undefined;

  /** Album or channel art, fetched by the host (§19.4). */
  @property({ attribute: false }) onArt:
    ((deviceId: string) => Promise<string | undefined>) | undefined;

  /**
   * What the plugins can be asked to do, and what this session may run (§5.11).
   *
   * Passed down rather than reached for: the page rebuilds a `MountEnv` from
   * the properties it is given, so a capability the shell holds and never
   * hands over is one no widget on a page can see. That is exactly how this
   * went missing — `hc-app` put `plugins` in *its* env, and `hc-page` builds a
   * different one.
   */
  @property({ attribute: false }) plugins: MountEnv['plugins'];

  @property({ attribute: false }) scopes: readonly string[] | undefined;

  /** Correct a device's presentation (§1.1). */
  @property({ attribute: false }) onUpdateDevice: MountEnv['onUpdateDevice'];

  /** Save the household's icon rules (§11.2). */
  @property({ attribute: false }) onSaveIconRules: MountEnv['onSaveIconRules'];

  /** Save the household's locale, units and clock (§4.2). */
  @property({ attribute: false }) onSavePreferences: MountEnv['onSavePreferences'];

  /** Core's table of what a widget config may hold (§4.4). */
  @property({ attribute: false }) vocabulary: MountEnv['vocabulary'];

  /** The pages this household has, for a widget that links to one. */
  @property({ attribute: false }) pages: MountEnv['pages'];

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

  /** The host's log reader — same seam as history. */
  @property({ attribute: false }) onEvents: EventFetch | undefined;

  @state() private tick = 0;

  /**
   * Widget elements, by id, so a re-render updates them instead of
   * replacing them. Cleared when the document changes, because ids are only
   * unique within one.
   */
  private readonly elements = new Map<string, HTMLElement>();

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

  override willUpdate(changed: Map<string, unknown>): void {
    // Widget ids are unique within a document, not across documents, so a
    // cached element from the last page would be handed the wrong config.
    if (changed.has('doc')) this.elements.clear();
  }

  override render() {
    const doc = this.doc;
    if (doc === undefined) return html`<div class="empty">No dashboard.</div>`;

    // Not the layout asked for, necessarily. Three of the four dashboards in
    // the reference house carry `desktop` and nothing else, and telling a
    // phone that its dashboard has no mobile layout is honest and useless —
    // the document has 36 widgets and something to show.
    const chosen = layoutToDraw(doc, this.breakpoint);
    if (chosen === undefined) {
      return html`<div class="empty">This dashboard has no layouts.</div>`;
    }
    const layout = chosen.layout;

    const widgets = doc.widgets ?? [];
    const byId = new Map(widgets.map((w) => [w.id, w]));
    const engine = new Engine(layout.columns, layout.flow ?? 'packed');
    const items = engine.normalize(gridItems(layout, widgets));

    return layout.frame != null
      ? this.composed(items, byId, layout.frame, layout.gap)
      : this.grid(items, byId, layout.columns, layout.row_height, layout.gap);
  }

  /**
   * A composed page, at the size its author drew it.
   *
   * `frame.fit` is the document's own answer to "what happens on a narrower
   * screen", and it was being ignored: the page scaled whenever `fitWidth` was
   * set, which is nobody, and never read the field. The reference house says
   * `scroll` on a 1240×1248 canvas, so a tablet scrolls sideways rather than
   * rendering the composition at two thirds — and a document that says
   * `contain` gets what it asked for instead of the same behaviour.
   */
  private composed(
    items: readonly GridItem[],
    byId: Map<string, DashboardWidget>,
    frame: { width: number; height: number; fit?: string | null },
    _gap: number,
  ) {
    const fit = frame.fit ?? 'scroll';
    const room = this.fitWidth > 0 ? this.fitWidth : this.clientWidth;
    const scale = fit === 'scroll' || room <= 0 ? 1 : room / frame.width;
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
  /** What every widget on this page is given (§4.2's shape, in practice). */
  private env(): MountEnv {
    return {
      store: this.store,
      context: this.context,
      // The page owns `@picked`, because every other element resolving that
      // token is resolving it here (§14.1).
      onPick: (deviceId: string) => {
        this.context = { ...this.context, picked: deviceId };
      },
      // Tapping a room opens it: the same document, a different `@room`.
      onOpenRoom: (room, page) => {
        this.dispatchEvent(
          new CustomEvent('hc-open-room', {
            detail: { room, page },
            bubbles: true,
            composed: true,
          }),
        );
      },
      ...(this.templates !== undefined ? { templates: this.templates } : {}),
      ...(this.onCommand !== undefined ? { onCommand: this.onCommand } : {}),
      ...(this.onFetch !== undefined ? { onFetch: this.onFetch } : {}),
      ...(this.onEvents !== undefined ? { onEvents: this.onEvents } : {}),
      ...(this.onDetails !== undefined ? { onDetails: this.onDetails } : {}),
      ...(this.onAction !== undefined ? { onAction: this.onAction } : {}),
      ...(this.onArt !== undefined ? { onArt: this.onArt } : {}),
      ...(this.plugins !== undefined ? { plugins: this.plugins } : {}),
      ...(this.scopes !== undefined ? { scopes: this.scopes } : {}),
      ...(this.onUpdateDevice !== undefined ? { onUpdateDevice: this.onUpdateDevice } : {}),
      ...(this.onSaveIconRules !== undefined ? { onSaveIconRules: this.onSaveIconRules } : {}),
      ...(this.onSavePreferences !== undefined
        ? { onSavePreferences: this.onSavePreferences }
        : {}),
      ...(this.vocabulary !== undefined ? { vocabulary: this.vocabulary } : {}),
      ...(this.pages !== undefined ? { pages: this.pages } : {}),
    };
  }

  private draw(w: DashboardWidget) {
    // An element the document says to hide is not drawn at all, rather than
    // drawn and hidden: the SETS controls exist to aim at a light you have
    // touched, and before you touch one there is nothing to aim at (§14.1).
    if (!isVisible(w.config ?? {}, this.store?.list() ?? [], this.context)) return nothing;

    // A template instance stands for another widget entirely, so what to draw
    // is decided before which tag draws it (§5.4).
    const spec = specFor({ type: w.type, config: w.config ?? {} }, this.env());
    const tag = tagFor(spec.type);
    if (tag === undefined) {
      const said = spec.config?.['text'];
      return html`<div class="unknown" part="unknown">
        ${typeof said === 'string' ? said : spec.type}
      </div>`;
    }

    // **Reused, not recreated.** `draw` runs on every render, and the page
    // re-renders on every device change — 184 devices streaming means many a
    // second. Creating a fresh element each time destroys and rebuilds every
    // widget, which reads as a flicker and, for the history chart, re-fetches
    // six hours of readings each time. Keyed by the widget's own id, which is
    // exactly what it is for.
    const key = `${w.id}:${tag}`;
    const cached = this.elements.get(key);
    const el = (cached ?? document.createElement(tag)) as MountTarget;
    this.elements.set(key, el);

    // One wiring, shared with the overlay (§5.6): a widget that works on a
    // page works in a sheet, because it is given the same things in both.
    //
    // **Caught, because a widget is somebody else's code** (§8.1). A throw
    // here used to propagate out of `render`, which aborts the *page* — Lit
    // leaves the previous frame's DOM in place, so the symptom is a dashboard
    // that has quietly stopped updating while the new document is already
    // installed. One extension with a bad config is not allowed to do that;
    // the widget that failed says so where it sits and the rest draw.
    try {
      mountWidget(el, spec, this.env());
    } catch (e) {
      // Dropped from the cache: a half-mounted element would be reused on the
      // next render and fail the same way with its state already wrong.
      this.elements.delete(key);
      return html`<div class="unknown" part="unknown">
        ${spec.type}: ${e instanceof Error ? e.message : String(e)}
      </div>`;
    }
    el.style.height = '100%';
    return el;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-page': HcPage;
  }
}
