/**
 * A skin as the decisions somebody actually makes.
 *
 * Mirrors `hc_types::skin::SkinSeeds`, which is what core stores — **seeds, not
 * resolved tokens**. Core holds the ~26 chosen values and refuses to judge
 * them; deriving the 74 tokens is this client's job, because whether `active`
 * is legible on a card is a contrast measurement that belongs with the
 * derivation (§15, §1.2).
 *
 * ## Why a palette is chosen and everything else is derived
 *
 * hc-web-flutter measured this rather than assuming it, and the finding is
 * worth inheriting: **no single ratio reproduces the four shipped skins.**
 * Midnight's corner scale is .29/.57/1.57 and Control Room's is .4/.6/1.6; no
 * lightness step yields all four surface sets. A formula contorted to hit
 * `#141922` from `#0B0E13` would be curve-fitting wearing the clothes of a
 * rule.
 *
 * So the split is by kind, not by count. A palette is *chosen*. Everything with
 * an actual rule behind it — the type ramp, density, motion, radii, shadows,
 * three of the six metric tints — is *derived*.
 */

export type Brightness = 'dark' | 'light';
export type SkinDensity = 'compact' | 'comfortable' | 'wall';
export type SkinMotion = 'crisp' | 'standard' | 'calm';

/**
 * Two decisions, not one: Soft Home carries a tint with no blur at all, because
 * a light ground scatters without needing to soften.
 */
export type SkinGlass = 'none' | 'tinted' | 'frosted';

export interface DensityTokens {
  rowHeight: number;
  controlHeight: number;
  minTapTarget: number;
  cardPadding: number;
}

export interface MotionTokens {
  fast: number;
  base: number;
  slow: number;
  curve: string;
  emphasized: string;
  enabled: boolean;
}

export interface MetricTints {
  temperature: string;
  humidity: string;
  illuminance: string;
  co2: string;
  power: string;
  reading: string;
}

export interface SkinSeeds {
  name: string;
  brightness: Brightness;

  // The palette. Chosen, not computed.
  ground: string;
  raised: string;
  sunken: string;
  overlay: string;
  ink: string;
  inkMuted: string;
  accent: string;
  onAccent: string;
  active: string;
  inactive: string;
  success: string;
  warn: string;
  danger: string;
  offline: string;
  hairline: string;

  /** The focus ring. Absent takes `accent`. */
  focus?: string;

  /** xs, sm, md, lg. Four values rather than a ratio — see above. */
  corners: [number, number, number, number];

  spaceUnit: number;
  typeScale: number;
  glowStrength: number;
  glowRadius: number;

  density: SkinDensity;
  motion: SkinMotion;
  glass?: SkinGlass;

  /** Where a skin wants something the rule does not give it. */
  densityOverride?: DensityTokens;
  motionOverride?: MotionTokens;
  metric?: MetricTints;
}

/**
 * The four shipped skins.
 *
 * **Compiled in, and core says they should be**: they are *"the floor: a house
 * should never be one bad row away from an unstyled app"*, and a stored skin
 * names which of these it was forked from so one that fails to load has
 * somewhere to fall back to.
 */
