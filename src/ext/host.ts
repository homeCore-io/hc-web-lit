/**
 * Loading an extension (§8.1, §4.3).
 *
 * **In-realm ESM, by default.** §8.1 settles this: install is already a
 * deliberate admin act, homeCore plugins are native binaries supervised as
 * processes, and hardening the browser layer while that door stands is defence
 * pointed away from the risk. Mandatory isolation is paid for by extension
 * authors in a currency this project cannot afford — no shared runtime, no
 * containers, everything async — and it would not even be complete, since
 * floorplan layers cannot be framed at all.
 *
 * What this owes in exchange is **error isolation**: an extension that throws
 * on load, or defines nothing, or names a tag it never registered, must leave
 * the rest of the page alone. A wall display that goes blank because a widget
 * somebody installed has a typo is the failure mode that makes people stop
 * installing things.
 */
import { readManifest, type ExtensionManifest, type WidgetDeclaration } from './manifest.js';
import { registerWidget, tagFor } from '../core/registry.js';

export interface LoadedExtension {
  manifest: ExtensionManifest;
  /** The document types it added, in the order declared. */
  widgets: WidgetDeclaration[];
}

export type LoadResult = LoadedExtension | { error: string };

/** How a module is fetched. Injectable, so a test needs no server. */
export type Importer = (url: string) => Promise<unknown>;

const defaultImporter: Importer = (url) => import(/* @vite-ignore */ url);

/**
 * Load one extension and register what it provides.
 *
 * The `?v=` cache-buster keyed on the manifest version is what makes an
 * update take effect on reload without service-worker gymnastics (§8.1).
 */
export async function loadExtension(
  raw: unknown,
  base: string,
  load: Importer = defaultImporter,
): Promise<LoadResult> {
  const read = readManifest(raw);
  if (!read.ok) return { error: read.reason };
  const manifest = read.manifest;

  const url = `${base.replace(/\/$/, '')}/${manifest.entry.replace(/^\.?\//, '')}?v=${manifest.version}`;

  try {
    await load(url);
  } catch (e) {
    // Named, because "an extension failed" sends an admin to the wrong place.
    return { error: `${manifest.id} did not load: ${e instanceof Error ? e.message : String(e)}` };
  }

  const declared = manifest.provides?.widgets ?? [];
  const registered: WidgetDeclaration[] = [];
  const missing: string[] = [];

  for (const w of declared) {
    // A module that declared a tag and never defined it is the common typo,
    // and the symptom without this check is a widget that renders as unknown
    // with nothing anywhere saying why.
    if (customElements.get(w.tag) === undefined) {
      missing.push(w.tag);
      continue;
    }
    registerWidget(w.widget_id ?? w.tag.replace(/^hc-/, ''), w.tag);
    registered.push(w);
  }

  if (missing.length > 0) {
    return {
      error: `${manifest.id} declares ${missing.join(', ')} but defines ${missing.length === 1 ? 'it' : 'them'} nowhere.`,
    };
  }

  return { manifest, widgets: registered };
}

/** Whether a document type is drawable, extensions included. */
export function canDraw(type: string): boolean {
  return tagFor(type) !== undefined;
}
