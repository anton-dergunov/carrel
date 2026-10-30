// A squarified treemap (Bruls, Huizing and van Wijk, 2000): rectangles whose areas are
// proportional to their values, laid in rows that keep each as near a square as they can, so a
// label fits and the eye compares them. Pure: the view (areas.js) draws what this returns.

/**
 * Lays `items` ({value, last?, …}) out in `rect` ({x, y, width, height}), the largest first and
 * an item marked `last` after all the others, whatever its size (the rest, merged). Returns
 * [{item, x, y, width, height}], which fill the rectangle; items of no value are left out.
 */
export function squarify(items, rect) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  if (!total || rect.width <= 0 || rect.height <= 0) return [];
  const scale = (rect.width * rect.height) / total;
  const queue = items
    .filter((item) => item.value > 0)
    .sort((a, b) => Number(Boolean(a.last)) - Number(Boolean(b.last)) || b.value - a.value)
    .map((item) => ({ item, area: item.value * scale }));
  const free = { ...rect };
  const placed = [];
  let row = [];
  for (const entry of queue) {
    const side = Math.min(free.width, free.height);
    if (!row.length || worst([...row, entry], side) <= worst(row, side)) {
      row.push(entry);
    } else {
      placeRow(row, free, placed);
      row = [entry];
    }
  }
  if (row.length) placeRow(row, free, placed, true);
  return placed;
}

/** The worst aspect ratio in a row of areas laid along a side of length `side`. */
function worst(row, side) {
  const sum = row.reduce((total, entry) => total + entry.area, 0);
  let largest = 0;
  let smallest = Infinity;
  for (const { area } of row) {
    largest = Math.max(largest, area);
    smallest = Math.min(smallest, area);
  }
  return Math.max((side * side * largest) / (sum * sum), (sum * sum) / (side * side * smallest));
}

/** Lays a row along the shorter side of what is free, and takes it off what is free. */
function placeRow(row, free, placed, last = false) {
  const sum = row.reduce((total, entry) => total + entry.area, 0);
  if (free.width >= free.height) {
    // A column at the left.
    const width = last ? free.width : sum / free.height;
    let y = free.y;
    row.forEach((entry, i) => {
      const height = i === row.length - 1 ? free.y + free.height - y : entry.area / width;
      placed.push({ item: entry.item, x: free.x, y, width, height });
      y += height;
    });
    free.x += width;
    free.width -= width;
  } else {
    // A row along the top.
    const height = last ? free.height : sum / free.width;
    let x = free.x;
    row.forEach((entry, i) => {
      const width = i === row.length - 1 ? free.x + free.width - x : entry.area / height;
      placed.push({ item: entry.item, x, y: free.y, width, height });
      x += width;
    });
    free.y += height;
    free.height -= height;
  }
}

/**
 * The largest items that can each be named, and the rest merged into one: lays out the k
 * largest of `items` with `merge(rest)` beside them, using `place(items)`, which returns tiles
 * ({item, …}), for the largest k at which `fits(tile)` holds for every tile, the merged one too.
 * Merging a single item would only rename it, so the rest is never one item. Returns the tiles
 * and k; when not even the largest item and the rest fit, k is 0 and the tiles are all of them.
 */
export function keepLargest(items, place, fits, merge) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  for (let k = sorted.length; k >= 1; k--) {
    if (sorted.length - k === 1) continue;
    const rest = sorted.slice(k);
    const tiles = place(rest.length ? [...sorted.slice(0, k), merge(rest)] : sorted);
    if (tiles.every(fits)) return { tiles, kept: k };
  }
  return { tiles: place(sorted), kept: 0 };
}
