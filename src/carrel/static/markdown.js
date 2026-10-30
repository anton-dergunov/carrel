// The agent's markdown as the page draws it: GFM, maths, and code, as VS Code's panel shows them.
//
// Maths comes in all four of the forms the agent writes: $…$ and \(…\) in a line, $$…$$ and
// \[…\] set apart. marked leaves each as a placeholder holding its TeX; the HTML is sanitised;
// then KaTeX draws into the placeholders, so its own output never passes through DOMPurify and
// what the agent wrote is never trusted as HTML. A `$` follows Pandoc's rule (no space inside
// either `$`, no digit after the closing one), so "$5 and $10" stays text.
//
// A ```mermaid block is drawn by Mermaid over its source, as lectern draws it, once the text is
// complete: half a diagram, mid-stream, fails at every frame. Mermaid is loaded only when there
// is one to draw, and one it cannot draw stays as its source.

import { Marked } from './vendor/marked/marked.esm.js';
import DOMPurify from './vendor/dompurify/purify.es.mjs';
import katex from './vendor/katex/katex.mjs';
import hljs from './vendor/highlight/highlight.min.js';

const BLOCK = [
  /^ {0,3}\$\$([\s\S]+?)\$\$[^\S\n]*(?:\n|$)/,
  /^ {0,3}\\\[([\s\S]+?)\\\][^\S\n]*(?:\n|$)/,
];
const DISPLAY = [/^\$\$([\s\S]+?)\$\$/, /^\\\[([\s\S]+?)\\\]/];
const INLINE = [/^\\\(([\s\S]+?)\\\)/, /^\$(?![\s$])((?:\\.|[^\\$])+?)(?<![\s\\])\$(?!\d)/];

const maths = {
  extensions: [
    {
      name: 'mathsBlock',
      level: 'block',
      start: (src) => src.match(/^ {0,3}(?:\$\$|\\\[)/m)?.index,
      tokenizer(src) {
        for (const form of BLOCK) {
          const found = form.exec(src);
          if (found) return { type: 'mathsBlock', raw: found[0], tex: found[1].trim() };
        }
        return undefined;
      },
      renderer: ({ tex }) => `<div class="maths display">${escape(tex)}</div>\n`,
    },
    {
      name: 'maths',
      level: 'inline',
      // An escaped `$` is the escape tokenizer's, not a formula's.
      start: (src) => src.match(/(?<!\\)\$|\\[([]/)?.index,
      tokenizer(src) {
        for (const [forms, display] of [[DISPLAY, true], [INLINE, false]]) {
          for (const form of forms) {
            const found = form.exec(src);
            if (found) return { type: 'maths', raw: found[0], tex: found[1].trim(), display };
          }
        }
        return undefined;
      },
      renderer: ({ tex, display }) => `<span class="maths${display ? ' display' : ''}">${escape(tex)}</span>`,
    },
  ],
};

const markdown = new Marked({ gfm: true }, maths);

// A table's text wraps, and the browser shares the width out by how much each column holds,
// which leaves a column of short entries ("Fig. 1, p. 3") its longest word beside one of
// sentences. So a short entry stays on one line, and a longer one keeps a few words to a line
// (8em, about as wide as a short one); a table that cannot fit then scrolls. Lectern's rule.
const SHORT_CELL = 16;

/** How a table's cell of `text` is laid out: 'short' on one line, 'wide' at least 8em wide. */
export function cellWidth(text) {
  return text.trim().length <= SHORT_CELL ? 'short' : 'wide';
}

/** The markdown as HTML, with each formula a placeholder holding its TeX. Not yet sanitised. */
export function markdownHtml(text) {
  return markdown.parse(text);
}

/**
 * Draws `text` into `element`: sanitised, then the maths, the code and, unless `diagrams` is
 * false (the text still streaming), the diagrams drawn into it.
 */
export function drawMarkdown(element, text, { diagrams = true } = {}) {
  element.innerHTML = DOMPurify.sanitize(markdownHtml(text));
  for (const table of element.querySelectorAll('table')) {
    wrap(table, 'table');
    for (const cell of table.querySelectorAll('th, td')) cell.classList.add(cellWidth(cell.textContent));
  }
  for (const placeholder of element.querySelectorAll('.maths')) {
    katex.render(placeholder.textContent, placeholder, {
      displayMode: placeholder.classList.contains('display'),
      throwOnError: false,
    });
  }
  for (const pre of element.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    const language = /\blanguage-([\w+-]+)/.exec(code?.className ?? '')?.[1];
    if (language === 'mermaid') {
      const figure = wrap(pre, 'diagram');
      if (diagrams) void drawDiagram(figure, pre.textContent);
      continue;
    }
    // Only a block that names its language: guessing goes wrong on a tool's output.
    if (language && hljs.getLanguage(language)) hljs.highlightElement(code);
    const box = wrap(pre, 'code');
    box.append(copyButton(() => (code ?? pre).textContent));
  }
}

// Diagrams.

const DIAGRAM_TEXT = '14px';
// Mermaid lets a diagram shrink to any width; below this share its text is too small to read.
const SMALLEST_DIAGRAM = 0.8;
const drawnDiagrams = new Map(); // source → its drawing, so drawing an answer again is instant
let mermaid = null; // loading Mermaid: a promise
let drawing = Promise.resolve(); // one at a time: Mermaid keeps state between drawings
let drawings = 0;

async function drawDiagram(figure, source) {
  if (!drawnDiagrams.has(source)) {
    try {
      const svg = await draw(source);
      drawnDiagrams.set(source, DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }));
    } catch {
      return; // its source stays
    }
  }
  if (!figure.isConnected || figure.querySelector(':scope > svg')) return;
  figure.insertAdjacentHTML('beforeend', drawnDiagrams.get(source));
  const svg = figure.querySelector(':scope > svg');
  const natural = Number.parseFloat(svg?.style.maxWidth);
  if (natural) svg.style.minWidth = `${natural * SMALLEST_DIAGRAM}px`;
  figure.classList.add('drawn');
}

function draw(source) {
  const drawn = drawing.then(async () => {
    const loaded = await loadMermaid();
    return (await loaded.render(`carrel-diagram-${++drawings}`, source)).svg;
  });
  drawing = drawn.catch(() => {});
  return drawn;
}

function loadMermaid() {
  mermaid ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/static/vendor/mermaid/mermaid.min.js';
    script.addEventListener('load', () => {
      window.mermaid.initialize(mermaidSettings());
      resolve(window.mermaid);
    });
    script.addEventListener('error', () => {
      mermaid = null; // tried again with the next diagram
      reject(new Error('Mermaid did not load'));
    });
    document.head.append(script);
  });
  return mermaid;
}

