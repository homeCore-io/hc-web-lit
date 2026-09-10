/**
 * `HcContext` — the capability boundary (§4.2), shaped by what widgets ask for.
 *
 * §4.2 sketched this before anything used it. Twenty-five widgets later the
 * shape is not a sketch: `mount.ts` is the list of what a widget genuinely
 * needs, discovered by handing it over one property at a time, and this is
 * that list named properly. Building it the other way round — nine primitives
 * designed against imagined widgets — is the cost §18.1 warns about, and the
 * reason Phase 0 exists.
 *
 * **Every host primitive is reachable here**, which is what stops an extension
 * from reimplementing one. If a widget can only get a capability by reaching
 * around the host, the primitive is missing or wrong (§5.1).
 *
 * **Narrow enough to be messages** (§3 Rule 3). Calls are direct and in-realm;
 * the discipline is that they *could* be posted, so isolating a widget later
 * is a transport swap rather than an ecosystem-breaking rewrite. Nothing here
 * hands over a host object: data in, data out.
 */
import type { DeviceQuery } from '../core/query.js';
import type { DeviceState } from '../core/device.js';
import type { ExprScope } from '../core/expr.js';
import type { HistoryEntry } from '../core/api.js';
import type { ActionConfig } from '../core/actions.js';
import type { Tokens } from '../design/tokens.js';
import type { CommandRequest } from '../core/widget.js';
import type { WidgetSpec } from '../core/widget.js';

export type Unsubscribe = () => void;

/** What a device set resolved to, with the count before the limit. */
export interface QueryResult {
  devices: DeviceState[];
  total: number;
}

export interface HcContext {
  /**
   * Scoped subscription: the host pushes only the devices asked for.
   *
   * Home Assistant sets a whole `hass` object on every card on every state
   * change, so all cards re-render on unrelated updates. Declaring up front
   * and fanning out per device is what keeps a wall tablet usable (§4.2).
   */
  subscribe(deviceIds: readonly string[], cb: (states: DeviceState[]) => void): Unsubscribe;

  /** One device, now. */
  device(deviceId: string): DeviceState | undefined;

  /** P2 — resolve a query to a live set (§5.3). */
  query(q: DeviceQuery): QueryResult;

  /** P1 — evaluate a pure expression against the binding scope (§6). */
  expr(source: string, scope?: ExprScope): unknown;

  /**
   * Ask the house to do something.
   *
   * The host applies auth, the safety policy and any confirmation (§5.10,
   * §11.3), which is why this is a request and not a call: a widget cannot
   * opt out of a policy it does not perform.
   */
  call(request: CommandRequest): void;

  /** P9 — run a configured action with the shared policy (§5.10). */
  action(action: ActionConfig): void;

  /** P8 — history, already downsampled (§5.9). */
  history(deviceId: string, opts: { from: Date; to: Date; limit: number }): Promise<HistoryEntry[]>;

  /**
   * Album or channel art for a media device, as a URL this page can show.
   *
   * The host fetches it, because core proxies it behind the bearer and a
   * widget must never hold one (§19.4).
   */
  art(deviceId: string): Promise<string | undefined>;

  /** P5 — a sheet the host owns, from a widget spec that could be stored (§5.6). */
  sheet(content: WidgetSpec): void;

  /** The non-actuating way to inspect a device — `hold`, everywhere (§5.10). */
  details(deviceId: string): void;

  /** P3 — what a template instance stands for (§5.4). */
  /**
   * Build a child widget from a spec — P4, for a widget that composes (§5.5).
   *
   * **Added because `hc-button` could not be built without it**, which is what
   * §7.4 says that widget is for: "if it needs a capability that isn't already
   * a primitive, that is a signal the primitive set is incomplete — fix the
   * primitive, don't special-case the widget". §7.4 asks for custom fields
   * "composed from child widgets (P4), not raw HTML", and §5.5 says an
   * extension ships a container the same way it ships anything else. Neither
   * was possible: `mountChild` lives in the shell, and nothing reached it from
   * here, so composition was first-party-only in practice while the plan said
   * it was not.
   *
   * **The one capability that is deliberately not message-shaped.** Rule 3
   * keeps every other one expressible as data in and data out; this returns a
   * live element, because a child *is* one. §5.5 already draws the consequence
   * and accepts it: "a sandboxed widget cannot be a container — a frame cannot
   * mount another frame's element — so the per-extension sandbox flag and
   * slots are mutually exclusive." So this is the seam where isolation and
   * composition are known to be exclusive, rather than a place the rule was
   * quietly broken.
   *
   * The child is mounted exactly as a page mounts one: same registry, same
   * template resolution, same host callbacks, and `nested` set so it draws no
   * chrome of its own. Undefined for a type nothing draws, which a caller
   * should render as visibly missing rather than as nothing.
   */
  child(spec: WidgetSpec): HTMLElement | undefined;

  template(id: string): WidgetSpec | undefined;

  /** Resolved design tokens, so a widget restyles with the house (§15). */
  tokens?: Tokens;

  /**
   * The locale in force, as a BCP 47 tag (§4.2).
   *
   * Declared here since §4.2 was written and supplied by nothing until the
   * i18n scaffolding landed. A widget that formats a number or a time should
   * hand it to `core/i18n.ts` rather than reach for this, but a widget that
   * ships its own words needs to know which ones to use.
   */
  locale: string;

  /**
   * What a person asked to see readings in (§4.2).
   *
   * Absent members mean "as the plugin published it", which is the default
   * and the honest one: converting a reading nobody asked to have converted
   * is how a client invents a fact.
   */
  units: { temperature?: 'C' | 'F'; length?: 'cm' | 'in' };

  /** Editing or viewing. Advisory to the widget; enforced by the host (§14.2). */
  mode: 'view' | 'edit';
}
