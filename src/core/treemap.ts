/**
 * Squarified treemap — the house as a field of rooms.
 *
 * `room_field`. Each room is a cell sized by how many devices it holds, and the
 * page's own caption says what it means: *"Brighter is more of it on · 157
 * devices in 15 rooms · 32 in none · tap one to open it"*.
 *
 * **Squarified rather than sliced** because the cells are targets. A naive
 * slice-and-dice treemap produces long thin slivers, and a sliver is both hard
 * to read a room name in and hard to tap. This is Bruls–Huizing–van Wijk: build
 * a row while adding the next item improves its worst aspect ratio, then lay
 * that row along the shorter side and recurse into what is left.
 *
 * Pure, and separate from the widget, so the arithmetic is testable without a
 * layout engine — which matters because the failure mode is subtle: a treemap
 * with a bug still looks like a treemap.
 */

export interface Weighted {
  /** Relative area. Zero-weight items are dropped rather than given slivers. */
  value: number;
}

export interface Cell<T> {
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Sized<T> {
  item: T;
  area: number;
}

/**
 * The worst aspect ratio in a row, given the side it will be laid along.
 *
 * Lower is squarer. `Infinity` for an empty row so the first item always joins.
 */
function worst<T>(row: readonly Sized<T>[], side: number): number {
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const r of row) {
    sum += r.area;
    if (r.area > max) max = r.area;
    if (r.area < min) min = r.area;
  }
  if (sum === 0) return Infinity;
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/** Lay one finished row along the shorter side, and return what is left. */
function place<T>(
  row: readonly Sized<T>[],
  x: number,
  y: number,
  w: number,
  h: number,
): { cells: Cell<T>[]; x: number; y: number; w: number; h: number } {
  const sum = row.reduce((a, r) => a + r.area, 0);
  const cells: Cell<T>[] = [];

  if (w >= h) {
    const thickness = h === 0 ? 0 : sum / h;
    let oy = y;
    for (const r of row) {
      const ch = thickness === 0 ? 0 : r.area / thickness;
      cells.push({ item: r.item, x, y: oy, w: thickness, h: ch });
      oy += ch;
    }
    return { cells, x: x + thickness, y, w: w - thickness, h };
  }

  const thickness = w === 0 ? 0 : sum / w;
  let ox = x;
  for (const r of row) {
    const cw = thickness === 0 ? 0 : r.area / thickness;
    cells.push({ item: r.item, x: ox, y, w: cw, h: thickness });
    ox += cw;
  }
  return { cells, x, y: y + thickness, w, h: h - thickness };
}

/**
 * Lay items out in a `width` × `height` box, largest first.
 *
 * The order is by weight rather than by name: a treemap that reordered as
 * rooms changed would move every cell whenever one light came on, and these
 * are things people learn the position of.
 */
export function squarify<T extends Weighted>(
  items: readonly T[],
  width: number,
  height: number,
): Cell<T>[] {
  if (width <= 0 || height <= 0) return [];

  const sized = items
    .filter((i) => i.value > 0)
    .map((item) => ({ item, area: 0 }))
    .sort((a, b) => b.item.value - a.item.value);
  if (sized.length === 0) return [];

  const total = sized.reduce((a, r) => a + r.item.value, 0);
  for (const r of sized) r.area = (r.item.value * width * height) / total;

  const out: Cell<T>[] = [];
  const queue = [...sized];
  let row: Sized<T>[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;

  while (queue.length > 0) {
    const side = Math.min(w, h);
    const next = queue[0]!;
    // Add while it makes the row squarer; otherwise close the row and recurse
    // into the rectangle that is left.
    if (row.length === 0 || worst([...row, next], side) <= worst(row, side)) {
      row.push(next);
      queue.shift();
    } else {
      const laid = place(row, x, y, w, h);
      out.push(...laid.cells);
      ({ x, y, w, h } = laid);
      row = [];
    }
  }
  if (row.length > 0) out.push(...place(row, x, y, w, h).cells);

  return out;
}
