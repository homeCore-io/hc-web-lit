/**
 * Tokens as CSS custom properties.
 *
 * This is the seam §5.8 is about: every widget's own custom properties default
 * to one of these, which is what makes a theme change repaint third-party
 * widgets and floorplan layers too, and what makes card-mod unnecessary. The
 * names are **ABI** (§19.7) — renaming one is a breaking change.
 */
import type { Tokens } from './tokens.js';

/** `--hc-surface-base`, `--hc-accent-primary`, … */
export function cssVariables(t: Tokens): Record<string, string> {
  const vars: Record<string, string> = {
    '--hc-name': t.name,
    '--hc-brightness': t.brightness,

    '--hc-surface-base': t.surface.base,
    '--hc-surface-raised': t.surface.raised,
    '--hc-surface-sunken': t.surface.sunken,
    '--hc-surface-overlay': t.surface.overlay,
    '--hc-surface-glass-tint': t.surface.glassTint,
    '--hc-surface-glass-blur': `${t.surface.glassBlur}px`,
    '--hc-ink': t.surface.onBase,
    '--hc-ink-muted': t.surface.onBaseMuted,

    '--hc-accent-primary': t.accent.primary,
    '--hc-accent-on-primary': t.accent.onPrimary,
    '--hc-accent-active': t.accent.active,
    '--hc-accent-inactive': t.accent.inactive,
    '--hc-accent-success': t.accent.success,
    '--hc-accent-warn': t.accent.warn,
    '--hc-accent-danger': t.accent.danger,
    '--hc-accent-on-danger': t.accent.onDanger,
    '--hc-accent-offline': t.accent.offline,

    '--hc-stroke-hairline': t.stroke.hairline,
    '--hc-stroke-width': `${t.stroke.width}px`,
    '--hc-stroke-focus': t.stroke.focus,

    '--hc-radius-xs': `${t.radius.xs}px`,
    '--hc-radius-sm': `${t.radius.sm}px`,
    '--hc-radius-md': `${t.radius.md}px`,
    '--hc-radius-lg': `${t.radius.lg}px`,
    '--hc-radius-pill': `${t.radius.pill}px`,

    '--hc-space-unit': `${t.space.unit}px`,

    '--hc-motion-fast': `${t.motion.fast}ms`,
    '--hc-motion-base': `${t.motion.base}ms`,
    '--hc-motion-slow': `${t.motion.slow}ms`,
    '--hc-motion-curve': t.motion.curve,
    '--hc-motion-emphasized': t.motion.emphasized,

    '--hc-glow-strength': String(t.glow.strength),
    '--hc-glow-radius': `${t.glow.radius}px`,

    '--hc-density-row-height': `${t.density.rowHeight}px`,
    '--hc-density-control-height': `${t.density.controlHeight}px`,
    '--hc-density-min-tap': `${t.density.minTapTarget}px`,
    '--hc-density-card-padding': `${t.density.cardPadding}px`,

    '--hc-elevation-card': t.elevation.card,
    '--hc-elevation-overlay': t.elevation.overlay,
    '--hc-elevation-control': t.elevation.control,

    '--hc-metric-temperature': t.metric.temperature,
    '--hc-metric-humidity': t.metric.humidity,
    '--hc-metric-illuminance': t.metric.illuminance,
    '--hc-metric-co2': t.metric.co2,
    '--hc-metric-power': t.metric.power,
    '--hc-metric-reading': t.metric.reading,

    '--hc-font-body': `"${t.text.family}", system-ui, sans-serif`,
    '--hc-font-mono': `"${t.text.monoFamily}", ui-monospace, monospace`,
  };

  for (const [role, v] of Object.entries({
    display: t.text.display,
    title: t.text.title,
    subtitle: t.text.subtitle,
    body: t.text.body,
    'body-small': t.text.bodySmall,
    caption: t.text.caption,
    overline: t.text.overline,
  })) {
    vars[`--hc-text-${role}-size`] = `${v.size}px`;
    vars[`--hc-text-${role}-weight`] = String(v.weight);
    vars[`--hc-text-${role}-height`] = String(v.height);
    if (v.tracking !== undefined) vars[`--hc-text-${role}-tracking`] = `${v.tracking}px`;
  }

  return vars;
}

/**
 * Whether the person at the screen has asked for less movement.
 *
 * Read here rather than written as a media query in each widget, because the
 * tokens are set as inline styles on the document root and an inline style
 * beats any stylesheet — a `@media (prefers-reduced-motion)` block inside a
 * component could not have overridden them even where somebody remembered to
 * write one. Three widgets out of sixteen had.
 */
function prefersStillness(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Write the tokens onto an element — the document root, in the shell.
 *
 * **Reduced motion is one line here rather than sixteen media queries.** Every
 * transition in this client is a duration token away from stopping, so a
 * person who has asked their machine for less movement gets a product that
 * stops moving — including the parts of it written by somebody else, which is
 * the half a per-widget rule could never reach (§7.2). The easing curve is
 * left alone: with a zero duration there is nothing for it to shape.
 */
export function applyTokens(el: HTMLElement, t: Tokens): void {
  const still = prefersStillness();
  for (const [name, value] of Object.entries(cssVariables(t))) {
    el.style.setProperty(name, still && /^--hc-motion-(fast|base|slow)$/.test(name) ? '0s' : value);
  }
  // `color-scheme` is what makes form controls, scrollbars and the canvas the
  // browser paints behind the page follow the skin. Without it a dark skin gets
  // a white scrollbar and a light page flash on load.
  el.style.colorScheme = t.brightness;
}
