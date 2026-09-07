/**
 * Seeds in, all the tokens out — the derivation, ported from
 * hc-web-flutter's `skin_seeds.dart`.
 *
 * **Pure on purpose**, like the layout engine: no DOM, no I/O, every rule
 * callable from a test. `test/tokens.test.ts` asserts each shipped skin rebuilds
 * from its seeds, which is the same claim the Dart test makes and the only thing
 * that keeps two clients rendering one skin the same way.
 *
 * Where Flutter types do not cross over, the CSS equivalent is used and named as
 * such: durations are milliseconds, curves are `cubic-bezier`, shadows are
 * `box-shadow` strings.
 */
import type {
  Brightness,
  DensityTokens,
  MetricTints,
  MotionTokens,
  SkinDensity,
  SkinGlass,
  SkinMotion,
  SkinSeeds,
} from './seeds.js';

export interface TextRole {
  size: number;
  weight: number;
  height: number;
  tracking?: number;
}

export interface TypeTokens {
  family: string;
  monoFamily: string;
  scale: number;
  display: TextRole;
  title: TextRole;
  subtitle: TextRole;
  body: TextRole;
  bodySmall: TextRole;
  caption: TextRole;
  overline: TextRole;
}

export interface Tokens {
  name: string;
  brightness: Brightness;
  surface: {
    base: string;
    raised: string;
    sunken: string;
    overlay: string;
    glassTint: string;
    glassBlur: number;
    onBase: string;
    onBaseMuted: string;
  };
  accent: {
    primary: string;
    onPrimary: string;
    active: string;
    inactive: string;
    success: string;
    warn: string;
    danger: string;
    onDanger: string;
    offline: string;
  };
  stroke: { hairline: string; width: number; focus: string };
  radius: { xs: number; sm: number; md: number; lg: number; pill: number };
  space: { unit: number };
  motion: MotionTokens;
  glow: { strength: number; radius: number };
  density: DensityTokens;
  elevation: { card: string; overlay: string };
  metric: MetricTints;
  text: TypeTokens;
}

/** The whole rule: seeds in, tokens out. */
export function deriveTokens(s: SkinSeeds): Tokens {
  const glass: SkinGlass = s.glass ?? 'none';
  return {
    name: s.name,
    brightness: s.brightness,
    surface: {
      base: s.ground,
      raised: s.raised,
      sunken: s.sunken,
      overlay: s.overlay,
      // Glass is a scattering of whatever light the room has — a white veil on
      // a dark ground, a black one on a light ground — not a colour of its own.
      glassTint:
        glass === 'none'
          ? 'transparent'
          : s.brightness === 'dark'
            ? 'rgba(255,255,255,0.078)'
            : 'rgba(0,0,0,0.039)',
      glassBlur: glass === 'frosted' ? 24 : 0,
      onBase: s.ink,
      onBaseMuted: s.inkMuted,
    },
    accent: {
      primary: s.accent,
      onPrimary: s.onAccent,
      active: s.active,
      inactive: s.inactive,
      success: s.success,
      warn: s.warn,
      danger: s.danger,
      // Same question as onPrimary — text on a saturated fill.
      onDanger: s.onAccent,
      offline: s.offline,
    },
    stroke: { hairline: s.hairline, width: 1, focus: s.focus ?? s.accent },
    radius: deriveRadii(s.corners),
    space: { unit: s.spaceUnit },
    motion: s.motionOverride ?? deriveMotion(s.motion),
    glow: { strength: s.glowStrength, radius: s.glowRadius },
    density: s.densityOverride ?? deriveDensity(s.density),
    elevation: deriveElevation(s),
    metric: s.metric ?? deriveMetrics(s),
    text: deriveType(s.typeScale),
  };
}

export function deriveRadii(c: readonly [number, number, number, number]) {
  return { xs: c[0], sm: c[1], md: c[2], lg: c[3], pill: 999 };
}

export function deriveDensity(d: SkinDensity): DensityTokens {
  switch (d) {
    case 'compact':
      return { rowHeight: 34, controlHeight: 30, minTapTarget: 32, cardPadding: 10 };
    case 'comfortable':
      return { rowHeight: 52, controlHeight: 44, minTapTarget: 44, cardPadding: 14 };
    case 'wall':
      return { rowHeight: 64, controlHeight: 52, minTapTarget: 56, cardPadding: 20 };
  }
}

