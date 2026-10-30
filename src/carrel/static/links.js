// Paper links, as the library guide tells agents to write them and vscode-pdf-viewer reads them
// (its src/shared/linkFormat.ts, ported):
//
//     http://pdf.invalid/<file path>?dest=table.2&page=7&search=…
//     http://pdf.invalid/<file path>?page=7&rect=71,402,541,520;71,522,300,534
//     http://pdf.invalid/open?file=<file path>&dest=…        (also for absolute paths)

const PARAMS = ['file', 'dest', 'page', 'search', 'rect'];

/**
 * Reads a link from its path and query, already percent-decoded. Because decoding has turned
 * `%26` into `&`, the query is split only at an `&` that starts a known parameter, so titles
 * like "Wide & Deep" survive in `file` and `search`.
 */
export function parseTargetParts(path, query) {
  const params = new Map();
  for (const part of query.split(new RegExp(`&(?=(?:${PARAMS.join('|')})=)`))) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      params.set(part.slice(0, eq), part.slice(eq + 1));
    }
  }
  const file = path === '/open' ? params.get('file') : path.replace(/^\//, '');
  if (!file) {
    return undefined;
  }
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return {
    file,
    page: page > 0 ? page : undefined,
    dest: params.get('dest') || undefined,
    search: params.get('search') || undefined,
    rect: parseRects(params.get('rect') ?? ''),
  };
}

/**
 * `x0,y0,x1,y1;…` in PDF points, as `paperlib locate` writes them; rectangles that are not four
 * finite numbers with x0 < x1 and y0 < y1 are left out.
 */
export function parseRects(text) {
  const rects = text
    .split(';')
    .map((part) => part.split(',').map((value) => (value.trim() === '' ? Number.NaN : Number(value))))
    .filter((r) => r.length === 4 && r.every(Number.isFinite) && r[0] < r[2] && r[1] < r[3]);
  return rects.length ? rects : undefined;
}

/** Rectangles as a link writes them. */
export function formatRects(rects) {
  return rects.map((r) => r.join(',')).join(';');
}

/** Percent-decoded text, or the text as it is when it does not decode. */
export function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The target of a paper link, or undefined for any other link. */
export function parsePaperLink(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' || url.hostname !== 'pdf.invalid') {
    return undefined;
  }
  return parseTargetParts(decode(url.pathname), decode(url.search.replace(/^\?/, '')));
}

/** Whether two paths name the same file: a synced folder may hand back another Unicode form. */
export function sameFile(a, b) {
  return a.normalize('NFC') === b.normalize('NFC');
}
