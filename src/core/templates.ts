/**
 * P3 — widget templates (§5.4).
 *
 * A widget subtree with named parameters, instantiated many times. A
 * `room-tile` used in twelve rooms is one definition and twelve references, so
 * one edit lands everywhere — §5.4 calls this the highest-leverage capability
 * on the primitive list for real users, and it is what decluttering-card and
 * streamline-card exist to add to Home Assistant.
 *
 * **By reference, not by copy**, and §5.4 is careful about which is which: a
 * *dashboard* template is a starting point and is copied, because a page you
 * began from is not a thing you want changing under you later. A *widget*
 * template is the opposite case — one edit landing everywhere is the whole
 * point — so an instance holds a reference and is resolved at render.
 *
 * **Where they live is this client's problem, not core's.** The plan put
 * storage at `GET/PUT /api/templates/{id}` because the previous client
 * compiled ahead of time and could not hold customised content, so anything a
 * user authored had to be modelled in core. That constraint is gone. What
 * stays core's is what two clients must agree on — `DashboardDefinition`, the
 * naming ratchet, `is_legal` — and a widget subtree with parameters is not in
 * that set.
 *
 * So this is the mechanism with a store behind an interface: substitution and
 * by-reference instantiation, which are the parts that have to be right,
 * separate from where the JSON eventually sits.
 */
import { evaluate, hasInterpolation, interpolate, isExpr } from './expr.js';
import type { WidgetSpec } from '../shell/mount.js';

/** A parameter, in the vocabulary §21.4 says rule templates share. */
export interface TemplateParam {
  name: string;
  /** `room`, `device`, `asset`, `string`, `number`, `boolean` — which picker. */
  type?: string;
  default?: unknown;
}

export interface WidgetTemplate {
  id: string;
  params?: TemplateParam[];
  /** The subtree. One widget today; `slots` is P4's business, not this one. */
  widget: WidgetSpec;
}

/** How a placement says "this is an instance of that". */
export interface TemplateRef {
  template: string;
  params?: Record<string, unknown>;
}

/**
 * Whether a config is an instance rather than a widget.
 *
 * `type` is a plain string and core accepts values it has never heard of
 * (§14.3), so a template instance round-trips through core untouched without
 * core needing a type for it — which is exactly the freedom that lets this
 * live here.
 */
export function templateRef(config: Record<string, unknown> | undefined): TemplateRef | undefined {
  const named = config?.['template'];
  if (typeof named !== 'string' || named === '') return undefined;
  const params = config?.['params'];
  return {
    template: named,
    ...(typeof params === 'object' && params !== null
      ? { params: params as Record<string, unknown> }
      : {}),
  };
}

/** The parameters an instance actually has: its own, over the declared defaults. */
export function paramsFor(
  template: WidgetTemplate,
  given: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of template.params ?? []) {
    if (p.default !== undefined) out[p.name] = p.default;
  }
  return { ...out, ...given };
}

/**
 * Substitute parameters through a subtree.
 *
 * Deep, because a template's interesting parts are nested — §5.4's own example
 * puts `{{ params.room }}` inside a `$query`. The substitution is P1's, with
 * `params` in scope: one expression language, one place it is implemented, and
 * a template author who already knows how a label is written.
 */
function fill(value: unknown, params: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return hasInterpolation(value) ? interpolate(value, { params }) : value;
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, params));
  if (isExpr(value)) {
    const got = evaluate(value.$expr, { params });
    // An expression that fails leaves the instance without the key, so the
    // widget's own default stands — the same rule as the placement seam.
    return got;
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const filled = fill(v, params);
      if (filled !== undefined) out[k] = filled;
    }
    return out;
  }
  return value;
}

/**
 * Resolve an instance to the widget it stands for.
 *
 * Called at render rather than at save, which is what makes the reference a
 * reference: editing the template changes every instance on the next frame,
 * and nothing has to be migrated.
 */
export function instantiate(
  template: WidgetTemplate,
  given: Record<string, unknown> = {},
): WidgetSpec {
  const params = paramsFor(template, given);
  const config = fill(template.widget.config ?? {}, params) as Record<string, unknown>;
  return { type: template.widget.type, config };
}

/**
 * The templates a client knows about.
 *
 * An interface rather than a fetch, because *where* they are stored is an open
 * question this primitive does not have to answer to be correct: a built-in
 * set, a browser store, a blob in core, or an extension shipping one
 * (`provides.templates`, §4.3) all satisfy it.
 */
export interface TemplateStore {
  get(id: string): WidgetTemplate | undefined;
  list(): WidgetTemplate[];
}

export class Templates implements TemplateStore {
  private readonly byId = new Map<string, WidgetTemplate>();

  constructor(seed: readonly WidgetTemplate[] = []) {
    for (const t of seed) this.byId.set(t.id, t);
  }

  add(t: WidgetTemplate): void {
    this.byId.set(t.id, t);
  }

  get(id: string): WidgetTemplate | undefined {
    return this.byId.get(id);
  }

  list(): WidgetTemplate[] {
    return [...this.byId.values()];
  }
}

/**
 * Resolve a placement's config, if it is an instance.
 *
 * Returns undefined when it is an ordinary widget, so a caller can tell "not a
 * template" from "a template that is missing" — the second is worth saying out
 * loud, because a page silently drawing nothing is how a broken reference
 * hides.
 */
export function resolveInstance(
  spec: WidgetSpec,
  store: TemplateStore | undefined,
): { spec: WidgetSpec } | { missing: string } | undefined {
  const ref = templateRef(spec.config);
  if (ref === undefined) return undefined;

  const found = store?.get(ref.template);
  if (found === undefined) return { missing: ref.template };
  return { spec: instantiate(found, ref.params) };
}
