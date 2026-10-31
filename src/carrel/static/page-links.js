// Page citations an answer left as plain text ("Table 6 on p. 20", "read pp. 8–10"), made links
// to the paper the answer is about, as the agent's own links are. The agent links most of its
// citations; this catches the passing ones, at no cost to the answer. A link made here opens the
// page (and a LaTeX paper's table, figure or section, by name), never a marked region.
//
// The paper is the one the question was asked about, and only when every link the answer has
// points to it; otherwise, when the question named none, the one paper the answer links. An
// answer that links two papers is left as it is, since a plain "p. 7" in it could be either's.
// A citation whose sentence names another paper of the library just before it ("FASTopic
// paper, p. 6") is left too.

import { parsePaperLink, sameFile } from './links.js';

const KINDS = String.raw`Tables?|Tab\.|Figures?|Figs?\.|Eqs?\.|Equations?|§|Sections?|Sec\.|Appendix|App\.`;
const ID = String.raw`(?:\d+(?:\.\d+)*[a-z]?|[A-Z](?:\.\d+)*)`;
const LABEL = String.raw`(?:${KINDS})\s?${ID}(?:\s?[–-]\s?${ID})?`;
// A page, or a range, not part of a longer number ("p. 7.5", "p. 12,000").
const PAGE = String.raw`\b(?:pp?\.|pages?)\s?(?<num>\d+)(?:\s?[–-]\s?\d+)?(?![.,]?\d)`;
const CITATION = new RegExp(
  String.raw`(?<label>${LABEL})(?<sep>,\s?|\s(?:on|at)\s|\s?\(\s?|\s)(?=(?:pp?\.|pages?)\s?\d)` +
    String.raw`|${PAGE}(?:,\s?(?<trailing>${LABEL}))?`,
  'gi',
);
const PAGE_AT = new RegExp(PAGE, 'iy');

/**
 * The plain page citations in `text`: where each starts and ends, its page (a range's first)
 * and the named destination its label gives, if any. A label before the page ("Fig. 10 (p. 20)")
 * or after it ("p. 7, Table 2") is part of the citation.
 */
export function findCitations(text) {
  const found = [];
  CITATION.lastIndex = 0;
  for (let match; (match = CITATION.exec(text)); ) {
    const { label, sep, num, trailing } = match.groups;
    if (!label) {
      found.push({ start: match.index, end: CITATION.lastIndex, page: Number(num), dest: destFor(trailing) });
      continue;
    }
    // A label, then its page.
    PAGE_AT.lastIndex = CITATION.lastIndex;
    const page = PAGE_AT.exec(text);
    if (!page) continue;
    let end = PAGE_AT.lastIndex;
    if (sep.includes('(') && text[end] === ')') end += 1;
    found.push({ start: match.index, end, page: Number(page.groups.num), dest: destFor(label) });
    CITATION.lastIndex = end;
  }
  return found;
}

const LABEL_PARTS = new RegExp(String.raw`^(${KINDS})\s?(${ID})`, 'i');

/** The named destination a label gives: "Table 6" → table.6, "§5.2" → subsection.5.2. */
export function destFor(label) {
  const [, kind, id] = LABEL_PARTS.exec(label ?? '') ?? [];
  if (!kind) return undefined;
  const word = kind.toLowerCase().replace(/s?\.?$/, '');
  const number = id.replace(/[a-z]$/, '');
  if (/^\d+$/.test(number) && (word === 'table' || word === 'tab')) return `table.${number}`;
  if (/^\d+$/.test(number) && (word === 'figure' || word === 'fig')) return `figure.${number}`;
  if (/^\d+(\.\d+){0,2}$/.test(number) && ['§', 'section', 'sec'].includes(word)) {
    return `${['section', 'subsection', 'subsubsection'][number.split('.').length - 1]}.${number}`;
  }
  if (/^[A-Z](\.\d+)?$/.test(id) && (word === 'appendix' || word === 'app')) {
    return id.includes('.') ? `subsection.${id}` : `appendix.${id}`;
  }
  return undefined;
}

