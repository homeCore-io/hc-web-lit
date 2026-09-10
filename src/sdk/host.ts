/**
 * Building an `HcContext` from what the host has.
 *
 * The adapter, kept apart from the interface so the interface stays the thing
 * an extension author reads. Everything here is a narrowing: the host holds a
 * store, an API client and an overlay stack, and a widget gets functions over
 * them and never the things themselves (§19.4).
 */
import { evaluate, type ExprScope } from '../core/expr.js';
import { runQuery, type DeviceQuery } from '../core/query.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest, EventFetch, HistoryFetch, WidgetSpec } from '../core/widget.js';
import type { ActionConfig } from '../core/actions.js';
import type { DeviceStore } from '../core/store.js';
import type { SelectionContext } from '../core/selection.js';
import type { TemplateStore } from '../core/templates.js';
import type { PluginRunner } from '../core/plugins.js';
import type { IconRule } from '../design/icons.js';
import type { Tokens } from '../design/tokens.js';
import type { Vocabulary } from '../core/vocabulary.js';
import type { DashboardLayout, DashboardWidget } from '../core/dashboard.js';
import type { Box } from '../core/pages.js';
import { locale, units, type Preferences } from '../core/i18n.js';

/**
 * Everything a widget is given that it cannot reach for itself.
 *
 * The host fills this in and `contextFor` narrows it into an `HcContext`. It
 * lives here rather than in the shell because the SDK is what an extension
 * reads: a package cannot depend on the application that contains it, and this
 * type is half the definition of what a host *is*.
 */
export interface MountEnv {
  store: DeviceStore | undefined;
  context: SelectionContext;
  onCommand?: (r: CommandRequest) => void;
  onFetch?: HistoryFetch;
  onEvents?: EventFetch;
  /** A widget saying what was touched; the host owns what `@picked` means. */
  onPick?: (deviceId: string) => void;
  onOpenRoom?: (room: string, page: string | undefined) => void;
  /** The non-actuating way to inspect a device (§5.10) — hold, everywhere. */
  onDetails?: (deviceId: string) => void;
  /** What a placement's `on_tap` does. The host dispatches it (§5.10). */
  onAction?: (a: ActionConfig) => void;
  /** Where widget templates come from (§5.4). Absent means none are defined. */
  templates?: TemplateStore;

  /**
   * Build a child widget, for `ctx.child` (§5.5).
   *
   * Supplied by `mountWidget`, which is the only thing that knows how — and
   * injected rather than imported, because the SDK depends downward only and
   * `mountChild` lives in the shell. A widget composing children is asking the
   * host to do it, which is the same shape every other capability here has.
   */
  mountChild?: (spec: WidgetSpec) => HTMLElement | undefined;
  /** Open a sheet on a widget spec (§5.6). */
  onSheet?: (content: WidgetSpec) => void;
  /** Album or channel art, fetched by the host because it needs the bearer. */
  onArt?: (deviceId: string) => Promise<string | undefined>;
  /**
   * What the plugins can be asked to do (§5.11).
   *
   * A capability rather than a client: the widget names an operation a plugin
   * declared and the host performs it, so §19.4 holds here as everywhere —
   * nothing but the host touches the socket or the token.
   */
  plugins?: PluginRunner;
  /**
   * Correct a device's presentation — `ui_hint`, `area`, a name (§1.1).
   *
   * A capability rather than a client: the widget names the change and the
   * host performs it, so §19.4 holds here as everywhere.
   */
  onUpdateDevice?: (deviceId: string, patch: Record<string, unknown>) => Promise<void>;
  /**
   * Save the household's icon rules and put them into force (§11.2).
   *
   * A capability rather than the store itself: the rules are module state by
   * design (`icons.ts`), and what a widget needs is the ability to *change*
   * them, not a reference to where they live.
   */
  onSaveIconRules?: (rules: IconRule[]) => void;
  /**
   * What this session may do, from `/auth/me` (§5.11).
   *
   * So a control gated on `requires_role` is not offered rather than being
   * offered and refused — §5.10's reasoning about actions, one level up.
   */
  scopes?: readonly string[];
  /** Resolved design tokens, so a widget restyles with the house (§15). */
  tokens?: Tokens;
  /**
   * Save the household's locale, units and clock, and put them into force.
   *
   * A capability rather than the store, exactly as the icon rules are: what a
   * widget needs is the ability to *change* them, not a reference to where
   * they live.
   */
  onSavePreferences?: (next: Preferences) => void;
  /**
   * The widgets on the page being drawn.
   *
   * Reading, which is not the same shape as writing: the save takes a widget
   * id and a config (below), because a widget that could hand over a whole
   * page could rewrite the page it is on. An editor needs to *see* the page
   * to offer a choice of what to edit, and the layouts — where things sit —
   * are not part of that and are not handed over.
   */
  pageWidgets?: readonly DashboardWidget[];
  /**
   * Save one widget's config back into the page it is on.
   *
   * The narrowest write that is useful: a widget id and a config, not a
   * document. A widget that could hand over a whole page could rewrite the
   * page it is on, and the host is the thing that owns what a page is (§19.4).
   *
   * Absent means this session cannot write — an older core, or a credential
   * without `dashboards:write` — and a widget that offers a save it cannot
   * perform is worse than one that does not offer it (§5.11).
   */
  onSaveWidget?: (widgetId: string, config: Record<string, unknown>) => Promise<void>;
  /**
   * Put a widget on the page, and say what it was called.
   *
   * The type only: a widget cannot choose where another one sits, because
   * where things sit is the page's business and the designer's (Phase 10).
   * It lands below everything else with an empty config, which is the honest
   * first frame — a config invented here would be a widget that looks
   * configured and points at nothing.
   */
  onAddWidget?: (type: string) => Promise<string>;
  /** Take one off the page, with its placements. */
  onRemoveWidget?: (widgetId: string) => Promise<void>;
  /**
   * Move or resize a widget, in the layout that is on screen.
   *
   * The units are the layout's own — cells on a packed page, pixels in the
   * frame on a composed one — and the host decides which, because which
   * layout is being drawn is the host's question (§5.7).
   */
  onPlaceWidget?: (widgetId: string, box: Box) => Promise<void>;
  /** The placements of the layout being drawn, so a surface can show them. */
  pagePlacements?: DashboardLayout | undefined;
  /**
   * The size being drawn.
   *
   * Which is not the same as the layout's own breakpoint: a page with only a
   * desktop layout is drawn at every size by borrowing it (§5.7), and a
   * surface that offers to move something has to be able to say so.
   */
  breakpoint?: string;
  /**
   * What is installed, and how to install something (§18.2).
   *
   * The listing is the host's own startup round rather than a second fetch: a
   * widget showing a different answer from the one the page was drawn with is
   * a widget explaining a failure that is not the one anybody has.
   */
  extensions?: { loaded: unknown[]; failed: { id: string; error: string }[] };
  onInstallExtension?: (archive: ArrayBuffer) => Promise<{ id: string; files: number }>;
  /**
   * The pages this household has, for a widget that links to one (§5.10).
   *
   * Names and ids, never the documents: a widget that wanted to *read*
   * another page would be reaching around the host, and one that wants to
   * offer a link needs only what it is called.
   */
  pages?: readonly { id: string; name: string; icon?: string }[];
  /**
   * Core's dashboard vocabulary (§4.4), when this session has reached core.
   *
   * Read by the property panel to generate its controls. Optional and often
   * absent — a panel that is offline (§16) has a cached document and no
   * vocabulary, and must still be able to edit it.
   */
  vocabulary?: Vocabulary;
  /** Editing or viewing (§14.2). */
  mode?: 'view' | 'edit';
}
import type { HcContext, QueryResult, Unsubscribe } from './context.js';