/** Lectern's settings: the page's colours, muted lines, and text as SVG text. */
function mermaidSettings() {
  const style = getComputedStyle(document.documentElement);
  const token = (name) => style.getPropertyValue(name).trim();
  const fontFamily = token('--ui');
  return {
    // Left on, Mermaid would draw every `.mermaid` on the page by itself.
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    // WebKit measures HTML labels too narrow and wraps them early.
    htmlLabels: false,
    flowchart: { htmlLabels: false, nodeSpacing: 30, rankSpacing: 36, padding: 8 },
    theme: 'base',
    themeVariables: {
      darkMode: matchMedia('(prefers-color-scheme: dark)').matches,
      background: token('--surface'),
      primaryColor: token('--question'),
      primaryTextColor: token('--text'),
      primaryBorderColor: token('--muted'),
      lineColor: token('--muted'),
      textColor: token('--text'),
      edgeLabelBackground: token('--surface'),
      fontFamily,
      fontSize: DIAGRAM_TEXT,
    },
    fontFamily,
    fontSize: Number.parseFloat(DIAGRAM_TEXT),
    // Mermaid lets a line show through half of a label on it.
    themeCSS: '.edgeLabel rect, .labelBkg { opacity: 1; }',
  };
}

function wrap(element, className) {
  const box = document.createElement('div');
  box.className = className;
  element.replaceWith(box);
  box.append(element);
  return box;
}

function copyButton(text) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button copy';
  button.title = 'Copy';
  button.setAttribute('aria-label', 'Copy');
  const svg = button.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
  svg.setAttribute('class', 'icon');
  const use = svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'use'));
  use.setAttribute('href', '#i-copy');
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    navigator.clipboard?.writeText(text()).then(
      () => {
        use.setAttribute('href', '#i-check');
        setTimeout(() => use.setAttribute('href', '#i-copy'), 1200);
      },
      () => {},
    );
  });
  return button;
}

function escape(text) {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