/** A link to `page` of `file` (relative to pdf_root), in the form the agent writes. */
export function pageHref(file, page, dest) {
  const path = file.split('/').map(encodeURIComponent).join('/');
  return `http://pdf.invalid/${path}?${dest ? `dest=${dest}&` : ''}page=${page}`;
}

/**
 * The paper an answer's plain citations are about, or undefined: the question's PDF when every
 * linked paper is it, or the only linked paper when the question named none.
 */
export function answerFile(asked, linked) {
  if (asked) return linked.every((file) => sameFile(file, asked)) ? asked : undefined;
  const files = linked.filter((file, i) => linked.findIndex((other) => sameFile(other, file)) === i);
  return files.length === 1 ? files[0] : undefined;
}

/**
 * The name a paper goes by in an answer, from its title: "Zep" for "Zep: A Temporal Knowledge
 * Graph…", or undefined when the title has no short name of at most three words before a colon.
 */
export function shortName(title) {
  const [head] = /^[^:]+?(?=:\s|\.\s)/.exec(title ?? '') ?? [];
  return head && head.split(/\s+/).length <= 3 && /[A-Z]/.test(head) ? head : undefined;
}

// How far back a citation's sentence is searched for another paper's name.
const NAMED_WITHIN = 40;

/** One pattern for a list of paper names, each as a whole word; null for none. */
export function namesPattern(names) {
  return names.length ? new RegExp(String.raw`(?<![\w-])(?:${names.map(escape).join('|')})(?![\w-])`) : null;
}

/** Whether the words just before a citation, in its sentence, match `pattern` (namesPattern). */
export function namesAnother(before, pattern) {
  return pattern ? pattern.test(before.slice(-NAMED_WITHIN).split(/[.!?]\s+|\n/).pop()) : false;
}

// The names of the papers other than an answer's, built once for a library list and a paper:
// an answer is drawn again at every frame while it streams.
let named = { papers: null, file: null, pattern: null };

function otherNames(papers, file) {
  if (named.papers !== papers || named.file !== file) {
    const own = shortName(papers.find((paper) => sameFile(paper.pdf ?? '', file))?.title);
    const names = papers
      .filter((paper) => !sameFile(paper.pdf ?? '', file))
      .map((paper) => shortName(paper.title))
      .filter((name) => name && name !== own);
    named = { papers, file, pattern: namesPattern([...new Set(names)]) };
  }
  return named.pattern;
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BLOCKS = 'p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, dd, dt';

/**
 * Links the plain page citations in a drawn answer to the pages of the paper it is about, as
 * above. `papers` are the library's papers ({title, pdf}), for the names of the others.
 */
export function linkPages(element, asked, papers = []) {
  const linked = [...element.querySelectorAll('a[href]')]
    .map((a) => parsePaperLink(a.getAttribute('href'))?.file)
    .filter(Boolean);
  const file = answerFile(asked, linked);
  if (!file) return;
  const names = otherNames(papers, file);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('a, code, pre, .maths, .katex') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const citations = findCitations(node.data);
    if (!citations.length) continue;
    const before = textBefore(node);
    const parts = [];
    let at = 0;
    for (const { start, end, page, dest } of citations) {
      if (namesAnother(before + node.data.slice(0, start), names)) continue;
      parts.push(node.data.slice(at, start));
      const link = document.createElement('a');
      link.className = 'auto';
      link.href = pageHref(file, page, dest);
      link.textContent = node.data.slice(start, end);
      parts.push(link);
      at = end;
    }
    if (!at) continue;
    parts.push(node.data.slice(at));
    node.replaceWith(...parts.filter((part) => part !== ''));
  }
}

/** The text of a node's block (its paragraph, list item or cell) before the node. */
function textBefore(node) {
  const block = node.parentElement?.closest(BLOCKS);
  if (!block) return '';
  let text = '';
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  while (walker.nextNode() && walker.currentNode !== node) text += walker.currentNode.data;
  return text;
}
