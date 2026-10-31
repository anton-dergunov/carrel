// The library's Map view: its papers laid out by what they are about (GET /api/map), drawn by
// meaning-map.js, each dot in its top-level area's colour, so the map shows where the meaning cuts
// across the folders.
//
// - The server's map carries positions, regions and their names, and no titles: they are joined
//   here to the library's document, so a paper's title is the library's.
// - A tap on a paper peeks at it (its title, authors, summary and Open), and lines join it to its
//   five nearest papers. A tap on a region's name flies to it.
// - The search box lights the papers it finds and dims the rest, at each depth: titles on the
//   device, text and meaning on the laptop. Areas lights one area's papers.
// - While the laptop draws the map again (a paper added) or names its regions, the map shown is
//   the last one, and it is asked for again every few seconds; the papers then glide to their new
//   places, and the new ones ring.
// - Each device remembers where it left the map.

import { areaName, hueOf, hues, plural } from './areas.js';
import { filterPapers } from './library.js';
import { createMeaningMap, shortTitle } from './meaning-map.js';
import { element, icon, marks, shortAuthors, typeIcon } from './rows.js';
import { startAsking } from './server-search.js';

const CAMERA_KEY = 'carrel.map';
const AGAIN_MS = 4000;
const SHORTEST = 3;
const SIDE_BY_SIDE = 760; // a map this wide docks the peek beside the paper, not above or below
const number = new Intl.NumberFormat('en');

/**
 * The server's map joined to the library: only the papers the library holds, their neighbours
 * renumbered to match; a region's label is its name, or its folders until it has one.
 */
export function mapData(drawn, doc) {
  const hue = hues(doc);
  const index = new Map();
  const points = [];
  drawn.points.forEach((p, i) => {
    const paper = doc.byText.get(p.id);
    if (!paper) return;
    index.set(i, points.length);
    points.push({
      id: p.id,
      paper,
      title: paper.title,
      short: shortTitle(paper.title),
      hue: hueOf(paper.topic, hue),
      x: p.x,
      y: p.y,
      region: p.r,
      hood: p.h,
      rank: p.rank,
      near: p.near,
    });
  });
  for (const p of points) p.near = p.near.map((j) => index.get(j)).filter((j) => j !== undefined);
  const regions = drawn.regions.map((r) => ({ ...r, named: Boolean(r.name), label: r.name || r.folders.join(' · ') }));
  return { side: drawn.side, points, regions, contours: drawn.contours };
}

/** The indices of the points whose paper is among `papers`. */
export function indicesOf(points, papers) {
  const wanted = new Set(papers);
  const out = new Set();
  points.forEach((p, i) => {
    if (wanted.has(p.paper)) out.add(i);
  });
  return out;
}

/**
 * Builds the view into `container`. `openPaper({pdf, title})` opens a paper's tab. Returns
 * `draw(doc, {query, depth})`, called whenever the view shows or the box changes, and `hide()`.
 */