/**
 * The context for one widget.
 *
 * Built per widget rather than shared, because `subscribe` and `details` are
 * about *this* widget, and because a context that outlived its element would
 * keep a listener alive after the thing that wanted it was gone.
 */
export function contextFor(env: MountEnv, spec: WidgetSpec): HcContext {
  const store = env.store;

  return {
    subscribe(deviceIds: readonly string[], cb: (states: DeviceState[]) => void): Unsubscribe {
      // Without a store there is nothing to hear from, and returning a
      // no-op teardown is kinder than making every caller check.
      return store?.subscribe(deviceIds, cb) ?? (() => undefined);
    },

    device(deviceId: string): DeviceState | undefined {
      return store?.get(deviceId);
    },

    query(q: DeviceQuery): QueryResult {
      return runQuery(q, store?.list() ?? []);
    },

    expr(source: string, scope: ExprScope = {}): unknown {
      // The bound device is in scope without the widget passing it, because a
      // widget that had to assemble its own scope would assemble it wrongly.
      const named = spec.config?.['device_id'];
      const device = typeof named === 'string' ? store?.get(named) : undefined;
      const devices: Record<string, DeviceState> = {};
      for (const d of store?.list() ?? []) devices[d.device_id] = d;
      // `user` is §6.4's named parameter for locale, units and theme — never
      // identity. Declared in the scope since P1 and supplied by nothing
      // until there were preferences to put in it.
      return evaluate(source, {
        devices,
        user: { locale: locale(), units: units() },
        ...(device !== undefined ? { device } : {}),
        ...scope,
      });
    },

    /**
     * **Refused while the page is being edited** (§14.2).
     *
     * Arranging a page means pressing on the things on it, and the things on
     * a page are a household's locks and lights. A drag that started on a
     * lock card and actuated it would be the worst bug this client could
     * have, and "widgets should check the mode" is not a defence — it is a
     * request. So the host does not perform, and a widget cannot opt out of
     * that by not knowing about it.
     */
    call(request) {
      if (env.mode === 'edit') return;
      env.onCommand?.(request);
    },

    action(action) {
      if (env.mode === 'edit') return;
      env.onAction?.(action);
    },

    async history(deviceId, opts) {
      return (await env.onFetch?.(deviceId, opts)) ?? [];
    },

    async art(deviceId) {
      return env.onArt?.(deviceId);
    },

    sheet(content) {
      env.onSheet?.(content);
    },

    details(deviceId) {
      env.onDetails?.(deviceId);
    },

    template(id) {
      const found = env.templates?.get(id);
      return found?.widget;
    },

    child(spec) {
      return env.mountChild?.(spec);
    },

    ...(env.tokens !== undefined ? { tokens: env.tokens } : {}),
    // Read at build time rather than captured: a context outlives a
    // preference change, and a widget asking for the locale wants the one in
    // force now.
    get locale() {
      return locale();
    },
    get units() {
      return units();
    },
    mode: env.mode ?? 'view',
  };
}
