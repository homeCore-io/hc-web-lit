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
import type { CommandRequest } from '../widgets/hc-controls.js';
import type { WidgetSpec } from '../shell/mount.js';

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

  /** P5 — a sheet the host owns, from a widget spec that could be stored (§5.6). */
  sheet(content: WidgetSpec): void;

  /** The non-actuating way to inspect a device — `hold`, everywhere (§5.10). */
  details(deviceId: string): void;

  /** P3 — what a template instance stands for (§5.4). */
  template(id: string): WidgetSpec | undefined;

  /** Resolved design tokens, so a widget restyles with the house (§15). */
  tokens?: Tokens;

  /** Editing or viewing. Advisory to the widget; enforced by the host (§14.2). */
  mode: 'view' | 'edit';
}