/** No overshoot on `crisp` anywhere: an instrument does not bounce. */
export function deriveMotion(m: SkinMotion): MotionTokens {
  const easeOut = 'cubic-bezier(0, 0, 0.58, 1)';
  const easeOutCubic = 'cubic-bezier(0.215, 0.61, 0.355, 1)';
  const easeOutBack = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  switch (m) {
    case 'crisp':
      return { fast: 90, base: 140, slow: 220, curve: easeOut, emphasized: easeOut, enabled: true };
    case 'standard':
      return {
        fast: 140,
        base: 260,
        slow: 460,
        curve: easeOutCubic,
        emphasized: easeOutBack,
        enabled: true,
      };
    case 'calm':
      return {
        fast: 160,
        base: 320,
        slow: 620,
        curve: easeOutCubic,
        emphasized: easeOutBack,
        enabled: true,
      };
  }
}

/**
 * Card and overlay shadows.
 *
 * A skin with no bloom gets no card shadow at all — that is what makes Control
 * Room read as flat panels rather than floating ones — but it still gets an
 * overlay shadow, because a modal has to separate from the page whatever the
 * skin thinks about depth.
 */
export function deriveElevation(s: SkinSeeds): { card: string; overlay: string } {
  if (s.glowStrength === 0) {
    return { card: 'none', overlay: '0 8px 24px rgba(0,0,0,0.8)' };
  }
  if (s.brightness === 'light') {
    // A light ground needs two: a tight contact shadow so the card meets the
    // page, and a wide soft one for depth. One blur on a light ground reads as
    // a grey smudge.
    return {
      card: '0 1px 2px rgba(0,0,0,0.078), 0 8px 18px rgba(0,0,0,0.059)',
      overlay: '0 18px 40px rgba(0,0,0,0.122)',
    };
  }
  // A frosted panel sits further off its wall than a card sits off a desk.
  const deep = (s.glass ?? 'none') === 'frosted';
  return {
    card: deep ? '0 12px 32px rgba(0,0,0,0.4)' : '0 8px 20px rgba(0,0,0,0.349)',
    overlay: deep ? '0 20px 48px rgba(0,0,0,0.6)' : '0 18px 40px rgba(0,0,0,0.549)',
  };
}

/**
 * Sensor hues.
 *
 * Three of the six have a rule and hold it in every dark skin: what a device
 * draws is the *on* colour, what a sensor reads is the information colour, and
 * air quality is the same green as success. The other three are their own hues
 * — temperature is warm, humidity cool, light yellow — and no accent implies
 * them.
 */
export function deriveMetrics(s: SkinSeeds): MetricTints {
  return {
    temperature: '#FF8A5B',
    humidity: '#4CC9F0',
    illuminance: '#FFD166',
    co2: s.success,
    power: s.active,
    reading: s.accent,
  };
}

/** One number sizes the whole ramp — 28 fields from `typeScale`. */
export function deriveType(scale: number): TypeTokens {
  const r = (size: number, weight: number, height: number, tracking?: number): TextRole => ({
    size: size * scale,
    weight,
    height,
    ...(tracking !== undefined ? { tracking } : {}),
  });
  return {
    family: 'Inter',
    monoFamily: 'JetBrains Mono',
    scale,
    display: r(26, 700, 1.05),
    title: r(16, 600, 1.2),
    subtitle: r(14, 600, 1.3),
    body: r(13, 400, 1.4),
    bodySmall: r(12.5, 400, 1.4),
    caption: r(11, 500, 1.35),
    overline: r(10, 600, 1.2, 1.1),
  };
}

/**
 * Rescale a corner ramp from its `md` handle, keeping the skin's proportions.
 *
 * `md` is the handle because it is the card radius — the one a person is looking
 * at while they drag it. A skin already at zero has no proportions left to keep,
 * so it falls back to a plausible ramp rather than multiplying zero by anything.
 */
export function scaleCorners(
  corners: readonly [number, number, number, number],
  md: number,
): [number, number, number, number] {
  if (corners[2] <= 0) return [md * 0.3, md * 0.6, md, md * 1.4];
  const k = md / corners[2];
  const r = (v: number) => Math.round(v * k);
  return [r(corners[0]), r(corners[1]), Math.round(md), r(corners[3])];
}
