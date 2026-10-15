/**
 * The editor's left rail — what can be put on the page, and what is on it.
 *
 * **Insert is the house first.** Rooms, and the devices in them, dragged onto
 * the page — the widget a device becomes is chosen for it (`core/insert.ts`),
 * because nobody building a page creates a lock: homeCore already has one.
 * After the house, the few things a page holds that are not devices, and
 * everything else folded under More. Choosing still arms rather than adds
 * (§14.1); dragging arms and places in one movement.
 *
 * **Layers** is the page as a list. A page drawn by a person is full of
 * things that are hard to press: a hairline, a label inside a section, a
 * shape behind everything, a widget told to hide until a lamp is picked. Every
 * design application answers that the same way — a list of what is there that
 * selects what it names — and without one, part of every page is unreachable.
 *
 * Neither writes anything. Both report, and the shell does the work: the tool
 * is the shell's (`hc-app`), and the selection is the page's (`hc-page`).
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type {
  DashboardBreakpoint,
  DashboardDefinition,
  DashboardWidget,
} from '../core/dashboard.js';
import { layoutToDraw } from '../core/dashboard.js';
import type { DeviceState } from '../core/device.js';
import { groupOf } from '../core/groups.js';
import { DEVICE_TYPES, DRAG_TOOL, deviceOfTool, deviceTool, firstWay } from '../core/insert.js';
import { effectiveArea, effectiveName, normalizeAreaName } from '../core/present.js';
import { knownTypes } from '../core/registry.js';
import { humanise } from '../core/text.js';
import { icon, iconFor } from '../design/icons.js';

/**
 * Things a page holds that are not part of the house.
 *
 * Deliberately few. Everything about a device comes *with* the device; what is
 * left is the page's own furniture — words, pictures, lines, a way to another
 * page — and a list of eight is one a person reads.
 */
const PAGE_ITEMS: readonly string[] = [
  'heading',
  'text',
  'image',
  'icon',
  'shape',
  'line',
  'dashboard_link',
  'web_embed',
];

/**
 * Everything else, folded away under More.
 *
 * Summaries of the house, containers and the authoring tools are real and
 * placeable, but they are not what somebody reaches for first, and a palette
 * that opens on all of them is the page-long list that buried the devices.
 * A type named nowhere — an extension's — lands under Other, because the
 * palette must not be the place that forgets one exists (§3, Rule 1).
 */
const MORE: readonly { name: string; types: readonly string[] }[] = [
  {
    name: 'Summaries of the house',
    types: [
      'house_status_hero',
      'worth_knowing',
      'event_feed',
      'rooms',
      'device_grid',
      'device_list',
      'stat_summary',
      'device_breakdown',
      'mode_chips',
      'scene_row',
      'camera_video',
    ],
  },
  { name: 'Text & decoration', types: ['markdown', 'divider', 'spacer', 'svg'] },
  { name: 'Containers', types: ['stack', 'grid', 'tabs', 'swipe', 'accordion'] },
  {
    name: 'Advanced',
    types: ['preferences', 'icon_rules', 'extensions', 'code', 'plugin_widget'],
  },
];

/** Shorter names where the humanised id reads like an id. */
const NAMES: Record<string, string> = {
  camera_video: 'Camera',
  colour_wheel: 'Colour wheel',
  dashboard_link: 'Link to a page',
  house_status_hero: 'House status',
  worth_knowing: 'Worth knowing',
  plugin_actions: 'Plugin actions',
  plugin_widget: 'Plugin widget',
  web_embed: 'Web page',
  svg: 'SVG',
};

export function typeName(type: string): string {
  return NAMES[type] ?? humanise(type);
}

/** The prefix a template tool carries, shared with the shell. */
export const TEMPLATE_TOOL = 'template:';

/**
 * What a widget is called in the list.
 *
 * The widget's own words first — a title, the text it shows — then the device
 * it is about, then what kind of thing it is. Ids are a last resort: this
 * house's ids are seventy characters of hex.
 */
export function layerName(
  w: DashboardWidget,
  deviceName: (id: string) => string | undefined,
): string {
  const c = w.config ?? {};
  const words = [w.title, c['title'], c['text'], c['label'], c['name']].find(
    (v): v is string => typeof v === 'string' && v.trim() !== '' && !v.includes('{{'),
  );
  if (words !== undefined) return words.length > 40 ? `${words.slice(0, 39)}…` : words;
  const device = c['device_id'];
  if (typeof device === 'string' && device !== '@picked') {
    const named = deviceName(device);
    if (named !== undefined) return named;
  }
  return typeName(w.type);
}

