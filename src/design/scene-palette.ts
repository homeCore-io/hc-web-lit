/**
 * The light a scene paints a room in.
 *
 * **The bridge does not tell us.** A Hue scene arrives with a name, an area,
 * whether it is active, and three resource ids — and nothing at all about what
 * it looks like. Checked against the reference house's 58 scenes: not one
 * carries a colour. So the name is the only evidence there is, and this is a
 * table of what the names mean, ported from the Flutter client's
 * `hc_scene_chip.dart` so a household that knows these chips still recognises
 * them.
 *
 * **Every scene gets a colour, not only the ones in the table.** The Flutter
 * version returns nothing for a name it does not know, which leaves a chip
 * with no dot beside eleven that have one — and the odd one out reads as
 * broken rather than as unknown. A name that is not in the table gets a hue
 * derived from the name itself: stable, so a scene is the same colour every
 * time and in every room, distinct enough to tell two apart, and honestly
 * arbitrary. Better a consistent guess than a hole in a row.
 *
 * Not tokens, and deliberately: these are the colours of light in a room, and
 * they mean the same thing on every skin — the same reasoning the warmth strip
 * and the colour wheel are written under. A skin tints the chip around them.
 */

export interface ScenePalette {
  /** The dot, and what a hover glows. */
  dot: string;
  /** The orb, deep to bright — a scene is a wash, not a single colour. */
  gradient: readonly string[];
}

/**
 * What a name means, matched as a substring so "Spring blossom" finds
 * "blossom" and "Savanna sunset" finds "savanna".
 *
 * Longest key first at lookup, so "nightlight" is not claimed by "light".
 */
const PALETTES: Record<string, ScenePalette> = {
  relax: { dot: '#ffb661', gradient: ['#ffb661', '#ff8a5b', '#e24c4c'] },
  read: { dot: '#ffc97a', gradient: ['#ffe3b0', '#ffc97a', '#ff9a5b'] },
  concentrate: { dot: '#bcd8ff', gradient: ['#eaf2ff', '#9dc4ff', '#7cc4ff'] },
  // **Not Flutter's #5be0c0.** That is the same mint it gives "aurora", so the
  // two chips were indistinguishable in a row that has both — and it did not
  // match energize's own gradient, which is icy blue almost all the way. The
  // dot now says what the scene looks like and tells the pair apart at once.
  energize: { dot: '#7fd4ff', gradient: ['#dff6ff', '#7cc4ff', '#4ce0d0'] },
  nightlight: { dot: '#c25a3a', gradient: ['#c25a3a', '#7a3b2a', '#3a2018'] },
  bright: { dot: '#ffffff', gradient: ['#ffffff', '#e9edf2', '#bfc7d2'] },
  dimmed: { dot: '#b79a6a', gradient: ['#6b5b45', '#4a3f30'] },
  savanna: { dot: '#ff6b4a', gradient: ['#ff9a5b', '#e24c4c', '#b03050'] },
  aurora: { dot: '#5be0c0', gradient: ['#5be0c0', '#4c9ee2', '#7c6bff'] },
  blossom: { dot: '#ff9ec4', gradient: ['#ff9ec4', '#e24c9e', '#b03050'] },
  twilight: { dot: '#b98bff', gradient: ['#b98bff', '#ff8abf', '#ff8a5b'] },
  mountain: { dot: '#bcdcff', gradient: ['#bcdcff', '#7c9ee2', '#5b6be0'] },
  'on air': { dot: '#ff5b5b', gradient: ['#ff5b5b', '#b03030'] },
  sunset: { dot: '#ff8a5b', gradient: ['#ffc97a', '#ff6b4a', '#a8325c'] },
  sunrise: { dot: '#ffd0a0', gradient: ['#fff0d8', '#ffc07a', '#ff8a6b'] },
  tropical: { dot: '#4ce0d0', gradient: ['#b9ffe8', '#4ce0d0', '#3d7bff'] },
  spring: { dot: '#9ee6a0', gradient: ['#e8ffd8', '#9ee6a0', '#4cc27a'] },
  forest: { dot: '#4cc27a', gradient: ['#9ee6a0', '#4cc27a', '#1e6b46'] },
  ocean: { dot: '#4c9ee2', gradient: ['#a8dcff', '#4c9ee2', '#1e4b8f'] },
  arctic: { dot: '#cfeaff', gradient: ['#ffffff', '#cfeaff', '#7cc4ff'] },
  candle: { dot: '#ff9a4a', gradient: ['#ffcf9a', '#ff9a4a', '#a8501e'] },
  movie: { dot: '#7c6bff', gradient: ['#b98bff', '#7c6bff', '#2a1e6b'] },
  party: { dot: '#ff4ca8', gradient: ['#ff4ca8', '#7c6bff', '#4ce0d0'] },
  off: { dot: '#5d6675', gradient: ['#5d6675', '#2a2f3a'] },
};

/** Longest key first, so a specific name beats a word inside it. */
const KEYS = Object.keys(PALETTES).sort((a, b) => b.length - a.length);

/**
 * A stable hue for a name nobody wrote a palette for.
 *
 * FNV-1a, because it needs to be the same on every device and every reload and
 * that is all it needs to be. Kept off the reds and greys by construction: the
 * saturation and lightness are fixed, so an invented colour still looks like it
 * belongs beside the written ones rather than like a random swatch.
 */
function derived(name: string): ScenePalette {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hue = h % 360;
  return {
    dot: `hsl(${hue} 62% 66%)`,
    gradient: [`hsl(${hue} 70% 76%)`, `hsl(${hue} 62% 60%)`, `hsl(${(hue + 28) % 360} 55% 42%)`],
  };
}

/** The palette for a scene called this. Never absent. */
export function paletteFor(name: string): ScenePalette {
  const n = name.toLowerCase();
  for (const key of KEYS) {
    const found = PALETTES[key];
    if (found !== undefined && n.includes(key)) return found;
  }
  return derived(n);
}

/**
 * The orb, as a CSS value: a lit sphere in the scene's own colour.
 *
 * **The dot holds most of the area, and the gradient only trims it.** Running
 * the three stops evenly across the circle let the last one take the rim,
 * which is most of what the eye sees — so "Tropical twilight" (purple, through
 * pink, to orange) and "Spring blossom" (pink) both came out pink, and two
 * scenes a person picks between looked alike. The dot is what a scene is
 * recognised by; the deep stop is a shadow on it, not a second identity.
 */
export function orbFor(name: string): string {
  const { dot, gradient } = paletteFor(name);
  const deep = gradient.at(-1) ?? dot;
  return (
    `radial-gradient(circle at 32% 28%, ` +
    `color-mix(in srgb, #fff 42%, ${dot}), ` +
    `${dot} 58%, ` +
    `color-mix(in srgb, ${deep} 70%, ${dot}))`
  );
}

/** Exported so a test can pin that the table is reachable and complete. */
export function paletteNames(): string[] {
  return [...KEYS];
}
