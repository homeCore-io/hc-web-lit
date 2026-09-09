/**
 * `hc-extension.json` — what an extension declares (§4.3).
 *
 * **One contribution path** (§4.6): a `provides.widgets[]` entry is a
 * `WidgetDescriptor`, the same shape a plugin declares, not a second format
 * invented for extensions. Inventing one here would be §3 Rule 1's mistake
 * committed a level up — a privileged path for extensions beside the one
 * plugins use.
 *
 * `hcApiVersion` is the compatibility gate. The host refuses an extension
 * declaring a version it does not implement, **and says so in the UI** rather
 * than failing silently, because an extension that half-loads is worse than
 * one that plainly did not.
 */

/** The API version this host implements. Bumped when the ABI breaks (§19.7). */
export const HC_API_VERSION = '1';

export interface WidgetDeclaration {
  /** The custom element the module defines. */
  tag: string;
  /** The document `type` this draws. Unknown types are core-legal (§14.3). */
  widget_id?: string;
  name: string;
  description?: string;
  icon?: string;
  categories?: string[];
  /**
   * Whether a client that cannot draw it has anything to fall back on (§4.6).
   * `instrument` promises a portable render; `graphical` says plainly that it
   * has none, which is truer for a floorplan than a false render tree.
   */
  kind?: 'instrument' | 'graphical';
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  hcApiVersion: string;
  entry: string;
  author?: string;
  homepage?: string;
  provides?: {
    widgets?: WidgetDeclaration[];
    floorplanLayers?: unknown[];
    templates?: unknown[];
  };
  assets?: string[];
}

/** Why an extension was refused, in words a person can act on. */
export type Refusal = { ok: false; reason: string };
export type Accepted = { ok: true; manifest: ExtensionManifest };

/**
 * Read a manifest, or say what is wrong with it.
 *
 * Every check answers a question an admin will ask when a widget does not
 * appear, so each failure names the field rather than reporting "invalid".
 */
export function readManifest(raw: unknown): Accepted | Refusal {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'Not an object.' };
  const m = raw as Record<string, unknown>;

  for (const key of ['id', 'name', 'version', 'hcApiVersion', 'entry'] as const) {
    if (typeof m[key] !== 'string' || m[key] === '') {
      return { ok: false, reason: `Missing "${key}".` };
    }
  }

  if (m['hcApiVersion'] !== HC_API_VERSION) {
    return {
      ok: false,
      reason: `Wants API version ${String(m['hcApiVersion'])}; this host implements ${HC_API_VERSION}.`,
    };
  }

  // A relative entry only. An extension pointing at another origin is a
  // different trust decision from the one an admin made when they installed a
  // package (§8.1), and not one to make quietly on their behalf.
  const entry = m['entry'] as string;
  if (/^[a-z]+:/i.test(entry) || entry.startsWith('//')) {
    return { ok: false, reason: 'Entry must be a path inside the extension, not a URL.' };
  }

  const widgets = (m['provides'] as { widgets?: unknown } | undefined)?.widgets;
  if (widgets !== undefined) {
    if (!Array.isArray(widgets)) return { ok: false, reason: '"provides.widgets" is not a list.' };
    for (const w of widgets) {
      const decl = w as Record<string, unknown>;
      if (typeof decl['tag'] !== 'string' || !decl['tag'].includes('-')) {
        return { ok: false, reason: 'A widget needs a "tag" with a hyphen in it.' };
      }
    }
  }

  return { ok: true, manifest: m as unknown as ExtensionManifest };
}
