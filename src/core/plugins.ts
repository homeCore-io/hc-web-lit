/**
 * What a plugin can be asked to do — P10's other half (§5.11).
 *
 * P10 landed as device schemas and stopped there, so this client has been
 * reading `DeviceSchema` on every card while `PluginCapabilities` — the same
 * idea one level up, published by the same plugins, on an endpoint that has
 * been there all along — went untouched. The reference house declares **31
 * operations across nine plugins** and not one of them is reachable from here.
 *
 * §5.11 states the point exactly: a UI can show progress, disable a second
 * run, offer cancel and render the outcome **without knowing what Hue is**.
 * Everything below is derived from what the plugin declared; there is no table
 * of plugin names anywhere in this file, and adding a tenth plugin needs no
 * change to it.
 *
 * ## What the declarations actually say
 *
 * Four shapes appear in the reference house, and each one changes the control:
 *
 * | count | shape | what it means for the UI |
 * |---|---|---|
 * | 20 | `stream:false concurrency:multi` | a button; the answer arrives with the response |
 * | 2 | `stream:false concurrency:single` | a button that greys out while it runs |
 * | 5 | `stream:true concurrency:single` | progress, and a running list of what it found |
 * | 4 | `stream:true cancelable:true` | all of that, plus a way to stop |
 *
 * The last row is why this is worth doing properly rather than as a row of
 * buttons: `zwave include_node` has a **five-minute** timeout and means "press
 * the button on the device now". Without progress it is indistinguishable from
 * a hang, and without cancel the only way out is waiting it out.
 *
 * ## Two response shapes, and the client cannot choose
 *
 * A command either answers immediately —
 *
 *     { "status": "ok", "request_id": "…", "count": 2, "devices": [ … ] }
 *
 * with the plugin's declared `result` fields spread at the top level — or it
 * accepts and streams:
 *
 *     { "status": "accepted", "request_id": "…", "stream_topic": "…" }
 *
 * Which one comes back follows the declaration, so a caller that read
 * `stream` already knows. It is checked anyway, because a declaration that
 * disagrees with what a plugin does is a thing that happens (homeCore#40) and
 * hanging on a stream that will never open is a worse failure than either.
 */

/** One thing a plugin can be asked to do. */
export interface PluginAction {
  id: string;
  label?: string;
  description?: string;
  /** `user` or `admin`. Checked before the control is offered, not after. */
  requires_role?: string;
  /** `single` means a second run must wait; `multi` may overlap. */
  concurrency?: string;
  cancelable?: boolean;
  /** Whether progress arrives over SSE rather than in the response. */
  stream?: boolean;
  timeout_ms?: number | null;
  /** The shape of the answer, by field name. Used to render, never to parse. */
  result?: Record<string, { type?: string }>;
  /** What one streamed item is called, when the plugin says. */
  item_key?: string;
  params?: unknown[];
}

export interface Plugin {
  plugin_id: string;
  status?: string;
  capabilities?: { actions?: PluginAction[] };
}

/** What came back from starting a command. */
export type CommandStart =
  | { kind: 'done'; requestId: string; result: Record<string, unknown> }
  | { kind: 'streaming'; requestId: string };

/** One frame off a command's stream. */
export interface CommandEvent {
  stage?: string;
  label?: string;
  message?: string;
  percent?: number;
  op?: string;
  data?: unknown;
  ts?: string;
}

/**
 * How the host runs one, so a widget never holds an API client (§19.4).
 *
 * Here rather than beside the widget that uses it: the SDK's `MountEnv`
 * carries this, and the SDK depends downward only — a capability type living
 * in `widgets/` would make the host import a widget to describe itself.
 * `boundary.test.ts` said so before this comment did.
 */
export interface PluginRunner {
  list: () => Promise<Plugin[]>;
  run: (
    pluginId: string,
    action: string,
  ) => Promise<
    { kind: 'done'; result: Record<string, unknown> } | { kind: 'streaming'; requestId: string }
  >;
  /** Follow a streaming command. Returns a function that stops following. */
  follow: (pluginId: string, requestId: string, onEvent: (e: CommandEvent) => void) => () => void;
}

/**
 * Whether this caller may be offered the control at all.
 *
 * §5.10's reasoning applied to plugin operations: `requires_role` is checked
 * **before** the control is rendered rather than after it is pressed, because
 * a button that exists to say "you may not" is worse than one that is not
 * there. The house is the authority either way — this only decides what to
 * draw.
 *
 * Unknown scopes mean an older core that does not report them, and there the
 * honest answer is to offer it: core refuses what it should, and hiding
 * everything would make the surface useless against a core that works.
 */
export function mayRun(action: PluginAction, scopes: readonly string[] | undefined): boolean {
  if (scopes === undefined) return true;
  if (action.requires_role !== 'admin') return true;
  return scopes.includes('plugins:admin') || scopes.includes('admin') || scopes.includes('*');
}

/** The words a person reads for an operation, from the plugin's own label. */
export function labelOf(action: PluginAction): string {
  return action.label ?? action.id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** The plugin's name without the prefix every one of them carries. */
export function nameOf(plugin: Plugin): string {
  return plugin.plugin_id.replace(/^plugin\./, '');
}

/** Actions a plugin declares, in the order it declared them. */
export function actionsOf(plugin: Plugin): PluginAction[] {
  return plugin.capabilities?.actions ?? [];
}

/**
 * Read the start of a command response without trusting its shape.
 *
 * `status` is what decides, not the declaration: see the file header.
 */
export function readStart(body: unknown): CommandStart | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const m = body as Record<string, unknown>;
  const requestId = typeof m['request_id'] === 'string' ? m['request_id'] : undefined;
  if (requestId === undefined) return undefined;

  if (m['status'] === 'accepted') return { kind: 'streaming', requestId };

  // Everything but the envelope is the plugin's declared result, spread at the
  // top level rather than nested.
  const { status: _s, request_id: _r, stream_topic: _t, ...result } = m;
  return { kind: 'done', requestId, result };
}

/** Read one stream frame, ignoring anything that is not one. */
export function readEvent(raw: unknown): CommandEvent | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  const out: CommandEvent = {};
  if (typeof m['stage'] === 'string') out.stage = m['stage'];
  if (typeof m['label'] === 'string') out.label = m['label'];
  if (typeof m['message'] === 'string') out.message = m['message'];
  if (typeof m['percent'] === 'number') out.percent = m['percent'];
  if (typeof m['op'] === 'string') out.op = m['op'];
  if (typeof m['ts'] === 'string') out.ts = m['ts'];
  if (m['data'] !== undefined) out.data = m['data'];
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Whether a frame says the operation has finished, however it phrased it. */
export function isFinal(event: CommandEvent): boolean {
  const stage = event.stage ?? '';
  return stage === 'done' || stage === 'complete' || stage === 'error' || stage === 'cancelled';
}

/**
 * A short line for one streamed item.
 *
 * A plugin sends whatever the item is — a Sonos speaker arrives as
 * `{uuid, room_name, host_port, status}` — and nothing here knows what any of
 * those mean. The rule is to prefer a field a person would recognise as a
 * name, then fall back to showing the object rather than showing nothing: an
 * unnameable item is still evidence that the operation is finding things.
 */
export function describeItem(data: unknown): string {
  if (typeof data === 'string') return data;
  if (typeof data !== 'object' || data === null) return String(data);

  const m = data as Record<string, unknown>;
  for (const key of ['room_name', 'name', 'label', 'title', 'id', 'hc_id', 'host', 'uuid']) {
    const value = m[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return JSON.stringify(data);
}
