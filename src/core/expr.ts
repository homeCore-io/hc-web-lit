/**
 * P1 — expressions in config (§6).
 *
 * A config value may hold a **pure JavaScript expression**, evaluated in the
 * client against a read-only scope. §6.1 settles the language: the audience
 * arriving from Home Assistant's button-card already writes JS against entity
 * state, the client is TypeScript, and a display expression is client work —
 * core's own `dashboard_vocabulary` says it "does not know what a card looks
 * like". Rhai stays server-side, where rules run.
 *
 * Two forms, both unambiguous in JSON (§6.3):
 *
 * ```json
 * { "label": "{{ device.name }}",
 *   "icon":  { "$expr": "isOn(device) ? 'lamp-on' : 'lamp'" } }
 * ```
 *
 * **Purity is a rule with a reason, not a boundary** (§6.2). JavaScript cannot
 * enforce it and pretending otherwise would be worse than saying so: extensions
 * run in the main realm, so an extension can already do anything an expression
 * could. What this gets instead is enforcement *by scope* — an expression is
 * compiled with named parameters and given nothing else, so reaching `window`
 * is awkward and obvious rather than natural. Pure expressions are safe to
 * evaluate speculatively, which is what lets the designer preview a value while
 * somebody types it.
 */
import type { DeviceState } from './device.js';
import { roleOf } from './facet.js';
import { effectiveArea, effectiveName, isOn, levelOf } from './present.js';

/** Everything an expression can see (§6.4). This list is the whole scope. */
export interface ExprScope {
  /** The primary bound device. */
  device?: DeviceState | undefined;
  /** Any device the widget declared, by id. */
  devices?: Record<string, DeviceState>;
  /** Template parameters (§5.4). */
  params?: Record<string, unknown>;
  /** Widget-local variables from config. */
  vars?: Record<string, unknown>;
  /** Resolved design tokens (§15). */
  tokens?: unknown;
  /** Locale, units, theme — never identity. */
  user?: unknown;
  /** Evaluation timestamp. */
  now?: number;
}

/**
 * The presentation helpers, handed in as parameters like everything else.
 *
 * An expression that had to re-derive on-ness would be re-deriving it *wrongly*
 * — every widget that did got it wrong the same way, which is the entire reason
 * the primitive exists (§1.1). So the derivation is in the scope, not
 * reachable through some global the expression happens to find.
 */
const HELPERS = {
  isOn,
  levelOf,
  effectiveName,
  effectiveArea,
  facetOf: roleOf,
} as const;

/** The parameter names, in a fixed order the compiled function is built with. */
const NAMES = [
  'device',
  'devices',
  'params',
  'vars',
  'tokens',
  'user',
  'now',
  ...Object.keys(HELPERS),
] as const;

export type Compiled = (scope: ExprScope) => unknown;

/**
 * Compiled functions, kept by source (§6.6).
 *
 * `new Function` per render is the obvious performance mistake — a page of
 * twenty widgets re-parsing on every device change, and this house pushes
 * state constantly. Keyed by the source text, because that is what determines
 * the function; a config object is rebuilt on every render and would key
 * nothing.
 */
const cache = new Map<string, Compiled | Error>();

/** Compiling is the whole enforcement: named parameters, and nothing else. */
function build(source: string): Compiled {
  // An *expression*, not a statement list — no `return`, so no early exit and
  // no accidental side-effect block (§6.3).
  const fn = new Function(...NAMES, `"use strict"; return (${source});`) as (
    ...args: unknown[]
  ) => unknown;

  return (scope: ExprScope) =>
    fn(
      scope.device,
      scope.devices ?? {},
      scope.params ?? {},
      scope.vars ?? {},
      scope.tokens,
      scope.user,
      scope.now ?? Date.now(),
      ...Object.values(HELPERS),
    );
}

/**
 * Compile, or report why not.
 *
 * A malformed expression is rejected **at save time in the designer**, not
 * discovered at render time on a wall display (§6.5) — which needs the failure
 * to be a value a caller can show, not an exception thrown into a render.
 */
export function compile(source: string): Compiled | Error {
  const hit = cache.get(source);
  if (hit !== undefined) return hit;

  let made: Compiled | Error;
  try {
    made = build(source);
  } catch (e) {
    made = e instanceof Error ? e : new SyntaxError(String(e));
  }
  cache.set(source, made);
  return made;
}

/**
 * Evaluate, and never throw.
 *
 * §6.6: an expression that throws renders a fallback, never a blank card. The
 * caller decides what the fallback is — usually the literal the document
 * carried, which is what a client that could not evaluate would have drawn.
 */
export function evaluate(source: string, scope: ExprScope): unknown {
  const fn = compile(source);
  if (fn instanceof Error) return undefined;
  try {
    return fn(scope);
  } catch {
    return undefined;
  }
}

/** `"{{ … }}"` anywhere in a string, replaced by what it evaluates to. */
const INTERPOLATION = /\{\{([^}]*)\}\}/g;

export function interpolate(text: string, scope: ExprScope): string {
  return text.replace(INTERPOLATION, (whole, body: string) => {
    const value = evaluate(body.trim(), scope);
    // The literal survives a failure, so a mistyped name shows `{{ dvice.name }}`
    // rather than an empty card — visibly wrong beats silently blank.
    return value === undefined || value === null ? whole : String(value);
  });
}

/** Whether a value is the `{"$expr": "…"}` form. */
export function isExpr(v: unknown): v is { $expr: string } {
  return (
    typeof v === 'object' && v !== null && typeof (v as { $expr?: unknown }).$expr === 'string'
  );
}

/** Whether a string carries an interpolation. */
export function hasInterpolation(v: unknown): v is string {
  return typeof v === 'string' && /\{\{[^}]*\}\}/.test(v);
}

/**
 * Which devices an expression reads, for §6.6's dependency rule.
 *
 * Static and deliberately shallow: `devices['hue_1']` and `devices.hue_1` are
 * the two spellings a document uses, and anything cleverer would be a parser.
 * A widget cannot reach a device it did not declare anyway — an undeclared one
 * is simply not in `devices` (§6.4) — so this is about *when* to recompute, not
 * about what may be read.
 */
export function readsDevices(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/devices\s*\[\s*['"]([^'"]+)['"]\s*\]/g)) found.add(m[1]!);
  for (const m of source.matchAll(/devices\.([A-Za-z_$][\w$]*)/g)) found.add(m[1]!);
  return [...found];
}

/** Exported so a test can prove the cache is doing its job. */
export function cacheSize(): number {
  return cache.size;
}
