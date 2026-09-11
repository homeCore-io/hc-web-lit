/**
 * The hc-api client. Everything that talks to core goes through here.
 *
 * Nothing else in the app may call `fetch` (§19.4) — the eslint config enforces
 * the letter of that and this file is the reason. Auth, base URL, error shape
 * and the scope vocabulary live in one place so a widget never learns them.
 *
 * Documented surface: `core/docs/openapi.yaml`. Everything below cites the
 * operationId it implements, so a change there is greppable from here.
 */
import type { DeviceState } from './device.js';
import { humanise } from './text.js';
import { readStart, type CommandStart, type Plugin } from './plugins.js';
import { readVocabulary, type Vocabulary } from './vocabulary.js';

/** What core rejected, with enough to act on rather than just a stack trace. */
export class HcApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'HcApiError';
  }

  /** The token is missing, expired, or its `token_version` was bumped. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface LoginResult {
  token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  user: { id: string; username: string; role: string; created_at: string };
}

/** The closed kind vocabulary — `hc_types::schema::AttributeKind`. */
export type AttributeKind =
  | 'bool'
  | 'integer'
  | 'float'
  | 'string'
  | 'enum'
  | 'color_xy'
  | 'color_rgb'
  | 'color_temp'
  | 'json';

/**
 * What an attribute is *for*, when it is not the point of the device.
 *
 * A lock reports whether it is locked; it also reports battery, signal and
 * firmware. Rendering all four the same way buries the one an operator came
 * for. Absent means primary.
 */
export type AttributeCategory = 'diagnostic' | 'config';

/**
 * What a boolean attribute's two states are *called*, in the device's words.
 *
 * A contact sensor has one `open` attribute, so a client that lists attributes
 * offers one row — and closing the door becomes "open, but Not", a logic gate
 * standing in for a word the device already has.
 */
export interface BoolStates {
  when_true?: { label?: string; verb?: string };
  when_false?: { label?: string; verb?: string };
}

/**
 * One choice in an `enum` attribute — `hc_types::schema::AttributeOption`.
 *
 * On the wire an option is `string | {value, label?, icon?}`, and an option
 * carrying neither extra is serialised as a plain string, so old payloads are
 * byte-identical. Normalised here so nothing downstream sees the union.
 *
 * `icon` is a **semantic name**, not a font codepoint — the same convention
 * `DeviceAction.icon` uses — so an unknown name must fall back visibly rather
 * than draw a missing glyph.
 */
export interface AttributeOption {
  value: string;
  label?: string;
  icon?: string;
}

/** The wire form, before normalisation. */
export type WireOption = string | AttributeOption;

export const asOption = (o: WireOption): AttributeOption =>
  typeof o === 'string' ? { value: o } : o;

/**
 * A choice's display text.
 *
 * Only the plugin can turn `cool` into "Cooling", which is the point of
 * `label`. Without one, `medium-high` becomes "Medium high" — readable, and
 * visibly not something anybody wrote.
 */
export function optionLabel(o: AttributeOption): string {
  if (o.label !== undefined) return o.label;
  return humanise(o.value);
}

/** One declared attribute — `hc_types::schema::AttributeSchema`. */
export interface AttributeSchema {
  kind: AttributeKind;
  writable?: boolean;
  display_name?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Fixed option list for the `enum` kind. Strings or objects — see above. */
  options?: WireOption[];
  category?: AttributeCategory;
  states?: BoolStates;
}

/** One declared command — `hc_types::schema::DeviceAction`. */
export interface DeviceAction {
  id: string;
  label: string;
  description?: string;
  category?: string;
  icon?: string;
  requires_role?: string;
  /** Natural-language template: "press button {button} on {device}". */
  sentence?: string;
  params?: ActionParam[];
  /**
   * Which of the device's own readings this action moves.
   *
   * `set_volume` on a Sonos declares `writes: "volume"`, which is what lets a
   * control show the level it is about to change rather than a number that
   * happens to share a name with the parameter. Served today and mirrored here
   * late — a client that does not read it re-derives the link by guessing.
   */
  writes?: string;
}

