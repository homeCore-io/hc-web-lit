/**
 * Events off core's WebSocket — `GET /events/stream`.
 *
 * The token goes in the query string because a browser cannot set headers on a
 * WebSocket upgrade. Core validates it before accepting, so a bad token is a
 * 401 and never an open socket.
 */

/** `hc_types::event::Event::DeviceStateChanged`, as it arrives. */
export interface DeviceStateChanged {
  type: 'device_state_changed';
  timestamp: string;
  device_id: string;
  device_name?: string;
  previous: Record<string, unknown>;
  /** The whole attribute map afterwards, not a delta. */
  current: Record<string, unknown>;
  /** Which keys moved — added, updated or removed. */
  changed: string[];
}

export interface DeviceAvailabilityChanged {
  type: 'device_availability_changed';
  timestamp: string;
  device_id: string;
  available: boolean;
}

export type HcEvent =
  DeviceStateChanged | DeviceAvailabilityChanged | { type: string; [k: string]: unknown };

export interface EventStreamOptions {
  url: string;
  onEvent: (e: HcEvent) => void;
  onStatus?: (connected: boolean) => void;
  /** Injectable for tests. */
  socketFactory?: (url: string) => WebSocket;
  /** Reconnect backoff, in ms, walked in order and then repeated at the last. */
  backoff?: number[];
}

/**
 * A reconnecting event stream.
 *
 * **Reconnection is not optional.** A wall display runs for months and a LAN
 * blip must not leave it showing state from an hour ago with no indication
 * anything is wrong. `onStatus` is how the shell renders that honestly (§16).
 */
export class EventStream {
  private socket: WebSocket | undefined;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private readonly backoff: number[];

  constructor(private readonly opts: EventStreamOptions) {
    this.backoff = opts.backoff ?? [500, 1000, 2000, 5000, 10000];
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.socket?.close();
    this.socket = undefined;
  }

  private open(): void {
    const make = this.opts.socketFactory ?? ((u: string) => new WebSocket(u));
    const socket = make(this.opts.url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.opts.onStatus?.(true);
    };

    socket.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        // A frame we cannot parse is core speaking a dialect we do not know.
        // Dropping it is right; taking the socket down over it is not.
        return;
      }
      if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
        this.opts.onEvent(parsed as HcEvent);
      }
    };

    socket.onclose = () => {
      this.opts.onStatus?.(false);
      this.scheduleReopen();
    };

    // `onerror` is followed by `onclose`, so reconnecting is handled there.
    // Doing it in both places is how you get two sockets.
    socket.onerror = () => {};
  }

  private scheduleReopen(): void {
    if (this.stopped) return;
    const delay = this.backoff[Math.min(this.attempt, this.backoff.length - 1)] ?? 10000;
    this.attempt += 1;
    this.timer = setTimeout(() => this.open(), delay);
  }
}
