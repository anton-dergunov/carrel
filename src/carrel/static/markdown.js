// The agent's markdown as the page draws it: GFM, maths, and code, as VS Code's panel shows them.
//
// Maths comes in all four of the forms the agent writes: $…$ and \(…\) in a line, $$…$$ and
// \[…\] set apart. marked leaves each as a placeholder holding its TeX; the HTML is sanitised;
// then KaTeX draws into the placeholders, so its own output never passes through DOMPurify and
// what the agent wrote is never trusted as HTML. A `$` follows Pandoc's rule (no space inside
// either `$`, no digit after the closing one), so "$5 and $10" stays text.

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

/** The markdown as HTML, with each formula a placeholder holding its TeX. Not yet sanitised. */
export function markdownHtml(text) {
  return markdown.parse(text);
}

/** Draws `text` into `element`: sanitised, then the maths and the code drawn into it. */
export function drawMarkdown(element, text) {
  element.innerHTML = DOMPurify.sanitize(markdownHtml(text));
  for (const table of element.querySelectorAll('table')) wrap(table, 'table');
  for (const placeholder of element.querySelectorAll('.maths')) {
    katex.render(placeholder.textContent, placeholder, {
      displayMode: placeholder.classList.contains('display'),
      throwOnError: false,
    });
  }
  for (const pre of element.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    const language = /\blanguage-([\w+-]+)/.exec(code?.className ?? '')?.[1];
    // Only a block that names its language: guessing goes wrong on a tool's output.
    if (language && hljs.getLanguage(language)) hljs.highlightElement(code);
    const box = wrap(pre, 'code');
    box.append(copyButton(() => (code ?? pre).textContent));
  }
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
