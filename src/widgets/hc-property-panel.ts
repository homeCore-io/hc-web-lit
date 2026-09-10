/**
 * The property panel — Phase 4's "schema-driven property panel for every
 * widget, no JSON editing required" (§4.4).
 *
 * Every control here is generated. Nothing in this file knows what a
 * `device_grid` is, which is the point: core publishes the table it validates
 * documents against, `core/properties.ts` turns it into a list of properties,
 * and this draws them. A widget type added to core next month gets an editor
 * with no change here, and so does one nobody has heard of (§14.3) — its keys
 * are listed as they are, editable and unlabelled, rather than refused.
 *
 * **It shows the widget while you edit it.** The panel mounts the subject as a
 * child and re-mounts it on every keystroke, so a property is not a name in a
 * form but a thing that changes on screen. That is `ctx.child` (§4.2, §5.5)
 * doing what it was added for, and it is also the fastest way to find out that
 * a generated control writes the wrong shape.
 *
 * **What it does not do is save.** There is no dashboard write path in this
 * client yet: a change is reported — as an event and to the host callback if
 * there is one — and the designer (Phase 10) is what will persist it. Said
 * plainly here so nobody reads an unsaved edit as a lost one; the panel says
 * the same thing on screen.
 *
 * Two rules taken from `core/properties.ts` and visible in the markup:
 * suggestions never restrict, so every open field is an input with a
 * `datalist` rather than a select; and a key nothing described is drawn like
 * any other rather than hidden, because it belongs to somebody.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { TemplateResult } from 'lit';
import { VERBS, type ActionConfig } from '../core/actions.js';
import { isScene } from '../core/capability.js';
import type { DeviceState } from '../core/device.js';
import { effectiveArea, effectiveName } from '../core/present.js';
import {
  asList,
  propertiesFor,
  withValue,
  type Property,
  type Suggest,
} from '../core/properties.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';
import { facetHints } from '../core/selection.js';
import { widgetSpec, type Vocabulary } from '../core/vocabulary.js';
import type { WidgetSpec } from '../core/widget.js';
import { knownRoles } from '../design/roles.js';
import { markNames } from '../design/icons.js';
import { mountChildren, type MountEnv } from '../shell/mount.js';

/** The three states of a confirmation, in the words the field uses. */
const CONFIRM = [
  { value: 'policy', label: 'as the safety policy says' },
  { value: 'always', label: 'always ask' },
  { value: 'never', label: 'never ask' },
] as const;

