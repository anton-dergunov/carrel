// The meaning map, drawn on a canvas: the library's papers laid out by what they are about.
//
// Ported from Acervo's meaning map (`acervo-llm-dictionary`, `web/src/meaningMap/core.ts`), whose
// look and motion it keeps: an atlas of land and sea from the papers' density, region names in
// spaced capitals far out, neighbourhoods in italics nearer, and titles close in, the most central
// first. Here a point is a paper, its dot coloured by its top-level area, and selecting it draws
// fine lines to its five nearest papers by meaning.
//
// One canvas, drawn in two layers a frame: the world layer (the land and its contours) under the
// camera, and the screen layer (dots and labels) in pixels, so text never scales with the zoom. A
// frame is drawn only when something asks for one. It is handed a canvas, data and callbacks, and
// knows nothing else of carrel (map-view.js joins the server's map to the library).

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const range = (count) => Array.from({ length: count }, (_, i) => i);
const AREA_HUES = 12;

/** A title short enough to label a dot: the name before a colon, when that is short, else its
 * first words up to `most` characters. */
export function shortTitle(title, most = 34) {
  const text = String(title ?? '').trim();
  const colon = text.indexOf(':');
  if (colon > 0 && colon <= most && text.slice(0, colon).split(/\s+/).length <= 5) return text.slice(0, colon);
  if (text.length <= most) return text;
  const cut = text.slice(0, most + 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > most / 2 ? cut.slice(0, space) : cut.slice(0, most)).replace(/[\s,.;:–-]+$/, '')}…`;
}

/** `text` in lines of at most `width` characters, broken between words; at most `most` lines,
 * the last ending in … when the text goes on. */
export function wrapLines(text, width, most = 3) {
  const lines = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length > most) {
    const kept = lines.slice(0, most);
    kept[most - 1] = `${kept[most - 1].replace(/[\s,.;:–-]+$/, '')}…`;
    return kept;
  }
  return lines;
}

/**
 * Draws `data` ({side, points, regions, contours}) on `canvas`. A point is {id, title, short, hue,
 * x, y, region, hood, rank, near}; a region {id, level, index, x, y, count, region?, label, named}.
 * `onSelect(point | null, index)`, `onRegion(region)` and `onCamera(camera)` say what the reader
 * did. Returns the handle the view drives it with.
 */
export function createMeaningMap(canvas, { onSelect = () => {}, onRegion = () => {}, onCamera = () => {} } = {}) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  let data = null;
  let n = 0;
  let X = new Float32Array(0), Y = new Float32Array(0), FX = new Float32Array(0), FY = new Float32Array(0);
  let PX = new Float32Array(0), PY = new Float32Array(0), PA = new Float32Array(0);
  let delay = new Float32Array(0), fresh = new Uint8Array(0);
  let regionList = [], hoodList = [];
  let contourPaths = [];
  let anim = null;
  let sel = -1, hover = -1;
  let lit = null;
  let W = 0, H = 0, dpr = 1;
  let cam = { k: 1, tx: 0, ty: 0 }, fitK = 1;
  let insets = { top: 0, right: 0, bottom: 0, left: 0 };
  let colors = null;
  let fonts = null;
  let raf = 0;
  let flight = null;
  let inertia = null;
  let boxes = [];
  let order = [];
  let zmin = new Float32Array(0);
  const widths = new Map();
  const pending = [];

  // The camera.

  const view = () => ({ x: insets.left, y: insets.top, w: Math.max(80, W - insets.left - insets.right), h: Math.max(80, H - insets.top - insets.bottom) });
  const centre = () => {
    const v = view();
    return { x: v.x + v.w / 2, y: v.y + v.h / 2 };
  };
  const toWorld = (sx, sy) => ({ x: (sx - cam.tx) / cam.k, y: (sy - cam.ty) / cam.k });
  const zoom = () => cam.k / fitK;
  const minK = () => fitK * 0.55;
  const maxK = () => fitK * 30;

  function place(cx, cy, k) {
    const c = centre();
    cam = { k, tx: c.x - cx * k, ty: c.y - cy * k };
  }
  function current() {
    const c = centre();
    return { cx: (c.x - cam.tx) / cam.k, cy: (c.y - cam.ty) / cam.k, k: cam.k };
  }
  function boundsOf(indices) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of indices) {
      x0 = Math.min(x0, X[i]); y0 = Math.min(y0, Y[i]); x1 = Math.max(x1, X[i]); y1 = Math.max(y1, Y[i]);
    }
    if (!isFinite(x0)) {
      const side = data ? data.side : 1000;
      return { x0: 0, y0: 0, x1: side, y1: side };
    }
    return { x0, y0, x1, y1 };
  }
  function kToFit(b, v, pad) {
    const bw = Math.max(b.x1 - b.x0, 40), bh = Math.max(b.y1 - b.y0, 40);
    return Math.min((v.w - pad * 2) / bw, (v.h - pad * 2) / bh);
  }
  // `fitK` is always the whole map in the whole canvas, whatever covers part of it: the levels of
  // detail hang off it, and a peek opening must not change what is labelled.
  function measureFit() {
    if (!n || !W) return;
    fitK = kToFit(boundsOf(range(n)), { w: W, h: H }, 36);
  }
  function flyTo(cx, cy, k, ms = 520) {
    k = clamp(k, minK(), maxK());
    if (reduced.matches || ms === 0) {
      place(cx, cy, k);
      flight = null;
      request();
      onCamera(getCamera());
      return;
    }
    flight = { from: current(), to: { cx, cy, k }, t0: performance.now(), ms };
    inertia = null;
    request();
  }
  function fitIndices(indices, animate = true, pad = 36) {
    if (!indices.length) return;
    const b = boundsOf(indices);
    flyTo((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, Math.min(kToFit(b, view(), pad), maxK()), animate ? 560 : 0);
  }
  function fit(animate = true) {
    if (n) fitIndices(range(n), animate);
  }
  function zoomAt(sx, sy, factor, animate) {
    const k = clamp(cam.k * factor, minK(), maxK());
    const w = toWorld(sx, sy);
    if (!animate) {
      cam = { k, tx: sx - w.x * k, ty: sy - w.y * k };
      request();
      return;
    }
    // The world point under the finger stays under it.
    const c = centre();
    flyTo(w.x + (c.x - sx) / k, w.y + (c.y - sy) / k, k, 380);
  }

  // The data.

  function load(next, opts) {
    const first = !data;
    data = next;
    n = next.points.length;
    X = new Float32Array(n); Y = new Float32Array(n);
    FX = new Float32Array(n); FY = new Float32Array(n);
    PX = new Float32Array(n); PY = new Float32Array(n); PA = new Float32Array(n);
    delay = new Float32Array(n); fresh = new Uint8Array(n);
    next.points.forEach((p, i) => {
      X[i] = p.x;
      Y[i] = p.y;
    });
    regionList = next.regions.filter((r) => r.level === 'region');
    hoodList = next.regions.filter((r) => r.level === 'hood');
    contourPaths = next.contours.map(([level, flat]) => {
      const path = new Path2D();
      path.moveTo(flat[0], flat[1]);
      for (let j = 2; j < flat.length; j += 2) path.lineTo(flat[j], flat[j + 1]);
      path.closePath();
      return { level, path };
    });
    sel = -1; hover = -1; lit = null;
    measureFit();
    // A map that grows in is shown whole; new data for the map on screen keeps the view.
    if (opts.camera) setCamera(opts.camera);
    else if (first || opts.animate === 'grow') fit(false);
    // A title's zoom comes from how central its paper is, so the middle distance names the papers
    // that best describe each neighbourhood; a map with no regions names every paper at once.
    zmin = new Float32Array(n);
    next.points.forEach((p, i) => {
      zmin[i] = next.regions.length ? 1.9 + Math.pow(1 - p.rank, 1.3) * 4.2 : 0;
    });
    order = range(n).sort((a, b) => next.points[b].rank - next.points[a].rank);
    startAnimation(opts);
    request();
  }

  // Two motions, both from where a point was to where it is. Growing starts every point at its
  // region's centre, a region at a time, so the map assembles into its islands; an update starts
  // each paper where the previous map had it, and fades the new ones in after.
  function startAnimation(opts) {
    anim = null;
    if (!opts.animate || reduced.matches || !data) return;
    const now = performance.now();
    if (opts.animate === 'grow') {
      const centres = new Map(regionList.map((r) => [r.index, r]));
      const mid = data.side / 2;
      let last = 0;
      data.points.forEach((p, i) => {
        const r = centres.get(p.region);
        FX[i] = r ? r.x : mid;
        FY[i] = r ? r.y : mid;
        const reach = Math.hypot(X[i] - FX[i], Y[i] - FY[i]) / data.side;
        delay[i] = Math.max(p.region, 0) * 55 + reach * 420;
        last = Math.max(last, delay[i]);
      });
      anim = { kind: 'grow', t0: now, dur: 700, total: last + 700 + 450 };
    } else if (opts.animate === 'update' && opts.previous) {
      data.points.forEach((p, i) => {
        const was = opts.previous.get(p.id);
        if (was) {
          FX[i] = was[0]; FY[i] = was[1]; delay[i] = 0;
        } else {
          FX[i] = X[i]; FY[i] = Y[i]; delay[i] = 900; fresh[i] = 1;
        }
      });
      anim = { kind: 'update', t0: now, dur: 1000, total: 900 + 1000 + 2600 };
    }
  }

  function positions(now) {
    const t = anim ? now - anim.t0 : Infinity;
    for (let i = 0; i < n; i++) {
      if (!anim) {
        PX[i] = X[i]; PY[i] = Y[i]; PA[i] = 1;
        continue;
      }
      const p = clamp((t - delay[i]) / anim.dur, 0, 1);
      const e = anim.kind === 'grow' ? easeOut(p) : easeInOut(p);
      PX[i] = FX[i] + (X[i] - FX[i]) * e;
      PY[i] = FY[i] + (Y[i] - FY[i]) * e;
      PA[i] = anim.kind === 'grow' ? smooth(0, 0.35, p) : fresh[i] ? smooth(0, 0.6, p) : 1;
    }
    return t;
  }

  // Colours, fonts, measuring.

  function readStyle() {
    const cs = getComputedStyle(canvas);
    const v = (name) => cs.getPropertyValue(name).trim();
    colors = {
      sea: v('--map-sea'), land: v('--map-land'), coast: v('--map-coast'), contour: v('--map-contour'), halo: v('--map-halo'),
      ink: v('--text'), ink2: v('--map-ink-2'), ink3: v('--muted'), accent: v('--accent'),
      areas: range(AREA_HUES).map((i) => v(`--area-${i + 1}`)),
    };
    const reading = v('--reading') || 'Georgia, serif';
    const ui = v('--ui') || 'system-ui, sans-serif';
    fonts = {
      region: `600 13px ${reading}`,
      regionList: `italic 600 15px ${reading}`,
      hood: `italic 400 14.5px ${reading}`,
      title: `500 13px ${ui}`,
      titleOn: `600 13.5px ${ui}`,
      full: `400 12.5px ${ui}`,
    };
    widths.clear();
  }
  function width(font, text) {
    const key = font + '\u0000' + text;
    let w = widths.get(key);
    if (w === undefined) {
      ctx.font = font;
      w = ctx.measureText(text).width;
      widths.set(key, w);
    }
    return w;
  }
  const areaColour = (p) => colors.areas[(Math.max(p.hue, 1) - 1) % AREA_HUES] || colors.ink3;

  // Spaced capitals, drawn a letter at a time: a canvas's own letter spacing is not in every
  // WebKit this has to run in.
  const TRACK = 0.13 * 13;
  function spacedWidth(text) {
    let w = 0;
    for (const ch of text) w += width(fonts.region, ch) + TRACK;
    return w - TRACK;
  }
  function drawSpaced(text, x, y) {
    let cx = x - spacedWidth(text) / 2;
    ctx.textAlign = 'left';
    for (const ch of text) {
      ctx.strokeText(ch, cx, y);
      ctx.fillText(ch, cx, y);
      cx += width(fonts.region, ch) + TRACK;
    }
  }
  // A screen-space grid of placed boxes, so testing a label against everything placed costs a
  // handful of comparisons rather than one per label.
  function makeGrid() {
    const cell = 80;
    const cells = new Map();
    const keys = (b) => {
      const out = [];
      for (let gx = Math.floor(b.x / cell); gx <= Math.floor((b.x + b.w) / cell); gx++)
        for (let gy = Math.floor(b.y / cell); gy <= Math.floor((b.y + b.h) / cell); gy++) out.push(gx + ':' + gy);
      return out;
    };
    return {
      free(b) {
        for (const k of keys(b))
          for (const o of cells.get(k) ?? []) if (b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h) return false;
        return true;
      },
      add(b) {
        for (const k of keys(b)) {
          const list = cells.get(k);
          if (list) list.push(b);
          else cells.set(k, [b]);
        }
      },
    };
  }

  // Drawing.

  function draw(now, map) {
    const t = positions(now);
    const growing = anim !== null && anim.kind === 'grow';
    const labelsIn = growing ? smooth(anim.total - 520, anim.total, t) : 1;
    const worldIn = growing ? smooth(0, 700, t) : 1;
    const z = zoom();
    const selected = sel >= 0 ? map.points[sel] : null;
    const focus = selected !== null || (lit !== null && lit.size > 0);
    const inFocus = (i) => i === sel || (lit !== null && lit.has(i)) || (selected !== null && selected.near.includes(i));

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.sea;
    ctx.fillRect(0, 0, W, H);

    // The world layer: the land, where the papers are thick, and its contours.
    ctx.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * cam.tx, dpr * cam.ty);
    if (contourPaths.length) {
      ctx.globalAlpha = worldIn;
      ctx.fillStyle = colors.land;
      for (const c of contourPaths) if (c.level === 0) ctx.fill(c.path);
      ctx.lineJoin = 'round';
      for (const c of contourPaths) {
        ctx.strokeStyle = c.level === 0 ? colors.coast : colors.contour;
        ctx.lineWidth = (c.level === 0 ? 1.1 : 0.9) / cam.k;
        ctx.stroke(c.path);
      }
      ctx.globalAlpha = 1;
    }

    // The screen layer.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const SX = (i) => PX[i] * cam.k + cam.tx;
    const SY = (i) => PY[i] * cam.k + cam.ty;
    const onScreen = (x, y, m = 60) => x > -m && x < W + m && y > -m && y < H + m;

    if (selected) {
      const sx = SX(sel), sy = SY(sel);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = colors.accent;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (const j of selected.near) {
        ctx.moveTo(sx, sy);
        ctx.lineTo(SX(j), SY(j));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The dots, in their area's colour; the selection and the lit papers ringed in the accent.
    const radius = clamp(2 + z * 0.35, 2.6, 4.6);
    for (let i = 0; i < n; i++) {
      if (PA[i] <= 0.01) continue;
      const x = SX(i), y = SY(i);
      if (!onScreen(x, y)) continue;
      ctx.globalAlpha = PA[i] * (focus && !inFocus(i) ? 0.2 : 1);
      ctx.fillStyle = areaColour(map.points[i]);
      ctx.beginPath();
      ctx.arc(x, y, i === sel ? radius + 1.5 : radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (lit) {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1.6;
      for (const i of lit) {
        if (PA[i] <= 0.01 || i === sel) continue;
        const x = SX(i), y = SY(i);
        if (!onScreen(x, y)) continue;
        ctx.beginPath();
        ctx.arc(x, y, radius + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (selected) {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(SX(sel), SY(sel), radius + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (anim && anim.kind === 'update') {
      for (let i = 0; i < n; i++) {
        if (!fresh[i]) continue;
        const local = (t - delay[i]) / 1300;
        if (local < 0 || local > 2) continue;
        const phase = local % 1;
        ctx.strokeStyle = colors.accent;
        ctx.globalAlpha = (1 - phase) * 0.8;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(SX(i), SY(i), 5 + phase * 16, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    drawLabels(map, z, labelsIn, SX, SY, onScreen, focus, inFocus, selected);
  }

  function drawLabels(map, z, labelsIn, SX, SY, onScreen, focus, inFocus, selected) {
    const grid = makeGrid();
    boxes = [];
    if (labelsIn <= 0) return;
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'middle';
    const halo = colors.halo;

    // The selection and the paper under the mouse are labelled even over others; its nearest
    // papers and the lit ones come next, at any zoom, but only where there is room.
    const forced = [];
    if (selected) forced.push(sel);
    if (hover >= 0) forced.push(hover);
    const preferred = [...(selected ? selected.near : []), ...(lit ? [...lit].slice(0, 80) : [])];

    const regionAlpha = 1 - smooth(1.45, 2.2, z);
    const hoodAlpha = smooth(1.35, 1.85, z) * (1 - smooth(4.6, 6.6, z));
    const fullAlpha = smooth(6.4, 8.2, z);

    // Papers the reader asked about come first, then the names of places, then the rest in order
    // of how central each paper is to its neighbourhood. Far in, a title is shown whole.
    const titleLabel = (i, forcedOne, wanted = forcedOne) => {
      const p = map.points[i];
      const x = SX(i), y = SY(i);
      if (!onScreen(x, y, 0) || PA[i] < 0.5) return;
      const on = i === sel;
      const whole = fullAlpha > 0.05;
      const lines = whole ? wrapLines(p.title, 30, 3) : [p.short];
      const font = on ? fonts.titleOn : whole ? fonts.full : fonts.title;
      const lh = 15;
      const w = Math.max(...lines.map((line) => width(font, line)));
      const h = lines.length * lh + 3;
      const gap = 7;
      let box = { x: x + gap, y: y - lh / 2 - 1, w: w + 4, h };
      if (!grid.free(box)) {
        const left = { x: x - gap - w - 4, y: y - lh / 2 - 1, w: w + 4, h };
        if (!forcedOne && !grid.free(left)) return;
        if (grid.free(left)) box = left;
      }
      grid.add(box);
      boxes.push({ ...box, point: i });
      ctx.globalAlpha = (focus && !inFocus(i) ? 0.3 : 1) * labelsIn * PA[i] * (wanted ? 1 : smooth(zmin[i], zmin[i] + 0.22, z));
      ctx.font = font;
      ctx.textAlign = 'left';
      ctx.strokeStyle = halo;
      ctx.lineWidth = 3.5;
      ctx.fillStyle = on || (lit !== null && lit.has(i)) ? colors.accent : colors.ink;
      lines.forEach((line, k) => {
        const ly = y + k * lh;
        ctx.strokeText(line, box.x + 2, ly);
        ctx.fillText(line, box.x + 2, ly);
      });
    };

    const seen = new Set();
    for (const i of forced) {
      if (!seen.has(i)) {
        seen.add(i);
        titleLabel(i, true);
      }
    }
    for (const i of preferred) {
      if (!seen.has(i)) {
        seen.add(i);
        titleLabel(i, false, true);
      }
    }

    const placeName = (r, alpha) => {
      if (alpha <= 0.02) return;
      const x = r.x * cam.k + cam.tx, y = r.y * cam.k + cam.ty;
      if (!onScreen(x, y, 120)) return;
      const text = r.label;
      if (!text) return;
      // Capitals are for a place's name. A region still waiting for one shows its folders, in
      // their own case: shouted, a list of folders reads as a warning.
      const named = r.level === 'region' && r.named;
      const lines = named ? wrapLines(text.toUpperCase(), 18) : wrapLines(text, r.level === 'region' ? 24 : 20);
      const lh = r.level === 'region' ? 19 : 18;
      const font = named ? fonts.region : r.level === 'region' ? fonts.regionList : fonts.hood;
      const lw = Math.max(...lines.map((l) => (named ? spacedWidth(l) : width(font, l))));
      const box = { x: x - lw / 2 - 4, y: y - (lines.length * lh) / 2 - 2, w: lw + 8, h: lines.length * lh + 4 };
      if (!grid.free(box)) return;
      grid.add(box);
      boxes.push({ ...box, region: r });
      ctx.globalAlpha = alpha * labelsIn * (focus ? 0.35 : 1);
      ctx.font = font;
      ctx.fillStyle = colors.ink2;
      ctx.strokeStyle = halo;
      ctx.lineWidth = 4;
      lines.forEach((line, k) => {
        const ly = box.y + 2 + lh / 2 + k * lh;
        if (named) drawSpaced(line, x, ly);
        else {
          ctx.textAlign = 'center';
          ctx.strokeText(line, x, ly);
          ctx.fillText(line, x, ly);
        }
      });
    };
    const levels = z < 1.8 ? [regionList, hoodList] : [hoodList, regionList];
    for (const list of levels) for (const r of list) placeName(r, r.level === 'region' ? regionAlpha : hoodAlpha);

    if (z >= 1.8 || !map.regions.length) {
      for (const i of order) {
        if (seen.has(i) || z < zmin[i]) continue;
        titleLabel(i, false);
      }
    }
    ctx.globalAlpha = 1;
  }

  // The frame loop.

  function request() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  let lastFrame = 0;
  function frame(now) {
    raf = 0;
    const dt = lastFrame ? Math.min(now - lastFrame, 64) : 16;
    lastFrame = now;
    let again = false;
    if (flight) {
      const p = clamp((now - flight.t0) / flight.ms, 0, 1);
      const e = easeInOut(p);
      const k = Math.exp(Math.log(flight.from.k) + (Math.log(flight.to.k) - Math.log(flight.from.k)) * e);
      place(flight.from.cx + (flight.to.cx - flight.from.cx) * e, flight.from.cy + (flight.to.cy - flight.from.cy) * e, k);
      if (p >= 1) {
        flight = null;
        onCamera(getCamera());
      } else again = true;
    }
    if (inertia) {
      cam.tx += inertia.vx * dt;
      cam.ty += inertia.vy * dt;
      const decay = Math.pow(0.93, dt / 16);
      inertia.vx *= decay;
      inertia.vy *= decay;
      if (Math.hypot(inertia.vx, inertia.vy) < 0.02) {
        inertia = null;
        onCamera(getCamera());
      } else again = true;
    }
    if (anim) {
      if (now - anim.t0 > anim.total) anim = null;
      else again = true;
    }
    if (data && W) draw(now, data);
    if (again) request();
    else lastFrame = 0;
  }

  // Gestures: one finger pans (with a little inertia), two pinch, a tap selects, a double tap
  // zooms in. The canvas takes every touch (`touch-action: none`), so Safari scrolls nothing.

  const pointers = new Map();
  let gesture = null;
  let lastTap = null;
  let wheelTimer = 0;
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function hitPoint(x, y, reach) {
    for (const b of boxes) if (b.point !== undefined && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.point;
    let best = -1, bestD = reach * reach;
    for (let i = 0; i < n; i++) {
      if (PA[i] < 0.3) continue;
      const dx = PX[i] * cam.k + cam.tx - x, dy = PY[i] * cam.k + cam.ty - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  function hitRegion(x, y) {
    for (const b of boxes) if (b.region && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.region;
    return null;
  }
  function tap(x, y, type) {
    if (!data) return;
    const now = performance.now();
    if (lastTap && now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
      lastTap = null;
      zoomAt(x, y, 2.2, true);
      return;
    }
    lastTap = { t: now, x, y };
    const region = zoom() < 2.4 ? hitRegion(x, y) : null;
    if (region) {
      fitRegion(region.id);
      onRegion(region);
      return;
    }
    const i = hitPoint(x, y, type === 'mouse' ? 12 : 24);
    if (i >= 0) {
      select(i);
      onSelect(data.points[i], i);
      return;
    }
    const hood = hitRegion(x, y);
    if (hood) {
      fitRegion(hood.id);
      onRegion(hood);
      return;
    }
    if (sel >= 0) {
      select(-1);
      onSelect(null, -1);
    }
  }

  function down(e) {
    // Capture keeps a drag that leaves the canvas ours; a pointer the browser does not consider
    // active (a synthetic one, in a test) must not end the gesture.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // carry on uncaptured
    }
    const p = at(e);
    pointers.set(e.pointerId, p);
    flight = null;
    inertia = null;
    if (pointers.size === 1) {
      gesture = { kind: 'pan', moved: 0, start: e.timeStamp, last: p, samples: [{ t: e.timeStamp, ...p }], type: e.pointerType };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), k0: cam.k, world: toWorld(m.x, m.y) };
    }
  }
  function move(e) {
    const p = at(e);
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        const i = hitPoint(p.x, p.y, 10);
        const region = zoom() < 2.4 ? hitRegion(p.x, p.y) : null;
        canvas.style.cursor = i >= 0 || region ? 'pointer' : 'grab';
        if (i !== hover) {
          hover = i;
          request();
        }
      }
      return;
    }
    pointers.set(e.pointerId, p);
    if (!gesture) return;
    if (gesture.kind === 'pan') {
      const dx = p.x - gesture.last.x, dy = p.y - gesture.last.y;
      gesture.moved += Math.abs(dx) + Math.abs(dy);
      gesture.last = p;
      if (gesture.moved > 6) {
        cam.tx += dx;
        cam.ty += dy;
        canvas.style.cursor = 'grabbing';
        request();
      }
      gesture.samples.push({ t: e.timeStamp, ...p });
      if (gesture.samples.length > 6) gesture.samples.shift();
    } else if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = clamp((gesture.k0 * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(gesture.d0, 1), minK(), maxK());
      cam = { k, tx: m.x - gesture.world.x * k, ty: m.y - gesture.world.y * k };
      request();
    }
  }
  function up(e) {
    const p = at(e);
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.kind === 'pan' && pointers.size === 0) {
      const quick = e.timeStamp - gesture.start < 450;
      if (gesture.moved <= 6 && quick && e.type === 'pointerup') tap(p.x, p.y, gesture.type);
      else {
        const s = gesture.samples;
        const a = s[0], b = s[s.length - 1];
        const dt = b.t - a.t;
        if (dt > 0 && e.timeStamp - b.t < 80 && !reduced.matches) {
          inertia = { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
          request();
        } else onCamera(getCamera());
      }
      gesture = null;
      canvas.style.cursor = 'grab';
    } else if (gesture.kind === 'pinch') {
      if (pointers.size === 1) {
        const rest = [...pointers.values()][0];
        gesture = { kind: 'pan', moved: 99, start: e.timeStamp, last: rest, samples: [{ t: e.timeStamp, ...rest }], type: e.pointerType };
      } else if (pointers.size === 0) {
        gesture = null;
        onCamera(getCamera());
      }
    }
  }
  // A trackpad pinch arrives as a wheel event with ctrlKey and a two-finger scroll as a plain
  // one; a mouse wheel sends whole notches with nothing sideways, and on a map that means zoom.
  function wheel(e) {
    e.preventDefault();
    flight = null;
    inertia = null;
    const p = at(e);
    const modified = e.ctrlKey || e.metaKey;
    const notch = e.deltaX === 0 && (e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY)));
    if (modified || notch) {
      const pinch = e.ctrlKey && !e.metaKey && !notch;
      const scale = pinch ? 0.012 : e.deltaMode === 1 ? 0.025 : notch ? 0.0011 : 0.006;
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * scale), false);
    } else {
      cam.tx -= e.deltaX;
      cam.ty -= e.deltaY;
      request();
    }
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => onCamera(getCamera()), 200);
  }
  // On the document while the map shows, so zooming needs no click on it first: + − 0 and the
  // arrows, whenever nothing is being typed.
  function key(e) {
    if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || !canvas.offsetParent) return;
    if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    const c = centre();
    if (e.key === '+' || e.key === '=') zoomAt(c.x, c.y, 1.6, true);
    else if (e.key === '-' || e.key === '_') zoomAt(c.x, c.y, 1 / 1.6, true);
    else if (e.key === '0') fit(true);
    else if (e.key.startsWith('Arrow')) {
      const step = 90 / cam.k;
      const now = current();
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      flyTo(now.cx + dx, now.cy + dy, now.k, 200);
    } else return;
    e.preventDefault();
  }
  function leave() {
    if (hover >= 0) {
      hover = -1;
      request();
    }
  }
  // Safari's own pinch would zoom the page under the map.
  const stopGesture = (e) => e.preventDefault();

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('gesturestart', stopGesture);
  canvas.addEventListener('gesturechange', stopGesture);
  document.addEventListener('keydown', key);
  canvas.style.cursor = 'grab';

  // Size and theme.

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const keep = W ? current() : null;
    W = r.width;
    H = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const before = fitK;
    measureFit();
    if (keep && data) place(keep.cx, keep.cy, keep.k * (fitK / before));
    else if (data) fit(false);
    while (pending.length) pending.shift()();
    // Setting the canvas's size clears it, so it is drawn again now rather than on the next frame.
    if (data) draw(performance.now(), data);
    request();
  }
  const sizes = new ResizeObserver(resize);
  sizes.observe(canvas);
  const themeWatch = new MutationObserver(() => {
    readStyle();
    request();
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => {
    readStyle();
    request();
  };
  scheme.addEventListener('change', onScheme);
  readStyle();
  document.fonts?.ready.then(() => {
    widths.clear();
    request();
  });

  // The handle.

  // Anything that moves the camera before the canvas has a size would be computed against a
  // zero-sized view and thrown away by the first resize; it waits instead.
  const whenSized = (fn) => (W ? fn() : pending.push(fn));

  function select(i, opts = {}) {
    sel = i;
    if (i >= 0 && opts.fly) whenSized(() => flyTo(X[i], Y[i], Math.max(cam.k, fitK * (opts.zoom ?? 6)), 560));
    request();
  }
  function fitRegion(id) {
    if (!data) return;
    const r = data.regions.find((x) => x.id === id);
    if (!r) return;
    const points = data.points;
    fitIndices(range(n).filter((i) => (r.level === 'region' ? points[i].region : points[i].hood) === r.index), true, 50);
  }
  function getCamera() {
    const c = current();
    return { cx: c.cx, cy: c.cy, z: c.k / fitK };
  }
  function setCamera(c) {
    if (c)
      whenSized(() => {
        place(c.cx, c.cy, clamp(c.z * fitK, minK(), maxK()));
        request();
      });
  }

  return {
    /** New data; returns how many papers are new, when animating an update. */
    setData(next, opts = {}) {
      load(next, opts);
      return anim?.kind === 'update' ? fresh.reduce((a, b) => a + b, 0) : 0;
    },
    select,
    /** Rings these papers and dims the rest; null for none. */
    highlight(indices) {
      lit = indices && indices.size ? indices : null;
      request();
    },
    fit,
    fitIndices: (indices) => whenSized(() => fitIndices([...indices], true, 50)),
    fitRegion,
    zoomBy(factor) {
      const c = centre();
      zoomAt(c.x, c.y, factor, true);
    },
    setInsets(next) {
      insets = { ...insets, ...next };
    },
    screenOf(i) {
      return { x: X[i] * cam.k + cam.tx, y: Y[i] * cam.k + cam.ty };
    },
    /** Brings a paper into the part of the canvas nothing covers, moving as little as it can. */
    reveal(i) {
      whenSized(() => {
        const v = view(), m = 40;
        const sx = X[i] * cam.k + cam.tx, sy = Y[i] * cam.k + cam.ty;
        const dx = sx < v.x + m ? v.x + m - sx : sx > v.x + v.w - m ? v.x + v.w - m - sx : 0;
        const dy = sy < v.y + m ? v.y + m - sy : sy > v.y + v.h - m ? v.y + v.h - m - sy : 0;
        if (!dx && !dy) return;
        const c = current();
        flyTo(c.cx - dx / cam.k, c.cy - dy / cam.k, cam.k, 360);
      });
    },
    getCamera,
    setCamera,
    redraw: request,
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(wheelTimer);
      sizes.disconnect();
      themeWatch.disconnect();
      scheme.removeEventListener('change', onScheme);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('gesturestart', stopGesture);
      canvas.removeEventListener('gesturechange', stopGesture);
      document.removeEventListener('keydown', key);
    },
  };
}
