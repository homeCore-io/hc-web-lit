/**
 * Core's colour role names, mapped onto the token vocabulary (§15).
 *
 * A stored page says `ink: "hairline"` or `fill: "surface"` — a name for a
 * *role*, never a colour. That is what lets one document read correctly in all
 * four skins, and it is why this mapping exists in exactly one place rather
 * than in each widget that happens to take a colour.
 *
 * An unknown role resolves to the body ink rather than to a literal: a document
 * naming a role this client has not learned yet should be dim, not invisible or
 * garish.
 */
const ROLE: Record<string, string> = {
  foreground: '--hc-ink',
  muted: '--hc-ink-muted',
  accent: '--hc-accent-primary',
  active: '--hc-accent-active',
  success: '--hc-accent-success',
  warn: '--hc-accent-warn',
  danger: '--hc-accent-danger',
  offline: '--hc-accent-offline',
  hairline: '--hc-stroke-hairline',
  page: '--hc-surface-base',
  surface: '--hc-surface-raised',
  sunken: '--hc-surface-sunken',
  overlay: '--hc-surface-overlay',
};

/** The CSS custom property a role resolves to. */
export function roleVar(role: string | undefined, fallback = '--hc-ink'): string {
  return (role !== undefined ? ROLE[role] : undefined) ?? fallback;
}

/** A `var()` reference for a role, ready to drop into a style attribute. */
export function roleColor(role: string | undefined, fallback = '--hc-ink'): string {
  return `var(${roleVar(role, fallback)})`;
}

/** The role names this client knows. Exported so a test can pin the list. */
export function knownRoles(): string[] {
  return Object.keys(ROLE).sort();
}
