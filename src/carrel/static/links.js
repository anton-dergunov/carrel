// Paper links, as the library guide tells agents to write them and vscode-pdf-viewer reads them
// (its src/shared/linkFormat.ts, ported):
//
//     http://pdf.invalid/<file path>?dest=table.2&page=7&search=…
//     http://pdf.invalid/open?file=<file path>&dest=…        (also for absolute paths)

const PARAMS = ['file', 'dest', 'page', 'search'];

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
  };
}

function decode(text) {
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
