// Adding papers to the library, and the stream of a command's output that adding and removing
// share. The laptop runs the engine's own commands (edits.py): an arXiv paper is filed by the
// engine, a web page or a PDF goes into the area the reader picks.

import { element } from './rows.js';

const ARXIV = /^(?:https?:\/\/(?:www\.)?(?:export\.)?arxiv\.org\/(?:abs|pdf)\/)?\d{4}\.\d{4,5}(?:v\d+)?(?:\.pdf)?\/?$/i;

/** Whether the engine files `source` itself: an arXiv id or address. */
export function isArxiv(source) {
  return ARXIV.test(source.trim());
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
 * The Add button and its sheet. `topics()` lists the areas; `onAdded()` follows a paper added,
 * and `openPaper({pdf, title})` opens one.
 */
export function startAdding({ topics, onAdded, openPaper }) {
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
      area.append(new Option(`${' '.repeat(depth)}${topic.path.split('/').at(-1).replaceAll('-', ' ')}`, topic.path));
    }
    const named = where.appendChild(element('input'));
    named.type = 'text';
    named.placeholder = 'Its title (if the page or PDF lacks one)';
    named.setAttribute('aria-label', 'Its title');
    const hint = element('p', 'hint', 'An arXiv paper is filed by the library: a model picks its area and writes its summary.');

    const add = element('button', 'primary', 'Add');
    add.type = 'button';
    const log = commandLog();
    log.box.hidden = true;

    const update = () => {
      const pdf = file.files?.[0];
      const filed = !pdf && isArxiv(source.value);
      where.hidden = filed || (!pdf && !source.value.trim());
      hint.textContent = pdf
        ? `${pdf.name}: choose the area it goes in.`
        : filed || !source.value.trim()
          ? 'An arXiv paper is filed by the library: a model picks its area and writes its summary.'
          : 'A web page is printed to a PDF and its text kept; choose the area it goes in.';
      add.disabled = running || (!pdf && !source.value.trim()) || (!filed && !area.value);
    };
    source.addEventListener('input', () => {
      if (source.value) file.value = '';
      update();
    });
    file.addEventListener('change', () => {
      if (file.files?.length) source.value = '';
      update();
    });
    area.addEventListener('change', update);
    source.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !add.disabled) add.click();
    });

    add.addEventListener('click', async () => {
      const pdf = file.files?.[0];
      running = true;
      update();
      log.box.hidden = false;
      log.say(isArxiv(source.value) && !pdf ? 'Asking arXiv, then a model for its area…' : 'Adding…', 'working');
      try {
        const ended = pdf
          ? await runCommand(
              `/api/add?${new URLSearchParams({ topic: area.value, title: named.value, name: pdf.name })}`,
              { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: pdf },
              log.line,
            )
          : await runCommand(
              '/api/add',
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: source.value, topic: area.value, title: named.value }) },
              log.line,
            );
        if (ended.added?.length) {
          const [first] = ended.added;
          log.say(ended.added.length > 1 ? `Added ${ended.added.length} papers.` : `Added “${first.title}”.`, 'done');
          const open = element('button', 'plain', 'Open it');
          open.type = 'button';
          open.addEventListener('click', () => {
            close();
            openPaper(first);
          });
          log.box.append(open);
          source.value = '';
          file.value = '';
          onAdded();
        } else {
          log.say('Nothing was added: the output above says why.', 'error');
        }
      } catch (error) {
        log.say(String(error.message || error), 'error');
      } finally {
        running = false;
        update();
      }
    });

    update();
    const row = element('div', 'add-row');
    row.append(source, add);
    return [title, row, choose, file, where, hint, log.box];
  }

  button.addEventListener('click', open);
  document.addEventListener('pointerdown', (event) => {
    if (!sheet.hidden && !sheet.contains(event.target) && !button.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !sheet.hidden) close();
  });
}
