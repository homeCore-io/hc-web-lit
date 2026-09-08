/**
 * Contrast, computed the way the CSS composites it.
 *
 * The widgets paint marks with `color-mix()` against skin tokens, which is a
 * promise rather than a result: a mix lands wherever a particular skin's
 * surfaces happen to be, and a tile that reads on a near-black ground can
 * vanish on a pale one. Five skins ship and one of them is light, so "it looks
 * right" means "it looked right in `midnight`" unless something checks.
 *
 * Measured in a browser first, which found the real numbers; this is the same
 * arithmetic so the check can be a test instead of a thing somebody remembers
 * to do before adding a skin.
 *
 * sRGB mixing, matching `color-mix(in srgb, …)` — Chrome's default for that
 * function and what the stylesheets ask for.
 */

/** `#rgb`, `#rrggbb`, or `rgb(r, g, b)` → 0–1 channels. */
export function parseColour(c: string): [number, number, number] | undefined {
  const hex = c.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const [r, g, b] = [...hex].map((ch) => parseInt(ch + ch, 16) / 255);
    return [r!, g!, b!];
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  const nums = c.match(/[\d.]+/g);
  if (nums === null || nums.length < 3) return undefined;
  return [Number(nums[0]) / 255, Number(nums[1]) / 255, Number(nums[2]) / 255];
}

/** `color-mix(in srgb, a pct%, b)` — `pct` of the first, the rest of the second. */
export function mix(a: string, b: string, pct: number): [number, number, number] | undefined {
  const x = parseColour(a);
  const y = parseColour(b);
  if (x === undefined || y === undefined) return undefined;
  const w = Math.min(1, Math.max(0, pct / 100));
  return [x[0] * w + y[0] * (1 - w), x[1] * w + y[1] * (1 - w), x[2] * w + y[2] * (1 - w)];
}

/** WCAG relative luminance. */
export function luminance(rgb: readonly [number, number, number]): number {
  const f = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * f[0]! + 0.7152 * f[1]! + 0.0722 * f[2]!;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(
  a: string | readonly [number, number, number],
  b: string | readonly [number, number, number],
): number {
  const x = typeof a === 'string' ? parseColour(a) : a;
  const y = typeof b === 'string' ? parseColour(b) : b;
  if (x === undefined || y === undefined) return 0;
  const la = luminance(x);
  const lb = luminance(y);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG's two floors: body text, and anything that is a shape. */
export const READABLE = 4.5;
export const VISIBLE = 3;
