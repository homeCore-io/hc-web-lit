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

/** One declared attribute — `hc_types::schema::AttributeSchema`. */
export interface AttributeSchema {
  kind: AttributeKind;
  writable?: boolean;
  display_name?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Fixed option list for the `enum` kind. */
  options?: string[];
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
}

export interface ActionParam {
  name: string;
  kind: string;
  label?: string;
  required?: boolean;
  default?: unknown;
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
}

export interface ApiOptions {
  /** e.g. `http://10.0.10.150:8080/api/v1` — no trailing slash. */
  baseUrl: string;
  token?: string;
  /** Injectable for tests; defaults to the platform `fetch`. */
  fetch?: typeof globalThis.fetch;
}

export class HcApi {
  private readonly baseUrl: string;
  private readonly doFetch: typeof globalThis.fetch;
  private token: string | undefined;

  constructor(opts: ApiOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  get authenticated(): boolean {
    return this.token !== undefined;
  }

  setToken(token: string | undefined): void {
    this.token = token;
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

  /** `listDashboards`. */
  async listDashboards(): Promise<unknown[]> {
    return this.request<unknown[]>('GET', '/dashboards');
  }

  /** `getDashboard`. */
  async getDashboard(id: string): Promise<unknown> {
    return this.request<unknown>('GET', `/dashboards/${encodeURIComponent(id)}`);
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token !== undefined) headers['Authorization'] = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

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
