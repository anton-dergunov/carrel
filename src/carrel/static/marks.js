// The reader's own marks on a paper: a star, for a paper to read later, and tags, which gather
// papers for one of the reader's projects across the areas. Only the reader sets them, here: the
// server writes them through the engine into the library's catalog/reader.yaml, which no agent
// may write. The library's document is changed at once, and the views drawn again.

import { haystackOf, loadLibrary } from './library.js';
import { element, icon } from './rows.js';

const RECENT_KEY = 'carrel.recent-tags';
const RECENT = 6; // tags this device used last, offered first
const listeners = new Set();

/**
 * A tag's name as the engine makes it from what was typed: lower case, ASCII, words joined by
 * hyphens, at most 40 characters; '' when nothing usable is left (`tag_name` in paperlib.py).
 */
export function tagName(text) {
  const made = String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return made.length <= 40 ? made : '';
}

/** The tags in the order a picker offers them: this device's recent ones, then the latest used. */
export function orderTags(tags, recent = []) {
  const place = new Map(recent.map((name, i) => [name, i]));
  return [...tags].sort((a, b) => {
    const ra = place.get(a.name) ?? Infinity;
    const rb = place.get(b.name) ?? Infinity;
    if (ra !== rb) return ra - rb;
    return String(b.latest ?? '').localeCompare(String(a.latest ?? '')) || a.name.localeCompare(b.name);
  });
}

/** Listens for a change to the marks: `listener(pdf)`, the paper changed, or null for a tag's. */
export function onMarks(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(pdf) {
  for (const listener of listeners) listener(pdf);
}

/** Stars a paper to read later, or takes the star off: the day it is starred, or null. */
export async function setStar(pdf, on) {
  const reply = await send(`/api/star/${pathUrl(pdf)}`, 'PUT', { on });
  const paper = await paperOf(pdf);
  if (paper) {
    if (reply.starred) paper.starred = reply.starred;
    else delete paper.starred;
  }
  changed(pdf);
  return reply.starred;
}

/** Gives a paper exactly these tags: its tags as the server keeps them. */
export async function setTags(pdf, names) {
  const before = (await paperOf(pdf))?.tags ?? [];
  const reply = await send(`/api/tags/${pathUrl(pdf)}`, 'PUT', { tags: names });
  remember(reply.tags.filter((name) => !before.includes(name)));
  const doc = await library();
  if (doc) doc.tags = reply.all;
  const paper = doc?.byPdf.get(pdf.normalize('NFC'));
  if (paper) {
    if (reply.tags.length) paper.tags = reply.tags;
    else delete paper.tags;
    paper.haystack = haystackOf(paper);
  }
  changed(pdf);
  return reply.tags;
}

/** A tag's description, or its new name (onto another tag, the two become one): its name now. */
export async function editTag(name, { about, rename } = {}) {
  const reply = await send(`/api/tag/${encodeURIComponent(name)}`, 'PUT', { about, name: rename });
  const doc = await library();
  if (doc) {
    doc.tags = reply.all;
    if (reply.name !== name) retag(doc, name, reply.name);
  }
  changed(null);
  return reply.name;
}

/** Takes a tag off every paper. */
export async function deleteTag(name) {
  const reply = await send(`/api/tag/${encodeURIComponent(name)}`, 'DELETE');
  const doc = await library();
  if (doc) {
    doc.tags = reply.all;
    retag(doc, name, null);
  }
  changed(null);
}

function retag(doc, from, to) {
  for (const paper of doc.papers) {
    if (!paper.tags?.includes(from)) continue;
    const tags = [...new Set(paper.tags.map((name) => (name === from ? to : name)).filter(Boolean))].sort();
    if (tags.length) paper.tags = tags;
    else delete paper.tags;
    paper.haystack = haystackOf(paper);
  }
}

// The controls.

/**
 * The star: a button, filled when the paper is starred. `starred` is the day it was, or null.
 * The change shows at once, and goes back if the laptop could not keep it.
 */
export function starButton(pdf, starred, { className = 'icon-button star-button' } = {}) {
  const button = element('button', className);
  button.type = 'button';
  button.append(icon('star'));
  const show = (day) => {
    button.setAttribute('aria-pressed', String(Boolean(day)));
    const label = day ? `Starred to read, ${day}. Take the star off` : 'Star it to read later';
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  let day = starred ?? null;
  show(day);
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const was = day;
    day = was ? null : new Date().toISOString().slice(0, 10);
    show(day);
    try {
      day = await setStar(pdf, !was);
      show(day);
    } catch (error) {
      day = was;
      show(day);
      console.warn(`The star was not saved: ${error.message}`);
    }
  });
  return button;
}

