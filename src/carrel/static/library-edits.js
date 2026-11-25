// Adding papers to the library, and the stream of a command's output that adding and removing
// share. The laptop runs the engine's own commands (edits.py): an arXiv paper is filed by the
// engine, a web page or a PDF goes into the area the reader picks.

import { arxivId, plainTitle } from './library.js';
import { element, icon, paperRow } from './rows.js';

/** Whether the engine files `source` itself: an arXiv id or address. */
export function isArxiv(source) {
  return arxivId(source) !== null;
}

/** The paper in `papers` (the library's document) that `source` names by its arXiv id, if any. */
export function paperNamed(papers, source) {
  const id = arxivId(source);
  return id ? (papers.find((paper) => paper.arxiv === id) ?? null) : null;
}

/**
 * Runs a command on the laptop (a fetch of `url` with `init`) and calls `onLine(text)` with each
 * line it prints. Resolves to how it ended, {code, …what happened}, or rejects with what went
 * wrong.
 */
export async function runCommand(url, init, onLine) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const said = await response.json().catch(() => null);
    throw new Error(said?.error ?? `${response.status} ${response.statusText}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rest = '';
  let ended = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    const lines = rest.split('\n');
    rest = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      const entry = JSON.parse(line);
      if (entry.done) ended = entry;
      else onLine(entry.line);
    }
  }
  if (!ended) throw new Error('The laptop stopped answering before the command ended.');
  return ended;
}

/** The output of a command, as it comes: a box of its lines, and the line that says how it went. */
export function commandLog() {
  const box = element('div', 'command-log');
  const lines = box.appendChild(element('pre', 'lines'));
  const state = box.appendChild(element('p', 'command-state'));
  return {
    box,
    line(text) {
      lines.textContent += `${text}\n`;
      lines.scrollTop = lines.scrollHeight;
    },
    say(text, kind = '') {
      state.textContent = text;
      state.className = `command-state ${kind}`.trim();
    },
  };
}

/**
 * What an add came to, as a card: a heading that says it, the paper (a row as the library draws
 * it, which opens it) or why there is none, the next step, and what the command printed, folded.
 * `outcome` is the server's ({outcome, papers, reason}, edits.py), or 'exists' for a paper the
 * library already has, found before anything ran. `rowOf(paper)` gives the library's own entry
 * for a paper the server named, when it has it; `openButton: false` leaves out Open, when the
 * sheet's own button says it.
 */
export function addResult({ outcome, papers = [], reason = '' }, { printed = '', rowOf = (paper) => paper, onOpen, onAgain, openButton = true }) {
  const box = element('div', `add-result ${outcome}`);
  box.setAttribute('role', 'status');
  const [first] = papers;
  const heads = {
    added: [papers.length > 1 ? `Added ${papers.length} papers` : `Added to ${first?.topic ?? 'the library'}`, 'check'],
    exists: ['Already in your library', 'book-open-check'],
    skipped: ['You skipped this paper before', 'info'],
    failed: ['Not added', 'info'],
  };
  const [text, mark] = heads[outcome] ?? heads.failed;
  const head = box.appendChild(element('p', 'result-head'));
  head.append(icon(mark), element('span', '', text));

  for (const paper of papers.slice(0, 3)) {
    const shown = rowOf(paper);
    const row = paperRow({ ...shown, title: plainTitle(shown.title), year: shown.year ?? String(shown.published ?? '').slice(0, 4) }, { rich: true, topic: outcome === 'exists' });
    row.addEventListener('click', (event) => {
      event.preventDefault();
      onOpen(paper);
    });
    box.append(row);
  }
  if (reason) box.append(element('p', 'result-reason', reason));
  if (outcome === 'skipped') box.append(element('p', 'result-hint', 'To add it, take it out of catalog/skipped.yaml.'));

  const buttons = element('div', 'result-buttons');
  if (first && openButton) {
    const open = buttons.appendChild(element('button', 'primary', 'Open'));
    open.type = 'button';
    open.addEventListener('click', () => onOpen(first));
  }
  if (outcome === 'added' && onAgain) {
    const again = buttons.appendChild(element('button', 'plain', 'Add another'));
    again.type = 'button';
    again.addEventListener('click', onAgain);
  }
  if (buttons.childElementCount) box.append(buttons);

  if (printed) {
    const output = box.appendChild(element('details', 'result-output'));
    output.append(element('summary', '', 'What the library printed'));
    output.append(element('pre', 'lines', printed));
    output.open = outcome === 'failed' && !reason;
  }
  return box;
}

/** While a command runs: what it is doing, and the last line it printed. */
function addProgress(text) {
  const box = element('div', 'add-result running');
  box.setAttribute('role', 'status');
  box.append(element('p', 'command-state working', text));
  const latest = box.appendChild(element('p', 'result-latest'));
  return { box, line: (line) => (latest.textContent = line) };
}

/**
 * The Add button and its sheet. `topics()` lists the areas and `papers()` the library's papers;
 * `onAdded()` follows a paper added, and `openPaper({pdf, title})` opens one.
 */
export function startAdding({ topics, papers = () => [], onAdded, openPaper }) {
  const button = document.getElementById('library-add');
  const sheet = document.getElementById('add-sheet');
  let running = false;

  function open() {
    if (!sheet.hidden) return close();
    sheet.replaceChildren(...form());
    sheet.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const box = button.getBoundingClientRect();
    sheet.style.top = `${box.bottom + 6}px`;
    sheet.style.left = `${Math.max(8, Math.min(box.right - sheet.offsetWidth, window.innerWidth - sheet.offsetWidth - 8))}px`;
    sheet.querySelector('input[type="text"]').focus({ preventScroll: true });
  }

  function close() {
    if (running) return; // the output stays in view until the command ends
    sheet.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  function openIt(paper) {
    close();
    openPaper({ pdf: paper.pdf, title: plainTitle(paper.title) });
  }

  function form() {
    const title = element('div', 'sheet-title');
    title.append(element('h2', '', 'Add a paper'));
    const source = element('input');
    source.type = 'text';
    source.placeholder = "arXiv id or address, or a web page's address";
    source.setAttribute('aria-label', 'What to add');
    Object.assign(source, { autocomplete: 'off', autocapitalize: 'off', spellcheck: false, enterKeyHint: 'go' });
    const file = element('input');
    file.type = 'file';
    file.accept = 'application/pdf,.pdf';
    file.hidden = true;
    const choose = element('button', 'plain', 'or choose a PDF…');
    choose.type = 'button';
    choose.addEventListener('click', () => file.click());

    const where = element('div', 'add-where');
    const area = where.appendChild(element('select'));
    area.setAttribute('aria-label', 'The area it goes in');
    area.append(new Option('Choose its area…', ''));
    for (const topic of topics()) {
      const depth = topic.path.split('/').length - 1;
      area.append(new Option(`${' '.repeat(depth)}${topic.path.split('/').at(-1).replaceAll('-', ' ')}`, topic.path));
    }
    const named = where.appendChild(element('input'));
    named.type = 'text';
    named.placeholder = 'Its title (if the page or PDF lacks one)';
    named.setAttribute('aria-label', 'Its title');
    const hint = element('p', 'hint');

    const add = element('button', 'primary', 'Add');
    add.type = 'button';
    const result = element('div', 'add-results');
    let known = null; // the library's paper the box names, found as it is typed
    let finished = false; // a command's card is showing, until the box changes

    const rowOf = (paper) => papers().find((each) => each.pdf === paper.pdf) ?? paper;
    const again = () => {
      finished = false;
      result.replaceChildren();
      update();
      source.focus({ preventScroll: true });
    };

    const update = () => {
      const pdf = file.files?.[0];
      known = pdf ? null : paperNamed(papers(), source.value);
      const filed = !pdf && isArxiv(source.value);
      where.hidden = filed || (!pdf && !source.value.trim());
      hint.hidden = Boolean(known) || finished;
      hint.textContent = pdf
        ? `${pdf.name}: choose the area it goes in.`
        : filed || !source.value.trim()
          ? 'An arXiv paper is filed by the library: a model picks its area and writes its summary.'
          : 'A web page is printed to a PDF and its text kept; choose the area it goes in.';
      add.textContent = known ? 'Open' : 'Add';
      add.disabled = running || (!known && ((!pdf && !source.value.trim()) || (!filed && !area.value)));
      if (!running && !finished) {
        result.replaceChildren(...(known ? [addResult({ outcome: 'exists', papers: [known] }, { onOpen: openIt, openButton: false })] : []));
      }
    };
    const changed = () => {
      if (running) return;
      finished = false;
      update();
    };
    source.addEventListener('input', () => {
      if (source.value) file.value = '';
      changed();
    });
    file.addEventListener('change', () => {
      if (file.files?.length) source.value = '';
      changed();
    });
    area.addEventListener('change', update);
    source.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !add.disabled) add.click();
    });

    add.addEventListener('click', async () => {
      if (known) return openIt(known);
      const pdf = file.files?.[0];
      running = true;
      update();
      const progress = addProgress(isArxiv(source.value) && !pdf ? 'Asking arXiv, then a model for its area…' : 'Adding…');
      result.replaceChildren(progress.box);
      const printed = [];
      const onLine = (line) => {
        printed.push(line);
        if (line.trim()) progress.line(line.trim());
      };
      let card;
      try {
        const ended = pdf
          ? await runCommand(
              `/api/add?${new URLSearchParams({ topic: area.value, title: named.value, name: pdf.name })}`,
              { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: pdf },
              onLine,
            )
          : await runCommand(
              '/api/add',
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: source.value, topic: area.value, title: named.value }) },
              onLine,
            );
        card = ended;
        if (ended.outcome === 'added') {
          source.value = '';
          file.value = '';
          onAdded();
        }
      } catch (error) {
        card = { outcome: 'failed', reason: String(error.message || error) };
      } finally {
        running = false;
        finished = true;
        update();
      }
      result.replaceChildren(addResult(card, { printed: printed.join('\n'), rowOf, onOpen: openIt, onAgain: again }));
    });

    update();
    const row = element('div', 'add-row');
    row.append(source, add);
    return [title, row, choose, file, where, hint, result];
  }

  button.addEventListener('click', open);
  document.addEventListener('pointerdown', (event) => {
    if (!sheet.hidden && !sheet.contains(event.target) && !button.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !sheet.hidden) close();
  });
  /** Whether a paper is being added: its PDF may still be on its way to the laptop. */
  return { busy: () => running };
}
