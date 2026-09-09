/**
 * Icons, derived from what a device declares (§11.2).
 *
 * **This is a presentation table, and it belongs here.** §1.1 forbids mapping
 * `device_type` to a *behaviour* — that is a client deciding what a plugin's
 * word means, closed against the next plugin and silently wrong rather than
 * visibly missing. A picture is the opposite case: it is presentation, the
 * core/client boundary puts presentation in the client (§1.2), and §11.2
 * already specifies the resolution order — a name rule, then `ui_hint`, then
 * `device_type`. An unknown type gets the generic device mark, which is a
 * visible "I don't know what this is", not a wrong claim about it.
 *
 * `ui_hint` outranks `device_type` because that is the field's whole purpose: a
 * switch a person hinted as a light *is* a light, and drawing it as a rocker
 * would make the override cosmetic.
 *
 * Stroke-drawn on a 24×24 grid, `currentColor` throughout, so one icon works on
 * every skin and takes its colour from whatever state the caller is painting.
 */
import { html, type TemplateResult } from 'lit';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';

/** The marks. Inner SVG, no colours — the caller owns those. */
const MARKS: Record<string, string> = {
  light:
    '<path d="M12 3a6 6 0 0 0-3.4 10.9c.5.4.9 1 .9 1.7V17h5v-1.4c0-.7.4-1.3.9-1.7A6 6 0 0 0 12 3Z"/>' +
    '<path d="M9.5 20h5"/>',
  switch: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 9.5h6"/>',
  outlet:
    '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/>' + '<path d="M9.5 9.5v3M14.5 9.5v3"/>',
  fan:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="1.6"/>' +
    '<path d="M12 3.5c2.2 2.2 2.2 5.2 0 6.9M20.5 12c-2.2 2.2-5.2 2.2-6.9 0' +
    'M12 20.5c-2.2-2.2-2.2-5.2 0-6.9M3.5 12c2.2-2.2 5.2-2.2 6.9 0"/>',
  lock:
    '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/>' +
    '<path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  door: '<path d="M6.5 3h11v18h-11z"/><circle cx="14.5" cy="12" r="1"/>',
  window: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 4v16M4 12h16"/>',
  garage: '<path d="M3.5 20V9.5L12 5l8.5 4.5V20"/><path d="M7 20v-7h10v7M7 16.5h10"/>',
  motion:
    '<circle cx="9" cy="4.8" r="2"/><path d="M6 21l2.2-6.2L11 12l1 4 3 3"/>' +
    '<path d="M16.5 7.5a4 4 0 0 1 0 6M19 5a7.5 7.5 0 0 1 0 11"/>',
  temperature: '<path d="M14 14.6V5.5a2 2 0 1 0-4 0v9.1a4 4 0 1 0 4 0Z"/><path d="M12 9.5v5"/>',
  water: '<path d="M12 3.2s6 6.6 6 10.4a6 6 0 0 1-12 0c0-3.8 6-10.4 6-10.4Z"/>',
  rain:
    '<path d="M7.5 15.5a4 4 0 0 1 .6-8 5.5 5.5 0 0 1 10.3 1.6 3.5 3.5 0 0 1-.4 6.4"/>' +
    '<path d="M9 18.5 8 21M13 18.5 12 21M17 18.5 16 21"/>',
  lightning: '<path d="M13.5 2.5 5.5 14h5.6l-.6 7.5 8-11.5h-5.6z"/>',
  vibration:
    '<path d="M3 10v4M6 8v8M21 10v4M18 8v8"/><rect x="9" y="5" width="6" height="14" rx="2"/>',
  weather:
    '<circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2v2M12 20v2M2 12h2M20 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>',
  media: '<rect x="2.5" y="4.5" width="19" height="13" rx="2.5"/><path d="M8 21h8"/>',
  speaker:
    '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><circle cx="12" cy="14.5" r="3.2"/>' +
    '<circle cx="12" cy="6.5" r="1"/>',
  scene: '<path d="m12 2.5 2.2 5.3 5.3 2.2-5.3 2.2L12 17.5l-2.2-5.3L4.5 10l5.3-2.2Z"/>',
  remote:
    '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10 7h4M10 11h4M10 15h4"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2h5"/>',
  hub:
    '<circle cx="12" cy="12" r="2"/>' +
    '<path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8"/>' +
    '<path d="M5.8 5.8a8.8 8.8 0 0 0 0 12.4M18.2 5.8a8.8 8.8 0 0 1 0 12.4"/>',
  // One bar, because the only thing this client draws a battery for is a
  // battery that is low.
  battery:
    '<rect x="2.5" y="8" width="17" height="8" rx="2.5"/><path d="M21.5 11v2"/>' +
    '<path d="M5.5 10.5v3"/>',
  device: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="2.5"/>',

  // Controls rather than kinds of device. Same grid, same stroke, so a
  // transport row sits in the same family as the tiles beside it — and so the
  // volume glyphs stop being emoji, which render at whatever size and colour
  // the platform's font decides and match nothing else on the page.
  play: '<path d="M8 5.5 18.5 12 8 18.5Z"/>',
  pause: '<path d="M9.5 5v14M14.5 5v14"/>',
  play_pause: '<path d="M4 5.5 12 12l-8 6.5Z"/><path d="M16.5 5.5v13M21 5.5v13"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  prev: '<path d="M17.5 5.5 8 12l9.5 6.5Z"/><path d="M5.5 5.5v13"/>',
  next: '<path d="M6.5 5.5 16 12l-9.5 6.5Z"/><path d="M18.5 5.5v13"/>',
  volume_up:
    '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z"/><path d="M16 9.5a4 4 0 0 1 0 5"/>' +
    '<path d="M18.5 7a7.5 7.5 0 0 1 0 10"/>',
  volume_down: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z"/><path d="M16 9.5a4 4 0 0 1 0 5"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
};

