import type { HistoryEntry, LogEntry } from './api.js';

/**
 * What a widget *is*, as a document says it and as a host hands it over.
 *
 * These two types were in `widgets/hc-controls.ts` and `shell/mount.ts` —
 * inside a widget and inside the shell — while the SDK exported both. A
 * package cannot depend on the application that contains it, so they live
 * where everything that needs them can reach: the document concept in core,
 * with the app and the SDK above it.
 */

/** A widget instance as the document stores it. */
export interface WidgetSpec {
  type: string;
  config?: Record<string, unknown>;
}

/**
 * What the host is asked to do to a device.
 *
 * Data, so it can be logged, queued or refused. A widget builds one of these
 * and hands it over; it never performs one, which is what puts the safety
 * policy in a single place (§5.10, §11.3).
 */
export interface CommandRequest {
  deviceId: string;
  /** An attribute write. */
  patch?: Record<string, unknown>;
  /** An action, with its declared parameters. */
  action?: { id: string; params: Record<string, unknown> };
}

/** How a widget asks the host for history (§5.9). */
export type HistoryFetch = (
  deviceId: string,
  opts: { from: Date; to: Date; limit: number },
) => Promise<HistoryEntry[]>;

/** How a widget asks the host for recent activity. */
export type EventFetch = (opts: { limit: number }) => Promise<LogEntry[]>;