export interface ActionParam {
  name: string;
  kind: string;
  label?: string;
  required?: boolean;
  default?: unknown;
  /** The range and unit a numeric parameter accepts, when it declares one. */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { label: string; value: string }[];
  /** Populate the option list from a live attribute of the same device. */
  options_from?: {
    attribute?: { attribute: string; label_key?: string; value_key?: string };
  };
}

/**
 * What a device accepts (§5.11).
 *
 * A writable attribute is a state you set; an action is a thing you do. A
 * device may legitimately have neither — core answers `schema not found` for
 * plenty of perfectly good hardware, and that is not an error.
 */
export interface DeviceSchema {
  attributes?: Record<string, AttributeSchema> | null;
  actions?: DeviceAction[];
  /**
   * Which readings the device is *for*, most important first.
   *
   * `category` says which attributes are not the point; this ranks what is
   * left. Core derives it at serve time from the device's own `device_type`,
   * falls back to a significance rank where the type says nothing — every
   * Z-Wave node, since they are all `device_type: "zwave"` — and sorts
   * whatever neither table names. A plugin that declares its own keeps it.
   *
   * That last part matters here specifically: `attributes` is a HashMap in
   * Rust, so "the first attribute" was never stable between reads.
   */
  primary?: string[];
}

/** One recorded value — `HistoryEntry` in the OpenAPI schema. */
export interface HistoryEntry {
  attribute: string;
  recorded_at: string;
  value: unknown;
}

/** One entry in the event log — `LogEntry` in the OpenAPI schema. */
export interface LogEntry {
  seq: number;
  event_type: string;
  device_id?: string;
  event?: Record<string, unknown>;
}

export interface ApiOptions {
  /** e.g. `http://10.0.10.150:8080/api/v1` — no trailing slash. */
  baseUrl: string;
  /**
   * A bearer to start with: a session token, or a panel's API key (§ panel.ts).
   * Core accepts either in the `Authorization` header and — since v0.1.68 — in
   * the `?token=` the event stream takes, so a key needs nothing special here.
   * It simply never refreshes, because there is no refresh token to present
   * and a key does not expire on a clock.
   */
  token?: string;
  /** Injectable for tests; defaults to the platform `fetch`. */
  fetch?: typeof globalThis.fetch;
}

export class HcApi {
  private readonly baseUrl: string;
  private readonly doFetch: typeof globalThis.fetch;
  private token: string | undefined;

  /**
   * The refresh token, and the one in-flight attempt to use it.
   *
   * **Refresh tokens are single-use and rotating**, and core is explicit about
   * what a replay means: "presenting an already-used token is treated as theft
   * and revokes the entire token chain." So two requests that expire together
   * must not each refresh — that is not a race that loses a request, it is a
   * race that logs the house out. Everyone waits on the same promise.
   */
  private refreshToken: string | undefined;
  private refreshing: Promise<boolean> | undefined;