export function startMapView(container, { openPaper }) {
  const canvas = element('canvas', 'map-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', "The library's papers laid out by what they are about");
  const status = element('div', 'map-status');
  status.setAttribute('aria-live', 'polite');
  const tools = element('div', 'map-tools');
  const areasButton = element('button', 'map-button map-areas', 'Areas');
  areasButton.type = 'button';
  areasButton.setAttribute('aria-expanded', 'false');
  const legend = element('div', 'map-legend sheet');
  legend.hidden = true;
  const zoom = element('div', 'map-zoom');
  for (const [name, label, iconName] of [
    ['in', 'Zoom in', 'plus'],
    ['out', 'Zoom out', 'minus'],
    ['fit', 'The whole map', 'scan'],
  ]) {
    const button = zoom.appendChild(element('button', 'map-button icon-button'));
    button.type = 'button';
    button.dataset.map = name;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.append(icon(iconName));
  }
  tools.append(areasButton, zoom);
  const peek = element('div', 'map-peek sheet');
  peek.setAttribute('role', 'dialog');
  peek.setAttribute('aria-label', 'A paper on the map');
  peek.hidden = true;
  container.replaceChildren(canvas, status, tools, legend, peek);

  let map = null; // the canvas's handle, made the first time the view shows
  let doc = null;
  let drawn = null; // the server's map, as last fetched
  let etag = null;
  let data = null; // `drawn` joined to `doc`
  let shownFor = null; // the {drawn, doc} that `data` was made from
  let visible = false;
  let asking = false;
  let again = 0;
  let failure = '';
  let search = { query: '', depth: 'titles', note: '', lit: null };
  let area = ''; // the area Areas lights, when the box is empty
  let peeked = -1;
  let peekSide = 'bottom'; // where the peek is docked: away from the paper
  const laptop = startAsking({ wait: 350 });
  const searchNote = element('span', 'map-search-note');
  let lastKey = '';

  function ensureMap() {
    if (map) return;
    map = createMeaningMap(canvas, {
      onSelect: (point, index) => (point ? showPeek(index) : closePeek()),
      onRegion: () => closePeek(),
      onCamera: (camera) => {
        try {
          localStorage.setItem(CAMERA_KEY, JSON.stringify(camera));
        } catch {
          // Private browsing: the place lasts as long as the page.
        }
        if (peeked >= 0) placePeek();
      },
    });
  }

  function storedCamera() {
    try {
      const camera = JSON.parse(localStorage.getItem(CAMERA_KEY) ?? 'null');
      return camera && [camera.cx, camera.cy, camera.z].every(Number.isFinite) ? camera : null;
    } catch {
      return null;
    }
  }

  // The map from the laptop.

  async function fetchMap() {
    clearTimeout(again);
    if (asking) return;
    asking = true;
    let response;
    try {
      response = await fetch('/api/map', { cache: 'no-cache' });
    } catch {
      failure = drawn ? '' : 'Could not reach the laptop.';
      asking = false;
      drawStatus();
      return;
    }
    asking = false;
    if (response.status === 202) {
      failure = '';
      drawStatus('Drawing the map, about a quarter of a minute…');
      later();
      return;
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      failure = body?.error ?? 'The map could not be drawn.';
      drawStatus();
      return;
    }
    failure = '';
    const tag = response.headers.get('ETag');
    if (!tag || tag !== etag) {
      etag = tag;
      drawn = body;
      show();
    }
    if (body.drawing || body.names === 'pending') later();
    drawStatus();
  }

  function later() {
    clearTimeout(again);
    if (visible) again = setTimeout(fetchMap, AGAIN_MS);
  }

  /** Puts `drawn` on the canvas, joined to `doc`: grown in the first time, from where the reader
   * left it when there is such a place, and glided to when it replaces a map on screen. */
  function show() {
    if (!drawn || !doc || !map) return;
    if (shownFor?.drawn === drawn && shownFor?.doc === doc) return;
    const before = data;
    data = mapData(drawn, doc);
    closePeek();
    if (before && shownFor?.drawn !== drawn) {
      const previous = new Map(before.points.map((p) => [p.id, [p.x, p.y]]));
      const moved = data.points.some((p) => {
        const was = previous.get(p.id);
        return !was || was[0] !== p.x || was[1] !== p.y;
      });
      map.setData(data, moved ? { animate: 'update', previous, camera: map.getCamera() } : { camera: map.getCamera() });
    } else if (before) {
      map.setData(data, { camera: map.getCamera() });
    } else {
      const camera = storedCamera();
      map.setData(data, camera ? { camera } : { animate: 'grow' });
    }
    shownFor = { drawn, doc };
    lastKey = '';
    light();
    buildLegend();
  }

  // What the status line says: the map, or the search, or what is happening on the laptop.

  function drawStatus(waiting = '') {
    const parts = [];
    if (failure) parts.push(element('span', 'map-error', failure));
    else if (!data) parts.push(element('span', 'map-waiting', waiting || 'Loading the map…'));
    else if (search.note) {
      parts.push(searchNote);
      if (search.lit?.size) {
        const fit = element('button', 'plain map-fit', 'Show them');
        fit.type = 'button';
        fit.addEventListener('click', () => map.fitIndices(search.lit));
        parts.push(fit);
      }
    } else if (area) {
      const count = lit()?.size ?? 0;
      parts.push(element('span', '', `${areaName(area)}: ${plural(count, 'paper')}`));
      const clear = element('button', 'plain map-fit', 'Every area');
      clear.type = 'button';
      clear.addEventListener('click', () => chooseArea(''));
      parts.push(clear);
    } else {
      const regions = data.regions.filter((r) => r.level === 'region').length;
      const text = [plural(data.points.length, 'paper'), regions ? plural(regions, 'region') : ''].filter(Boolean).join(' · ');
      parts.push(element('span', '', text));
      if (drawn.drawing) parts.push(element('span', 'map-waiting', 'Drawing it again…'));
      else if (drawn.names === 'pending') parts.push(element('span', 'map-waiting', 'Naming the regions…'));
    }
    if (waiting && data) parts.push(element('span', 'map-waiting', waiting));
    status.replaceChildren(...parts);
  }

  // Lighting papers: the search's, else an area's.

  function lit() {
    if (!data) return null;
    if (search.lit) return search.lit;
    if (area) return indicesOf(data.points, doc.papers.filter((paper) => paper.topic === area || paper.topic.startsWith(`${area}/`)));
    return null;
  }

  function light() {
    if (!data) return;
    const key = `${search.depth}\n${search.query}`;
    if (key !== lastKey) {
      lastKey = key;
      runSearch();
    }
    map.highlight(lit());
    drawStatus();
  }

  function runSearch() {
    const query = search.query.trim();
    search.lit = null;
    search.note = '';
    if (!query) {
      laptop.stop();
      return;
    }
    if (search.depth === 'titles') {
      laptop.stop();
      const found = indicesOf(data.points, filterPapers(doc.papers, query));
      search.lit = found;
      searchNote.textContent = `${plural(found.size, 'paper')} match “${query}”`;
      search.note = 'titles';
      return;
    }
    search.note = search.depth;
    if (query.length < SHORTEST) {
      laptop.stop();
      searchNote.textContent = search.depth === 'meaning' ? 'Describe what you are looking for.' : `Type ${SHORTEST} letters or more.`;
      return;
    }
    const url = search.depth === 'meaning' ? `/api/meaning?${new URLSearchParams({ q: query, topic: '' })}` : `/api/search?${new URLSearchParams({ q: query, topic: '' })}`;
    const slot = element('span');
    searchNote.replaceChildren(slot);
    laptop.ask(
      slot,
      `${search.depth}\n${query}`,
      url,
      (results) => {
        if (search.query.trim() !== query) return;
        const byText = new Map(data.points.map((p, i) => [p.id, i]));
        search.lit = new Set(results.papers.map((found) => byText.get(found.text)).filter((i) => i !== undefined));
        searchNote.textContent =
          search.depth === 'meaning' ? `The ${search.lit.size} papers nearest “${results.query}”` : `${plural(results.total, 'paper')} hold “${results.query}”${results.total > results.papers.length ? `, the ${results.papers.length} with the most shown` : ''}`;
        map.highlight(lit());
        drawStatus();
      },
      search.depth === 'meaning' ? 'Searching by meaning…' : 'Searching the papers…',
    );
  }

  // Areas: a legend of the colours, and a way to light one area.

  function buildLegend() {
    const counts = new Map();
    for (const p of data.points) {
      const top = p.paper.topic.split('/')[0];
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    const hue = hues(doc);
    const list = element('div', 'choices-scroll');
    list.append(legendRow('', 'Every area', data.points.length, null));
    for (const [top, count] of [...counts].sort((a, b) => b[1] - a[1])) list.append(legendRow(top, areaName(top), count, hueOf(top, hue)));
    legend.replaceChildren(element('div', 'sheet-header', 'Coloured by area. Tap one to light its papers.'), list);
  }

  function legendRow(path, name, count, hue) {
    const button = element('button', 'choice');
    button.type = 'button';
    button.dataset.area = path;
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(area === path));
    button.append(element('span', hue ? `dot hue-${hue}` : 'dot every-dot'), element('span', 'choice-label', name), element('span', 'count', number.format(count)));
    button.addEventListener('click', () => chooseArea(path));
    return button;
  }

  /** Lights an area's papers, or none; the list closes so the map shows, and its button names
   * the area. */
  function chooseArea(path) {
    area = area === path ? '' : path;
    for (const row of legend.querySelectorAll('[data-area]')) row.setAttribute('aria-checked', String(row.dataset.area === area));
    areasButton.textContent = area ? areaName(area) : 'Areas';
    areasButton.classList.toggle('on', Boolean(area));
    toggleLegend(false);
    closePeek();
    map.highlight(lit());
    drawStatus();
  }

  function toggleLegend(open = legend.hidden) {
    legend.hidden = !open;
    areasButton.setAttribute('aria-expanded', String(open));
  }

  // The peek at a paper.

  function showPeek(index) {
    const point = data.points[index];
    const paper = point.paper;
    peeked = index;
    const kicker = element('p', 'peek-kicker');
    if (paper.type) kicker.append(typeIcon(paper.type));
    kicker.append(element('span', '', [paper.type, paper.topic, paper.year].filter(Boolean).join(' · ')), marks(paper));
    const card = [kicker, element('p', 'peek-title', paper.title)];
    const authors = shortAuthors(paper.authors, 4);
    if (authors) card.push(element('p', 'peek-authors', authors));
    if (paper.summary) card.push(element('p', 'peek-summary', paper.summary));
    const actions = element('div', 'peek-actions');
    const open = actions.appendChild(element('button', 'primary', 'Open'));
    open.type = 'button';
    open.addEventListener('click', () => {
      closePeek();
      openPaper({ pdf: paper.pdf, title: paper.title });
    });
    if (point.near.length) actions.append(element('span', 'peek-near', 'Lines join its nearest papers.'));
    peek.replaceChildren(...card, actions);
    peek.hidden = false;
    toggleLegend(false);
    const box = canvas.getBoundingClientRect();
    const spot = map.screenOf(index);
    if (box.width >= SIDE_BY_SIDE) peekSide = spot.x > box.width / 2 ? 'left' : 'right';
    else peekSide = spot.y > box.height / 2 ? 'top' : 'bottom';
    placePeek();
    map.reveal(index);
  }

  /** Docked to the side of the map away from the paper (on a wide map, left or right; else top
   * or bottom, under the paper's own column) and never more than that side's half, so the paper
   * and its nearest stay in sight and a double tap's second tap reaches the map. The map keeps
   * the paper out from under it. */
  function placePeek() {
    if (peeked < 0 || peek.hidden) return;
    const box = canvas.getBoundingClientRect();
    const spot = map.screenOf(peeked);
    const width = Math.min(400, box.width - 24);
    peek.style.width = `${width}px`;
    const across = peekSide === 'left' || peekSide === 'right';
    peek.style.maxHeight = `${across ? box.height - 24 : Math.max(160, box.height * 0.45)}px`;
    if (across) {
      peek.style.left = `${peekSide === 'left' ? box.left + 12 : box.right - width - 12}px`;
      peek.style.top = `${box.top + 12}px`;
      map.setInsets({ top: 0, bottom: 0, left: peekSide === 'left' ? width + 24 : 0, right: peekSide === 'right' ? width + 24 : 0 });
      return;
    }
    peek.style.left = `${box.left + Math.max(12, Math.min(spot.x - width / 2, box.width - width - 12))}px`;
    const height = peek.offsetHeight;
    peek.style.top = `${peekSide === 'top' ? box.top + 12 : box.bottom - height - 12}px`;
    map.setInsets(peekSide === 'top' ? { top: height + 24, bottom: 0, left: 0, right: 0 } : { top: 0, bottom: height + 24, left: 0, right: 0 });
  }

  function closePeek() {
    if (peeked >= 0) map?.select(-1);
    map?.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
    peeked = -1;
    peek.hidden = true;
  }

  // Events.

  zoom.addEventListener('click', (event) => {
    const button = event.target.closest('[data-map]');
    if (!button || !map) return;
    if (button.dataset.map === 'in') map.zoomBy(1.6);
    else if (button.dataset.map === 'out') map.zoomBy(1 / 1.6);
    else map.fit(true);
  });
  areasButton.addEventListener('click', () => {
    closePeek();
    toggleLegend();
  });
  canvas.addEventListener('pointerdown', () => toggleLegend(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && visible && !peek.hidden) closePeek();
  });

  return {
    draw(nextDoc, { query = '', depth = 'titles' } = {}) {
      const showing = !visible;
      visible = true;
      ensureMap();
      doc = nextDoc;
      search.query = query;
      search.depth = depth;
      if (showing) map.restyle();
      if (showing || !drawn) void fetchMap();
      show();
      light();
    },
    /** The library's document changed: the map may have too. */
    refresh() {
      if (visible) void fetchMap();
    },
    hide() {
      if (!visible) return;
      visible = false;
      clearTimeout(again);
      laptop.stop();
      closePeek();
      toggleLegend(false);
    },
  };
}
