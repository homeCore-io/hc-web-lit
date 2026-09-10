/**
 * The application shell.
 *
 * Deliberately thin. Routing, auth, the connection and theming land here (§3);
 * everything else is a widget, and widgets do not reach around this (§19.4).
 *
 * Phase 0's version: log in, load the device store and a dashboard, keep the
 * store fed from the event stream, and draw the page. No router yet.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HcApi, HcApiError } from '../core/api.js';
import { applyTokens } from '../design/css.js';
import { builtInSeeds, defaultSkin } from '../design/seeds.js';
import { deriveTokens } from '../design/tokens.js';
import type { DashboardBreakpoint, DashboardDefinition } from '../core/dashboard.js';
import { withWidgetConfig } from '../core/dashboard.js';
import { addWidget, duplicatePage, newPage, removeWidget, renamed } from '../core/pages.js';
import { EventStream } from '../core/events.js';
import { check, checkAction } from '../core/safety.js';
import { DeviceStore } from '../core/store.js';
import { Authored } from '../core/authored.js';
import { BrowserContent, ServerContent } from '../core/content.js';
import { PanelCredential } from '../core/panel.js';
import type { IconRule } from '../design/icons.js';
import { pagesToShow, LastKnown, ageOf } from '../core/last-known.js';
import type { CommandEvent } from '../core/plugins.js';
import type { Vocabulary } from '../core/vocabulary.js';
import { since, type Preferences } from '../core/i18n.js';
import { ExtensionSource, type InstalledExtensions } from '../ext/install.js';
import type { CommandRequest } from '../core/widget.js';
import { effectiveName, isOn } from '../core/present.js';
import type { ActionConfig } from '../core/actions.js';
import type { MountEnv } from './mount.js';
import './hc-page.js';
import './hc-overlay.js';
import type { HcOverlay } from './hc-overlay.js';
import '../widgets/hc-device-grid.js';
import '../widgets/hc-event-feed.js';
import '../widgets/hc-device-list.js';
import '../widgets/hc-history-chart.js';
import '../widgets/hc-code.js';
import '../widgets/hc-colour-wheel.js';
import '../widgets/hc-contact.js';
import '../widgets/hc-fan.js';
import '../widgets/hc-presence.js';
import '../widgets/hc-plugin-actions.js';
import '../widgets/hc-device-breakdown.js';
import '../widgets/hc-house-status.js';
import '../widgets/hc-line.js';
import '../widgets/hc-room-field.js';
import '../widgets/hc-slider.js';
import '../widgets/hc-warmth.js';
import '../widgets/hc-media.js';
import '../widgets/hc-mode-chips.js';
import '../widgets/hc-scene-row.js';
import '../widgets/hc-shape.js';
import '../widgets/hc-text.js';
import '../widgets/hc-worth-knowing.js';
import '../widgets/hc-device-card.js';
import '../widgets/hc-device-details.js';
import '../widgets/hc-device-reading.js';
import '../widgets/hc-divider.js';
import '../widgets/hc-grid.js';
import '../widgets/hc-heading.js';
import '../widgets/hc-icon.js';
import '../widgets/hc-icon-rules.js';
import '../widgets/hc-keypad.js';
import '../widgets/hc-lock.js';
import '../widgets/hc-timer.js';
import '../widgets/hc-image.js';
import '../widgets/hc-spacer.js';
import '../widgets/hc-stack.js';
import '../widgets/hc-swipe.js';
import '../widgets/hc-tabs.js';
import '../widgets/hc-accordion.js';
import '../widgets/hc-property-panel.js';
import '../widgets/hc-preferences.js';
import '../widgets/hc-gauge.js';
import '../widgets/hc-markdown.js';
import '../widgets/hc-camera.js';
import '../widgets/hc-toggle.js';
import '../widgets/hc-stepper.js';
import '../widgets/hc-thermostat.js';
import '../widgets/hc-stat-summary.js';
import '../widgets/hc-rooms.js';
import '../widgets/hc-web-embed.js';
import '../widgets/hc-dashboard-link.js';
import '../widgets/hc-svg.js';
import '../widgets/hc-plugin-widget.js';

type Phase = 'idle' | 'connecting' | 'ready' | 'failed';

/**
 * How long since the house said anything, in words rather than a timestamp.
 *
 * The rounding and the words moved to `core/i18n.ts` when the client learned
 * about locales; kept as a name here because the shell and its tests have
 * always called it this, and "since" alone says less at the call site.
 */
export function sinceHeard(at: number): string {
  return since(at);
}

