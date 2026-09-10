/**
 * A widget a plugin contributes — the portable render tree (§4.6).
 *
 * `plugin_widget` names a card by `{plugin_id, widget_id}` and nothing else,
 * which for a long time meant no client could draw one: core knew the identity
 * and had no idea what it looked like. `WidgetDescriptor` is what closed that,
 * and this is the reading half.
 *
 * **An element kind is an instrument, not markup.** `gauge` says a value sits
 * in a range; how that is drawn is the client's business, and a terminal
 * client draws a meter. That is the rule the whole format exists to keep, and
 * the reason nothing here has a `style` or a `class` in it.
 *
 * **Validated against the element table core serves**, not against a list
 * written here. `GET /dashboards/vocabulary` carries `elements` beside
 * `widgets` precisely so a client can learn which instruments it must
 * implement; hardcoding them would mean a plugin using a kind core added last
 * month is refused by a client that could have drawn it.
 *
 * A render tree is **strict** where a widget config is not. An unknown config
 * key is another client's drawing preference riding along in `extra_fields`;
 * an unknown render field is a plugin asking every client to draw something
 * none of them agreed to, and drawing the rest anyway is how one client ends
 * up the only one that looks right.
 */
import type { DeviceState } from './device.js';
import { readingAt } from './facet.js';
import type { VocabularyElement, VocabularyField } from './vocabulary.js';

/** One node of the render tree. `kind` names the instrument. */
export interface RenderElement {
  kind: string;
  children?: RenderElement[];
  [field: string]: unknown;
}

/** One reading, wired to one place in the render. */
export interface DescriptorBinding {
  name: string;
  /** A device id, or `{{config.field}}` resolved against the card's config. */
  device: string;
  key: string;
  /** The value's own range, mapped onto the instrument's. All four or none. */
  in_from?: number;
  in_to?: number;
  out_from?: number;
  out_to?: number;
  decimals?: number;
}

/** A web-only implementation, registered *against* the render (§8.1). */
export interface DescriptorCode {
  entry: string;
  grant?: string[];
}

export interface WidgetDescriptor {
  widget_id: string;
  title: string;
  icon?: string;
  config_schema?: VocabularyField[];
  bindings?: DescriptorBinding[];
  render?: RenderElement;
  code?: DescriptorCode;
}

/** Who can draw it. Derived from the descriptor, never declared. */
export function portabilityOf(d: WidgetDescriptor): 'portable' | 'web_only' {
  return d.code === undefined ? 'portable' : 'web_only';
}

export type Refusal = { ok: false; reason: string };
export type Accepted = { ok: true };

/**
 * Whether this client can draw the descriptor, and why not when it cannot.
 *
 * Core validates a descriptor where it arrives, so a refusal here is rarer
 * than it looks — it is the descriptor from a newer core using an instrument
 * this build has not implemented, or a manifest that reached this client by
 * some other route. Refusing whole rather than drawing the parts it
 * understands, for the reason the format is strict in the first place: half a
 * card is a card nobody can debug.
 *
 * The reasons are core's own wording, so an author reading a message from this
 * client and a message from core is reading the same sentence.
 */
export function validateDescriptor(
  raw: unknown,
  elements: readonly VocabularyElement[],
): Accepted | Refusal {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'Not a descriptor.' };
  const d = raw as WidgetDescriptor;

  const id = typeof d.widget_id === 'string' && d.widget_id !== '' ? d.widget_id : undefined;
  if (id === undefined) return { ok: false, reason: 'A widget needs a widget_id.' };
  if (typeof d.title !== 'string' || d.title === '') {
    return { ok: false, reason: `widget '${id}' requires a title` };
  }

  if (d.render === undefined) {
    // Read differently from a missing render alone: a plugin that shipped code
    // and stopped is not making the same mistake as one that has not started.
    return d.code !== undefined
      ? {
          ok: false,
          reason: `widget '${id}' declares code but no render: a code widget must still say what a client without a browser draws`,
        }
      : { ok: false, reason: `widget '${id}' requires a render` };
  }

  for (const b of d.bindings ?? []) {
    const given = [b.in_from, b.in_to, b.out_from, b.out_to].filter((v) => v !== undefined).length;
    // All four or none: a half-specified mapping is the case where a gauge
    // quietly reads 0–1, which looks like a working card until somebody checks.
    if (given !== 0 && given !== 4) {
      return { ok: false, reason: `widget '${id}' binding '${b.name}' has a half-specified range` };
    }
  }

  return checkElement(d.render, id, elements);
}

