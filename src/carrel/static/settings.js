// The chat's settings, a dialog opened from the model's name on the chat's status line: the
// model this device's chats start on, kept on the device, and a note about the reader that every
// chat carries in its system prompt, kept on the server. Both reach a chat when its Claude Code
// process starts; a running chat keeps what it started with, so its prompt cache stays valid.

const MODEL_KEY = 'carrel.model';
// A word under each model's name, for the choice.
const HINTS = { opus: 'Deepest', sonnet: 'Balanced', haiku: 'Fastest, cheapest' };
// How long typing in the note pauses before it is saved.
const SAVE_AFTER_MS = 800;

/** What the sheet says when this chat runs on another model than the one chosen, else ''. */
export function modelLine(live, chosen, name) {
  if (!live || !chosen || live === chosen) return '';
  return `This chat stays on ${name(live)}; the next one starts on ${name(chosen)}.`;
}

/**
 * `liveModel()` is the model this chat's process runs on, or null; `name(model)` how the status
 * line names one; `onOpen()` follows the sheet opening, `onModel()` a model being chosen. Returns
 * `model()`, the model this device's chats start on (null until it is known), `show(open)` and
 * `shown()`.
 */
export function startSettings({ liveModel, name, onOpen = () => {}, onModel = () => {} }) {
  const sheet = document.getElementById('settings-dialog');
  const button = document.getElementById('model');
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
  title.append(el('h2', '', 'Chat settings'));
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
  const loading = header('Loading…');

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
        choice.append(el('span', 'dot'), words);
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

  async function show(open) {
    if (!open) {
      if (sheet.open) sheet.close();
      return;
    }
    if (sheet.open) return;
    onOpen();
    sheet.showModal();
    button.setAttribute('aria-expanded', 'true');
    noteSays('');
    sheet.replaceChildren(loading);
    try {
      await load();
    } catch (error) {
      sheet.replaceChildren(header(`Could not read the settings: ${error.message ?? error}`));
      return;
    }
    draw();
    sheet.replaceChildren(title, modelGroup, noteGroup);
  }

  button.addEventListener('click', () => void show(!sheet.open));
  // Done, Escape, or a tap outside it: the note is saved as the dialog closes.
  sheet.addEventListener('close', () => {
    void saveNote();
    button.setAttribute('aria-expanded', 'false');
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