@customElement('hc-app')
export class HcApp extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-height: 100vh;
      background: var(--hc-surface-base, #0b0e13);
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    header {
      display: flex;
      align-items: center;
      /* Wrapping, because a phone is a stated target and this row does not fit
         one: at 390px the status was pushed 180px past the right edge and took
         the whole document with it, so every page scrolled sideways. */
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--hc-stroke-hairline, #262d38);
      font-size: 0.875rem;
    }
    header select {
      max-width: 40vw;
    }
    header button {
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 0.625rem;
      border: 1px solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      cursor: pointer;
    }
    header button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    header input.rename {
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 0.5rem;
      border: 1px solid var(--hc-stroke-focus, #7cc4ff);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      max-width: 40vw;
    }
    header button.danger {
      border-color: color-mix(in srgb, var(--hc-accent-danger, #ff7b72) 55%, transparent);
      color: var(--hc-accent-danger, #ff7b72);
    }
    /* Fixed rather than in the flow: a panel's layout should not move when the
       network drops, or every reconnect reflows the page somebody is reading. */
    .stale {
      position: fixed;
      right: 0.75rem;
      bottom: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.7rem;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-overlay, #1b2230);
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      box-shadow: var(--hc-elevation-overlay, 0 24px 60px rgb(0 0 0 / 0.5));
      pointer-events: none;
    }
    .stale .dot {
      background: var(--hc-accent-warn, #ffc978);
    }
    [hidden] {
      display: none !important;
    }
    .brand {
      /* The brand colour, not the on colour. They are the same in four of
         the five skins, which is exactly why this was wrong and invisible
         until blue_hour swapped them. */
      color: var(--hc-accent-primary, #ffb661);
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .spacer {
      flex: 1;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      opacity: 0.75;
      font-variant-numeric: tabular-nums;
      /* Never the reason the row is too wide: it is the least important thing
         in the header and the first that should give. */
      min-width: 0;
      white-space: nowrap;
    }
    .dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--hc-accent-inactive, #2a313b);
    }
    .dot[data-live] {
      background: var(--hc-accent-success, #6fd1a6);
    }
    select {
      background: var(--hc-surface-raised, #141922);
      color: inherit;
      border: 1px solid var(--hc-stroke-hairline, #262d38);
      border-radius: 6px;
      padding: 0.25rem 0.5rem;
      font: inherit;
    }
    main {
      padding: 1rem;
    }
    .note {
      padding: 2rem;
      text-align: center;
      opacity: 0.7;
    }
    .error {
      color: var(--hc-accent-danger, #ff7b72);
    }
  `;

  /** Where core is. The shell's business, not any widget's. */
  @property({ type: String }) baseUrl = '/api/v1';

  @state() private phase: Phase = 'idle';
  @state() private message = '';
  @state() private live = false;

  /**
   * When the house last said anything.
   *
   * §16 asks for a *clear* stale indicator, and "reconnecting" is not one: it
   * says the socket is down and nothing about whether what is on the screen is
   * a minute old or since breakfast. On a wall panel that difference is the
   * whole question — a dark lamp that was dark a minute ago is information,
   * and one that was dark at 7am is a picture of the past.
   */
  @state() private lastHeard = 0;

  /**
   * A wall panel, rather than somebody's browser.
   *
   * Entered with `?kiosk` in the url, because that is what a kiosk app is
   * given: a URL and nothing else. It hides *this* client's chrome — the
   * brand, the pickers, the device count — none of which a panel on a wall has
   * any use for, and none of which a kiosk browser can hide for us because
   * they are ours rather than the browser's.
   *
   * **No wake lock.** The Screen Wake Lock API needs a secure context, and a
   * panel reaches this over plain HTTP on a LAN, where `navigator.wakeLock` is
   * simply absent — measured, not assumed. Kiosk browsers do screen management
   * properly anyway, with motion and schedules; a page can only say "never
   * sleep", which is the wrong answer at 3am.
   */
  @state() private kiosk = new URLSearchParams(globalThis.location?.search ?? '').has('kiosk');

  /**
   * This panel's own credential (§ panel.ts).
   *
   * Claimed at construction, which is before `?kiosk` is read below — the key
   * comes out of the address either way, so a URL pasted into a normal browser
   * does not leave a credential sitting in the bar. Whether it is *used* is a
   * separate question, answered in `connectedCallback`.
   */
  /**
   * The house as it was, for a panel that came back before the network did
   * (§16, `last-known.ts`).
   */
  private readonly lastKnown = new LastKnown();

  /** Drawing a snapshot rather than the house. Never true while connected. */
  @state() private restored = false;

  /** The reconnect attempt running behind a restored view. */
  private retry: ReturnType<typeof setTimeout> | undefined;

  private readonly panel = new PanelCredential();
  private readonly panelKey = this.panel.claim();

  /**
   * What the panel's key may do, from `/auth/me`.
   *
   * Read rather than assumed, and shown rather than discovered: a key issued
   * without `content:write` produces a panel where saving an icon rule fails,
   * and the only thing worse than that is failing without saying why.
   * Undefined against a core older than v0.1.68, which did not report it.
   */
  @state() private panelScopes: string[] | undefined;

  /**
   * What a third party shipped, and what would not load.
   *
   * The failures are held rather than logged. An extension that does not
   * appear is the hardest thing in this design to diagnose from the outside —
   * the symptom is a placement that draws as unknown, which looks exactly like
   * a typo in the dashboard — so the reason belongs on screen, next to the
   * person who can act on it.
   */
  @state() private extensions: InstalledExtensions = { loaded: [], failed: [] };

  /** Re-renders the age while nothing is arriving, so it counts up visibly. */
  private ageTimer: ReturnType<typeof setInterval> | undefined;

  /** The slower clock that persists what the house last looked like. */
  private snapshotTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * The last chance to record what this panel knew.
   *
   * `pagehide` rather than `unload`, which a modern browser may never fire —
   * and which is skipped entirely for a tab restored from the back/forward
   * cache. A power cut gives no warning at all, which is why the periodic
   * save exists as well as this.
   */
  private readonly onHide = (): void => {
    if (this.live) this.lastKnown.saveNow(this.store.list(), this.docs);
  };
  @state() private docs: DashboardDefinition[] = [];
  /**
   * Core's table of what a widget config may hold (§4.4).
   *
   * Undefined until it has been read, and possibly for good: an older core
   * does not serve it and a panel offline never asked. The property panel is
   * built to work either way, so nothing waits on this.
   */
  @state() private vocabulary: Vocabulary | undefined;
  @state() private current: DashboardDefinition | undefined;
  @state() private breakpoint: DashboardBreakpoint = 'desktop';
  @state() private skin = defaultSkin;
  /** What `@room` means on the page being shown (§14.1). */
  @state() private roomContext: { room?: string; picked?: string } = {};

  private readonly store = new DeviceStore();

  /**
   * What this household authored — templates, icon rules — and where it is
   * kept.
   *
   * Built here rather than fetched: none of it is a fact about the house, so
   * none of it belongs to core (and the endpoints that hold it there today are
   * on their way out). The browser adapter keeps it per device, which is right
   * for a preference and an open question for content two devices should
   * agree on.
   */
  private authored = new Authored(new BrowserContent());

  /**
   * The one overlay stack (§5.6).
   *
   * A query rather than a stored reference: it is in this element's own shadow
   * root, and the first command can arrive before the first render has put it
   * there.
   */
  private get overlay(): HcOverlay | null {
    return this.renderRoot.querySelector('hc-overlay');
  }
  private api: HcApi | undefined;
  private stream: EventStream | undefined;

  /**
   * Every command a widget asks for passes through here.
   *
   * The host dispatches, so the host is where the safety policy is a rule
   * rather than a convention (§5.10, §11.3) — a widget cannot opt out of a
   * confirmation by mishandling its own events, because it never had the
   * chance to send anything itself.
   */
  /**
   * Hold to inspect (§5.10).
   *
   * The sheet's content is a widget spec rather than a node, so what `hold`
   * opens is a config value — which is what makes "hold opens a room sheet
   * instead" a setting later rather than a change here (§5.6).
   */
  /** Album or channel art, fetched with the credential the widget lacks. */
  private readonly art = async (deviceId: string): Promise<string | undefined> =>
    this.api?.mediaArt(deviceId);

  /**
   * What the plugins can be asked to do (§5.11).
   *
   * The host performs it and the widget only names it, so §19.4 holds: a
   * widget that could reach `EventSource` directly would be a widget holding
   * the token, since the credential travels in the query.
   */
  /**
   * Correct a device's presentation, and show the result immediately.
   *
   * The store is updated from the response rather than waiting for an event:
   * `ui_hint` is not device state, so nothing on the stream announces it, and
   * a person who has just chosen "this outlet is a fan" should not watch the
   * card stay a switch.
   */
  private readonly updateDevice = async (
    deviceId: string,
    patch: Record<string, unknown>,
  ): Promise<void> => {
    const api = this.api;
    if (api === undefined) return;
    await api.updateDevice(deviceId, patch);
    const fresh = await api.getDevice(deviceId);
    if (fresh !== undefined) this.store.upsert(fresh);
  };

  /**
   * Save the household's icon rules, and redraw everything that draws a mark.
   *
   * `Authored.apply` puts them into force by setting module state, which
   * nothing observes — so a rule saved on this page would not reach the cards
   * behind it until something else happened to re-render. Resetting the store
   * with its own contents is the honest signal for "everything changed": it
   * notifies every subscriber, which is precisely the set of things that draw
   * a device.
   */
  private readonly saveIconRules = (rules: IconRule[]): void => {
    this.authored.saveIconRules(rules);
    this.authored.apply();
    this.repaint();
  };

  /**
   * Redraw everything that draws a device, after something that is not a
   * device changed.
   *
   * **Fresh objects, not the ones already held.** A widget is handed its
   * device by assignment and Lit compares by identity, so resetting the store
   * with the very objects it contains notifies every subscriber and changes
   * no property — and nothing re-renders. Icon rules and the household's
   * units are both module state that no device carries, so there is no other
   * signal to send.
   *
   * Found by switching temperature to Celsius on a live page and watching
   * every reading stay in Fahrenheit while the settings widget beside them
   * updated. 184 shallow copies once per settings change is not a cost worth
   * optimising.
   */
  private repaint(): void {
    this.store.reset(this.store.list().map((d) => ({ ...d })));
    this.requestUpdate();
  }

  /**
   * Save the household's locale, units and clock, and redraw the house.
   *
   * The same signal the icon rules need and for the same reason: a preference
   * is module state that nothing observes, so every card that already drew a
   * number has to be told that the number now reads differently.
   */
  private readonly savePreferences = (next: Preferences): void => {
    this.authored.savePreferences(next);
    this.repaint();
  };

  /**
   * Whether this session may write a page at all.
   *
   * `content:write`, not `dashboards:write`: a page is this client's document
   * now, so what decides is whether this session may write *this client's*
   * content. Undefined scopes mean a password login against a core that does
   * not report them, which is the ordinary browser session and may write.
   * Checked here so the save is not *offered* rather than offered and refused
   * (§5.11).
   */
  private mayWriteDashboards(): boolean {
    return this.panelScopes === undefined || this.panelScopes.includes('content:write');
  }

  /**
   * The household's pages, and the one-time takeover from core.
   *
   * **This client stores its own documents** (§18.2). Core holds what is
   * core's — the devices, their state, the plugins, and the configuration a
   * client submits about them — and a page is not one of those.
   *
   * The import exists because these documents *were* in core while the other
   * client was the only one that could author them, and a household should not
   * have to rebuild its house by hand to move. It runs once and is recorded as
   * having run, so a page deleted here does not come back on the next boot.
   * A core that cannot answer is not a failure: this client's own pages are
   * already loaded by then, and the import can happen on a later start.
   */
  private async loadPages(api: HcApi): Promise<DashboardDefinition[]> {
    const mine = this.authored.dashboards();
    if (this.authored.imported()) return mine;

    try {
      const theirs = (await api.listDashboards()) as DashboardDefinition[];
      return this.authored.importDashboards(theirs);
    } catch {
      return mine;
    }
  }

  /**
   * Save one widget's config back into the page it is on.
   *
   * Written to this client's own store, which is where its documents live. No
   * round trip, no `updated_at` from somewhere else, and no other editor to
   * lose a race with — the page belongs to the thing that is drawing it.
   */
  private readonly saveWidget = async (
    widgetId: string,
    config: Record<string, unknown>,
  ): Promise<void> => {
    const doc = this.current;
    if (doc === undefined) throw new Error('Nothing to save into.');

    const next = withWidgetConfig(doc, widgetId, config);
    if (next === undefined) throw new Error(`This page has no widget "${widgetId}".`);

    this.docs = this.authored.saveDashboard(next);
    this.current = this.docs.find((d) => d.id === doc.id) ?? next;
    // A promise because the capability is one: a store that writes over the
    // network is still the ordinary case (`ServerContent`), and a caller that
    // could not await this would have no way to report a failure.
    return Promise.resolve();
  };

  /**
   * Put a widget on the page being shown, and say what it was called.
   *
   * The same store the save writes to, so a page gains a widget and keeps it
   * without anything else being involved.
   */
  private readonly addWidgetToPage = async (type: string): Promise<string> => {
    const doc = this.current;
    if (doc === undefined) throw new Error('No page to add to.');
    const { doc: next, id } = addWidget(doc, type);
    this.docs = this.authored.saveDashboard(next);
    this.current = next;
    return Promise.resolve(id);
  };

  private readonly removeWidgetFromPage = async (widgetId: string): Promise<void> => {
    const doc = this.current;
    if (doc === undefined) throw new Error('No page to remove from.');
    const next = removeWidget(doc, widgetId);
    this.docs = this.authored.saveDashboard(next);
    this.current = next;
    return Promise.resolve();
  };

  /**
   * Whether "delete this page" has been asked once already.
   *
   * There is no undo and no bin. The icon rules editor learned this by having
   * a session wipe a household's rules with one click, and the answer was the
   * same then: ask in place, cheaply, rather than in a dialog somebody is
   * trained to dismiss.
   */
  @state() private confirmingDelete = '';

  /** A new page, and it opens on it — nobody makes a page to not look at it. */
  private readonly addPage = (): void => {
    const name = `Page ${this.docs.length + 1}`;
    const page = newPage(
      name,
      this.docs.map((d) => d.id),
      this.current?.owner_user_id ?? '',
    );
    this.docs = this.authored.saveDashboard(page);
    this.current = page;
  };

  /**
   * A copy of the page on screen.
   *
   * The authoring move a household actually has before Phase 10: take the page
   * that nearly does what you want and change the copy.
   */
  private readonly copyPage = (): void => {
    const doc = this.current;
    if (doc === undefined) return;
    const copy = duplicatePage(
      doc,
      this.docs.map((d) => d.id),
    );
    this.docs = this.authored.saveDashboard(copy);
    this.current = copy;
  };

  /** Whether the page's name is being typed rather than shown. */
  @state() private renaming = false;

  /**
   * Rename the page, and only that.
   *
   * **The id does not move.** It is an address — an `on_tap` targets one, a
   * `dashboard_link` lists them — so renaming a page that other pages link to
   * would break the links to fix a label. The name is what a person reads and
   * the id is what a document refers to, which is exactly the split §1.1 makes
   * for devices.
   */
  private readonly renamePage = (name: string): void => {
    this.renaming = false;
    const doc = this.current;
    if (doc === undefined) return;

    const next = renamed(doc, name);
    if (next === undefined) return;
    this.docs = this.authored.saveDashboard(next);
    this.current = next;
  };

  private readonly removePage = (id: string): void => {
    this.confirmingDelete = '';
    this.docs = this.authored.deleteDashboard(id);
    if (this.current?.id === id) this.current = this.docs[0];
  };

  /**
   * What the household's pages are called.
   *
   * Names and ids only: a widget offering a link to another page needs what it
   * is called, and nothing else about it (§19.4).
   */
  private pageList(): { id: string; name: string; icon?: string }[] {
    return this.docs.map((d) => ({
      id: d.id,
      name: d.name,
      ...(typeof d.icon === 'string' && d.icon !== '' ? { icon: d.icon } : {}),
    }));
  }

  private readonly plugins = {
    list: async () => (await this.api?.listPlugins()) ?? [],
    run: async (pluginId: string, action: string) => {
      const api = this.api;
      if (api === undefined) throw new Error('not connected');
      const started = await api.runPluginAction(pluginId, action);
      return started.kind === 'done'
        ? ({ kind: 'done', result: started.result } as const)
        : ({ kind: 'streaming', requestId: started.requestId } as const);
    },
    follow: (pluginId: string, requestId: string, onEvent: (e: CommandEvent) => void) => {
      const api = this.api;
      if (api === undefined) return () => undefined;
      const source = new EventSource(api.pluginStreamUrl(pluginId, requestId));
      // Core names the SSE event `stream`; the default `message` handler would
      // never fire and the operation would look like it never reported.
      source.addEventListener('stream', (e) => {
        try {
          onEvent(JSON.parse((e as MessageEvent).data as string) as CommandEvent);
        } catch {
          // A frame that is not JSON is a frame this cannot use. The next one
          // may be fine, and closing the stream over it would lose the rest.
        }
      });
      return () => source.close();
    },
  };

  private readonly details = (deviceId: string): void => {
    // No title: the sheet's content leads with the device's name, and the
    // chrome saying it again is the same thing said twice.
    this.overlay?.sheet({ widget: { type: 'device_details', config: { device_id: deviceId } } });
  };

  /** What a widget mounted in an overlay is given — the page's env, minus the
   * page. `@picked` belongs to a page's own selection, so a sheet has none. */
  private overlayEnv(): MountEnv {
    return {
      store: this.store,
      context: this.roomContext,
      onCommand: this.command,
      onFetch: this.history,
      onEvents: this.events,
      onDetails: this.details,
      onAction: this.runAction,
      onArt: this.art,
      plugins: this.plugins,
      onUpdateDevice: this.updateDevice,
      onSaveIconRules: this.saveIconRules,
      onSavePreferences: this.savePreferences,
      ...(this.vocabulary !== undefined ? { vocabulary: this.vocabulary } : {}),
      pages: this.pageList(),
      ...(this.mayWriteDashboards()
        ? {
            onSaveWidget: this.saveWidget,
            onAddWidget: this.addWidgetToPage,
            onRemoveWidget: this.removeWidgetFromPage,
          }
        : {}),
      ...(this.panelScopes !== undefined ? { scopes: this.panelScopes } : {}),
      templates: this.authored.templates(),
    };
  }

  private readonly command = async (r: CommandRequest): Promise<void> => {
    const api = this.api;
    const device = this.store.get(r.deviceId);
    if (api === undefined || device === undefined) return;

    const verdict =
      r.action !== undefined ? checkAction(device, r.action.id) : check(device, r.patch ?? {});

    // A refusal says why. This used to return silently, three lines above a
    // comment about how a control that does nothing is the worst kind — the
    // safety policy is a good reason not to act and a bad reason not to speak.
    if ('allow' in verdict && !verdict.allow) {
      this.overlay?.toast(verdict.reason, { kind: 'warn' });
      return;
    }
    // And a confirmation is the host's, not the platform's: `globalThis.confirm`
    // blocks the event loop, cannot be styled into the skin the wall is running,
    // and on a kiosk names the origin in a chrome nobody asked for (§5.6).
    if ('confirm' in verdict) {
      const ok = await (this.overlay?.confirm({
        text: verdict.confirm,
        confirmLabel: 'Do it',
        danger: true,
      }) ?? Promise.resolve(false));
      if (!ok) return;
    }

    // Accepted, not applied: core answers 202 and the real state arrives on the
    // stream. A failure here is worth saying out loud rather than swallowing —
    // a control that silently does nothing is the worst kind.
    const sent =
      r.action !== undefined
        ? api.callAction(r.deviceId, r.action.id, r.action.params)
        : api.commandDevice(r.deviceId, r.patch ?? {});

    void sent.catch((e: unknown) => {
      const why = e instanceof HcApiError ? e.message : String(e);
      this.overlay?.toast(`${effectiveName(device)}: ${why}`, { kind: 'warn' });
    });
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.paint();

    // A panel with a key connects itself. That is the whole feature: after a
    // power cut the tablet's browser reopens its URL and the dashboard is
    // back, with nobody standing in front of it and no password on the
    // machine. Without a key this stays on the Connect button, which is right
    // for a browser somebody is sitting at.
    if (this.panelKey !== undefined) void this.connectWithKey(this.panelKey);

    globalThis.addEventListener?.('pagehide', this.onHide);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stream?.stop();
    if (this.ageTimer !== undefined) clearInterval(this.ageTimer);
    if (this.snapshotTimer !== undefined) clearInterval(this.snapshotTimer);
    if (this.schemaSweep !== undefined) clearTimeout(this.schemaSweep);
    if (this.retry !== undefined) clearTimeout(this.retry);
    globalThis.removeEventListener?.('pagehide', this.onHide);
  }

  /**
   * Tokens go on the document root, not on this element.
   *
   * A widget in a shadow root inherits custom properties through the tree, and
   * an overlay the host opens is not inside this element at all (§5.6). One
   * place, so a skin change repaints everything including third-party widgets
   * and floorplan layers (§15).
   */
  private paint(): void {
    const seeds = builtInSeeds[this.skin];
    if (seeds === undefined) return;
    applyTokens(document.documentElement, deriveTokens(seeds));
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('skin')) this.paint();
  }

  private async connect(username: string, password: string): Promise<void> {
    this.phase = 'connecting';
    this.message = '';
    try {
      const api = new HcApi({ baseUrl: this.baseUrl });
      await api.login(username, password);
      await this.bootstrap(api);
    } catch (e) {
      this.fail(e);
    }
  }

  /**
   * Come up on this panel's own key, with nobody in front of it.
   *
   * The credential is checked before anything is loaded, because the failure
   * that matters here is a *revoked* key: the panel would otherwise fetch a
   * dashboard, open a stream, get refused, and sit there showing a login
   * screen with a dead key underneath it that no amount of reloading fixes.
   * Asking `/auth/me` first turns that into one clear sentence and a forgotten
   * key, so the next `?key=` provisions cleanly.
   */
  private async connectWithKey(key: string): Promise<void> {
    this.phase = 'connecting';
    this.message = '';
    try {
      const api = new HcApi({ baseUrl: this.baseUrl, token: key });
      this.panelScopes = (await api.me()).scopes;
      await this.bootstrap(api);
    } catch (e) {
      if (e instanceof HcApiError && e.isAuthFailure) {
        this.panel.forget();
        this.phase = 'failed';
        this.message =
          'This panel’s key was refused. Open it once with a new ?key= to set it up again.';
        return;
      }
      this.fail(e);
    }
  }

  /**
   * Everything after authentication, which is the same either way.
   *
   * A key and a password differ only in how the bearer was obtained; from here
   * down the panel and somebody's browser are the same client, which is the
   * point — a panel that ran a reduced path would be a second thing to keep
   * working.
   *
   * Throws rather than setting the failed phase, so each caller can say what
   * its own failure means.
   */
  private async bootstrap(api: HcApi): Promise<void> {
    {
      this.api = api;

      // Schemas inline: one request, and the controls a device offers are known
      // on first paint rather than after N more round trips (§5.11).
      // hc-web-lit's own storage where it is running, the browser's where it
      // is not. A static deployment is a supported way to run this, and it
      // should keep a household's rules on the machine they were typed on
      // rather than forget them.
      const shared = new ServerContent({ token: () => this.api?.bearer() });
      if (await shared.load()) this.authored = new Authored(shared);

      // Before the first paint, so a mark drawn from a rule is drawn from it
      // the first time rather than after a flicker.
      this.authored.apply();
      // Before the dashboard, and the page waits for it. A widget type that
      // resolved a moment *after* the first paint would draw as unknown and
      // then quietly become something else, which is worse than never
      // resolving: an author cannot tell that from a config mistake (§8.1).
      this.extensions = await new ExtensionSource({
        token: () => this.api?.bearer(),
      }).installAll();

      this.store.reset(await api.listDevices({ includeSchema: true }));
      // What core says a widget config may hold (§4.4). Not awaited alongside
      // the devices because nothing on the first paint needs it — only the
      // property panel does, and it works without it.
      this.vocabulary = await api.dashboardVocabulary();

      this.docs = await this.loadPages(api);
      this.current = this.docs[0];

      this.stream = new EventStream({
        // Asked again on every reconnect, so a session renewed while the
        // panel was offline is the one the next attempt uses.
        url: () =>
          api.streamUrl({
            type: [
              'device_state_changed',
              'device_availability_changed',
              // A schema changing is an event (core v0.1.69). Without it a
              // Lutron phantom scene renders with no status until somebody
              // reloads, because it upgrades its own schema about a second
              // after the bridge connects.
              'device_schema_changed',
            ],
          }),
        onEvent: (e) => {
          this.store.apply(e);
          this.lastHeard = Date.now();
        },
        onStatus: (connected) => {
          this.live = connected;
          if (connected) this.lastHeard = Date.now();
        },
      });
      // The store decides *whether* a schema moved; refetching needs the API
      // client, so the shell does that half (§19.4).
      this.store.onSchemaStale = () => this.refetchSchemas();

      this.stream.start();
      this.lastHeard = Date.now();

      // Live again. Whatever was on screen a moment ago was a snapshot; it is
      // now the house, and the retry behind it has nothing left to do.
      this.restored = false;
      if (this.retry !== undefined) clearTimeout(this.retry);
      this.retry = undefined;

      // The first snapshot is taken here rather than on a timer, so a panel
      // that is rebooted five minutes after being set up still has one.
      this.lastKnown.saveNow(this.store.list(), this.docs);
      // Only while disconnected: a page that re-rendered every ten seconds
      // while everything was fine would be a wall panel burning battery to
      // tell somebody nothing changed.
      this.tickAge();

      // And a snapshot on its own slower clock. `LastKnown` refuses one that
      // comes too soon, so this asks often and writes rarely (§16).
      this.snapshotTimer = setInterval(() => {
        if (this.live) this.lastKnown.save(this.store.list(), this.docs);
      }, 60_000);

      this.phase = 'ready';
    }
  }

  /**
   * What this panel's key cannot do, when that is worth saying out loud.
   *
   * Undefined for a browser session, for a key with the content scopes, and
   * against a core older than v0.1.68 — which did not report scopes, so an
   * absent list means *unknown* and guessing from the role is exactly the
   * mistake core v0.1.68 exists to stop.
   */
  private get panelLimit(): { text: string; why: string } | undefined {
    const scopes = this.panelScopes;
    if (this.panelKey === undefined || scopes === undefined) return undefined;
    if (!scopes.includes('content:read')) {
      return {
        text: 'own content',
        why: 'This key cannot read the household’s authored content, so this panel is showing its own icon rules and templates rather than the house’s. Re-issue it with content:read.',
      };
    }
    if (!scopes.includes('content:write')) {
      return {
        text: 'read only',
        why: 'This key cannot write authored content, so icon rules and templates cannot be saved from this panel. Re-issue it with content:write.',
      };
    }
    return undefined;
  }

  /**
   * Refetch the schemas the store says have moved.
   *
   * **Coalesced, because a plugin restart is not one event.** hc-zwave
   * republishes on rescan and hc-hue when an aux device gains a facet, so a
   * client that fetched per event would answer a restart with one request per
   * device — 184 of them on this house, arriving in a burst, on the hardware
   * least able to absorb it. A short window turns that into one pass, and a
   * schema arriving 250ms late is invisible where a request storm is not.
   */
  private refetchSchemas(): void {
    if (this.schemaSweep !== undefined) return;
    this.schemaSweep = setTimeout(() => {
      this.schemaSweep = undefined;
      void this.sweepSchemas();
    }, 250);
  }

  private async sweepSchemas(): Promise<void> {
    const api = this.api;
    if (api === undefined) return;

    for (const deviceId of this.store.staleSchemas()) {
      try {
        this.store.setSchema(deviceId, (await api.getDeviceSchema(deviceId)) ?? null);
      } catch {
        // Left stale on purpose: the next event, or the next connect, tries
        // again. Dropping it would mean a device whose controls never return.
      }
    }
  }

  private schemaSweep: ReturnType<typeof setTimeout> | undefined;

  private fail(e: unknown): void {
    // A credential the house refused is not an outage, and a stale dashboard
    // would hide the one thing the person needs to be told.
    const refused = e instanceof HcApiError && e.isAuthFailure;
    if (!refused && this.showLastKnown()) return;

    this.phase = 'failed';
    this.message =
      e instanceof HcApiError ? e.message : `Could not reach ${this.baseUrl} — ${String(e)}`;
  }

  /**
   * Draw what was last known, and keep trying for what is true.
   *
   * The screen a wall panel should show after a power cut it outlived: the
   * dashboard somebody relies on, every reading exactly as old as it is, and
   * the staleness badge saying so. `lastHeard` is the snapshot's own timestamp
   * rather than now, so a view restored from four hours ago says four hours —
   * the alternative is a panel that looks live and is not, which is the single
   * worst thing this client could do (§16).
   */
  private showLastKnown(): boolean {
    const snapshot = this.lastKnown.load();
    if (snapshot === undefined) return false;

    // **The pages this client stores win over the snapshot's copy of them.**
    // A snapshot is a photograph of the house taken every few minutes; a page
    // is a document somebody edited, possibly since. Restoring the photograph
    // over the document would quietly undo yesterday's edit on a panel that
    // came back after a power cut — and the panel would look fine.
    //
    // The snapshot is still where the *devices* come from, and still where
    // the pages come from when this client's own store cannot be reached
    // either, which on a static deployment is the same outage.
    const docs = pagesToShow(this.authored.dashboards(), snapshot.dashboards);
    if (docs.length === 0) return false;

    this.store.reset(snapshot.devices);
    this.docs = [...docs];
    this.current = this.docs.find((d) => d.id === this.current?.id) ?? this.docs[0];
    this.lastHeard = Date.now() - ageOf(snapshot);
    this.restored = true;
    this.live = false;
    this.phase = 'ready';

    this.tickAge();
    this.scheduleRetry();
    return true;
  }

  /**
   * Try the house again, slowing down but never giving up.
   *
   * A panel is unattended: there is nobody to press anything, so stopping
   * after N attempts means a screen that stays wrong until somebody notices.
   * Backing off to a minute costs nothing and recovers on its own.
   */
  private scheduleRetry(delay = 5_000): void {
    if (this.retry !== undefined) clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      const key = this.panelKey;
      const attempt = key !== undefined ? this.connectWithKey(key) : Promise.resolve();
      void attempt.then(() => {
        if (this.restored) this.scheduleRetry(Math.min(delay * 2, 60_000));
      });
    }, delay);
  }

  /** Count the age up while nothing is arriving. Idempotent. */
  private tickAge(): void {
    if (this.ageTimer !== undefined) return;
    this.ageTimer = setInterval(() => {
      if (!this.live) this.requestUpdate();
    }, 10_000);
  }

  /**
   * History, read through the host like everything else (§19.4).
   *
   * A widget holding an API client would hold a token; this is the same shape
   * as the command sink and becomes `ctx.history` when the capability object
   * exists (§5.9).
   */
  private readonly history = async (
    deviceId: string,
    opts: { from: Date; to: Date; limit: number },
  ) => {
    if (this.api === undefined) return [];
    return this.api.deviceHistory(deviceId, opts);
  };

  /** The event log, read through the host like history (§19.4). */
  private readonly events = async (opts: { limit: number }) => {
    if (this.api === undefined) return [];
    return this.api.listEvents(opts);
  };

  /**
   * Open a room: the room document, with `@room` set to the one tapped.
   *
   * One page for every room, which is what the token exists for — the field
   * hands over a room and the page it belongs on, and nothing about either is
   * hardcoded here.
   */
  /**
   * What a placement's `on_tap` does (§5.10).
   *
   * `page` is the only verb the reference house stores, and it is the
   * breadcrumb going home — which also means leaving the room, or the house
   * page would draw itself with a room still selected under it.
   */
  /**
   * Every action, dispatched in one place (§5.10).
   *
   * The host does this rather than the widget, and that is what makes the
   * safety policy real: a lock never actuates from a plain tap regardless of
   * what a placement's config says, and a widget nobody in this repo wrote
   * cannot opt out by mishandling its own events (§11.3).
   */
  private readonly runAction = async (a: ActionConfig): Promise<void> => {
    switch (a.do) {
      case 'none':
        return;

      case 'page': {
        const target = this.docs.find((d) => d.id === a.target);
        if (target === undefined) {
          this.overlay?.toast(`No dashboard called ${a.target ?? '(nothing)'}.`, { kind: 'warn' });
          return;
        }
        // Going home also leaves the room, or the house page would draw itself
        // with a room still selected under it.
        this.current = target;
        this.roomContext = {};
        return;
      }

      case 'details': {
        const id = a.device_id ?? a.target ?? this.roomContext.picked;
        if (id === undefined) return;
        this.details(id);
        return;
      }

      case 'url': {
        // A new tab, always. A kiosk that navigated away from the dashboard
        // would need somebody to walk to it and press back.
        if (a.target !== undefined) globalThis.open(a.target, '_blank', 'noopener');
        return;
      }

      case 'toggle': {
        const id = a.device_id ?? a.target ?? this.roomContext.picked;
        const device = id === undefined ? undefined : this.store.get(id);
        if (device === undefined) {
          this.overlay?.toast('That device is not in the house.', { kind: 'warn' });
          return;
        }
        // Through the same sink a control uses, so the safety policy and the
        // confirmation are applied once rather than per caller.
        await this.command({ deviceId: device.device_id, patch: { on: isOn(device) !== true } });
        return;
      }

      case 'service': {
        const id = a.device_id ?? a.target;
        if (a.service === undefined || id === undefined) {
          this.overlay?.toast('That action names no service.', { kind: 'warn' });
          return;
        }
        await this.command({
          deviceId: id,
          action: { id: a.service, params: a.payload ?? {} },
        });
        return;
      }

      default:
        // A verb from a newer client, or a typo. Saying so beats a tap that
        // silently does nothing (§5.10).
        this.overlay?.toast(`Nothing here knows how to ${a.do}.`, { kind: 'warn' });
    }
  };

  private openRoom(e: CustomEvent<{ room: string; page?: string }>): void {
    const { room, page } = e.detail;
    const target = page !== undefined ? this.docs.find((d) => d.id === page) : undefined;
    if (target !== undefined) this.current = target;
    this.roomContext = { room };
  }

  /** Put the cursor in the name the moment it appears, not after a click. */
  override updated(): void {
    const box = this.shadowRoot?.querySelector<HTMLInputElement>('input.rename');
    if (box !== null && box !== undefined && this.shadowRoot?.activeElement !== box) box.select();
  }

  override render() {
    return html`
      <header ?hidden=${this.kiosk}>
        <span class="brand">homeCore</span>
        ${
          this.phase === 'ready'
            ? html`
                <select
                  @change=${(e: Event) => {
                    const id = (e.target as HTMLSelectElement).value;
                    this.current = this.docs.find((d) => d.id === id);
                  }}
                >
                  ${this.docs.map(
                    (d) =>
                      // Marked from `current`, because the page is no longer
                      // only ever changed here: a breadcrumb's `on_tap` moves
                      // it too, and a picker that says otherwise is lying about
                      // what is on the screen.
                      html`<option value=${d.id} ?selected=${d.id === this.current?.id}>
                        ${d.name}
                      </option>`,
                  )}
                </select>
                ${this.pageControls()}
                <select
                  @change=${(e: Event) => {
                    this.skin = (e.target as HTMLSelectElement).value;
                  }}
                >
                  ${Object.keys(builtInSeeds).map(
                    (n) => html`<option value=${n} ?selected=${n === this.skin}>${n}</option>`,
                  )}
                </select>
                <select
                  .value=${this.breakpoint}
                  @change=${(e: Event) => {
                    this.breakpoint = (e.target as HTMLSelectElement).value as DashboardBreakpoint;
                  }}
                >
                  ${(['mobile', 'tablet', 'desktop', 'tv'] as const).map(
                    (b) =>
                      html`<option value=${b} ?selected=${b === this.breakpoint}>${b}</option>`,
                  )}
                </select>
              `
            : nothing
        }
        <span class="spacer"></span>
        ${
          this.phase === 'ready'
            ? html`<span class="status">
                <span class="dot" ?data-live=${this.live}></span>
                ${this.live ? 'live' : `last heard ${sinceHeard(this.lastHeard)}`} ·
                ${this.store.size} devices
              </span>`
            : nothing
        }
        ${
          // Only when it is true, and only when it costs the household
          // something: a key without the content scopes gives this panel its
          // *own* icon rules and templates rather than the house's, and two
          // devices quietly disagreeing about what a mark means is worse than
          // one that says so.
          this.phase === 'ready' && this.panelLimit !== undefined
            ? html`<span class="status error" title=${this.panelLimit.why}>
                ${this.panelLimit.text}
              </span>`
            : nothing
        }
      </header>
      <main>${this.body()}</main>
      ${
        // The one thing a panel must never hide. Chrome goes; "what you are
        // looking at is four minutes old" stays, because a dashboard that
        // quietly shows the past is worse than one that shows nothing.
        this.phase === 'ready' && !this.live && (this.kiosk || this.restored)
          ? html`<div class="stale" part="stale">
              <span class="dot"></span>
              ${
                this.restored
                  ? // Said differently on purpose. "Last heard 20m ago" describes
                    // a live page whose connection dropped; this page was *built*
                    // from a recording, and nothing on it has been checked since.
                    // "reconnecting" only when something actually is (see
                    // `scheduleRetry`): a browser session has no credential to
                    // retry with and must not claim otherwise.
                    html`showing the house as it was
                    ${sinceHeard(this.lastHeard)}${
                      this.retry !== undefined ? ' · reconnecting' : ''
                    }`
                  : html`last heard ${sinceHeard(this.lastHeard)}`
              }
            </div>`
          : nothing
      }
    `;
  }

  /**
   * Make a page, copy one, forget one.
   *
   * In the chrome rather than on a page, because these are things you do *to*
   * a page and a widget that could delete the page it is on is a widget that
   * can delete itself mid-render. Hidden in kiosk with the rest of the header:
   * a wall panel is for looking at.
   *
   * Absent entirely when this session cannot write content — §5.11's rule
   * again, and the reason is sharper here than usual, because the failure
   * would be a page somebody made that vanishes on reload.
   */
  private pageControls() {
    if (!this.mayWriteDashboards()) return nothing;
    const id = this.current?.id;

    if (this.renaming && this.current !== undefined) {
      return html`<input
        class="rename"
        aria-label="Page name"
        .value=${this.current.name}
        @keydown=${(e: KeyboardEvent) => {
          // Escape leaves the name alone, which is what somebody who opened
          // this by accident is reaching for.
          if (e.key === 'Escape') this.renaming = false;
          if (e.key === 'Enter') this.renamePage((e.target as HTMLInputElement).value);
        }}
        @blur=${(e: Event) => {
          // Escape has already turned this off, and its own blur must not
          // then commit the words somebody was abandoning.
          if (this.renaming) this.renamePage((e.target as HTMLInputElement).value);
        }}
      />`;
    }

    return html`<button
        title="Rename this page"
        @click=${() => {
          this.renaming = true;
        }}
      >
        Rename
      </button>
      <button title="Make a page" @click=${this.addPage}>+ Page</button> ${
        id === undefined
          ? nothing
          : this.confirmingDelete === id
            ? html`<button
                  class="danger"
                  @click=${() => {
                    this.removePage(id);
                  }}
                >
                  Delete “${this.current?.name}”?
                </button>
                <button
                  @click=${() => {
                    this.confirmingDelete = '';
                  }}
                >
                  Keep it
                </button>`
            : html`<button title="Copy this page" @click=${this.copyPage}>Duplicate</button>
                <button
                  title="Delete this page"
                  @click=${() => {
                    this.confirmingDelete = id;
                  }}
                >
                  Delete
                </button>`
      }`;
  }

  private body() {
    if (this.phase === 'idle') {
      return html`<div class="note">
        <button
          @click=${() => {
            void this.connect('admin', 'password');
          }}
        >
          Connect
        </button>
      </div>`;
    }
    if (this.phase === 'connecting') return html`<div class="note">Connecting…</div>`;
    if (this.phase === 'failed') return html`<div class="note error">${this.message}</div>`;

    return html`
      ${this.message !== '' ? html`<div class="note error">${this.message}</div>` : nothing}
      ${
        // Not a toast: this is a standing condition, not an event, and it is
        // still true tomorrow. An admin who installed something and cannot see
        // it needs the reason to still be there when they go looking (§4.3 —
        // the host "says so in the UI rather than failing silently").
        this.extensions.failed.length > 0 && !this.kiosk
          ? html`<div class="note error" part="note">
              ${this.extensions.failed.map((f) => html`<div>${f.id}: ${f.error}</div>`)}
            </div>`
          : nothing
      }
      <hc-page
        @hc-open-room=${(e: CustomEvent<{ room: string; page?: string }>) => this.openRoom(e)}
        .doc=${this.current}
        .store=${this.store}
        .onCommand=${this.command}
        .onFetch=${this.history}
        .onEvents=${this.events}
        .onDetails=${this.details}
        .onArt=${this.art}
        .plugins=${this.plugins}
        .onUpdateDevice=${this.updateDevice}
        .onSaveIconRules=${this.saveIconRules}
        .onSavePreferences=${this.savePreferences}
        .vocabulary=${this.vocabulary}
        .pages=${this.pageList()}
        .onSaveWidget=${this.mayWriteDashboards() ? this.saveWidget : undefined}
        .onAddWidget=${this.mayWriteDashboards() ? this.addWidgetToPage : undefined}
        .onRemoveWidget=${this.mayWriteDashboards() ? this.removeWidgetFromPage : undefined}
        .scopes=${this.panelScopes}
        .templates=${this.authored.templates()}
        .onAction=${this.runAction}
        .context=${this.roomContext}
        breakpoint=${this.breakpoint}
      ></hc-page>
      <hc-overlay .env=${this.overlayEnv()}></hc-overlay>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-app': HcApp;
  }
}