/** Declared word → mark. Presentation only; nothing behavioural reads this. */
const BY_WORD: Record<string, string> = {
  light: 'light',
  bulb: 'light',
  switch: 'switch',
  outlet: 'outlet',
  plug: 'outlet',
  fan: 'fan',
  lock: 'lock',
  door: 'door',
  contact_sensor: 'door',
  window: 'window',
  garage: 'garage',
  motion: 'motion',
  motion_sensor: 'motion',
  occupancy: 'motion',
  occupancy_sensor: 'motion',
  presence: 'motion',
  temperature: 'temperature',
  temperature_sensor: 'temperature',
  thermostat: 'temperature',
  climate: 'temperature',
  humidity: 'water',
  water: 'water',
  water_sensor: 'water',
  leak: 'water',
  rain_sensor: 'rain',
  lightning_sensor: 'lightning',
  vibration_sensor: 'vibration',
  weather_station: 'weather',
  media_player: 'media',
  tv: 'media',
  speaker: 'speaker',
  scene: 'scene',
  pico_remote: 'remote',
  keypad: 'remote',
  vcrx: 'remote',
  remote: 'remote',
  timer: 'timer',
  counter: 'timer',
  bridge: 'hub',
  gateway: 'hub',
  zwave: 'hub',
  hub: 'hub',
};

/**
 * A user's own rule: this name gets that mark (§11.2).
 *
 * Ordered, first match wins, and matched against the device's *name* by
 * default because that is what a person recognises — "Holiday Lights" is a
 * switch to the bridge and a string of lights to the household.
 */
export interface IconRule {
  /** A regular expression, as the user typed it. */
  match: string;
  /** A mark name. An unknown one falls through to the derived answer. */
  icon: string;
  /** What to match against. The name, unless said otherwise. */
  on?: 'name' | 'area' | 'type';
}

/**
 * The rules in force.
 *
 * Module state, deliberately, and it is the one place this client keeps any.
 * The alternative is threading a resolver through every widget that draws a
 * mark, and the cost of that is not the plumbing — it is that a third-party
 * widget calling `iconFor` would silently ignore the user's rules unless its
 * author remembered to ask for them. A house has one set of icon rules the way
 * it has one skin.
 */
let rules: IconRule[] = [];

/** Set by the host, from wherever it keeps user content. */
export function setIconRules(next: readonly IconRule[]): void {
  rules = [...next];
}

export function iconRules(): IconRule[] {
  return [...rules];
}

/** What a rule looks at on a device. */
function subject(
  d: { name?: string; ui_hint?: string; device_type?: string; area?: string | null } | undefined,
  on: IconRule['on'],
): string {
  if (on === 'area') return d?.area ?? '';
  if (on === 'type') return d?.ui_hint ?? d?.device_type ?? '';
  return d?.name ?? '';
}

/**
 * The first rule that matches, if any.
 *
 * A malformed pattern matches nothing rather than throwing: these are typed by
 * a person into a text field, and a half-finished regex must not take the page
 * down between keystrokes.
 */
export function ruleFor(
  d: { name?: string; ui_hint?: string; device_type?: string; area?: string | null } | undefined,
  list: readonly IconRule[] = rules,
): IconRule | undefined {
  for (const rule of list) {
    if (typeof rule?.match !== 'string' || rule.match === '') continue;
    try {
      if (new RegExp(rule.match, 'i').test(subject(d, rule.on))) return rule;
    } catch {
      // Not a pattern yet. The next one might be.
    }
  }
  return undefined;
}

/**
 * The mark for a device: the user's rule, then `ui_hint`, then `device_type`.
 *
 * §11.2's order. A rule wins because it is the most specific thing anybody
 * said — the household knows which switch is a fan and the bridge does not.
 */
export function iconFor(
  d: { name?: string; ui_hint?: string; device_type?: string; area?: string | null } | undefined,
): string {
  const named = ruleFor(d)?.icon;
  if (named !== undefined && named in MARKS) return named;

  const hint = d?.ui_hint;
  const type = d?.device_type;
  return (
    (hint !== undefined ? BY_WORD[hint] : undefined) ??
    (type !== undefined ? BY_WORD[type] : undefined) ??
    // A type nobody has drawn for still gets a mark that says "a device", which
    // is true, rather than a bulb, which would not be.
    'device'
  );
}

/** One mark, sized by the box it is given. */
export function icon(name: string): TemplateResult {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true" part="icon">
    ${unsafeSVG(MARKS[name] ?? MARKS['device'])}
  </svg>`;
}

/** Exported so a test can pin that every mapped word has a mark. */
export function markNames(): string[] {
  return Object.keys(MARKS);
}

export function mappedWords(): Record<string, string> {
  return { ...BY_WORD };
}

/**
 * The metric colour a mark belongs to, where one applies.
 *
 * A row of grey icons reads as a form; a thermometer in the temperature tint
 * and a droplet in the humidity one reads as instruments. The tokens are the
 * skin's (§15), so this follows a skin change like everything else — and a mark
 * with no metric gets none rather than an invented colour.
 */
const METRIC: Record<string, string> = {
  temperature: '--hc-metric-temperature',
  water: '--hc-metric-humidity',
  rain: '--hc-metric-humidity',
  weather: '--hc-metric-reading',
  lightning: '--hc-metric-illuminance',
  motion: '--hc-metric-reading',
  vibration: '--hc-metric-reading',
  battery: '--hc-metric-power',
};

export function metricVar(mark: string): string | undefined {
  return METRIC[mark];
}
