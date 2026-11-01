// The settings, one dialog, opened from the gear in the tab strip, or at the chat's part from the
// model's name on the chat's status line. The look, kept on this device by boot.js: the colours,
// whether a dark theme darkens the paper, the text sizes of the library, the chat and the rest,
// and how a paper's pages are drawn; and where the chat sits, kept by layout.js. The chat's: the model this device's chats
// start on, kept on the device, and a note about the reader that every chat carries in its system
// prompt, kept on the server. Both reach a chat when its Claude Code process starts; a running
// chat keeps what it started with, so its prompt cache stays valid.
import { icon } from './rows.js';

const MODEL_KEY = 'carrel.model';
// A word under each model's name, for the choice.
const HINTS = { opus: 'Deepest', sonnet: 'Balanced', haiku: 'Fastest, cheapest' };
// How long typing in the note pauses before it is saved.
const SAVE_AFTER_MS = 800;
const FAMILIES = [
  ['carrel', 'Carrel'],
  ['plain', 'Black & white'],
  ['eink', 'E-ink'],
];
const MODES = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'Follow system'],
];
const INKS = [
  ['mono', 'Black only'],
  ['colour', 'With colour'],
];
// Settings → Pages: the strengths the reader judged in crisp-pages, as words.
const STRENGTHS = ['Off', 'Light', 'More', 'Most'];
const PARTS = [
  ['library', 'Library'],
  ['chat', 'Chat'],
  ['ui', 'Everything else'],
];
// Where the chat sits (layout.js's places), with the icon the Chat button shows for each.
const PLACES = [
  ['bottom', 'Below', 'panel-bottom'],
  ['top', 'Above', 'panel-top'],
  ['left', 'Left', 'panel-left'],
  ['right', 'Right', 'panel-right'],
  ['sheet', 'Over', 'panel-bottom-open'],
  ['tab', 'A tab', 'chat'],
];

/** The part of the dialog `show` opens at: the top, or the chat's ('chat'). */
export function sectionFor(asked) {
  return asked === 'chat' ? 'chat' : 'top';
}

/** What the sheet says when this chat runs on another model than the one chosen, else ''. */
export function modelLine(live, chosen, name) {
  if (!live || !chosen || live === chosen) return '';
  return `This chat stays on ${name(live)}; the next one starts on ${name(chosen)}.`;
}

/**
 * `liveModel()` is the model this chat's process runs on, or null; `name(model)` how the status
 * line names one; `onOpen()` follows the sheet opening, `onModel()` a model being chosen;
 * `layout` is layout.js's control, for where the chat sits. Returns
 * `model()`, the model this device's chats start on (null until it is known), `show(open,
 * section)` and `shown()`.
 */
