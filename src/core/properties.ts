/**
 * The property panel's model — Phase 4's "schema-driven property panel for
 * every widget, no JSON editing required" (§4.4).
 *
 * Pure, like the layout engine and the control generator: a widget's spec from
 * core's vocabulary plus its stored config in, a list of editable properties
 * out. What draws them is `widgets/hc-property-panel.ts`; nothing here knows
 * about the DOM.
 *
 * **This is the descriptor half of §4.4, and it is the client's.** Core says
 * what is legal — required, `one_of`, `min`, which fields are references — and
 * this says what that looks like to a person: which control, what it is
 * called, what to offer in it. The household's decision on homeCore#30 is the
 * same split one level up, so it is not re-argued here: presentation is the
 * client's, and asking core to publish a picker vocabulary would be asking it
 * to hold UI.
 *
 * Three rules the shapes below exist to keep:
 *
 * - **Nothing is dropped.** `extra_fields` is true for every widget core
 *   describes, so a config carries keys this table has never heard of — a
 *   drawing preference another client wrote, a field a newer core added. They
 *   are listed and editable, not pruned. A panel that saved back only what it
 *   understood would delete somebody else's work every time it was opened.
 * - **Nothing is invented.** Where core constrains a value, the control is a
 *   choice of exactly those values. Where it does not, the control accepts
 *   anything and merely *suggests* — a document naming a colour role or a
 *   facet this build has not learned yet must stay saveable, which means no
 *   suggestion list may also be a restriction.
 * - **No JSON.** Every form below is a control a person can operate. The one
 *   exception is stated as one: an `object` field core describes no fields for
 *   is shown as what it is and marked as edited elsewhere, rather than
 *   pretending a text area full of braces is an editor.
 */
import { humanise } from './text.js';
import { applies, type VocabularyField, type VocabularyWidget } from './vocabulary.js';

/** How a property is edited. */
export type PropertyForm =
  /** A boolean. */
  | 'toggle'
  /** A number, with core's lower bound when it has one. */
  | 'number'
  /** One of a closed set core published. */
  | 'select'
  /** A word or a name. */
  | 'text'
  /** Prose, or markup: a field somebody writes into rather than fills in. */
  | 'longText'
  /** A list of values, each edited like a `text`. */
  | 'list'
  /** A gesture (§5.10) — its own little editor. */
  | 'action'
  /** Free key/value pairs, for a payload nobody can describe in advance. */
  | 'pairs'
  /** Structure with no description, shown but not edited here. */
  | 'opaque';

/**
 * What to offer in a field core leaves open.
 *
 * §4.4's `x-hc-picker`, and this client's half of it. Core declares
 * `reference` for the four kinds of thing it can point at, and those come
 * first because core said so rather than because a name was recognised. The
 * rest is a short list of names core has no way to describe — a room is not a
 * core concept, a colour role is a token in a skin, an attribute belongs to
 * whichever device the sibling field names. Each is a *suggestion*: the
 * control still accepts a value that is not on the list.
 */
export type Suggest =
  'device' | 'scene' | 'area' | 'attribute' | 'role' | 'icon' | 'dashboard' | 'facet' | 'asset';

/** One editable thing in the panel. */
export interface Property {
  name: string;
  label: string;
  form: PropertyForm;
  value: unknown;
  required: boolean;
  /** Whether an empty string counts as a value — `markdown`, and only it. */
  allowEmpty: boolean;
  /** The closed set, for a `select`. */
  options?: readonly string[];
  min?: number;
  suggest?: Suggest;
  /**
   * A list core also accepts as a bare string (`string_or_strings`). Kept so
   * an edit that leaves one value writes back the shape the document already
   * used, rather than rewriting every page's `facet: "light"` into a list.
   */
  scalarOk?: boolean;
  /** For a list of references: which kind, so the row picker is right. */
  of?: Suggest;
  /** Not described by core: another client's key, or a newer core's. */
  undescribed?: boolean;
  /** Why core would refuse the config as it stands, in a person's words. */
  problem?: string;
}

/**
 * The gestures a placement can carry (§5.10).
 *
 * Core's vocabulary names only `on_tap`; the other two ride in the space
 * `extra_fields` leaves open, and this client reads all three
 * (`core/actions.ts`). Offering them here is what makes `hold` — the
 * non-actuating way to inspect a device — something a person can point at
 * rather than a default they cannot see.
 */
export const GESTURES = ['on_tap', 'on_hold', 'on_double_tap'] as const;

/**
 * Lifting an element above the grid (§14.1).
 *
 * **A property of the element, not of the layout.** A card lifted on the wall
 * is lifted on the phone too, because a design decision that changes when you
 * rotate a tablet is not one anybody asked for — so it rides in the widget's
 * own config, which is also why it needs no schema change (`gridItems`
 * resolves the engine's `floating` from it).
 *
 * Offered here for the same reason the gestures are: every real document uses
 * the key, core's vocabulary describes it for no widget, and a client that
 * reads it and cannot write it is one where a lifted card can only be made by
 * hand in another editor. Without this it showed up as an undescribed text
 * field on documents that already had it, and not at all on documents that
 * did not.
 */
