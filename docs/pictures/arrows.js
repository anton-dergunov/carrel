// Arrows over a picture, from one place in a capture to another, with a tap or a click drawn where
// it starts. scripts/pictures.py writes captures/marks.js: for each capture, the size of the screen
// it was taken at and the boxes of the places it named. A capture is the <img data-capture="NAME">
// of the picture; a place is "NAME:KEY".
//
//   arrow('reading-ipad:link', 'reading-ipad:mark', { from: 'left', to: 'right', bend: 0.3, start: 'tap' })
//
// `from` and `to` pick a side of the box (left, right, top, bottom; the centre by default), `bend`
// curves the arrow (its sign picks the side), `start` draws a finger's tap or a pointer's click.
//
// The hand and the pointer are Lucide's "pointer" and "mouse-pointer-2" (Lucide 1.55.0, ISC
// licence, "Copyright (c) 2026 Lucide Icons and Contributors"), as carrel's own icons are.

const INK = '#d9480f';
const HAND = [
  'M22 14a8 8 0 0 1-8 8',
  'M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
  'M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1',
  'M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10',
  'M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
];
const POINTER =
  'M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z';

const SVG = 'http://www.w3.org/2000/svg';
let layer;

function svg(name, attributes, parent = layer) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  parent.append(node);
  return node;
}

function ensureLayer() {
  if (layer) return;
  layer = svg('svg', { class: 'arrows', width: document.body.scrollWidth, height: document.body.scrollHeight }, document.body);
  const defs = svg('defs', {});
  for (const [id, colour, size] of [['head-halo', '#ffffff', 7], ['head', INK, 5]]) {
    const marker = svg('marker', { id, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: size, markerHeight: size, orient: 'auto-start-reverse', markerUnits: 'strokeWidth' }, defs);
    svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: colour }, marker);
  }
}

/** Where a place is on the picture, in the page's px: a side of its box, or its centre. */
function at(place, side) {
  const [name, key] = place.split(':');
  const capture = window.MARKS?.[name];
  const box = capture?.marks?.[key];
  const image = document.querySelector(`img[data-capture="${name}"]`);
  if (!box || !image) throw new Error(`no place ${place}`);
  const shown = image.getBoundingClientRect();
  const scale = shown.width / capture.size[0];
  const [x, y, w, h] = box;
  const left = shown.left + x * scale, top = shown.top + y * scale, width = w * scale, height = h * scale;
  const sides = {
    left: [left - 3, top + height / 2],
    right: [left + width + 3, top + height / 2],
    top: [left + width / 2, top - 3],
    bottom: [left + width / 2, top + height + 3],
  };
  const [px, py] = sides[side] ?? [left + width / 2, top + height / 2];
  return { x: px + window.scrollX, y: py + window.scrollY };
}

function arrow(fromPlace, toPlace, { from, to, bend = 0.25, start } = {}) {
  ensureLayer();
  const a = at(fromPlace, from);
  const b = at(toPlace, to);
  const dx = b.x - a.x, dy = b.y - a.y;
  const c = { x: (a.x + b.x) / 2 - dy * bend, y: (a.y + b.y) / 2 + dx * bend };
  const d = `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
  svg('path', { d, fill: 'none', stroke: '#ffffff', 'stroke-width': 7, 'stroke-linecap': 'round', 'marker-end': 'url(#head-halo)' });
  svg('path', { d, fill: 'none', stroke: INK, 'stroke-width': 3.2, 'stroke-linecap': 'round', 'marker-end': 'url(#head)' });
  // The tap or the click is drawn just under the place it starts from, so the link stays readable.
  if (start === 'tap') tap(at(fromPlace, 'bottom'));
  if (start === 'click') click(at(fromPlace, 'bottom'));
}

/** A finger's tap: a ring where it touched, and the hand, its fingertip there. */
function tap({ x, y }) {
  svg('circle', { cx: x, cy: y, r: 9, fill: 'none', stroke: INK, 'stroke-width': 2.5 });
  // The pointing finger's tip is at (8, 2) of Lucide's 24-unit square.
  const hand = svg('g', { transform: `translate(${x - 8 * 1.3}, ${y - 2 * 1.3}) scale(1.3)` });
  for (const d of HAND) svg('path', { d, fill: 'none', stroke: '#ffffff', 'stroke-width': 4.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, hand);
  for (const d of HAND) svg('path', { d, fill: 'none', stroke: '#1d1d1f', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, hand);
}

/** A pointer's click: a ring where it clicked, and the pointer, its tip there. */
function click({ x, y }) {
  svg('circle', { cx: x, cy: y, r: 9, fill: 'none', stroke: INK, 'stroke-width': 2.5 });
  // The pointer's tip is at (4, 4) of Lucide's 24-unit square.
  const pointer = svg('g', { transform: `translate(${x - 4 * 1.2}, ${y - 4 * 1.2}) scale(1.2)` });
  svg('path', { d: POINTER, fill: '#1d1d1f', stroke: '#ffffff', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, pointer);
}

window.arrow = arrow;