export function startSettings({ liveModel, name, onOpen = () => {}, onModel = () => {}, layout = null }) {
  const sheet = document.getElementById('settings-dialog');
  const button = document.getElementById('model');
  const gear = document.getElementById('settings-button');
  const look = window.carrelLook;
  let models = [];
  let defaultModel = null;
  let chosen = rememberedModel();
  let savedNote = null;
  let saveTimer = 0;
  let saving = Promise.resolve();

  const el = (tag, className, text) => {
    const made = document.createElement(tag);
    if (className) made.className = className;
    if (text) made.textContent = text;
    return made;
  };
  const header = (text) => el('div', 'sheet-header', text);

  // The sheet's title, and Done.
  const title = el('div', 'settings-title');
  title.append(el('h2', '', 'Settings'));
  const done = title.appendChild(el('button', 'plain', 'Done'));
  done.type = 'button';
  done.addEventListener('click', () => void show(false));

  // The model: one of a row of choices, kept on this device.
  const choices = el('div', 'model-choices');
  choices.setAttribute('role', 'radiogroup');
  choices.setAttribute('aria-label', 'The model new chats start on');
  const line = el('p', 'hint');
  const modelGroup = el('section', 'group');
  modelGroup.append(groupTitle('div', 'Model', 'this device'), choices, line);

  // The note about the reader: kept on the server, for every device.
  const note = Object.assign(el('textarea'), {
    id: 'reader-note',
    rows: 5,
    placeholder: 'Who you are, what you know, how you like answers',
    autocapitalize: 'sentences',
  });
  const noteState = el('span', 'state');
  noteState.setAttribute('aria-live', 'polite');
  const count = el('span', 'count');
  const noteFoot = el('div', 'note-foot');
  noteFoot.append(el('span', 'hint', "Added to each new chat's instructions."), noteState, count);
  const noteGroup = el('section', 'group note-group');
  const noteLabel = groupTitle('label', 'About me', 'every device');
  noteLabel.htmlFor = 'reader-note';
  noteGroup.append(noteLabel, note, noteFoot);
  const chatPart = el('div', 'chat-part');
  const loading = header('Loading…');

  // The look: kept on this device by boot.js, and applied as it is chosen.
  const choiceRow = (label, pref, values) => {
    const control = el('div', 'segmented');
    control.setAttribute('role', 'radiogroup');
    control.setAttribute('aria-label', label);
    for (const [value, text] of values) {
      const choice = control.appendChild(el('button', '', text));
      choice.type = 'button';
      choice.setAttribute('role', 'radio');
      choice.dataset.pref = pref;
      choice.dataset.value = String(value);
      choice.addEventListener('click', () => {
        look.set(pref, value);
        drawLook();
      });
    }
    return control;
  };
  const switchRow = (words, pref) => {
    const row = el('button', 'switch-row');
    row.type = 'button';
    row.setAttribute('role', 'switch');
    row.dataset.switch = pref;
    row.append(el('span', 'words', words), el('span', 'switch'));
    row.addEventListener('click', () => {
      look.set(pref, !look.prefs[pref]);
      drawLook();
    });
    return row;
  };
  const families = choiceRow('Colours', 'family', FAMILIES);
  const modes = choiceRow('Light or dark', 'mode', MODES);
  const inks = choiceRow('The screen', 'ink', INKS);
  const darkPages = el('button', 'switch-row');
  darkPages.type = 'button';
  darkPages.setAttribute('role', 'switch');
  darkPages.append(el('span', 'words', 'Dark pages'), el('span', 'switch'));
  darkPages.addEventListener('click', () => {
    look.set('darkPages', !look.prefs.darkPages);
    drawLook();
  });
  const darkHint = el('p', 'hint', 'In a dark theme, the paper is drawn light on dark too.');
  const colourGroup = el('section', 'group look-group');
  colourGroup.append(groupTitle('div', 'Colours', 'this device'), families, modes, inks, darkPages, darkHint);

  const sizes = el('div', 'sizes');
  const steppers = PARTS.map(([part, label]) => {
    const row = sizes.appendChild(el('div', 'size-row'));
    row.append(el('span', 'size-name', label));
    const stepper = row.appendChild(el('div', 'stepper'));
    const step = (by, text, words) => {
      const made = el('button', '', text);
      made.type = 'button';
      made.setAttribute('aria-label', `${words} ${label.toLowerCase()} text`);
      made.addEventListener('click', () => {
        look.set(part, look.prefs[part] + by);
        drawLook();
      });
      return made;
    };
    const less = step(-1, '−', 'Smaller');
    const value = el('output', 'size-value');
    const more = step(1, '+', 'Larger');
    stepper.append(less, value, more);
    return { part, less, value, more };
  });
  const sizeGroup = el('section', 'group look-group');
  sizeGroup.append(groupTitle('div', 'Text size', 'this device'), sizes);

  // How a paper's pages are drawn (crisp-pages): one switch over the adjustments, which keeps
  // them when off, so a paper can be seen as it is and back in a tap.
  const pagesSwitch = switchRow('Adjust pages', 'pages');
  const pagesHint = el('p', 'hint', 'Off, every paper is drawn as it is.');
  const outlines = switchRow('Letters as outlines', 'outlines');
  const outlinesHint = el('p', 'hint', 'Crisper on e-ink; softer on a monitor.');
  const labelled = (label, control) => {
    const row = el('div', 'pages-row');
    row.append(el('span', 'pages-name', label), control);
    return row;
  };
  const tone = labelled('Darker greys', choiceRow('Darker greys', 'tone', look.tones.map((v, i) => [v, STRENGTHS[i]])));
  const contrast = labelled('Contrast', choiceRow('Contrast', 'contrast', look.contrasts.map((v, i) => [v, STRENGTHS[i]])));
  const scans = switchRow('Scans in black and white', 'scans');
  const scansHint = el('p', 'hint', 'Only on the pages of a paper that are scans.');
  const adjustments = el('div', 'pages-adjustments');
  adjustments.append(outlines, outlinesHint, tone, contrast, scans, scansHint);
  const pagesGroup = el('section', 'group look-group');
  pagesGroup.append(groupTitle('div', 'Pages', 'this device'), pagesSwitch, pagesHint, adjustments);

  // Where the chat sits: applied at once, behind the dialog.
  const places = el('div', 'place-choices');
  places.setAttribute('role', 'radiogroup');
  places.setAttribute('aria-label', 'Where the chat sits');
  for (const [place, text, iconName] of PLACES) {
    const choice = places.appendChild(el('button'));
    choice.type = 'button';
    choice.setAttribute('role', 'radio');
    choice.dataset.place = place;
    choice.append(icon(iconName), el('span', '', text));
    choice.addEventListener('click', () => {
      layout.set({ place, hidden: false });
      drawLook();
    });
  }
  const resetSize = el('button', 'plain', 'Default size');
  resetSize.type = 'button';
  resetSize.addEventListener('click', () => layout.resetShare());
  const placeFoot = el('div', 'place-foot');
  placeFoot.append(el('span', 'hint', 'Drag the split between them to resize the chat.'), resetSize);
  // On a phone the bar has no room for the Chat button, so it is here.
  const chatShown = el('button', 'switch-row phone-only');
  chatShown.type = 'button';
  chatShown.setAttribute('role', 'switch');
  chatShown.append(el('span', 'words', 'Show the chat'), el('span', 'switch'));
  chatShown.addEventListener('click', () => {
    layout.set({ hidden: !layout.get().hidden });
    drawLook();
  });
  const layoutGroup = el('section', 'group look-group');
  layoutGroup.append(groupTitle('div', 'Layout', 'this device'), chatShown, places, placeFoot);

  // Two columns where the dialog is wide enough (the CSS decides): the look, then the rest.
  const columns = el('div', 'settings-columns');
  const lookColumn = columns.appendChild(el('div', 'settings-column'));
  const restColumn = columns.appendChild(el('div', 'settings-column'));
  lookColumn.append(colourGroup, sizeGroup, pagesGroup);

  function drawLook() {
    const { prefs, sizes: range } = look;
    for (const choice of [...colourGroup.querySelectorAll('[data-pref]'), ...pagesGroup.querySelectorAll('[data-pref]')]) {
      choice.setAttribute('aria-checked', String(String(prefs[choice.dataset.pref]) === choice.dataset.value));
    }
    for (const row of pagesGroup.querySelectorAll('[data-switch]')) {
      row.setAttribute('aria-checked', String(prefs[row.dataset.switch]));
    }
    adjustments.hidden = !prefs.pages;
    pagesHint.hidden = prefs.pages;
    const eink = prefs.family === 'eink';
    modes.hidden = eink;
    inks.hidden = !eink;
    darkPages.hidden = eink;
    darkHint.hidden = eink;
    darkPages.setAttribute('aria-checked', String(prefs.darkPages));
    for (const { part, less, value, more } of steppers) {
      value.textContent = `${prefs[part]} px`;
      less.disabled = prefs[part] <= range[part][0];
      more.disabled = prefs[part] >= range[part][1];
    }
    if (!layout) return;
    const { place, hidden } = layout.get();
    for (const choice of places.children) choice.setAttribute('aria-checked', String(choice.dataset.place === place));
    // On a tab of its own, the chat has no split to size.
    placeFoot.hidden = place === 'tab';
    chatShown.hidden = place === 'tab';
    chatShown.setAttribute('aria-checked', String(!hidden));
  }

  function groupTitle(tag, text, scope) {
    const made = el(tag, 'group-title', text);
    made.append(el('span', 'scope', `· ${scope}`));
    return made;
  }

  function countNote() {
    count.textContent = `${note.value.length} / ${note.maxLength}`;
  }

  function noteSays(text, warn = false) {
    noteState.textContent = text;
    noteState.classList.toggle('warn', warn);
  }

  async function load() {
    const response = await fetch('/api/settings');
    if (!response.ok) throw new Error(await response.text());
    const settings = await response.json();
    models = settings.models;
    defaultModel = settings.default_model;
    if (!models.some((m) => m.id === chosen)) chosen = null;
    note.maxLength = settings.longest_note;
    if (savedNote === null || note.value === savedNote) note.value = settings.note;
    savedNote = settings.note;
    countNote();
    onModel();
  }

  function model() {
    return chosen ?? defaultModel;
  }

  function draw() {
    choices.replaceChildren(
      ...models.map((m) => {
        const choice = el('button');
        choice.type = 'button';
        choice.setAttribute('role', 'radio');
        choice.setAttribute('aria-checked', String(m.id === model()));
        const words = el('span', 'words');
        words.append(el('span', 'name', m.name));
        if (HINTS[m.id]) words.append(el('span', 'sub', HINTS[m.id]));
        choice.append(el('span', 'radio'), words);
        choice.addEventListener('click', () => {
          chosen = m.id;
          rememberModel(chosen);
          draw();
          onModel();
        });
        return choice;
      }),
    );
    line.textContent = modelLine(liveModel(), model(), name) || 'New chats on this device start on it.';
  }

  /** Saves the note when it changed; a failure says why and is tried again at the next change. */
  function saveNote() {
    clearTimeout(saveTimer);
    saving = saving.then(async () => {
      const text = note.value;
      if (savedNote === null || text === savedNote) return;
      try {
        const response = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: text }),
        });
        if (!response.ok) throw new Error(await response.text());
        savedNote = (await response.json()).note;
        noteSays(note.value === savedNote ? '✓ Saved' : '');
      } catch (error) {
        noteSays(`Not saved: ${error.message ?? error}`, true);
      }
    });
    return saving;
  }
  note.addEventListener('input', () => {
    countNote();
    noteSays('');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNote, SAVE_AFTER_MS);
  });
  note.addEventListener('blur', () => void saveNote());

  async function show(open, asked = 'top') {
    if (!open) {
      if (sheet.open) sheet.close();
      return;
    }
    const section = sectionFor(asked);
    // The dialog scrolls, under its title; in one column, the chat's part is below the look's.
    const reveal = () => (sheet.scrollTop = section === 'chat' ? chatPart.offsetTop - title.offsetHeight - 12 : 0);
    (section === 'chat' ? button : gear).setAttribute('aria-expanded', 'true');
    if (sheet.open) return reveal();
    onOpen();
    drawLook();
    chatPart.replaceChildren(loading);
    restColumn.replaceChildren(...(layout ? [layoutGroup] : []), chatPart);
    sheet.replaceChildren(title, columns);
    sheet.showModal();
    noteSays('');
    reveal();
    try {
      await load();
    } catch (error) {
      chatPart.replaceChildren(header(`Could not read the chat's settings: ${error.message ?? error}`));
      return;
    }
    draw();
    chatPart.replaceChildren(modelGroup, noteGroup);
    reveal();
  }

  button.addEventListener('click', () => void show(!sheet.open, 'chat'));
  gear.addEventListener('click', () => void show(!sheet.open));
  // Done, Escape, or a tap outside it: the note is saved as the dialog closes.
  sheet.addEventListener('close', () => {
    void saveNote();
    button.setAttribute('aria-expanded', 'false');
    gear.setAttribute('aria-expanded', 'false');
  });
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) void show(false);
  });
  // The model new chats start on is needed before the sheet is first opened.
  load().catch(() => {});

  return { model, show, shown: () => sheet.open };
}

function rememberedModel() {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

function rememberModel(model) {
  try {
    localStorage.setItem(MODEL_KEY, model);
  } catch {
    // Private browsing: the choice lasts as long as the page.
  }
}
