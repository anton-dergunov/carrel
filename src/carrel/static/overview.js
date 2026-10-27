// The paper's overview: the reader's pre-read note, which the library's /overview skill writes
// into their notes folder. The button on the chat's status line shows the note when the paper
// has one, with no model call, and otherwise asks /overview: in the chat being read in when it is
// only about this paper, else in a new one. The skill reads the paper into that chat, so the
// questions after it find the paper in its cache.
//
// The note opens in a sheet over the chat, beside the paper. Delete moves it to the Trash, for a
// note wanted only for this reading. A link to a note in the chat, which the skill writes as the
// note's path on the laptop, opens the note too, with its paper when another one is open.

import { decode, sameFile } from './links.js';
import { drawMarkdown } from './markdown.js';

const COMMAND = '/overview';

/**
 * `ask(text, pdf)` asks a question about the paper, in the chat or a new one; `openPaper(pdf)`
 * opens another paper with the chat in view; `onOpen()` closes what else covers the chat.
 * Returns `about(pdf)`, the paper the chat asks about now (or null), `show()`, `hide()`,
 * `turnEnded(question)`, for a turn the page watched end, and `opensLink(url)`, which follows a
 * link to an overview note and says whether it was one.
 */
export function startOverview({ ask, openPaper, onOpen = () => {} }) {
  const button = document.getElementById('overview');
  const sheet = document.getElementById('overview-sheet');

  let pdf = null;
  let note = null; // {name, text} of the paper's note, or null for none
  let asked = 0; // the lookup in flight, so an older one's answer is dropped
  let wanted = null; // the paper whose note a link asked for, shown once it is found

  function about(next) {
    if (next === pdf) return;
    if (next !== wanted) wanted = null;
    pdf = next;
    note = null;
    hide();
    look();
    if (pdf) void lookUp();
  }

  async function lookUp() {
    const mine = ++asked;
    let found = null;
    try {
      const response = await fetch(`/api/overview/${pdf.split('/').map(encodeURIComponent).join('/')}`);
      if (response.ok) found = await response.json();
    } catch {
      return; // offline: the button stays as it was
    }
    if (mine !== asked) return;
    note = found;
    look();
    if (note && wanted === pdf) {
      wanted = null;
      show();
    }
  }

  function look() {
    button.hidden = !pdf;
    button.classList.toggle('has-note', Boolean(note));
    const label = note ? 'Show the overview' : 'Write an overview';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.querySelector('use').setAttribute('href', note ? '#i-notebook-text' : '#i-notebook-pen');
  }

  function show() {
    if (!note) return;
    onOpen();
    const header = document.createElement('div');
    header.className = 'sheet-header';
    const name = header.appendChild(document.createElement('span'));
    name.className = 'name';
    name.textContent = note.name;
    const buttons = header.appendChild(document.createElement('span'));
    buttons.className = 'buttons';
    const remove = buttons.appendChild(plainButton('Delete', () => confirmDelete(buttons)));
    remove.title = 'Move this note to the Trash';
    buttons.append(plainButton('Close', hide));
    const body = document.createElement('div');
    body.className = 'answer note';
    drawMarkdown(body, fromObsidian(note.text));
    sheet.replaceChildren(header, body);
    sheet.hidden = false;
    sheet.scrollTop = 0;
    button.setAttribute('aria-expanded', 'true');
  }

  function confirmDelete(buttons) {
    const why = document.createElement('span');
    why.className = 'why';
    why.textContent = 'The note goes to the Trash.';
    buttons.replaceChildren(why, plainButton('Delete', () => void remove()), plainButton('Keep', show));
  }

  async function remove() {
    const from = pdf;
    const response = await fetch(`/api/overview/${from.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'DELETE',
    }).catch(() => null);
    if (!response?.ok && response?.status !== 404) {
      sheet.querySelector('.why').textContent = 'Could not reach the laptop; the note is still there.';
      return;
    }
    if (from !== pdf) return;
    note = null;
    hide();
    look();
  }

  function hide() {
    sheet.hidden = true;
    sheet.replaceChildren();
    button.setAttribute('aria-expanded', 'false');
  }

  /** A turn this page watched ended: the agent may have written the note. */
  async function turnEnded(question) {
    if (!pdf) return;
    await lookUp();
    if (note && question?.trim().startsWith(COMMAND)) show();
  }

  /**
   * A link to an overview note, as the skill's reply gives it: the note's path on the laptop,
   * which the browser has made a path on this server.
   */
  function opensLink(url) {
    if (url.origin !== location.origin || !url.pathname.endsWith('.md')) return false;
    const path = decode(url.pathname);
    if (note && sameFile(path.split('/').at(-1), `${note.name}.md`)) show();
    else void openNote(path, url.href);
    return true;
  }

  /** Another paper's note: its paper opens, and the note with it once it is found. */
  async function openNote(path, href) {
    const response = await fetch(`/api/overview-note?path=${encodeURIComponent(path)}`).catch(() => null);
    if (!response?.ok) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    const { pdf: its } = await response.json();
    const open = its === pdf; // then opening it looks nothing up
    wanted = its;
    await openPaper(its);
    if (open) void lookUp();
  }

  button.addEventListener('click', () => {
    if (!sheet.hidden) hide();
    else if (note) show();
    else ask(COMMAND, pdf);
  });

  look();
  return { about, show, hide, turnEnded, opensLink, has: () => Boolean(note) };
}

function plainButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'plain';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

/**
 * An Obsidian note as plain markdown: without its properties (the paper's sheet shows them), a
 * callout's marker as its title, and [[links]] as the text they show, since the notes they name
 * are not here.
 */
export function fromObsidian(text) {
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^> \[!(\w+)\][+-]? *(.*)$/gm, (_, kind, title) => `> **${title || kind.charAt(0).toUpperCase() + kind.slice(1)}**\n>`)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, name, alias) => alias ?? name);
}
