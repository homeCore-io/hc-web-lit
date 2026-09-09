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

const KEYS = { templates: 'templates', icons: 'icon-rules' } as const;

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

  /** Everything authored, for an export or a look at what is stored. */
  export(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of this.store.keys()) out[key] = this.store.read(key);
    return out;
  }
}
