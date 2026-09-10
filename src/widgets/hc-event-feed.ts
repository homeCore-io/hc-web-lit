/**
 * What just happened.
 *
 * Answers the question every home automation system exists to answer badly:
 * *what turned that light on?* Four placements across the real dashboards.
 *
 * Reads through the host, like history does — a widget holds no API client
 * (§19.4) — and refreshes on its own rather than per state change, because the
 * log is a query and not a subscription.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { activityFrom, type Activity, type LogEntry } from '../core/activity.js';
import type { DeviceState } from '../core/device.js';
import { registerWidget } from '../core/registry.js';
import { clock as formatClock } from '../core/i18n.js';

export type EventFetch = (opts: { limit: number }) => Promise<LogEntry[]>;

/** How loud each kind is. A rule firing is the interesting one. */
const TONE: Record<string, string> = {
  rule_fired: '--hc-accent-primary',
  scene_activated: '--hc-accent-active',
  device_command_sent: '--hc-accent-primary',
  device_availability_changed: '--hc-accent-offline',
};

@customElement('hc-event-feed')
export class HcEventFeed extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    ol {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: calc(var(--hc-space-unit, 8px) * 0.4);
    }
    li {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      min-width: 0;
      font-family: var(--hc-font-body, system-ui, sans-serif);
      color: var(--hc-ink, #e9edf2);
      font-size: var(--hc-text-body-small-size, 12.5px);
    }
    .when {
      flex: none;
      width: 3.5rem;
      color: var(--hc-ink-muted, #8b95a4);
      font-variant-numeric: tabular-nums;
      font-size: var(--hc-text-caption-size, 11px);
    }
    .who {
      flex: none;
      max-width: 45%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .what {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--hc-ink-muted, #8b95a4);
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) context: { room?: string } = {};
  /** The host's log reader — the same seam as history (§5.9). */
  @property({ attribute: false }) onEvents: EventFetch | undefined;

  @state() private entries: LogEntry[] = [];
  @state() private note = '';

  private timer: ReturnType<typeof setInterval> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
    // A poll rather than a subscription: the log is a query, and the stream
    // already pushes state changes into the store for everything else to draw.
    this.timer = setInterval(() => void this.load(), 20_000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('onEvents')) void this.load();
  }

  private async load(): Promise<void> {
    if (this.onEvents === undefined) return;
    try {
      // Ask for far more than the widget shows: most of the log is not news,
      // and the filtering happens here (`core/activity.ts`).
      this.entries = await this.onEvents({ limit: 300 });
      this.note = '';
    } catch {
      this.note = 'Log unavailable.';
    }
  }

  override render() {
    const rows = activityFrom(this.config, this.entries, this.devices, this.context.room);

    if (rows.length === 0) {
      return html`<div class="empty" part="empty">
        ${this.note !== '' ? this.note : 'Nothing has happened.'}
      </div>`;
    }

    return html`<ol part="feed">
      ${rows.map((r) => this.row(r))}
    </ol>`;
  }

  private row(r: Activity) {
    return html`<li part="event">
      <span class="when">${clock(r.at)}</span>
      <span class="who" style="color:var(${TONE[r.kind] ?? '--hc-ink'})">${r.who}</span>
      <span class="what">${r.what}</span>
    </li>`;
  }
}

/** Wall-clock, because "3 minutes ago" needs a tick to stay true. */
function clock(at: string | undefined): string {
  if (at === undefined) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : formatClock(d);
}

registerWidget('event_feed', 'hc-event-feed');

declare global {
  interface HTMLElementTagNameMap {
    'hc-event-feed': HcEventFeed;
  }
}
