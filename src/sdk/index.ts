/**
 * `@homecore/widget-sdk` — the surface an extension is written against.
 *
 * Published in Phase 3, and §18.1 is clear about why the order matters: once a
 * third party has written against this, a primitive added later cannot be
 * adopted retroactively by widgets already in the wild — it just becomes a
 * second way to do the same thing, which is §5.1's entire diagnosis of Home
 * Assistant. Everything up to that point is ours to change freely; after it,
 * §19.7 applies and a rename is a breaking change.
 *
 * Which is why this file is a re-export and not a new vocabulary. Every type
 * here is one the first-party widgets already use; nothing was invented for
 * the SDK, because a surface invented ahead of its callers is the thing the
 * sequencing exists to prevent.
 */
/**
 * The rendering runtime, from the host rather than from the extension.
 *
 * Found by building `hc-button`: it had to `import ... from 'lit'` itself,
 * which means an installed extension ships a second copy of Lit, registers a
 * second set of reactive-element definitions and loses every shared style.
 * §10.3 makes exactly this argument about the Rive runtime — bundle once in
 * the shell, expose it, never let an extension carry its own — and it is the
 * same argument here. The acceptance gate is what surfaced it (§7.4).
 */
export { LitElement, css, html, nothing, svg } from 'lit';
export type { TemplateResult } from 'lit';

export type { HcContext, QueryResult, Unsubscribe } from './context.js';
export { HcWidgetBase } from './base.js';
export { registerWidget, tagFor } from '../widgets/registry.js';

// The primitives, as an extension sees them.
export type { DeviceState } from '../core/device.js';
export type { DeviceQuery } from '../core/query.js';
export type { ActionConfig } from '../core/actions.js';
export type { WidgetSpec } from '../shell/mount.js';
export type { Tokens } from '../design/tokens.js';

// Presentation is the one thing a widget must never re-derive (§1.1).
export { effectiveArea, effectiveName, isOn, levelOf, sceneKind } from '../core/present.js';
export { formatReading, hasPowerState, readingOf, roleOf } from '../core/facet.js';
export { controlsFor } from '../core/controls.js';
export { humanise, words } from '../core/text.js';
export { icon, iconFor } from '../design/icons.js';
export { childrenOf, wantsChrome } from '../core/compose.js';