export const LAYERS = ['grid', 'free'] as const;

const isGesture = (name: string): boolean => (GESTURES as readonly string[]).includes(name);

/**
 * Fields whose value is a name in a list only the client can produce.
 *
 * Deliberately short, and every entry earns its place by being a field a
 * person would otherwise have to type exactly right from memory. It is a
 * presentation table, which §1.1 permits and this client uses sparingly: the
 * cost of being wrong is a suggestion that does not appear, never a value
 * that cannot be saved.
 */
const SUGGESTS: Record<string, Suggest> = {
  area_name: 'area',
  room: 'area',
  rooms: 'area',
  room_order: 'area',
  attribute: 'attribute',
  metrics: 'attribute',
  face: 'icon',
  icon: 'icon',
  status_icon: 'icon',
  color: 'role',
  color_to: 'role',
  fill: 'role',
  fill_to: 'role',
  ink: 'role',
  ink_end: 'role',
  stroke: 'role',
  dashboard_ids: 'dashboard',
  room_page: 'dashboard',
  facet: 'facet',
  // A household's own pictures (§9). Core describes `url` as a plain string
  // because it is one — the store is this client's, not core's — so the
  // *suggestion* is the store's contents and the field still takes any URL.
  // Offering it is what makes the asset store reachable at all: before this
  // the only picture a `url` field could name was one somewhere else on the
  // network.
  url: 'asset',
  // `types` is deliberately absent: it holds device *types*, which are a
  // plugin's open vocabulary and not this client's facet names. A picker
  // offering the wrong list is worse than a plain box, because every value in
  // it looks official and selects nothing.
};

/**
 * Fields somebody writes into, rather than fills in.
 *
 * Markup and languages, and not `text` — a heading, a label and a caption are
 * all called `text` and are all one line, so a text area there would be a
 * five-line box for three words on nearly every widget that has one.
 */
const PROSE = new Set(['markdown', 'html', 'svg', 'query', 'path']);

const REFERENCE_SUGGEST: Record<string, Suggest> = {
  device: 'device',
  devices: 'device',
  scene: 'scene',
  scenes: 'scene',
};

/** What to offer in this field, if anything. Core's answer first. */
function suggestFor(field: VocabularyField): Suggest | undefined {
  const byReference =
    field.reference !== undefined ? REFERENCE_SUGGEST[field.reference] : undefined;
  return byReference ?? SUGGESTS[field.name];
}

/**
 * Which control a field gets.
 *
 * Read top to bottom: the more a field is constrained, the more specific the
 * control. A field core constrained to five values is a choice of five; one it
 * left open is a box that takes anything.
 */
function formFor(field: VocabularyField): PropertyForm {
  if (isGesture(field.name)) return 'action';
  if (field.type === 'boolean') return 'toggle';
  if (field.type === 'integer' || field.type === 'number') return 'number';
  if ((field.one_of ?? []).length > 0) return 'select';
  if (field.type === 'array' || field.type === 'string_or_strings') return 'list';
  if (field.type === 'object') return 'opaque';
  return PROSE.has(field.name) ? 'longText' : 'text';
}

/**
 * Whether the stored value is one anything else would understand.
 *
 * **Derived from the table core publishes, not from a second one.** This
 * client stores its own pages, so nothing outside it will refuse a config —
 * which makes the check *more* worth having, not less: a value outside the
 * shared vocabulary is one another client cannot read, and there is now no
 * save to bounce and tell somebody so. Reading the served table is what keeps
 * this from becoming a rival opinion about what a widget config means.
 */
function problemOf(field: VocabularyField, value: unknown): string | undefined {
  const missing =
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '' && field.allow_empty !== true);

  if (missing) return field.required ? 'Needs a value.' : undefined;

  const one = field.one_of ?? [];
  if (one.length > 0 && typeof value === 'string' && !one.includes(value)) {
    return `Not one of: ${one.join(', ')}.`;
  }

  if (field.type === 'integer' || field.type === 'number') {
    if (typeof value !== 'number') return 'Should be a number.';
    if (field.min !== undefined && value < field.min) return `At least ${field.min}.`;
    if (field.type === 'integer' && !Number.isInteger(value)) return 'Should be a whole number.';
    return undefined;
  }

  if (field.type === 'boolean' && typeof value !== 'boolean') return 'Should be on or off.';
  if (field.type === 'array' && !Array.isArray(value)) return 'Should be a list.';
  if (field.type === 'string' && typeof value !== 'string') return 'Should be text.';
  if (field.type === 'string_or_strings' && typeof value !== 'string' && !Array.isArray(value)) {
    return 'Should be a word or a list of them.';
  }
  return undefined;
}