@customElement('hc-editor-rail')
export class HcEditorRail extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      color: var(--hc-ink, #e9edf2);
      font-size: var(--hc-text-body-small-size, 12.5px);
    }
    .tabs {
      display: flex;
      gap: 4px;
      padding: 8px;
      border-bottom: 1px solid var(--hc-stroke-hairline, #262d38);
    }
    .tabs button {
      flex: 1;
      padding: 6px 8px;
      border: 1px solid transparent;
      border-radius: var(--hc-radius-sm, 8px);
      background: none;
      color: var(--hc-ink-muted, #8b95a4);
      font: inherit;
      cursor: pointer;
    }
    .tabs button[aria-selected='true'] {
      background: var(--hc-surface-raised, #141922);
      border-color: var(--hc-stroke-hairline, #262d38);
      color: var(--hc-ink, #e9edf2);
    }
    .body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 8px;
    }
    .search {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      margin-bottom: 8px;
      border: 1px solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: inherit;
      font: inherit;
    }
    h3 {
      margin: 12px 4px 4px;
      font-size: var(--hc-text-caption-size, 11px);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--hc-ink-muted, #8b95a4);
    }
    h3:first-of-type {
      margin-top: 4px;
    }
    .shelf {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
    }
    .shelf button {
      padding: 8px;
      text-align: left;
      border: 1px solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-raised, #141922);
      color: inherit;
      font: inherit;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .shelf button:hover {
      border-color: var(--hc-ink-muted, #8b95a4);
    }
    .shelf button[aria-pressed='true'] {
      border-color: var(--hc-accent-active, #ffc978);
      color: var(--hc-accent-active, #ffc978);
    }
    h4 {
      margin: 8px 4px 4px;
      font-size: var(--hc-text-caption-size, 11px);
      font-weight: 600;
      color: var(--hc-ink-muted, #8b95a4);
    }
    details.room summary,
    details.more summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      border-radius: 6px;
      cursor: pointer;
      list-style: none;
      font-weight: 600;
    }
    details.room summary::-webkit-details-marker,
    details.more summary::-webkit-details-marker {
      display: none;
    }
    details.room summary::before,
    details.more summary::before {
      content: '▸';
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
    details[open].room summary::before,
    details[open].more summary::before {
      content: '▾';
    }
    details.room summary:hover,
    details.more summary:hover {
      background: var(--hc-surface-raised, #141922);
    }
    details.more {
      margin-top: 12px;
    }
    .count {
      margin-left: auto;
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      font-weight: 400;
    }
    .devices {
      list-style: none;
      margin: 0 0 4px;
      padding: 0 0 0 12px;
    }
    .devices button {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 4px 8px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: grab;
    }
    .devices button:hover {
      background: var(--hc-surface-raised, #141922);
      border-color: var(--hc-stroke-hairline, #262d38);
    }
    .devices button[aria-pressed='true'] {
      border-color: var(--hc-accent-active, #ffc978);
    }
    .devices button[data-away] {
      opacity: 0.55;
    }
    .devices .mark {
      display: inline-flex;
      flex: none;
      width: 16px;
      height: 16px;
      color: var(--hc-ink-muted, #8b95a4);
    }
    .devices .mark svg {
      width: 100%;
      height: 100%;
    }
    .devices .what {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .devices .kind {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      white-space: nowrap;
    }
    .shelf button {
      cursor: grab;
    }
    .hint {
      margin: 0 0 8px;
      padding: 8px;
      border-radius: var(--hc-radius-sm, 8px);
      background: color-mix(in srgb, var(--hc-accent-active, #ffc978) 14%, transparent);
      color: var(--hc-ink, #e9edf2);
    }
    .layers {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .layers li button {
      display: flex;
      align-items: baseline;
      gap: 8px;
      width: 100%;
      padding: 4px 8px;
      border: 0;
      border-radius: 6px;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .layers li button:hover {
      background: var(--hc-surface-raised, #141922);
    }
    .layers li button[aria-pressed='true'] {
      background: color-mix(in srgb, var(--hc-stroke-focus, #7cc4ff) 22%, transparent);
    }
    .layers .what {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .layers .kind {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      white-space: nowrap;
    }
    .layers .group {
      padding: 6px 8px 2px;
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      font-weight: 600;
    }
    .layers .group button {
      padding: 0;
      color: inherit;
      font-weight: 600;
    }
    .empty {
      padding: 8px;
      color: var(--hc-ink-muted, #8b95a4);
    }
    button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 1px;
    }
  `;

  @property({ attribute: false }) doc: DashboardDefinition | undefined;
  @property({ type: String }) breakpoint: DashboardBreakpoint = 'desktop';
  /** The type held, waiting to be drawn. */
  @property({ type: String }) tool: string | undefined;
  /** What is in hand on the page. */
  @property({ attribute: false }) held: readonly string[] = [];
  /** Template ids this household has made. */
  @property({ attribute: false }) templateIds: readonly string[] = [];
  @property({ attribute: false }) deviceName: (id: string) => string | undefined = () => undefined;
  /** The house, which is what Insert offers first. */
  @property({ attribute: false }) devices: readonly DeviceState[] = [];

  @state() private tab: 'insert' | 'layers' = 'insert';
  @state() private filter = '';
  /** Rooms somebody opened, so they stay open across a re-render. */
  @state() private openRooms = new Set<string>();

  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private arm(type: string): void {
    this.emit('hc-tool', { type: this.tool === type ? undefined : type });
  }

  /** Show the layers list — the shell asks for it when something is selected. */
  showLayers(): void {
    this.tab = 'layers';
  }

  override render() {
    return html`<div class="tabs" role="tablist">
        <button
          role="tab"
          aria-selected=${this.tab === 'insert'}
          @click=${() => {
            this.tab = 'insert';
          }}
        >
          Insert
        </button>
        <button
          role="tab"
          aria-selected=${this.tab === 'layers'}
          @click=${() => {
            this.tab = 'layers';
          }}
        >
          Layers
        </button>
      </div>
      <div class="body">${this.tab === 'insert' ? this.insert() : this.layers()}</div>`;
  }

  private insert() {
    const words = this.filter.trim().toLowerCase();
    const searching = words !== '';
    const label = (t: string): string =>
      t.startsWith(TEMPLATE_TOOL) ? t.slice(TEMPLATE_TOOL.length) : typeName(t);
    const matches = (t: string): boolean =>
      !searching || label(t).toLowerCase().includes(words) || t.includes(words);

    const held = deviceOfTool(this.tool);
    const heldName =
      held === undefined
        ? this.tool === undefined
          ? undefined
          : label(this.tool)
        : (this.deviceName(held) ?? held);

    const listed = new Set([...PAGE_ITEMS, ...MORE.flatMap((m) => m.types)]);
    const more = [
      ...MORE,
      {
        name: 'Other',
        types: knownTypes().filter((t) => !listed.has(t) && !DEVICE_TYPES.has(t)),
      },
      { name: 'Your templates', types: this.templateIds.map((id) => `${TEMPLATE_TOOL}${id}`) },
    ]
      .map((m) => ({ ...m, types: m.types.filter(matches) }))
      .filter((m) => m.types.length > 0);
    const items = PAGE_ITEMS.filter(matches);
    const rooms = this.rooms(words);

    const tile = (t: string) =>
      html`<button
        class="item"
        draggable="true"
        title=${label(t)}
        aria-pressed=${this.tool === t ? 'true' : 'false'}
        @click=${() => this.arm(t)}
        @dragstart=${(e: DragEvent) => this.carry(e, t)}
        @dragend=${() => this.emit('hc-tool', { type: undefined })}
      >
        ${label(t)}
      </button>`;

    return html`${
        heldName === undefined
          ? nothing
          : html`<p class="hint">
              Drop <strong>${heldName}</strong> on the page, or click where it goes. Esc to cancel.
            </p>`
      }
      <input
        class="search"
        type="search"
        placeholder="Find a device or room…"
        aria-label="Find a device or room"
        .value=${this.filter}
        @input=${(e: Event) => {
          this.filter = (e.target as HTMLInputElement).value;
        }}
      />
      <h3>Your house</h3>
      ${
        rooms.length === 0
          ? html`<div class="empty">
              ${searching ? 'No device by that name.' : 'No devices yet.'}
            </div>`
          : rooms.map(
              (r) =>
                html`<details
                  class="room"
                  ?open=${searching || this.openRooms.has(r.key)}
                  @toggle=${(e: Event) => this.remember(r.key, (e.target as HTMLDetailsElement).open)}
                >
                  <summary>
                    <span class="what">${r.name}</span
                    ><span class="count">${r.devices.length}</span>
                  </summary>
                  <ul class="devices">
                    ${r.devices.map((d) => this.deviceRow(d))}
                  </ul>
                </details>`,
            )
      }
      ${
        items.length === 0
          ? nothing
          : html`<h3>On the page</h3>
              <div class="shelf">${items.map(tile)}</div>`
      }
      ${
        more.length === 0
          ? nothing
          : html`<details class="more" ?open=${searching}>
              <summary>More</summary>
              ${more.map(
                (m) =>
                  html`<h4>${m.name}</h4>
                    <div class="shelf">${m.types.map(tile)}</div>`,
              )}
            </details>`
      }`;
  }

  /** Rooms the house has, each with its devices, matching what was typed. */
  private rooms(words: string): { key: string; name: string; devices: DeviceState[] }[] {
    const by = new Map<string, { key: string; name: string; devices: DeviceState[] }>();
    for (const d of this.devices) {
      const area = effectiveArea(d);
      const key = normalizeAreaName(area);
      const name = key === '' ? 'Not in a room' : humanise(area ?? key);
      if (
        words !== '' &&
        !effectiveName(d).toLowerCase().includes(words) &&
        !name.toLowerCase().includes(words)
      ) {
        continue;
      }
      const room = by.get(key) ?? { key, name, devices: [] };
      room.devices.push(d);
      by.set(key, room);
    }
    for (const r of by.values()) {
      r.devices.sort((a, b) => effectiveName(a).localeCompare(effectiveName(b)));
    }
    // Rooms by name, and the devices nobody put in one last — they are the
    // ones a person is least likely to be looking for.
    return [...by.values()].sort((a, b) =>
      a.key === '' ? 1 : b.key === '' ? -1 : a.name.localeCompare(b.name),
    );
  }

  private deviceRow(d: DeviceState) {
    const tool = deviceTool(d.device_id);
    return html`<li>
      <button
        draggable="true"
        title="Drag onto the page, or click and then click where it goes"
        aria-pressed=${this.tool === tool ? 'true' : 'false'}
        ?data-away=${!d.available}
        @click=${() => this.arm(tool)}
        @dragstart=${(e: DragEvent) => this.carry(e, tool)}
        @dragend=${() => this.emit('hc-tool', { type: undefined })}
      >
        <span class="mark">${icon(iconFor(d))}</span>
        <span class="what">${effectiveName(d)}</span>
        <span class="kind">${firstWay(d).label}</span>
      </button>
    </li>`;
  }

  /**
   * Start carrying something over to the page.
   *
   * The tool is armed now rather than at the drop, because the page cannot
   * read a drag's data until it lands — and it needs to know what is coming,
   * and how big, to draw where it will go while it is still being carried.
   */
  private carry(e: DragEvent, tool: string): void {
    e.dataTransfer?.setData(DRAG_TOOL, tool);
    e.dataTransfer?.setData('text/plain', tool);
    if (e.dataTransfer !== null) e.dataTransfer.effectAllowed = 'copy';
    this.emit('hc-tool', { type: tool });
  }

  private remember(key: string, open: boolean): void {
    if (open === this.openRooms.has(key)) return;
    const next = new Set(this.openRooms);
    if (open) next.add(key);
    else next.delete(key);
    this.openRooms = next;
  }

  private layers() {
    const doc = this.doc;
    if (doc === undefined || (doc.widgets ?? []).length === 0) {
      return html`<div class="empty">Nothing on this page yet. Pick something from Insert.</div>`;
    }

    // In the order the page draws them, top to bottom then left to right,
    // because that is the order somebody looking at the page reads it in.
    const layout = layoutToDraw(doc, this.breakpoint)?.layout;
    const at = new Map(
      (layout?.placements ?? []).map((p) => [
        p.widget_id,
        { y: p.rect?.y ?? p.y * 1000, x: p.rect?.x ?? p.x * 1000 },
      ]),
    );
    const placed = (doc.widgets ?? [])
      .filter((w) => at.has(w.id))
      .sort((a, b) => {
        const pa = at.get(a.id)!;
        const pb = at.get(b.id)!;
        return pa.y - pb.y || pa.x - pb.x;
      });

    // Grouped by the top of each widget's group path, which is a section on
    // every composed page in this household.
    const sections = new Map<string, DashboardWidget[]>();
    for (const w of placed) {
      const top = groupOf(w.config)?.split('/')[0] ?? '';
      sections.set(top, [...(sections.get(top) ?? []), w]);
    }
    const held = new Set(this.held);

    const row = (w: DashboardWidget) =>
      html`<li>
        <button
          aria-pressed=${held.has(w.id) ? 'true' : 'false'}
          title=${w.id}
          @click=${(e: MouseEvent) => {
            const ids = e.shiftKey
              ? held.has(w.id)
                ? this.held.filter((i) => i !== w.id)
                : [...this.held, w.id]
              : [w.id];
            this.emit('hc-select', { ids });
          }}
        >
          <span class="what">${layerName(w, this.deviceName)}</span>
          <span class="kind">${typeName(w.type)}</span>
        </button>
      </li>`;

    return html`<ul class="layers">
      ${[...sections].map(([section, ws]) =>
        section === ''
          ? ws.map(row)
          : html`<li class="group">
                <button
                  title="Select everything in ${section}"
                  @click=${() => this.emit('hc-select', { ids: ws.map((w) => w.id) })}
                >
                  ${section}
                </button>
              </li>
              ${ws.map(row)}`,
      )}
    </ul>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-editor-rail': HcEditorRail;
  }
}
