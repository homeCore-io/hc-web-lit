/**
 * P10 — turning a device's declared schema into controls (§5.11).
 *
 * **The control row is generated, not written.** A plugin already said what its
 * device accepts: which attributes are writable and of what kind, what an
 * action is called and what parameters it takes. A widget that hardcodes
 * "lights have a brightness slider" is re-deriving, less well, something the
 * plugin published — and it has nothing to say about the `vcrx` or the
 * `pico_remote` nobody wrote a widget for.
 *
 * Pure, like the layout engine and the token derivation: schema in, a list of
 * control descriptors out. What draws them is a widget's business.
 */
import { asOption } from './api.js';
import type {
  AttributeKind,
  AttributeOption,
  AttributeSchema,
  DeviceAction,
  DeviceSchema,
} from './api.js';
import type { DeviceState } from './device.js';

/** A control to draw, already resolved against the device's current state. */
export type Control =
  | {
      form: 'toggle';
      key: string;
      label: string;
      value: boolean | undefined;
      /** The device's own words for its two states, when it supplied them. */
      onLabel?: string;
      offLabel?: string;
    }
  | {
      form: 'slider';
      key: string;
      label: string;
      value: number | undefined;
      min: number;
      max: number;
      step: number;
      unit?: string;
    }
  | {
      form: 'select';
      key: string;
      label: string;
      value: string | undefined;
      /** Already normalised: nothing downstream sees the string|object union. */
      options: AttributeOption[];
    }
  | {
      form: 'colorTemp';
      key: string;
      label: string;
      value: number | undefined;
      min: number;
      max: number;
      unit?: string;
    }
  | { form: 'color'; key: string; label: string; value: unknown }
  | { form: 'text'; key: string; label: string; value: string | undefined }
  | {
      form: 'action';
      /**
       * The action's id, so every variant has a stable key for list rendering.
       * An attribute and an action could in principle share a name on one
       * device; nothing in the house does, and a collision would cost only a
       * re-render.
       */
      key: string;
      action: DeviceAction;
      label: string;
    };

/** Which control a kind implies. `json` is deliberately absent — see below. */
const FORM: Partial<Record<AttributeKind, Control['form']>> = {
  bool: 'toggle',
  integer: 'slider',
  float: 'slider',
  enum: 'select',
  string: 'text',
  color_temp: 'colorTemp',
  color_xy: 'color',
  color_rgb: 'color',
};

const label = (key: string, a: AttributeSchema): string =>
  a.display_name ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * The controls a device offers, in a stable order.
 *
 * Attributes first, then actions. Within attributes, `bool` leads — power is
 * what somebody reached for — and `diagnostic`/`config` attributes are excluded
 * entirely: a lock's battery and firmware are readings, not controls, and
 * rendering them beside the lock buries the one an operator came for.
 */
export function controlsFor(device: DeviceState, schema?: DeviceSchema | null): Control[] {
  const s = schema ?? device.schema;
  if (s == null) return [];

  const out: Control[] = [];
  const attrs = Object.entries(s.attributes ?? {});

  // Power first, then everything else alphabetically — a stable order matters
  // more than a clever one, because a control that moves between renders is a
  // control somebody mis-taps.
  attrs.sort(([ak, av], [bk, bv]) => {
    const rank = (k: string, v: AttributeSchema) => (v.kind === 'bool' ? (k === 'on' ? 0 : 1) : 2);
    return rank(ak, av) - rank(bk, bv) || ak.localeCompare(bk);
  });

  for (const [key, a] of attrs) {
    if (a.writable !== true) continue;
    // Not a control: a reading about the device's health, or a setting that
    // shapes behaviour rather than commanding it.
    if (a.category === 'diagnostic' || a.category === 'config') continue;

    const form = FORM[a.kind];
    // `json` has no dedicated control by declaration — core's own word for it
    // is "opaque". Offering a textarea for one would be inviting a person to
    // hand-edit something the plugin never promised to parse back.
    if (form === undefined) continue;

    const value = device.attributes[key];
    const name = label(key, a);

    switch (form) {
      case 'toggle':
        out.push({
          form,
          key,
          label: name,
          value: typeof value === 'boolean' ? value : undefined,
          ...(a.states?.when_true?.label !== undefined
            ? { onLabel: a.states.when_true.label }
            : {}),
          ...(a.states?.when_false?.label !== undefined
            ? { offLabel: a.states.when_false.label }
            : {}),
        });
        break;
      case 'slider':
        out.push({
          form,
          key,
          label: name,
          value: typeof value === 'number' ? value : undefined,
          min: a.min ?? 0,
          max: a.max ?? 100,
          // A step of zero would freeze the control; a missing one on an
          // integer means one.
          step: a.step !== undefined && a.step > 0 ? a.step : a.kind === 'integer' ? 1 : 0.1,
          ...(a.unit !== undefined ? { unit: a.unit } : {}),
        });
        break;
      case 'colorTemp':
        out.push({
          form,
          key,
          label: name,
          value: typeof value === 'number' ? value : undefined,
          min: a.min ?? 2000,
          max: a.max ?? 6500,
          ...(a.unit !== undefined ? { unit: a.unit } : {}),
        });
        break;
      case 'select':
        out.push({
          form,
          key,
          label: name,
          value: typeof value === 'string' ? value : undefined,
          options: (a.options ?? []).map(asOption),
        });
        break;
      case 'color':
        out.push({ form, key, label: name, value });
        break;
      case 'text':
        out.push({ form, key, label: name, value: typeof value === 'string' ? value : undefined });
        break;
    }
  }

  for (const action of s.actions ?? []) {
    out.push({ form: 'action', key: action.id, action, label: action.label });
  }

  return out;
}

/**
 * Resolve an action parameter's options against the device (§5.11).
 *
 * `options_from` binds a picker to a live attribute — a keypad's buttons come
 * from `available_buttons`, carrying the engraving off the wall — so nothing
 * here knows what a Lutron keypad is. The attribute arrives in two shapes from
 * two plugins: Caséta sends `[2, 3, 4]`, Lutron sends `[{name, number}]`. Both
 * are handled, because both are what the house sends.
 */
export function optionsForParam(
  device: DeviceState,
  param: {
    options?: { label: string; value: string }[];
    options_from?: { attribute?: { attribute: string; label_key?: string; value_key?: string } };
  },
): { label: string; value: string }[] {
  if (param.options !== undefined) return param.options;

  const from = param.options_from?.attribute;
  if (from === undefined) return [];

  const raw = device.attributes[from.attribute];
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): { label: string; value: string }[] => {
    if (typeof entry === 'number' || typeof entry === 'string') {
      return [{ label: `Button ${entry}`, value: String(entry) }];
    }
    if (typeof entry === 'object' && entry !== null) {
      const row = entry as Record<string, unknown>;
      const value = row[from.value_key ?? 'value'];
      if (value === undefined) return [];
      const lbl = row[from.label_key ?? 'label'];
      return [{ label: typeof lbl === 'string' ? lbl : String(value), value: String(value) }];
    }
    return [];
  });
}