function checkElement(
  el: RenderElement,
  id: string,
  elements: readonly VocabularyElement[],
): Accepted | Refusal {
  const spec = elements.find((e) => e.kind === el.kind);
  if (spec === undefined) {
    const known = elements
      .map((e) => e.kind)
      .sort((a, b) => a.localeCompare(b))
      .join(', ');
    return {
      ok: false,
      reason: `widget '${id}' renders unknown element '${el.kind}' (expected ${known})`,
    };
  }

  const children = el.children ?? [];
  if (children.length > 0 && !spec.container) {
    return {
      ok: false,
      reason: `widget '${id}' gives children to '${el.kind}', which draws itself`,
    };
  }

  for (const [name, value] of Object.entries(el)) {
    if (name === 'kind' || name === 'children') continue;
    const field = spec.fields.find((f) => f.name === name);
    if (field === undefined) {
      return { ok: false, reason: `widget '${id}' sets unknown field '${name}' on '${el.kind}'` };
    }
    const wrong = fieldProblem(field, value);
    if (wrong !== undefined) {
      return { ok: false, reason: `widget '${id}' sets ${name} on '${el.kind}': ${wrong}` };
    }
  }

  for (const field of spec.fields) {
    if (field.required && el[field.name] === undefined) {
      return {
        ok: false,
        reason: `widget '${id}' omits required field '${field.name}' on '${el.kind}'`,
      };
    }
  }

  for (const child of children) {
    const got = checkElement(child, id, elements);
    if (!got.ok) return got;
  }
  return { ok: true };
}

function fieldProblem(field: VocabularyField, value: unknown): string | undefined {
  const one = field.one_of ?? [];
  if (one.length > 0 && (typeof value !== 'string' || !one.includes(value))) {
    return `expected one of ${one.join(', ')}`;
  }
  if (field.type === 'number' || field.type === 'integer') {
    if (typeof value !== 'number') return 'expected a number';
    if (field.min !== undefined && value < field.min) return `expected at least ${field.min}`;
  }
  if (field.type === 'string' && typeof value !== 'string') return 'expected text';
  if (field.type === 'boolean' && typeof value !== 'boolean') return 'expected true or false';
  return undefined;
}

/** A binding, resolved against the house. */
export interface BoundValue {
  /** The number or word the device is reporting, after any range mapping. */
  value: unknown;
  unit?: string;
  decimals?: number;
}

/**
 * Every binding a descriptor declares, resolved.
 *
 * `{{config.field}}` names a device the *card* was configured with, which is
 * how one descriptor serves every device of its kind. Core stores that
 * template and does not expand it — resolving a binding against device state
 * is the client's job, and core is a document store.
 *
 * A binding that names a device the house does not have resolves to nothing
 * rather than to zero, because an instrument reading zero is a claim.
 */
export function resolveBindings(
  bindings: readonly DescriptorBinding[],
  config: Record<string, unknown>,
  devices: readonly DeviceState[],
): Record<string, BoundValue> {
  const out: Record<string, BoundValue> = {};

  for (const b of bindings) {
    const template = /^\{\{\s*config\.([a-z0-9_]+)\s*\}\}$/i.exec(b.device);
    const id = template === null ? b.device : config[template[1] ?? ''];
    if (typeof id !== 'string') continue;

    const device = devices.find((d) => d.device_id === id);
    if (device === undefined) continue;

    const reading = readingAt(device, b.key);
    if (reading === undefined) continue;

    let value = reading.value;
    if (
      typeof value === 'number' &&
      b.in_from !== undefined &&
      b.in_to !== undefined &&
      b.out_from !== undefined &&
      b.out_to !== undefined
    ) {
      const span = b.in_to - b.in_from;
      const at = span === 0 ? 0 : (value - b.in_from) / span;
      value = b.out_from + at * (b.out_to - b.out_from);
    }

    out[b.name] = {
      value,
      ...(reading.unit !== undefined ? { unit: reading.unit } : {}),
      ...(b.decimals !== undefined ? { decimals: b.decimals } : {}),
    };
  }

  return out;
}
