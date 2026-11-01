// The area map: a squarified treemap (Bruls, Huizing and van Wijk, 2000) of topics, two levels
// deep, every tile named with its count or merged into "+N more". Pure: text is measured by the
// `measure(text, size, weight)` the caller passes (areas.js measures with the page's font), and
// areas.js draws what this returns.

const number = new Intl.NumberFormat('en');

/**
 * Lays `items` ({value, last?, …}) out in `rect` ({x, y, width, height}), the largest first and
 * an item marked `last` after all the others, whatever its size (the rest, merged). Returns
 * [{item, x, y, width, height}], which fill the rectangle; items of no value are left out.
 *
 * A row takes the next item while that leaves its worst aspect ratio at most `tolerance` times
 * what it was: 1 is the paper's rule; other values break the rows elsewhere. With `fits(tile)`,
 * the labels decide first: a row takes the next item when that leaves fewer of its tiles too
 * small for their label (a column grows wider as it takes more), and closes when taking it
 * would leave more.
 */
export function squarify(items, rect, { tolerance = 1, fits = null } = {}) {
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
    let grow = !row.length || worst([...row, entry], side) <= tolerance * worst(row, side);
    if (fits && row.length) {
      const now = unfit(row, free, fits);
      const next = unfit([...row, entry], free, fits);
      if (next !== now) grow = next < now;
    }
    if (grow) {
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

/** How many of a row's tiles, laid in what is free, `fits` finds too small. */
function unfit(row, free, fits) {
  return layRow(row, free).filter((tile) => !fits(tile)).length;
}

/** A row's tiles along the shorter side of what is free (all of it, when `last`). */
function layRow(row, free, last = false) {
  const sum = row.reduce((total, entry) => total + entry.area, 0);
  const tiles = [];
  if (free.width >= free.height) {
    // A column at the left.
    const width = last ? free.width : sum / free.height;
    let y = free.y;
    row.forEach((entry, i) => {
      const height = i === row.length - 1 ? free.y + free.height - y : entry.area / width;
      tiles.push({ item: entry.item, x: free.x, y, width, height });
      y += height;
    });
  } else {
    // A row along the top.
    const height = last ? free.height : sum / free.width;
    let x = free.x;
    row.forEach((entry, i) => {
      const width = i === row.length - 1 ? free.x + free.width - x : entry.area / height;
      tiles.push({ item: entry.item, x, y: free.y, width, height });
      x += width;
    });
  }
  return tiles;
}

/** Lays a row, and takes it off what is free. */
function placeRow(row, free, placed, last = false) {
  const tiles = layRow(row, free, last);
  placed.push(...tiles);
  if (free.width >= free.height) {
    const width = tiles[0].width;
    free.x += width;
    free.width -= width;
  } else {
    const height = tiles[0].height;
    free.y += height;
    free.height -= height;
  }
}

/** How far a tile is from a square: its longer side over its shorter. */
export function stretch(tile) {
  return Math.max(tile.width / tile.height, tile.height / tile.width);
}

/**
 * The largest items that can each be named, and the rest merged into one: lays out the k
 * largest of `items` with `merge(rest)` beside them, for the largest k at which `fits(tile)`
 * holds for every tile, the merged one too. `place(items)` returns candidate layouts (lists of
 * tiles {item, x, y, width, height}); of those that fit, the one whose most stretched tile is
 * the least stretched is kept. Merging a single item would only rename it, so the rest is never
 * one item. Returns the tiles and k; when nothing fits, k is 0 and the tiles are the first
 * candidate for all of them.
 */
export function keepLargest(items, place, fits, merge) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  for (let k = sorted.length; k >= 1; k--) {
    if (sorted.length - k === 1) continue;
    const rest = sorted.slice(k);
    let best = null;
    for (const tiles of place(rest.length ? [...sorted.slice(0, k), merge(rest)] : sorted)) {
      if (!tiles.every(fits)) continue;
      const most = Math.max(...tiles.map(stretch));
      if (!best || most < best.most) best = { tiles, most };
    }
    if (best) return { tiles: best.tiles, kept: k };
  }
  return { tiles: place(sorted)[0], kept: 0 };
}

// The nodes.

/** A tile of its own for the papers filed in a topic itself, beside its subtopics, once they are this share of it. */
export const OWN_SHARE = 0.05;

/**
 * The topics under `root` ('' for the whole library) as the map's nodes, two levels deep:
 * {value, path, name, own?, children}. `topics` are the library's ({path, count, total}),
 * `name(path)` what a tile says. The papers filed in a topic itself, when it has subtopics too,
 * become a node of their own named "general" (`own`), if they are at least OWN_SHARE of it.
 */
export function mapNodes(topics, root, name) {
  const under = (path) => {
    const depth = path ? path.split('/').length + 1 : 1;
    return topics.filter((topic) => topic.path.split('/').length === depth && (!path || topic.path.startsWith(`${path}/`)));
  };
  const own = (topic, children) =>
    children.length && topic.count > 0 && topic.count >= OWN_SHARE * topic.total
      ? [{ value: topic.count, path: topic.path, name: 'general', own: true, children: [] }]
      : [];
  const node = (topic, deeper) => {
    const children = deeper ? under(topic.path).map((child) => node(child, false)) : [];
    return { value: topic.total, path: topic.path, name: name(topic.path), children: [...children, ...(deeper ? own(topic, children) : [])] };
  };
  const nodes = under(root).map((topic) => node(topic, true));
  const self = root ? topics.find((topic) => topic.path === root) : null;
  return self ? [...nodes, ...own(self, nodes)] : nodes;
}

// The labels.
//
// A label is measured before it is drawn, so it is never cut: the name wraps between words,
// never inside one, at the largest size from its own down to 11 px at which it fits; the count
// follows on the name's last line when there is room, else on a line of its own. A label that
// does not fit at 11 px is not drawn, and its tile is merged. The sizes are at the library's text
// size of 17 px, and scale with it (`scale`).

export const TOP_TEXT = { size: 15, weight: 600, count: 12 };
export const SUB_TEXT = { size: 13.5, weight: 400, count: 11.5 };
export const SMALLEST_TEXT = 11;
const LINE = 1.2;
const MOST_LINES = 3;
const SAFETY = 4; // px: the canvas measures a little narrower than WebKit draws

/** The lines `words` wrap into at `width` px, or null when a word alone is wider. */
function wrap(words, width, size, weight, measure) {
  const lines = [];
  let line = '';
  for (const word of words) {
    if (measure(word, size, weight) > width) return null;
    const longer = line ? `${line} ${word}` : word;
    if (line && measure(longer, size, weight) > width) {
      lines.push(line);
      line = word;
    } else {
      line = longer;
    }
  }
  lines.push(line);
  return lines;
}

/** `text` (TOP_TEXT or SUB_TEXT) at the text scale `scale`, with the smallest size it may fall to. */
export function scaledText(text, scale = 1) {
  return { ...text, size: text.size * scale, count: text.count * scale, smallest: SMALLEST_TEXT * scale };
}

/** How a label of {name, count} fits in `width` × `height` px: {size, countSize, below, height, said}, or null. */
export function fitLabel({ name, count }, width, height, text, measure) {
  const said = { name, count };
  width -= SAFETY;
  if (width <= 0 || height <= 0) return null;
  for (let size = text.size; size >= (text.smallest ?? SMALLEST_TEXT); size -= 0.5) {
    const countSize = Math.min(text.count, size);
    const lines = wrap(name.split(' '), width, size, text.weight, measure);
    if (!lines || lines.length > MOST_LINES) continue;
    const countWidth = measure(count, countSize, 400) + 6;
    const below = measure(lines.at(-1), size, text.weight) + countWidth > width;
    const needed = lines.length * size * LINE + (below ? countSize * LINE : 0);
    if (needed <= height) return { size, countSize, below, height: needed, said };
  }
  return null;
}

/** What a tile says: its name, or for a merged one "+N more" (and `more`, "areas" at the top), then the count. */
export function tileText(item, more = '') {
  const count = number.format(item.value);
  if (!item.merged) return { name: item.name, count };
  return { name: `+${item.members.length} more${more ? ` ${more}` : ''}`, count };
}

// The layout.

const GUTTER = 3;
const PAD = { x: 8, y: 5 }; // a label's padding inside its tile
const SUB_PAD = { x: 6, y: 4 };
const TOLERANCES = [1, 0.8, 1.3, 0.6, 1.7];

// The rest, merged: laid out last, in the corner where the smallest tiles are.
const merge = (members) => ({ merged: true, last: true, members, value: members.reduce((sum, item) => sum + item.value, 0), children: [] });

/**
 * The tiles to draw for `nodes` (from mapNodes) in `rect`: each with its label and, inside a
 * tile large enough, its children below the label. Tiles that cannot hold a label are merged, at
 * each level; a merged tile at the top says `more` after "+N more". Returns {tiles, named, of,
 * inner, innerOf, smallest}: the tiles ({item, x, y, width, height, label, children: [tile]}),
 * how many of the nodes are named, how many of their children are named inside them, and the
 * smallest label's size.
 */
export function layoutTreemap(nodes, rect, { measure, more = '', scale = 1 }) {
  const topText = scaledText(TOP_TEXT, scale);
  const subText = scaledText(SUB_TEXT, scale);
  const half = GUTTER / 2;
  const inset = (tile) => ({ ...tile, x: tile.x + half, y: tile.y + half, width: Math.max(0, tile.width - GUTTER), height: Math.max(0, tile.height - GUTTER) });
  // Each tolerance, with the labels deciding the rows and without.
  const candidates = (items, area, fits) =>
    TOLERANCES.flatMap((tolerance) => [squarify(items, area, { tolerance, fits: (tile) => fits(inset(tile)) }), squarify(items, area, { tolerance })]).map((tiles) => tiles.map(inset));
  const topLabel = (tile, height = tile.height) => fitLabel(tileText(tile.item, more), tile.width - 2 * PAD.x, height - 2 * PAD.y, topText, measure);
  const subLabel = (child) => fitLabel(tileText(child.item), child.width - 2 * SUB_PAD.x, child.height - 2 * SUB_PAD.y, subText, measure);
  const topFits = (tile) => topLabel(tile) !== null;
  const subFits = (child) => subLabel(child) !== null;
  const { tiles: tops, kept } = keepLargest(nodes, (items) => candidates(items, rect, topFits), topFits, merge);
  let inner = 0;
  const tiles = tops.map((tile) => {
    const alone = { ...tile, label: topLabel(tile), children: [] };
    const children = tile.item.children ?? [];
    if (children.length < 2 || tile.width < 110 || tile.height < 90) return alone;
    // The header takes what its label needs, at most a third of the tile.
    const label = topLabel(tile, Math.max(30, tile.height / 3));
    if (!label) return alone;
    const header = label.height + 2 * PAD.y;
    const area = { x: tile.x + half, y: tile.y + header, width: tile.width - GUTTER, height: tile.height - header - half };
    const laid = keepLargest(children, (items) => candidates(items, area, subFits), subFits, merge);
    // Not even one child can be named: the tile shows its own label alone.
    if (!laid.kept) return alone;
    inner += laid.kept;
    return { ...tile, label, children: laid.tiles.map((child) => ({ ...child, label: subLabel(child) })) };
  });
  const labels = tiles.flatMap((tile) => [tile.label, ...tile.children.map((child) => child.label)]).filter(Boolean);
  return {
    tiles,
    named: kept,
    of: nodes.length,
    inner,
    innerOf: nodes.reduce((sum, node) => sum + (node.children?.length ?? 0), 0),
    smallest: labels.length ? Math.min(...labels.map((label) => label.size)) : null,
  };
}

/**
 * The layout of `nodes` at `width`, as short as it can be: the least height from `min` (in
 * steps of `step`) up to `max` at which it names as many tiles, at both levels, as at `max`,
 * with labels no smaller than there (or 13 px, scaled). Returns layoutTreemap's answer with its height.
 */
export function layoutToFit(nodes, width, { min, max, step = 20, ...options }) {
  const full = layoutTreemap(nodes, { x: 0, y: 0, width, height: max }, options);
  const named = full.named + full.inner;
  const size = Math.min(full.smallest ?? 0, 13 * (options.scale ?? 1));
  for (let height = min; height < max; height += step) {
    const laid = layoutTreemap(nodes, { x: 0, y: 0, width, height }, options);
    if (laid.named + laid.inner >= named && (laid.smallest ?? 0) >= size) return { ...laid, height };
  }
  return { ...full, height: max };
}