export const builtInSeeds: Record<string, SkinSeeds> = {
  midnight: {
    name: 'midnight',
    brightness: 'dark',
    ground: '#0B0E13',
    raised: '#141922',
    sunken: '#0D1116',
    overlay: '#1A202A',
    ink: '#E9EDF2',
    inkMuted: '#8B95A4',
    accent: '#7CC4FF',
    onAccent: '#06131F',
    active: '#FFB661',
    inactive: '#2A313B',
    success: '#6FD1A6',
    warn: '#FFC978',
    danger: '#FF7B72',
    offline: '#AA737A',
    hairline: '#262D38',
    corners: [4, 8, 14, 22],
    spaceUnit: 8,
    typeScale: 1,
    glowStrength: 1,
    glowRadius: 34,
    density: 'comfortable',
    motion: 'standard',
  },

  /**
   * The mockup's palette, with blue as the colour of *on*.
   *
   * Every shipped skin lights an active device amber and uses blue for chrome.
   * This one swaps them: a lamp that is on glows the mockup's `--blue`
   * (#7CC4FF), and the brand amber (#FFB661, §15) becomes the interactive
   * colour. Same surfaces, same inks — the difference is entirely which of the
   * two the eye reads as "this is doing something".
   *
   * Named for the twilight it looks like, and to sit beside `midnight`.
   *
   * **Why it is worth having as a skin rather than a tweak:** widgets already
   * take both colours from tokens — a brightness track fills with
   * `accent.active` and a warmth track with `accent.primary` — so this repaints
   * every control, chip and indicator in the app without a single widget
   * knowing it happened. That is the styling contract (§5.8) doing its job, and
   * a skin is the cheapest possible test of it.
   */
  blue_hour: {
    name: 'blue_hour',
    brightness: 'dark',
    ground: '#0B0E13',
    raised: '#141922',
    sunken: '#0D1116',
    overlay: '#1A202A',
    ink: '#E9EDF2',
    inkMuted: '#8B95A4',
    // The brand colour, doing brand work.
    accent: '#FFB661',
    onAccent: '#21160A',
    // The colour of a light that is on.
    active: '#7CC4FF',
    inactive: '#2A313B',
    success: '#6FD1A6',
    warn: '#FFC978',
    danger: '#FF7B72',
    offline: '#AA737A',
    hairline: '#262D38',
    corners: [4, 8, 14, 22],
    spaceUnit: 8,
    typeScale: 1,
    glowStrength: 1,
    glowRadius: 34,
    density: 'comfortable',
    motion: 'standard',
    // The focus ring stays blue rather than following the amber accent: it
    // marks where the keyboard is, which is a different question from what the
    // brand is, and blue is the one the eye is already tracking here.
    focus: '#7CC4FF',
  },

  ambient_glass: {
    name: 'ambient_glass',
    brightness: 'dark',
    ground: '#0B0D10',
    raised: '#14181D',
    sunken: '#080A0C',
    overlay: '#161A20',
    ink: '#F2F5F8',
    inkMuted: '#8D97A3',
    accent: '#7CC4FF',
    onAccent: '#06131F',
    active: '#FFB661',
    inactive: '#3A424D',
    success: '#5FD6A2',
    warn: '#FFC978',
    danger: '#FF7B72',
    offline: '#A07680',
    hairline: 'rgba(255,255,255,0.122)',
    corners: [5, 10, 18, 26],
    spaceUnit: 8,
    typeScale: 1.15,
    glowStrength: 1,
    glowRadius: 44,
    density: 'wall',
    motion: 'calm',
    glass: 'frosted',
  },

  control_room: {
    name: 'control_room',
    brightness: 'dark',
    ground: '#08090A',
    raised: '#0F1114',
    sunken: '#050607',
    overlay: '#131619',
    ink: '#E6E9ED',
    inkMuted: '#7A828C',
    accent: '#38BDF8',
    onAccent: '#04141D',
    active: '#FBBF24',
    inactive: '#2A2F35',
    success: '#34D399',
    warn: '#D97706',
    danger: '#F87171',
    offline: '#B3666E',
    hairline: '#1E2126',
    corners: [2, 3, 5, 8],
    spaceUnit: 6,
    typeScale: 0.92,
    glowStrength: 0,
    glowRadius: 0,
    density: 'compact',
    motion: 'crisp',
    metric: {
      temperature: '#FB923C',
      humidity: '#22D3EE',
      illuminance: '#FDE047',
      co2: '#34D399',
      power: '#FBBF24',
      reading: '#38BDF8',
    },
  },

  soft_home: {
    name: 'soft_home',
    brightness: 'light',
    ground: '#F7F4EF',
    raised: '#FFFFFF',
    sunken: '#EFEAE2',
    overlay: '#FFFFFF',
    ink: '#241F1A',
    inkMuted: '#706861',
    accent: '#A65135',
    onAccent: '#FFFFFF',
    active: '#925E11',
    inactive: '#D8D0C6',
    success: '#447359',
    warn: '#915C1C',
    danger: '#C0524B',
    offline: '#936C6F',
    hairline: '#E2DACE',
    corners: [6, 12, 20, 28],
    spaceUnit: 8,
    typeScale: 1,
    glowStrength: 0.35,
    glowRadius: 26,
    density: 'comfortable',
    motion: 'standard',
    glass: 'tinted',
    focus: '#C2603F',
    densityOverride: { rowHeight: 56, controlHeight: 48, minTapTarget: 48, cardPadding: 18 },
    motionOverride: {
      fast: 130,
      base: 260,
      slow: 420,
      curve: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
      emphasized: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      enabled: true,
    },
    metric: {
      temperature: '#803B1E',
      humidity: '#266C87',
      illuminance: '#74570B',
      co2: '#2D7B5B',
      power: '#5C370A',
      reading: '#2F4774',
    },
  },
};

/** The skin a house gets before anyone has chosen one. */
export const defaultSkin = 'midnight';