@customElement('hc-property-panel')
export class HcPropertyPanel extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      color: var(--hc-ink, #e9edf2);
      font-size: var(--hc-text-body-small-size, 12.5px);
    }
    .preview {
      border: var(--hc-stroke-width, 1px) dashed var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-md, 12px);
      padding: 0.5rem;
      margin-bottom: 0.75rem;
      min-height: 3rem;
      /* Capped, because the subject is a real widget at its real size: a
         device grid of a busy room drew 880px of tiles and pushed every
         field it was meant to be edited by below the fold. */
      max-height: 40vh;
      overflow: auto;
    }
    .subject {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      padding-bottom: 0.5rem;
    }
    .row {
      display: grid;
      grid-template-columns: minmax(6rem, 10rem) 1fr;
      gap: 0.375rem;
      align-items: start;
      padding: 0.375rem 0;
      border-bottom: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
    }
    .name {
      padding-top: 0.6rem;
      color: var(--hc-ink-muted, #8b95a4);
    }
    .name.required {
      color: var(--hc-ink, #e9edf2);
    }
    .name .extra {
      display: block;
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-accent-warn, #ffc978);
    }
    .field {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      align-items: center;
      min-width: 0;
    }
    input,
    select,
    textarea {
      min-height: var(--hc-density-min-tap, 44px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      padding: 0 0.5rem;
      font: inherit;
      min-width: 0;
    }
    input[type='text'],
    input[type='number'],
    select,
    textarea {
      flex: 1 1 8rem;
    }
    textarea {
      min-height: 5rem;
      padding: 0.5rem;
      font-family: var(--hc-font-mono, ui-monospace, monospace);
      resize: vertical;
    }
    input[type='checkbox'] {
      min-height: 0;
      width: 1.1rem;
      height: 1.1rem;
      flex: none;
    }
    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible,
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    button {
      min-height: var(--hc-density-min-tap, 44px);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      padding: 0 0.625rem;
      cursor: pointer;
    }
    .problem {
      flex: 1 1 100%;
      color: var(--hc-accent-warn, #ffc978);
      font-size: var(--hc-text-caption-size, 11px);
    }
    .resolved {
      flex: 1 1 100%;
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
    .opaque {
      color: var(--hc-ink-muted, #8b95a4);
    }
    .listrow {
      display: flex;
      gap: 0.375rem;
      width: 100%;
    }
    .action {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      width: 100%;
    }
    .foot {
      display: flex;
      gap: 0.375rem;
      padding-top: 0.75rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .note {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  /** The panel's own config. `widget` is the subject it edits. */
  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) env: MountEnv | undefined;
  /** Core's table, when this session has reached core. Absent is workable. */
  @property({ attribute: false }) vocabulary: Vocabulary | undefined;
  /** Where an edit goes, when the host has somewhere to put it. */
  @property({ attribute: false }) onEditWidget: ((next: WidgetSpec) => void) | undefined;

  /** The edit in progress. Undefined until somebody changes something. */
  @state() private draft: Record<string, unknown> | undefined;

  /** The preview child, reused across renders. */
  private readonly cache = new Map<string, HTMLElement>();

  /** The widget being edited, as the config gives it. */
  private get subject(): WidgetSpec | undefined {
    const raw = this.config['widget'];
    if (typeof raw !== 'object' || raw === null) return undefined;
    const spec = raw as WidgetSpec;
    return typeof spec.type === 'string' ? spec : undefined;
  }

  private get current(): Record<string, unknown> {
    return this.draft ?? this.subject?.config ?? {};
  }

  private commit(next: Record<string, unknown>): void {
    this.draft = next;
    const subject = this.subject;
    if (subject === undefined) return;
    const spec: WidgetSpec = { type: subject.type, config: next };
    this.onEditWidget?.(spec);
    // Composed, because the panel may be several shadow roots deep inside
    // whatever surface opened it, and the thing that persists is above all of
    // them.
    this.dispatchEvent(
      new CustomEvent('hc-widget-change', { detail: spec, bubbles: true, composed: true }),
    );
  }

  private set(p: Property, value: unknown): void {
    this.commit(withValue(this.current, p, value));
  }

  /**
   * What to offer in a field core left open.
   *
   * Every one of these is a list of what exists right now — the devices in the
   * house, the rooms they are in, the attributes of the device this widget is
   * already pointed at. A suggestion that is stale is worse than none, so
   * nothing here is cached.
   */
  private suggestions(kind: Suggest | undefined): { value: string; label?: string }[] {
    switch (kind) {
      case 'device':
        return [...this.devices]
          .map((d) => ({ value: d.device_id, label: effectiveName(d) }))
          .sort((a, b) => a.label.localeCompare(b.label));
      case 'scene':
        return this.devices
          .filter((d) => isScene(d))
          .map((d) => ({ value: d.device_id, label: effectiveName(d) }))
          .sort((a, b) => a.label.localeCompare(b.label));
      case 'area':
        return [
          ...new Set(
            this.devices.flatMap((d) =>
              (effectiveArea(d) ?? '') !== '' ? [effectiveArea(d)!] : [],
            ),
          ),
        ]
          .sort((a, b) => a.localeCompare(b))
          .map((a) => ({ value: a, label: humanise(a) }));
      case 'attribute':
        return this.attributeNames().map((a) => ({ value: a, label: humanise(a) }));
      case 'role':
        return knownRoles().map((r) => ({ value: r }));
      case 'icon':
        return [...markNames()].sort().map((m) => ({ value: m, label: humanise(m) }));
      case 'facet':
        return facetHints().map((f) => ({ value: f, label: humanise(f) }));
      default:
        // `dashboard` among them: this client has no list of pages to offer,
        // and an empty datalist is an honest way of saying so.
        return [];
    }
  }

  /**
   * The attributes of the device this widget is already pointed at.
   *
   * The one suggestion that depends on another field: `attribute` on a slider
   * means "of that device", and offering every attribute in the house would be
   * offering mostly wrong answers. Declared attributes first, then whatever
   * the device is actually publishing — a plugin that publishes more than it
   * declares is common, and both are things somebody may want to bind.
   */
  private attributeNames(): string[] {
    const id = this.current['device_id'];
    if (typeof id !== 'string') return [];
    const device = this.devices.find((d) => d.device_id === id);
    if (device === undefined) return [];
    return [
      ...new Set([
        ...Object.keys(device.schema?.attributes ?? {}),
        ...Object.keys(device.attributes),
      ]),
    ].sort((a, b) => a.localeCompare(b));
  }

  /** The name behind an id, so a field of ids is readable. */
  private nameOf(id: unknown): string | undefined {
    if (typeof id !== 'string' || id === '') return undefined;
    const device = this.devices.find((d) => d.device_id === id);
    return device === undefined ? undefined : effectiveName(device);
  }

  private datalist(kind: Suggest | undefined, id: string) {
    const options = this.suggestions(kind);
    if (options.length === 0) return nothing;
    return html`<datalist id=${id}>
      ${options.map((o) =>
        o.label === undefined
          ? html`<option value=${o.value}></option>`
          : html`<option value=${o.value} label=${o.label}></option>`,
      )}
    </datalist>`;
  }

  private text(p: Property, value: string, onChange: (v: string) => void) {
    const listId = `list-${p.name}`;
    const suggestions = this.suggestions(p.suggest ?? p.of);
    return html`<input
        part="select"
        type="text"
        aria-label=${p.label}
        .value=${value}
        list=${suggestions.length > 0 ? listId : nothing}
        @input=${(e: Event) => onChange((e.target as HTMLInputElement).value)}
      />
      ${this.datalist(p.suggest ?? p.of, listId)}`;
  }

  private renderList(p: Property) {
    const items = asList(p.value);
    const write = (next: string[]): void => this.set(p, next);

    return html`${items.map(
        (item, i) =>
          html`<div class="listrow">
            ${this.text({ ...p, label: `${p.label} ${i + 1}` }, item, (v) =>
              write(items.map((x, j) => (j === i ? v : x))),
            )}
            <button
              part="action"
              aria-label="Remove"
              @click=${() => write(items.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>`,
      )}
      <button part="action" @click=${() => write([...items, ''])}>Add</button>
      ${
        p.of === 'device' || p.suggest === 'device'
          ? html`<span class="resolved"
              >${items.map((i) => this.nameOf(i) ?? i).join(', ') || 'Nothing chosen yet.'}</span
            >`
          : nothing
      }`;
  }

  /**
   * The pairs editor — a payload nobody can describe in advance.
   *
   * A service call takes whatever the plugin takes, and core's vocabulary says
   * only that it is an object. Names and values, one row each, is the most a
   * generated editor can honestly offer; it is still not a text area full of
   * braces, which is what §4.4 forbids.
   */
  private renderPairs(
    p: Property,
    value: Record<string, unknown>,
    write: (v: Record<string, unknown>) => void,
  ) {
    const entries = Object.entries(value);
    return html`${entries.map(
        ([k, v], i) =>
          html`<div class="listrow">
            <input
              part="select"
              type="text"
              aria-label="Name ${i + 1}"
              .value=${k}
              @change=${(e: Event) => {
                const name = (e.target as HTMLInputElement).value;
                const next = Object.fromEntries(
                  entries.map(([ek, ev], j) => (j === i ? [name, ev] : [ek, ev])),
                );
                write(next);
              }}
            />
            <input
              part="select"
              type="text"
              aria-label="Value ${i + 1}"
              .value=${typeof v === 'string' ? v : JSON.stringify(v)}
              @input=${(e: Event) => {
                const raw = (e.target as HTMLInputElement).value;
                write({ ...value, [k]: raw });
              }}
            />
            <button
              part="action"
              aria-label="Remove ${k}"
              @click=${() => write(Object.fromEntries(entries.filter(([ek]) => ek !== k)))}
            >
              ✕
            </button>
          </div>`,
      )} <button part="action" @click=${() => write({ ...value, '': '' })}>Add</button>`;
  }

  /**
   * A gesture's editor (§5.10).
   *
   * The verb decides the rest, so the rest is not shown until it is chosen —
   * the same rule core's own `when` states for widget fields, applied to a
   * shape core does not describe.
   */
  private renderAction(p: Property) {
    const raw = (typeof p.value === 'object' && p.value !== null ? p.value : {}) as Record<
      string,
      unknown
    >;
    const action = raw as unknown as ActionConfig;
    const verb = typeof action.do === 'string' ? action.do : 'none';

    const write = (patch: Record<string, unknown>): void => {
      const next = { ...raw, ...patch };
      for (const [k, v] of Object.entries(next)) if (v === undefined || v === '') delete next[k];
      this.set(p, next['do'] === undefined || next['do'] === 'none' ? undefined : next);
    };

    const target = (label: string, suggest: Suggest | undefined, key: string) =>
      this.text(
        { ...p, label, ...(suggest !== undefined ? { suggest } : {}) },
        typeof raw[key] === 'string' ? (raw[key] as string) : '',
        (v) => write({ [key]: v }),
      );

    const confirm =
      raw['confirm'] === false ? 'never' : raw['confirm'] !== undefined ? 'always' : 'policy';

    return html`<div class="action">
      <select
        part="select"
        aria-label=${p.label}
        data-value=${verb}
        @change=${(e: Event) => write({ do: (e.target as HTMLSelectElement).value })}
      >
        ${VERBS.map((v) => html`<option value=${v}>${humanise(v)}</option>`)}
      </select>

      ${verb === 'page' ? target('Page', 'dashboard', 'target') : nothing}
      ${verb === 'url' ? target('Address', undefined, 'target') : nothing}
      ${verb === 'overlay' ? target('Widget', undefined, 'target') : nothing}
      ${verb === 'toggle' || verb === 'details' ? target('Device', 'device', 'device_id') : nothing}
      ${verb === 'service' ? target('Service', undefined, 'service') : nothing}
      ${
        verb === 'service'
          ? this.renderPairs(
              p,
              (typeof raw['payload'] === 'object' && raw['payload'] !== null
                ? raw['payload']
                : {}) as Record<string, unknown>,
              (v) => write({ payload: Object.keys(v).length === 0 ? undefined : v }),
            )
          : nothing
      }
      ${
        verb === 'none'
          ? nothing
          : html`<select
              part="select"
              aria-label="Confirmation"
              data-value=${confirm}
              @change=${(e: Event) => {
                const choice = (e.target as HTMLSelectElement).value;
                write({
                  confirm:
                    choice === 'never' ? false : choice === 'always' ? { text: '' } : undefined,
                });
              }}
            >
              ${CONFIRM.map((c) => html`<option value=${c.value}>${c.label}</option>`)}
            </select>`
      }
    </div>`;
  }

  private renderField(p: Property): TemplateResult | typeof nothing {
    switch (p.form) {
      case 'toggle':
        return html`<input
          part="select"
          type="checkbox"
          aria-label=${p.label}
          .checked=${p.value === true}
          @change=${(e: Event) => this.set(p, (e.target as HTMLInputElement).checked || undefined)}
        />`;

      case 'number':
        return html`<input
          part="select"
          type="number"
          aria-label=${p.label}
          min=${p.min ?? nothing}
          .value=${typeof p.value === 'number' ? String(p.value) : ''}
          @input=${(e: Event) => {
            const raw = (e.target as HTMLInputElement).value;
            this.set(p, raw === '' ? undefined : Number(raw));
          }}
        />`;

      case 'select':
        return html`<select
          part="select"
          aria-label=${p.label}
          data-value=${typeof p.value === 'string' ? p.value : ''}
          @change=${(e: Event) => this.set(p, (e.target as HTMLSelectElement).value || undefined)}
        >
          ${p.required ? nothing : html`<option value="">—</option>`}
          ${(p.options ?? []).map((o) => html`<option value=${o}>${humanise(o)}</option>`)}
        </select>`;

      case 'longText':
        return html`<textarea
          part="select"
          aria-label=${p.label}
          .value=${typeof p.value === 'string' ? p.value : ''}
          @input=${(e: Event) => this.set(p, (e.target as HTMLTextAreaElement).value)}
        ></textarea>`;

      case 'list':
        return this.renderList(p);

      case 'pairs':
        return this.renderPairs(
          p,
          (typeof p.value === 'object' && p.value !== null ? p.value : {}) as Record<
            string,
            unknown
          >,
          (v) => this.set(p, Object.keys(v).length === 0 ? undefined : v),
        );

      case 'action':
        return this.renderAction(p);

      case 'opaque': {
        const keys = Object.keys(
          (typeof p.value === 'object' && p.value !== null ? p.value : {}) as Record<
            string,
            unknown
          >,
        );
        // Structure core describes no fields for. Shown, and left alone: a
        // floorplan's geometry is imported and edited on the plan itself
        // (§12), and a text area full of braces here would be the JSON
        // editing §4.4 rules out, not a way around it.
        return html`<span class="opaque"
          >${keys.length === 0 ? 'Not set.' : `${keys.length} kept as they are: ${keys.join(', ')}`}
          · edited where it is drawn, not here.</span
        >`;
      }

      default:
        return this.text(p, typeof p.value === 'string' ? p.value : '', (v) => this.set(p, v));
    }
  }

  /**
   * Point every select at the value it actually holds.
   *
   * **After render, because a select cannot be told before its options
   * exist** — the failure that made every icon rule display "battery" while
   * the stored icons were correct. Marked with `data-value` on the way out so
   * this does not have to know which select is which.
   */
  override updated(): void {
    this.shadowRoot?.querySelectorAll<HTMLSelectElement>('select[data-value]').forEach((el) => {
      const want = el.dataset['value'] ?? '';
      if (el.value !== want) el.value = want;
    });
  }

  override render() {
    const subject = this.subject;
    if (subject === undefined) {
      return html`<div class="note" part="empty">
        No widget to edit. Put one in this panel's <code>widget</code> config.
      </div>`;
    }

    const config = this.current;
    const spec = widgetSpec(this.vocabulary, subject.type);
    const properties = propertiesFor(spec, config);
    const problems = properties.filter((p) => p.problem !== undefined).length;

    const preview =
      this.env !== undefined && this.config['preview'] !== false
        ? mountChildren([{ type: subject.type, config }], this.env, this.cache)
        : [];

    return html`
      ${
        preview.length === 0
          ? nothing
          : html`<div class="preview" part="preview">
              ${
                // Nothing draws this type here: an extension that is not
                // installed, or a type from another client. The config is
                // still fully editable, and saying so beats an empty box
                // that reads as a broken widget.
                preview[0] ??
                html`<span class="opaque">Nothing installed here draws a ${subject.type}.</span>`
              }
            </div>`
      }

      <div class="subject" part="state">
        ${subject.type}${
          spec === undefined
            ? html` ·
                <span class="opaque"
                  >core describes no fields for this type, so every key is shown as it is</span
                >`
            : nothing
        }
      </div>

      ${properties.map(
        (p) =>
          html`<div class="row" part="row">
            <div class="name ${p.required ? 'required' : ''}">
              ${p.label}${p.required ? ' *' : ''}
              ${p.undescribed === true ? html`<span class="extra">not core's</span>` : nothing}
            </div>
            <div class="field">
              ${this.renderField(p)}
              ${p.problem !== undefined ? html`<span class="problem">${p.problem}</span>` : nothing}
              ${
                p.suggest === 'device' && p.form !== 'list' && this.nameOf(p.value) !== undefined
                  ? html`<span class="resolved">${this.nameOf(p.value)}</span>`
                  : nothing
              }
            </div>
          </div>`,
      )}

      <div class="foot" part="controls">
        <span class="note"
          >${
            problems === 0
              ? 'Core would accept this.'
              : `${problems} ${problems === 1 ? 'field is' : 'fields are'} not what core accepts.`
          }</span
        >
        ${
          this.draft !== undefined
            ? html`<span class="note">
                  Changed here only — this client has no dashboard write path yet.
                </span>
                <button
                  part="action"
                  @click=${() => {
                    this.draft = undefined;
                  }}
                >
                  Undo the changes
                </button>`
            : nothing
        }
      </div>
    `;
  }
}

registerWidget('property_panel', 'hc-property-panel');

declare global {
  interface HTMLElementTagNameMap {
    'hc-property-panel': HcPropertyPanel;
  }
}