/** A property for a key nothing described, shaped by what it happens to hold. */
function undescribedProperty(name: string, value: unknown): Property {
  const form: PropertyForm = isGesture(name)
    ? 'action'
    : typeof value === 'boolean'
      ? 'toggle'
      : typeof value === 'number'
        ? 'number'
        : Array.isArray(value)
          ? 'list'
          : typeof value === 'object' && value !== null
            ? 'pairs'
            : 'text';

  return {
    name,
    label: humanise(name),
    form,
    value,
    required: false,
    allowEmpty: true,
    undescribed: true,
    ...(SUGGESTS[name] !== undefined ? { suggest: SUGGESTS[name] } : {}),
  };
}

/**
 * Everything editable about one widget, in the order it should be shown.
 *
 * Core's own field order first — it puts the selection before the trimmings,
 * which is the order somebody fills a card in — then the gestures, then
 * whatever else the config carries. A field whose `when` is not satisfied is
 * absent rather than disabled: it is not merely unavailable, it has no meaning
 * in this configuration.
 *
 * With no spec (an unknown widget type, or no vocabulary reached yet) every
 * key is listed as undescribed, which is the honest state — the config is
 * still fully editable, just unlabelled and unchecked.
 */
export function propertiesFor(
  spec: VocabularyWidget | undefined,
  config: Record<string, unknown> | undefined,
): Property[] {
  const cfg = config ?? {};
  const out: Property[] = [];
  const seen = new Set<string>();

  for (const field of spec?.fields ?? []) {
    seen.add(field.name);
    if (!applies(field, cfg)) continue;

    const value = cfg[field.name];
    const problem = problemOf(field, value);
    const suggest = suggestFor(field);
    const one = field.one_of ?? [];

    out.push({
      name: field.name,
      label: humanise(field.name),
      form: formFor(field),
      value,
      required: field.required,
      allowEmpty: field.allow_empty === true,
      ...(one.length > 0 ? { options: one } : {}),
      ...(field.min !== undefined ? { min: field.min } : {}),
      ...(suggest !== undefined ? { suggest } : {}),
      ...(field.type === 'string_or_strings' ? { scalarOk: true } : {}),
      ...(field.type === 'array' && suggest !== undefined ? { of: suggest } : {}),
      ...(problem !== undefined ? { problem } : {}),
    });
  }

  // The keys core does not describe but every client uses. Legal because
  // `extra_fields` is, and offered only where that is true rather than assumed
  // of every widget.
  if (spec === undefined || spec.extra_fields) {
    for (const name of GESTURES) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({
        name,
        label: humanise(name),
        form: 'action',
        value: cfg[name],
        required: false,
        allowEmpty: true,
      });
    }
    if (!seen.has('layer')) {
      seen.add('layer');
      out.push({
        name: 'layer',
        label: 'Layer',
        form: 'select',
        value: cfg['layer'],
        required: false,
        allowEmpty: true,
        options: LAYERS,
      });
    }
  }

  for (const name of Object.keys(cfg).sort((a, b) => a.localeCompare(b))) {
    if (seen.has(name)) continue;
    out.push(undescribedProperty(name, cfg[name]));
  }

  return out;
}

/** Every reason core would refuse this config, in field order. */
export function problemsIn(
  spec: VocabularyWidget | undefined,
  config: Record<string, unknown> | undefined,
): { name: string; problem: string }[] {
  return propertiesFor(spec, config).flatMap((p) =>
    p.problem !== undefined ? [{ name: p.name, problem: p.problem }] : [],
  );
}

/**
 * The config with one property changed.
 *
 * `undefined` removes the key rather than storing a null: a config with
 * `sort: null` in it is one core has to decide about, and an absent optional
 * field is what "not set" has always meant in these documents. A required
 * field that allows empty keeps its empty string, because there the emptiness
 * is the value.
 *
 * Every other key is carried over untouched — including the ones nothing
 * described, which is the whole point of the round-trip rule above.
 */
export function withValue(
  config: Record<string, unknown> | undefined,
  property: Pick<Property, 'name' | 'required' | 'allowEmpty' | 'scalarOk'>,
  value: unknown,
): Record<string, unknown> {
  const next = { ...(config ?? {}) };

  const empty =
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value === '' && !(property.required && property.allowEmpty)) ||
    (Array.isArray(value) && value.length === 0);

  if (empty) {
    delete next[property.name];
    return next;
  }

  // A list that core also takes as a bare string is written back the way the
  // document writes it: one facet stays `facet: "light"`.
  if (property.scalarOk === true && Array.isArray(value) && value.length === 1) {
    next[property.name] = value[0];
    return next;
  }

  next[property.name] = value;
  return next;
}

/** A list property's value as a list, whatever shape it is stored in. */
export function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v : String(v)));
  if (typeof value === 'string' && value !== '') return [value];
  return [];
}