  constructor(opts: ApiOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  get authenticated(): boolean {
    return this.token !== undefined;
  }

  /**
   * The bearer, for the one other thing that needs it.
   *
   * hc-web-lit's own server checks this token with core rather than keeping a
   * second set of users, so the content store has to send it. Nothing else
   * asks, and §19.4 still holds: a widget cannot reach this, because a widget
   * cannot reach the client.
   */
  bearer(): string | undefined {
    return this.token;
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  /**
   * `getCurrentUser`. Who this credential is, and — since v0.1.68 — what it
   * may actually do.
   *
   * **Read `scopes`, not `role`.** An API key names the user who created it,
   * so the profile that comes back is that person's, including their role,
   * while the key's authority is the narrower set it was issued with. Deriving
   * rights from the role hands a deliberately restricted key its owner's; this
   * client's content server did exactly that until core started reporting the
   * credential's own scopes.
   *
   * `scopes` is absent on a core older than v0.1.68, which is a different
   * thing from an empty list and is why it is optional here.
   */
  async me(): Promise<{ id: string; username: string; role: string; scopes?: string[] }> {
    return this.request<{ id: string; username: string; role: string; scopes?: string[] }>(
      'GET',
      '/auth/me',
    );
  }

  /**
   * `loginUser`. Public — the one call that needs no credential.
   *
   * The token is kept on this instance and not in storage: where a session
   * lives is the shell's decision, not the API client's.
   */
  async login(username: string, password: string): Promise<LoginResult> {
    const result = await this.request<LoginResult>('POST', '/auth/login', {
      username,
      password,
    });
    this.token = result.token;
    this.refreshToken = result.refresh_token;
    return result;
  }

  /**
   * `listDevices`. `includeSchema` resolves every device's schema inline —
   * one request instead of N+1, which is the difference between a dashboard
   * that can offer controls on first paint and one that cannot.
   */
  async listDevices(
    opts: { deviceType?: string; includeSchema?: boolean } = {},
  ): Promise<DeviceState[]> {
    const q = new URLSearchParams();
    if (opts.deviceType !== undefined) q.set('device_type', opts.deviceType);
    if (opts.includeSchema === true) q.set('include_schema', 'true');
    const suffix = q.size > 0 ? `?${q.toString()}` : '';
    return this.request<DeviceState[]>('GET', `/devices${suffix}`);
  }

  /** `getDeviceSchema`. Absent for many devices; the caller gets `undefined`. */
  /**
   * `getDevice`. One device, whole, with its schema resolved.
   *
   * Used after correcting a device's presentation: `ui_hint` is not device
   * state, so nothing on the event stream announces it, and re-reading the one
   * device is cheaper and more honest than re-listing 184.
   */
  async getDevice(deviceId: string): Promise<DeviceState | undefined> {
    try {
      return await this.request<DeviceState>(
        'GET',
        `/devices/${encodeURIComponent(deviceId)}?include_schema=true`,
      );
    } catch {
      return undefined;
    }
  }

  async getDeviceSchema(deviceId: string): Promise<DeviceSchema | undefined> {
    try {
      return await this.request<DeviceSchema>(
        'GET',
        `/devices/${encodeURIComponent(deviceId)}/schema`,
      );
    } catch (e) {
      if (e instanceof HcApiError && e.status === 404) return undefined;
      throw e;
    }
  }

  /**
   * `commandDevice`. A partial attribute map; core publishes it to the
   * device's MQTT command topic and answers 202 without waiting for the
   * device — so a resolved promise means *accepted*, never *applied*. The
   * state change arrives on the event stream.
   */
  async commandDevice(deviceId: string, patch: Record<string, unknown>): Promise<void> {
    await this.request<unknown>('PATCH', `/devices/${encodeURIComponent(deviceId)}/state`, patch);
  }

  /**
   * Invoke a declared action (§5.11).
   *
   * The same endpoint and the same topic as an attribute write — core's own
   * words: *"an attribute write is `{"source": "Netflix"}`; an action is
   * `{"action": "launch_app", "app": "Netflix"}`. Both reach the plugin through
   * the same `devices/{id}/cmd` topic, so declaring them costs no new
   * transport."* The difference is the shape of the body, not the route.
   */
  async callAction(
    deviceId: string,
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    await this.commandDevice(deviceId, { action, ...params });
  }

  /**
   * `getDeviceHistory`.
   *
   * **Every attribute, interleaved, newest first, and `limit` counts rows not
   * points.** Asking for 1000 rows of an ecowitt sensor over a day returns 303
   * — 117 temperature, 156 humidity, and 30 rows of battery metadata — so a
   * chart of one attribute pays for all of them and silently truncates at the
   * cap. There is no per-attribute filter and no server-side downsampling;
   * §5.9 is about closing exactly that, and `core/history.ts` does the
   * grouping and thinning here in the meantime.
   */
  async deviceHistory(
    deviceId: string,
    opts: { from?: Date; to?: Date; limit?: number } = {},
  ): Promise<HistoryEntry[]> {
    const q = new URLSearchParams();
    if (opts.from !== undefined) q.set('from', opts.from.toISOString());
    if (opts.to !== undefined) q.set('to', opts.to.toISOString());
    q.set('limit', String(opts.limit ?? 1000));
    return this.request<HistoryEntry[]>(
      'GET',
      `/devices/${encodeURIComponent(deviceId)}/history?${q.toString()}`,
    );
  }

  /**
   * `listEvents` — the recent log, newest first.
   *
   * The last 1,000 events, and much of that is not news: 158 of 300
   * consecutive entries on the reference house are one Roku republishing a
   * `device_info` field that contains a clock. `core/activity.ts` takes the
   * noise out; the server-side `type` filter narrows it further when a widget
   * knows which kinds it wants.
   */
  async listEvents(
    opts: { limit?: number; type?: string[]; deviceId?: string } = {},
  ): Promise<LogEntry[]> {
    const q = new URLSearchParams();
    q.set('limit', String(opts.limit ?? 200));
    if (opts.type !== undefined && opts.type.length > 0) q.set('type', opts.type.join(','));
    if (opts.deviceId !== undefined) q.set('device_id', opts.deviceId);
    return this.request<LogEntry[]>('GET', `/events?${q.toString()}`);
  }

  /**
   * `listDashboards`. **For the one-time takeover, and nothing else.**
   *
   * A page is a thing a person made, so it belongs in this client's own store
   * (§18.2) — core keeps what is core's. These documents were in core while
   * the other client was the only one that could author them, and this is how
   * a household moves without rebuilding its house by hand. `Authored`
   * records that the import has happened; nothing calls this afterwards.
   */
  async listDashboards(): Promise<unknown[]> {
    return this.request<unknown[]>('GET', '/dashboards');
  }

  /**
   * `dashboardVocabulary`. What a widget type is, as core describes it.
   *
   * **Not validation of this client's pages** — they live in this client's
   * store and core never sees them. It is the shared description of what a
   * widget config means, which is what makes a page portable: a value outside
   * it is one another client has no way to read. The property panel generates
   * its controls from it (§4.4).
   *
   * Undefined rather than an error when core does not serve it: an older core
   * is a panel with fewer labels, not a panel that will not start.
   */
  async dashboardVocabulary(): Promise<Vocabulary | undefined> {
    try {
      return readVocabulary(await this.request<unknown>('GET', '/dashboards/vocabulary'));
    } catch {
      return undefined;
    }
  }

  /**
   * `updateDevice`. Correct what a plugin got wrong, or could not know.
   *
   * Core accepts `name`, `area`, `ui_hint`, `status_icon`, `canonical_name`
   * and `button_names` here. `ui_hint` is the one that carries weight: an
   * outlet cannot know whether it feeds a lamp, a fan or a radio, so a plugin
   * safely calls it a switch and a person says what it really is. Every facet,
   * icon and type-specific widget in this client reads that field first (§1.1)
   * — and until now nothing could set it.
   */
  async updateDevice(deviceId: string, patch: Record<string, unknown>): Promise<void> {
    await this.request<unknown>('PATCH', `/devices/${encodeURIComponent(deviceId)}`, patch);
  }

  /** `listPlugins`. What is installed, and what each says it can do (§5.11). */
  async listPlugins(): Promise<Plugin[]> {
    const body = await this.request<unknown>('GET', '/plugins');
    // Core has answered both ways over its life — a bare array, and an object
    // with a `plugins` key. Reading both costs one line and saves a client
    // that breaks on an upgrade nobody thought was breaking.
    if (Array.isArray(body)) return body as Plugin[];
    const wrapped = (body as { plugins?: unknown } | null)?.plugins;
    return Array.isArray(wrapped) ? (wrapped as Plugin[]) : [];
  }

  /**
   * `postPluginCommand`. Ask a plugin to do one of the things it declared.
   *
   * Returns either the finished result or a request id to follow, because
   * that is what core returns; which one is decided by `status` rather than by
   * what the plugin declared (§ plugins.ts).
   */
  async runPluginAction(
    pluginId: string,
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<CommandStart> {
    const body = await this.request<unknown>(
      'POST',
      `/plugins/${encodeURIComponent(pluginId)}/command`,
      { action, ...params },
    );
    const start = readStart(body);
    if (start === undefined) throw new HcApiError(502, '/plugins', 'Unreadable command response');
    return start;
  }

  /**
   * The URL a command's progress arrives on.
   *
   * Server-sent events, and the credential goes in the query for the reason
   * core's own routing table gives: `EventSource` cannot set a header. That is
   * the same `?token=` path the event stream uses, and since v0.1.68 it takes
   * an API key as well as a session — so a wall panel provisioned with a key
   * can watch a discovery run like anything else.
   */
  pluginStreamUrl(pluginId: string, requestId: string): string {
    if (this.token === undefined) throw new Error('not authenticated');
    const q = new URLSearchParams({ token: this.token });
    return `${this.baseUrl}/plugins/${encodeURIComponent(pluginId)}/command/${encodeURIComponent(
      requestId,
    )}/stream?${q.toString()}`;
  }

  /**
   * The URL for the event stream, token in the query (§ events/stream).
   *
   * Resolves a relative base against the page, because the base *is* relative
   * in every real deployment: core sends no CORS headers, so a browser client
   * has to be same-origin behind whatever serves it. `ws://` and `wss://`
   * follow the page's scheme rather than being assumed.
   */
  streamUrl(params: { type?: string[]; deviceId?: string } = {}): string {
    if (this.token === undefined) throw new Error('not authenticated');
    const q = new URLSearchParams({ token: this.token });
    if (params.type !== undefined && params.type.length > 0) q.set('type', params.type.join(','));
    if (params.deviceId !== undefined) q.set('device_id', params.deviceId);

    const absolute = /^https?:\/\//.test(this.baseUrl)
      ? this.baseUrl
      : new URL(this.baseUrl, globalThis.location?.href ?? 'http://localhost/')
          .toString()
          .replace(/\/+$/, '');

    return `${absolute.replace(/^http/, 'ws')}/events/stream?${q.toString()}`;
  }

  /**
   * Album or channel art, as bytes this page can show.
   *
   * Core proxies it deliberately — "so a browser can render it without
   * reaching the device directly, and without the device's own URL leaking
   * into a page" — and it needs the bearer, which a widget must never hold
   * (§19.4). So the host fetches it and hands over an object URL: the token
   * stays here and the widget gets a string it can put in a `src`.
   *
   * Undefined for a device with no art, which is most of them most of the
   * time — a television showing its home screen has nothing to show.
   */
  async mediaArt(deviceId: string): Promise<string | undefined> {
    const headers: Record<string, string> = {};
    if (this.token !== undefined) headers['Authorization'] = `Bearer ${this.token}`;

    try {
      const res = await this.doFetch(`${this.baseUrl}/devices/${deviceId}/media/art`, { headers });
      if (!res.ok) return undefined;
      const blob = await res.blob();
      // An empty body is a 200 with nothing in it, which some proxies do.
      return blob.size === 0 ? undefined : URL.createObjectURL(blob);
    } catch {
      return undefined;
    }
  }

  /**
   * Trade the refresh token for a new session, once at a time.
   *
   * Returns whether there is a usable session afterwards. A failure clears
   * both tokens rather than leaving a dead one in place: a client that keeps
   * presenting a revoked credential looks to core exactly like the theft it
   * was designed to detect.
   */
  private async refresh(): Promise<boolean> {
    if (this.refreshing !== undefined) return this.refreshing;
    if (this.refreshToken === undefined) return false;

    this.refreshing = (async () => {
      try {
        const res = await this.doFetch(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: this.refreshToken }),
        });
        if (!res.ok) {
          this.token = undefined;
          this.refreshToken = undefined;
          return false;
        }
        const result = (await res.json()) as LoginResult;
        this.token = result.token;
        // Rotated: the one just used is spent, and keeping it would arm the
        // replay detection with our own credential.
        this.refreshToken = result.refresh_token;
        return true;
      } catch {
        return false;
      } finally {
        this.refreshing = undefined;
      }
    })();

    return this.refreshing;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token !== undefined) headers['Authorization'] = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    // An expired session is the ordinary state of a panel that has been up for
    // a month, not an error to show somebody. Renew and try once more; a
    // second 401 is a real refusal and falls through.
    if (res.status === 401 && !path.startsWith('/auth/') && (await this.refresh())) {
      return this.request<T>(method, path, body);
    }

    if (!res.ok) {
      // Core answers `{"error": "..."}`; anything else is a proxy in the way,
      // and the status is what the caller can act on either way.
      let detail = res.statusText;
      try {
        const parsed = (await res.json()) as { error?: string };
        if (typeof parsed.error === 'string') detail = parsed.error;
      } catch {
        // Body was not JSON. The status still is.
      }
      throw new HcApiError(res.status, path, `${method} ${path} — ${res.status} ${detail}`);
    }

    if (res.status === 204 || res.status === 202) return undefined as T;
    return (await res.json()) as T;
  }
}
