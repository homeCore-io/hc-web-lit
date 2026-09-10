/**
 * Core's dashboard vocabulary — the table it validates documents against
 * (§4.4, §4.6).
 *
 * Served whole at `GET /dashboards/vocabulary`: every widget type core knows,
 * every field of each, what is required, what values are legal, and which
 * fields hold references to things in the house. Forty widget types and four
 * hundred-odd fields, derived from core's own types rather than written down
 * twice.
 *
 * **This is the validation half, and this client owns the other one.** §4.4
 * settles the schema-versus-descriptor question server-side and this follows
 * it: core says what is *legal*, the client says what it *looks like* — which
 * picker a field gets, what it is called, whether it is prose or a word. A
 * client that invented its own legality would be inventing a second answer to
 * a question core already answers, and core's is the one that counts (§4.6).
 * The presentation half is `core/properties.ts`, and the split is exactly the
 * one the household decided: presentation is the client's, device management
 * is core's.
 *
 * **Absence is normal.** A panel that has not reached core yet, or is running
 * on a cached document offline (§16), has no vocabulary — so every function
 * here takes `undefined` and every caller keeps working with less. What is
 * lost without it is the labels and the pickers, not the ability to edit.
 */

/** What a field points at, when it points at something in the house. */
export type Reference = 'device' | 'devices' | 'scene' | 'scenes';

/** A field that only applies when a sibling holds a particular value. */
export interface FieldCondition {
  field: string;
  equals: string;
}

/** One config field of one widget type — `hc_types::dashboard_vocabulary`. */
export interface VocabularyField {
  name: string;
  /** `string`, `integer`, `number`, `boolean`, `array`, `object`, `any`, `string_or_strings`. */
  type: string;
  required: boolean;
  /** Whether an empty string counts as present, for a required string. */
  allow_empty?: boolean;
  min?: number;
  /** The legal values, when core constrains them. Absent means it does not. */
  one_of?: string[];
  reference?: Reference;
  when?: FieldCondition;
}

/** One widget type core knows how to validate. */
export interface VocabularyWidget {
  type: string;
  config_required: boolean;
  /**
   * Whether core accepts keys beyond those described. True for every widget
   * today, and the reason this client can offer `on_hold` and
   * `on_double_tap` (§5.10) on a widget whose vocabulary names only `on_tap`
   * — and the reason a config it does not recognise must round-trip rather
   * than be pruned. Pruning would silently delete another client's work.
   */
  extra_fields: boolean;
  fields: VocabularyField[];
}

/** One element kind inside a portable render tree (§4.6). */
export interface VocabularyElement {
  kind: string;
  container: boolean;
  fields: VocabularyField[];
}

/** The enumerations a client must agree with core about to read a document. */
export interface DocumentEnums {
  breakpoints: string[];
  flows: string[];
  frame_fits: string[];
}

/** The whole table, as core serves it. */
export interface Vocabulary {
  widgets: VocabularyWidget[];
  enums: DocumentEnums;
  /** Whether a type core has never heard of is legal. It is (§14.3). */
  unknown_types_accepted: boolean;
  elements: VocabularyElement[];
}

/**
 * Read what core served, or say nothing.
 *
 * Tolerant on purpose: a vocabulary that gained a field or a whole section
 * must not stop this client reading the parts it understands, because the
 * document it is validating did not change. The only thing insisted on is a
 * list of widgets, which is the part everything here is for.
 */
export function readVocabulary(raw: unknown): Vocabulary | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o['widgets'])) return undefined;

  const enums = (o['enums'] ?? {}) as Partial<DocumentEnums>;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

  return {
    widgets: o['widgets'].filter(
      (w): w is VocabularyWidget =>
        typeof w === 'object' && w !== null && typeof (w as VocabularyWidget).type === 'string',
    ),
    enums: {
      breakpoints: strings(enums.breakpoints),
      flows: strings(enums.flows),
      frame_fits: strings(enums.frame_fits),
    },
    unknown_types_accepted: o['unknown_types_accepted'] !== false,
    elements: Array.isArray(o['elements']) ? (o['elements'] as VocabularyElement[]) : [],
  };
}

/** What core says about one widget type, if it says anything. */
export function widgetSpec(
  vocabulary: Vocabulary | undefined,
  type: string,
): VocabularyWidget | undefined {
  return vocabulary?.widgets.find((w) => w.type === type);
}

/** Every type core describes, sorted. Empty without a vocabulary. */
export function describedTypes(vocabulary: Vocabulary | undefined): string[] {
  return (vocabulary?.widgets ?? []).map((w) => w.type).sort((a, b) => a.localeCompare(b));
}

/**
 * Whether a field applies, given the rest of the config.
 *
 * `area_name` is required when `selection_mode` is `area` and meaningless
 * otherwise; a panel that showed it always would be asking for something that
 * cannot be used, and one that marked it required always would refuse to save
 * a perfectly good manual card.
 */
export function applies(field: VocabularyField, config: Record<string, unknown>): boolean {
  const when = field.when;
  if (when === undefined) return true;
  return config[when.field] === when.equals;
}