/**
 * The paper's tags as pills, each with a ×, and a Tag button that opens the picker under them:
 * a field to find a tag or make one, and the tags with a check on the paper's own.
 */
export function tagLine(pdf, tags) {
  const box = element('div', 'tag-line');
  let mine = [...(tags ?? [])];
  let picker = null;

  const draw = () => {
    const pills = element('div', 'tag-pills');
    for (const name of mine) {
      const pill = pills.appendChild(element('span', 'tag-pill'));
      pill.append(icon('tag'), element('span', 'name', name));
      const remove = pill.appendChild(element('button', 'plain remove'));
      remove.type = 'button';
      remove.setAttribute('aria-label', `Take the tag ${name} off`);
      remove.title = `Take ${name} off`;
      remove.append(icon('close'));
      remove.addEventListener('click', () => void save(mine.filter((each) => each !== name)));
    }
    const add = pills.appendChild(element('button', 'plain tag-add'));
    add.type = 'button';
    add.setAttribute('aria-expanded', String(Boolean(picker)));
    add.append(icon('plus'), mine.length ? 'Tag' : 'Add a tag');
    add.addEventListener('click', () => (picker ? closePicker() : void openPicker()));
    box.replaceChildren(pills, ...(picker ? [picker.box] : []));
  };

  async function save(next) {
    const was = mine;
    mine = [...new Set(next)].sort();
    draw();
    try {
      mine = await setTags(pdf, mine);
    } catch (error) {
      mine = was;
      console.warn(`The tags were not saved: ${error.message}`);
    }
    draw();
    picker?.fill();
  }

  async function openPicker() {
    const doc = await library();
    picker = tagPicker({
      all: () => doc?.tags ?? [],
      mine: () => mine,
      toggle: (name) => void save(mine.includes(name) ? mine.filter((each) => each !== name) : [...mine, name]),
      close: closePicker,
    });
    draw();
    picker.focus();
  }

  function closePicker() {
    picker = null;
    draw();
  }

  draw();
  return box;
}

function tagPicker({ all, mine, toggle, close }) {
  const box = element('div', 'tag-picker');
  const field = box.appendChild(element('input'));
  field.type = 'text';
  field.placeholder = 'Find a tag, or name a new one';
  field.setAttribute('aria-label', 'A tag');
  field.autocapitalize = 'none';
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.enterKeyHint = 'done';
  const list = box.appendChild(element('div', 'tag-choices'));
  list.setAttribute('role', 'listbox');
  const done = box.appendChild(element('button', 'plain tag-done', 'Done'));
  done.type = 'button';
  done.addEventListener('click', close);

  const fill = () => {
    const typed = field.value.trim().toLowerCase();
    const name = tagName(field.value);
    const tags = orderTags(all(), recent()).filter((tag) => !typed || tag.name.includes(name || typed));
    const rows = tags.map((tag) => {
      const on = mine().includes(tag.name);
      const row = element('button', 'choice tag-choice');
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(on));
      row.append(element('span', 'check'), element('span', 'choice-label', tag.name));
      if (tag.about) row.append(element('span', 'about', tag.about));
      row.append(element('span', 'count', String(tag.count)));
      row.addEventListener('click', () => toggle(tag.name));
      return row;
    });
    if (name && !all().some((tag) => tag.name === name)) {
      const make = element('button', 'choice tag-new');
      make.type = 'button';
      make.append(icon('plus'), element('span', 'choice-label', `New tag “${name}”`));
      make.addEventListener('click', () => {
        field.value = '';
        toggle(name);
      });
      rows.unshift(make);
    }
    if (!rows.length) rows.push(element('p', 'none', 'No tags yet. Type a name for one: a project, a talk, a question.'));
    list.replaceChildren(...rows);
  };
  field.addEventListener('input', fill);
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const name = tagName(field.value);
      if (name && !mine().includes(name)) {
        field.value = '';
        toggle(name);
      } else if (!field.value) close();
    }
  });
  fill();
  return { box, fill, focus: () => field.focus({ preventScroll: true }) };
}

// The laptop.

async function send(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const reply = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(reply.error || `${response.status} ${response.statusText}`);
  return reply;
}

async function library() {
  return loadLibrary().catch(() => null);
}

async function paperOf(pdf) {
  return (await library())?.byPdf.get(pdf.normalize('NFC')) ?? null;
}

function pathUrl(file) {
  return file.split('/').map(encodeURIComponent).join('/');
}

/** The tags this device used last, the latest first. */
export function recentTags() {
  return recent();
}

function recent() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((name) => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

function remember(names) {
  if (!names.length) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([...names, ...recent().filter((name) => !names.includes(name))].slice(0, RECENT)));
  } catch {
    // Private browsing: the order lasts as long as the page.
  }
}
