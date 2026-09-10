/**
 * The things a person authored, in one place (§5.4, §11.2).
 *
 * Three features had each grown their own idea of where user content lives —
 * `TemplateStore` behind an interface, `setIconRules` taking whatever it is
 * given, and an asset store nobody had built. This answers the question once.
 *
 * Kept deliberately thin: it reads and writes JSON through a `ContentStore`
 * and knows what the shapes are, so a widget or a designer asks *this* rather
 * than reaching for storage directly. Where the JSON physically sits is the
 * adapter's business, and that decision is still open.
 */
import type { ContentStore } from './content.js';
import { Templates, type WidgetTemplate } from './templates.js';
import { setIconRules, type IconRule } from '../design/icons.js';
import { setPreferences, type Preferences } from './i18n.js';

const KEYS = { templates: 'templates', icons: 'icon-rules', prefs: 'preferences' } as const;

export class Authored {
  private readonly templateStore: Templates;

  constructor(private readonly store: ContentStore) {
    this.templateStore = new Templates(this.store.read<WidgetTemplate[]>(KEYS.templates) ?? []);
  }

  /**
   * Put what was saved into force.
   *
   * Called once by the host at startup. Icon rules are module state by design
   * (see `design/icons.ts`), so somebody has to hand them over, and this is
   * the somebody.
   */
  apply(): void {
    setIconRules(this.iconRules());
    setPreferences(this.preferences());
  }

  templates(): Templates {
    return this.templateStore;
  }

  saveTemplate(t: WidgetTemplate): void {
    this.templateStore.add(t);
    this.store.write(KEYS.templates, this.templateStore.list());
  }

  iconRules(): IconRule[] {
    const saved = this.store.read<IconRule[]>(KEYS.icons);
    return Array.isArray(saved) ? saved : [];
  }

  saveIconRules(rules: readonly IconRule[]): void {
    // Written and applied together: rules that were saved and not in force
    // would be a page that changes when you reload, which reads as a bug
    // rather than as a save.
    this.store.write(KEYS.icons, [...rules]);
    setIconRules(rules);
  }

  /**
   * Locale, units and clock — what a household reads its house in (§4.2).
   *
   * Authored content rather than a device setting: it is a property of the
   * people, and it belongs beside the icon rules and the templates that are
   * also theirs. Empty is the normal state and means "as it comes" — the
   * browser's locale, and every reading in the unit its plugin published.
   */
  preferences(): Preferences {
    const saved = this.store.read<Preferences>(KEYS.prefs);
    return typeof saved === 'object' && saved !== null ? saved : {};
  }

  savePreferences(next: Preferences): void {
    // Written and applied together, for the reason the icon rules are: a
    // preference that was saved and is not in force reads as a bug.
    this.store.write(KEYS.prefs, next);
    setPreferences(next);
  }

  /** Everything authored, for an export or a look at what is stored. */
  export(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of this.store.keys()) out[key] = this.store.read(key);
    return out;
  }
}
