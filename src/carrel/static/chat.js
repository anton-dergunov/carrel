// The chat beside the papers. A chat lives on the server; this page attaches to it over a WebSocket
// and draws its messages, each {seq, kind, data}, `kind` being the SDK's class name. When the
// socket drops (a reload, another paper, the tablet asleep), the page attaches again and asks
// only for the messages after the last it drew.
//
// Each question opens a turn: the answer is drawn as markdown (with its maths and code), and
// everything else (tools, thinking, system messages, text written between tool calls) folds into
// one row per turn. A kind this page does not know is a plain row in that fold, so an SDK update
// never breaks the chat, it only looks plainer.
//
// A question that starts with `/` is a slash command, run by Claude Code as in the terminal; the
// box lists the commands that match while one is typed.

import { parsePaperLink } from './links.js';
import { drawMarkdown } from './markdown.js';
import { startOverview } from './overview.js';
import { startSettings } from './settings.js';

const RESULT_PREVIEW = 4000;
// System messages that say nothing to the reader.
const QUIET_SYSTEM = new Set(['thinking_tokens', 'status']);
const CHAT_KEY = 'carrel.chat';
const RECONNECT_MAX_MS = 15_000;
// A chat changed this recently may still be open in VS Code or the terminal.
const RECENT_S = 300;

// A passage quoted in a question, as its bubble shows it; the agent gets all of it.
const QUOTE_SHOWN = 280;

/**
 * `currentPaper()` and `currentPage()` say what a question is about; `openTarget` follows a
 * citation; `onActivity()` says an answer ended or a question for the reader came, so a chat out
 * of sight can say so. Returns `quote(passage)`, which sets the passage the next question
 * carries ({pdf, page, text}, or null for none), `quoted()`, the one it would carry, `focus()`,
 * `about(pdf)`, the paper the next question is about, and `showOverview()`.
 */
export function startChat({ currentPaper, currentPage, openTarget, onActivity = () => {} }) {
  const log = document.getElementById('log');
  const form = document.getElementById('ask');
  const question = document.getElementById('question');
  const send = document.getElementById('send');
  const stop = document.getElementById('stop');
  const status = document.getElementById('status');
  const sheet = document.getElementById('chats-sheet');
  const quoteBox = document.getElementById('quote');
  const modelButton = document.getElementById('model');
  const commandList = document.getElementById('commands');
  const settings = startSettings({
    liveModel: () => model,
    name: modelName,
    onOpen: () => showSheet(false),
    onModel: () => renderStatus(),
  });
  const overview = startOverview({
    ask: (text) => void ask(text),
    onOpen() {
      showSheet(false);
      void settings.show(false);
    },
  });

  let chatId = remembered();
  let epoch = null;
  let lastSeq = 0;
  let socket = null;
  let attached = false;
  let waiting = []; // asks waiting for the socket to attach
  let reconnectDelay = 1000;
  let reconnectTimer = 0;
  let busy = false;
  let cacheExpiresAt = null;
  let limits = {};
  let model = null; // the model this chat's process runs on; null while there is none

  // Answer blocks drawn from the stream that the complete message has not yet replaced.
  const streamed = [];
  const toolRows = new Map();
  const permissionRows = new Map();
  let turn = null;
  let lastPaper = null;
  // The passage the next question carries: {pdf, page, text}.
  let passage = null;

  // The connection.

  function connect() {
    clearTimeout(reconnectTimer);
    if (socket) return;
    const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const query = new URLSearchParams({ chat: chatId ?? 'new', after: String(lastSeq), epoch: epoch ?? '' });
    const ws = new WebSocket(`${scheme}${location.host}/ws?${query}`);
    socket = ws;
    ws.addEventListener('message', (event) => {
      if (ws === socket) receive(JSON.parse(event.data));
    });
    ws.addEventListener('close', () => {
      if (ws !== socket) return;
      socket = null;
      attached = false;
      renderStatus();
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    });
  }

  function reconnectNow() {
    if (!socket) {
      reconnectDelay = 1000;
      connect();
    }
  }

  function whenAttached() {
    if (attached) return Promise.resolve();
    connect();
    return new Promise((resolve) => waiting.push(resolve));
  }

  /** Leaves this chat for another, or for a new one (null). */
  function switchChat(id) {
    chatId = id;
    remember(id);
    epoch = null;
    lastSeq = 0;
    clearLog();
    const old = socket;
    socket = null;
    attached = false;
    old?.close();
    connect();
  }

  function receive(message) {
    const { seq, kind, data } = message;
    if (kind === 'Chat') return chatState(data);
    if (kind === 'Limits') {
      limits = data;
      return renderStatus();
    }
    if (seq != null) {
      if (seq <= lastSeq) return;
      lastSeq = seq;
    }
    show(kind, data);
  }

  function chatState(data) {
    if ('replay_from' in data) {
      // Attached: what follows is the log after `replay_from`.
      if (data.replay_from === 0) clearLog();
      chatId = data.id;
      remember(chatId);
      epoch = data.epoch;
      attached = true;
      reconnectDelay = 1000;
      for (const resolve of waiting.splice(0)) resolve();
    }
    setBusy(data.busy);
    cacheExpiresAt = data.cache_expires_at;
    limits = data.limits ?? limits;
    model = data.model ?? null;
    renderStatus();
  }

  async function ask(text, { confirmed = false } = {}) {
    if (!text.trim() || busy) return;
    if (!confirmed && expired() && log.querySelector('.question')) {
      return confirmExpired(text);
    }
    await whenAttached();
    socket.send(
      JSON.stringify({ type: 'ask', text, paper: currentPaper(), page: currentPage(), selection: passage, model: settings.model() }),
    );
    setBusy(true);
    quote(null);
    showCommands(false);
  }

  /** Shows the passage the next question carries over the box, or none. */
  function quote(next) {
    passage = next?.text ? next : null;
    quoteBox.hidden = !passage;
    if (!passage) return;
    quoteBox.querySelector('.words').textContent = passage.text;
    quoteBox.querySelector('.where').textContent = passage.page ? `p. ${passage.page}` : '';
  }

  function setBusy(value) {
    busy = value;
    send.hidden = value;
    stop.hidden = !value;
  }

  // The status line: the model (a button that opens the settings), the connection, the prompt
  // cache, the usage limits.

  function expired() {
    return cacheExpiresAt != null && Date.now() / 1000 > cacheExpiresAt;
  }

  function renderStatus() {
    const parts = [];
    // The model this chat runs on, or the one its next question starts on.
    const shown = model ?? settings.model();
    modelButton.textContent = shown ? modelName(shown) : 'Model';
    if (!attached) parts.push('reconnecting…');
    if (cacheExpiresAt != null) {
      const left = cacheExpiresAt - Date.now() / 1000;
      parts.push(left > 0 ? `cache ${Math.ceil(left / 60)} min` : 'cache expired');
    }
    for (const [type, info] of Object.entries(limits ?? {})) {
      if (info.utilization == null && info.status === 'allowed') continue;
      let text = limitName(type);
      if (info.utilization != null) text += ` ${Math.round(info.utilization * 100)}%`;
      if (info.status === 'rejected') text += ' reached';
      if (info.status !== 'allowed' && info.resets_at) text += ` · resets ${clock(info.resets_at)}`;
      parts.push(text);
    }
    status.textContent = parts.join(' · ');
    status.classList.toggle('warn', Object.values(limits ?? {}).some((info) => info.status === 'rejected'));
  }
  setInterval(renderStatus, 30_000);

  function confirmExpired(text) {
    const box = append('div', 'row permission expired');
    box.append(
      `This chat's cache expired ${ago(Date.now() / 1000 - cacheExpiresAt)}: the answer re-reads the whole chat at full price. A new chat may cost less.`,
    );
    const buttons = box.appendChild(document.createElement('div'));
    buttons.className = 'buttons';
    const choose = (label, action) => {
      const button = buttons.appendChild(document.createElement('button'));
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        box.remove();
        action();
      });
    };
    choose('Ask anyway', () => void ask(text, { confirmed: true }));
    choose('New chat', () => {
      switchChat(null);
      void ask(text, { confirmed: true });
    });
    choose('Cancel', () => {
      question.value = text;
      grow();
    });
    box.scrollIntoView({ block: 'nearest' });
  }

  // The messages.

  function show(kind, data) {
    switch (kind) {
      case 'Question':
        return startTurn(data);
      case 'StreamEvent':
        return streamEvent(data);
      case 'AssistantMessage':
        return assistant(data);
      case 'UserMessage':
        return toolResults(data);
      case 'SystemMessage':
        if (data.subtype === 'init') return step('system', `Session started · ${data.data?.model ?? ''}`);
        return QUIET_SYSTEM.has(data.subtype) ? undefined : step('system', data.subtype, data);
      case 'HookEventMessage':
      case 'RateLimitEvent':
        return undefined; // the reader's own hooks, on every turn; limits are in the status line
      case 'ResultMessage':
        return result(data);
      case 'PermissionRequest':
        return permission(data);
      case 'PermissionDecision':
        return decided(data);
      case 'Error':
        return row('error', data.message);
      default:
        return step('unknown', kind, data);
    }
  }

  function startTurn({ text, paper, pdf, page, selection }) {
    endTurn();
    streamed.length = 0;
    const bubble = append('div', 'question');
    if (text.startsWith('/')) bubble.classList.add('command');
    if (paper && paper !== lastPaper) {
      // Which paper the question was about, when it changed: a tap opens it.
      bubble.append(placeLink('about', page ? `${paper} · p. ${page}` : paper, pdf, page));
    }
    if (paper) lastPaper = paper;
    if (selection?.text) {
      // The passage it quotes, and where it is: a tap goes there.
      const quoted = bubble.appendChild(document.createElement('blockquote'));
      quoted.className = 'quoted';
      const words = selection.text.length > QUOTE_SHOWN ? `${selection.text.slice(0, QUOTE_SHOWN - 1).trimEnd()}…` : selection.text;
      quoted.append(words);
      const from = [selection.paper, selection.page && `p. ${selection.page}`].filter(Boolean).join(' · ');
      if (from) quoted.append(placeLink('from', from, selection.pdf ?? pdf, selection.page));
    }
    bubble.append(text);
    turn = { question: bubble, fold: null, steps: 0, texts: [], text };
  }

  /** A line naming a place in a paper; a tap opens it there when the paper is known. */
  function placeLink(className, label, pdf, page) {
    const link = document.createElement(pdf ? 'a' : 'div');
    link.className = className;
    link.textContent = label;
    if (pdf) {
      link.href = '#';
      link.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openTarget({ file: pdf, page });
      });
    }
    return link;
  }

  /** The turn's fold, made when it gets its first step. */
  function fold() {
    turn ??= { question: null, fold: null, steps: 0, texts: [] };
    if (!turn.fold) {
      const details = document.createElement('details');
      details.className = 'row work running';
      details.appendChild(document.createElement('summary'));
      const body = details.appendChild(document.createElement('div'));
      body.className = 'steps';
      if (turn.question) turn.question.after(details);
      else log.append(details);
      turn.fold = { details, body };
    }
    return turn.fold;
  }

  function summarize(text) {
    const { details } = fold();
    details.querySelector('summary').textContent = text;
  }

  function step(className, title, body) {
    const { body: steps } = fold();
    const stick = nearBottom();
    let element;
    if (body === undefined) {
      element = steps.appendChild(document.createElement('div'));
      element.className = `row ${className}`;
      element.textContent = title;
    } else {
      element = steps.appendChild(document.createElement('details'));
      element.className = `row ${className}`;
      element.appendChild(document.createElement('summary')).textContent = title;
      const pre = element.appendChild(document.createElement('pre'));
      pre.textContent = typeof body === 'string' ? body : JSON.stringify(body, null, 1);
    }
    turn.steps += 1;
    summarize(`${turn.steps} ${turn.steps === 1 ? 'step' : 'steps'} · ${title}`);
    if (stick) log.scrollTop = log.scrollHeight;
    return element;
  }

  /** Text the model wrote before a tool call is part of the work, not the answer. */
  function foldTexts() {
    if (!turn?.texts.length) return;
    const { body } = fold();
    for (const element of turn.texts) {
      element.classList.add('aside');
      body.append(element);
    }
    turn.texts = [];
  }

  function endTurn(summary) {
    if (!turn) return;
    if (turn.fold) {
      turn.fold.details.classList.remove('running');
      summarize(summary ?? `${turn.steps} ${turn.steps === 1 ? 'step' : 'steps'}`);
    } else if (summary) {
      row('result', summary);
    }
    turn = null;
  }

  // The reply as it streams: one block per text block of the model's message.
  function streamEvent({ event, parent_tool_use_id }) {
    if (parent_tool_use_id) return; // a subagent's own text
    if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
      streamed.push(answerBlock());
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const block = streamed.at(-1) ?? (streamed.push(answerBlock()), streamed.at(-1));
      block.update(block.text + event.delta.text);
    }
  }

  function assistant({ content, parent_tool_use_id }) {
    if (parent_tool_use_id) return;
    for (const block of content ?? []) {
      if ('text' in block && !('thinking' in block)) {
        // The complete text replaces what was streamed for it.
        (streamed.shift() ?? answerBlock()).update(block.text);
      } else if ('thinking' in block) {
        if (block.thinking) step('thinking', 'Thinking', block.thinking);
      } else if ('name' in block && 'input' in block) {
        foldTexts();
        toolRows.set(block.id, step('tool', describeTool(block.name, block.input), block.input));
      }
    }
  }

  function toolResults({ content }) {
    if (!Array.isArray(content)) return;
    for (const block of content) {
      const rowFor = block.tool_use_id && toolRows.get(block.tool_use_id);
      if (!rowFor) continue;
      const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 1);
      const pre = rowFor.appendChild(document.createElement('pre'));
      pre.className = 'result';
      pre.textContent = text.length > RESULT_PREVIEW ? `${text.slice(0, RESULT_PREVIEW)}\n…` : text;
      if (block.is_error) rowFor.classList.add('failed');
    }
  }

  function result(data) {
    streamed.length = 0;
    const parts = [];
    if (turn?.steps) parts.push(`${turn.steps} ${turn.steps === 1 ? 'step' : 'steps'}`);
    if (data.is_error) parts.push(`stopped: ${data.subtype}`);
    if (data.duration_ms != null) parts.push(`${Math.round(data.duration_ms / 1000)} s`);
    if (data.total_cost_usd != null) parts.push(`$${data.total_cost_usd.toFixed(2)}`);
    const failed = data.is_error && turn?.fold;
    const asked = turn?.text;
    endTurn(parts.join(' · ') || 'Done');
    if (failed) failed.details.classList.add('failed');
    // A turn ending while this page watched, not one replayed when it attached.
    if (busy) {
      onActivity();
      void overview.turnEnded(asked);
    }
  }

  function permission({ id, tool, input, title, description, decision_reason, blocked_path }) {
    const box = append('div', 'row permission');
    // Claude Code's own sentence when it gives one ("Claude wants to read foo.txt").
    box.append(title || `${describeTool(tool, input)}?`);
    const why = [description, decision_reason, blocked_path && `Path: ${blocked_path}`].filter(Boolean);
    if (why.length) {
      box.appendChild(document.createElement('div')).className = 'why';
      box.lastChild.textContent = why.join(' · ');
    }
    const detail = box.appendChild(document.createElement('pre'));
    detail.textContent = JSON.stringify(input, null, 1);
    const buttons = box.appendChild(document.createElement('div'));
    buttons.className = 'buttons';
    for (const [label, allow] of [['Allow', true], ['Deny', false]]) {
      const button = buttons.appendChild(document.createElement('button'));
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => socket?.send(JSON.stringify({ type: 'permission', id, allow })));
    }
    permissionRows.set(id, buttons);
    if (busy) onActivity();
  }

  function decided({ id, allow }) {
    const buttons = permissionRows.get(id);
    if (buttons) buttons.replaceChildren(allow ? 'Allowed' : 'Denied');
  }

  // Drawing.

  function nearBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  }

  function append(tag, className) {
    const stick = nearBottom();
    const element = log.appendChild(document.createElement(tag));
    element.className = className;
    if (stick) log.scrollTop = log.scrollHeight;
    return element;
  }

  function row(className, text) {
    append('div', `row ${className}`).textContent = text;
  }

  function clearLog() {
    log.replaceChildren();
    streamed.length = 0;
    toolRows.clear();
    permissionRows.clear();
    turn = null;
    lastPaper = null;
  }

  function answerBlock() {
    const element = append('div', 'answer');
    turn?.texts.push(element);
    let frame = 0;
    const block = {
      text: '',
      update(text) {
        block.text = text;
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            const stick = nearBottom();
            drawMarkdown(element, block.text);
            if (stick) log.scrollTop = log.scrollHeight;
          });
        }
      },
    };
    return block;
  }

  // The chats: a new one, or one of the earlier ones.

  const chatsButton = document.getElementById('chats');

  function showSheet(open) {
    if (open) {
      void settings.show(false);
      overview.hide();
    }
    sheet.hidden = !open;
    chatsButton.setAttribute('aria-expanded', String(open));
  }

  async function showChats() {
    if (!sheet.hidden) {
      showSheet(false);
      return;
    }
    sheet.replaceChildren(sheetHeader('Loading…'));
    showSheet(true);
    let chats;
    try {
      const response = await fetch('/api/chats');
      chats = await response.json();
    } catch (error) {
      sheet.replaceChildren(sheetHeader(`Could not list the chats: ${error}`));
      return;
    }
    const list = document.createElement('ul');
    const now = Date.now() / 1000;
    for (const chat of chats) {
      const item = list.appendChild(document.createElement('li'));
      if (chat.id === chatId) item.className = 'current';
      const button = item.appendChild(document.createElement('button'));
      button.type = 'button';
      const title = button.appendChild(document.createElement('span'));
      title.className = 'first';
      title.textContent = chat.first_question || chat.title || 'An empty chat';
      const meta = button.appendChild(document.createElement('span'));
      meta.className = 'meta';
      const state = chat.busy ? 'answering' : chat.live ? 'open' : now - chat.last_modified < RECENT_S ? 'recent' : '';
      meta.textContent = [chat.paper, ago(now - chat.last_modified), state].filter(Boolean).join(' · ');
      button.addEventListener('click', () => {
        showSheet(false);
        if (chat.id !== chatId) switchChat(chat.id);
      });
    }
    sheet.replaceChildren(sheetHeader(chats.length ? 'Chats in this library' : 'No chats yet'), list);
  }

  function sheetHeader(text) {
    const header = document.createElement('div');
    header.className = 'sheet-header';
    header.textContent = text;
    return header;
  }

  // Citations move the PDF, and a link to the paper's overview note opens it; any other link
  // opens in a new tab.
  log.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link || link.classList.contains('about')) return;
    event.preventDefault();
    const target = parsePaperLink(link.href);
    if (target) {
      openTarget(target);
    } else if (overview.opensLink(new URL(link.href))) {
      // shown over the chat
    } else {
      window.open(link.href, '_blank', 'noopener');
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = question.value;
    question.value = '';
    grow();
    void ask(text);
  });
  question.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  function grow() {
    // An empty box takes its natural height, which is smaller while it is not being typed in.
    if (!question.value) {
      question.style.height = '';
      return;
    }
    question.style.height = 'auto';
    question.style.height = `${Math.min(question.scrollHeight, 160)}px`;
  }
  question.addEventListener('input', () => {
    grow();
    void listCommands();
  });

  // The slash commands that match what is typed, while the box holds just one being typed.

  let commands = null; // as Claude Code offers them: a promise, fetched once

  function loadCommands() {
    commands ??= fetch('/api/commands')
      .then((response) => response.json())
      .catch(() => {
        commands = null; // asked again next time
        return [];
      });
    return commands;
  }

  async function listCommands() {
    if (!/^\/\S*$/.test(question.value)) return showCommands(false);
    const offered = await loadCommands();
    // What the box holds now, the fetch done.
    const typed = /^\/(\S*)$/.exec(question.value)?.[1];
    if (typed == null) return showCommands(false);
    const matching = offered.filter(({ name }) => name.toLowerCase().startsWith(typed.toLowerCase()));
    if (!matching.length || (matching.length === 1 && matching[0].name === typed)) return showCommands(false);
    commandList.replaceChildren(
      ...matching.map(({ name, description, hint }) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'option');
        item.append(span('name', `/${name}`));
        if (hint) item.append(span('hint', hint));
        item.append(span('description', description));
        item.addEventListener('click', () => {
          question.value = `/${name} `;
          showCommands(false);
          grow();
          question.focus({ preventScroll: true });
        });
        return item;
      }),
    );
    return showCommands(true);
  }

  // The first list starts a Claude Code process on the laptop, which takes a few seconds: asked
  // for as soon as the box is.
  question.addEventListener('focus', () => void loadCommands(), { once: true });

  function showCommands(open) {
    commandList.hidden = !open;
    if (!open) commandList.replaceChildren();
  }
  stop.addEventListener('click', () => socket?.send(JSON.stringify({ type: 'stop' })));
  document.getElementById('new-chat').addEventListener('click', () => {
    showSheet(false);
    void settings.show(false);
    switchChat(null);
  });
  chatsButton.addEventListener('click', () => void showChats());

  // Back from sleep or from another app: attach again now, not at the next back-off.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectNow();
  });
  window.addEventListener('pageshow', reconnectNow);
  window.addEventListener('online', reconnectNow);

  quoteBox.querySelector('.drop').addEventListener('click', () => quote(null));
  quoteBox.querySelector('.words').addEventListener('click', () => {
    if (passage) openTarget({ file: passage.pdf, page: passage.page });
  });

  renderStatus();
  connect();
  return {
    quote,
    quoted: () => passage,
    /** Puts the cursor in the question box. */
    focus: () => question.focus({ preventScroll: true }),
    about: (pdf) => overview.about(pdf),
    showOverview: () => overview.show(),
  };
}

function span(className, text) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function remembered() {
  try {
    return localStorage.getItem(CHAT_KEY);
  } catch {
    return null;
  }
}

function remember(id) {
  try {
    if (id) localStorage.setItem(CHAT_KEY, id);
    else localStorage.removeItem(CHAT_KEY);
  } catch {
    // Private browsing: the chat is still on the server, in the list of chats.
  }
}

/** "haiku" → "Haiku", "claude-opus-5-5" → "Opus 5.5". */
export function modelName(id) {
  const found = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:\b|$)/.exec(id);
  const [name, version] = found ? [found[1], found[3] ? `${found[2]}.${found[3]}` : found[2]] : [id, ''];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}${version ? ` ${version}` : ''}`;
}

const LIMIT_NAMES = { five_hour: '5-h', seven_day: 'week', seven_day_opus: 'week (Opus)', seven_day_sonnet: 'week (Sonnet)' };

function limitName(type) {
  return LIMIT_NAMES[type] ?? type.replaceAll('_', ' ');
}

function clock(seconds) {
  return new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function ago(seconds) {
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  return days === 1 ? 'a day ago' : `${days} days ago`;
}

/** A tool use as one line: "Read Zep.txt, pages 8–9", "Grep 'win rate' in library/". */
export function describeTool(name, input = {}) {
  const base = (path) => String(path ?? '').split('/').filter(Boolean).at(-1) ?? '';
  switch (name) {
    case 'Read': {
      const range = input.pages ? `, pages ${input.pages}` : input.offset ? `, from line ${input.offset}` : '';
      return `Read ${base(input.file_path)}${range}`;
    }
    case 'Grep':
      return `Grep '${input.pattern}'${input.path ? ` in ${base(input.path)}/` : ''}`;
    case 'Glob':
      return `Glob ${input.pattern}`;
    case 'Bash':
      return `Bash: ${String(input.command ?? '').split('\n')[0].slice(0, 120)}`;
    case 'WebSearch':
      return `Search the web: ${input.query}`;
    case 'WebFetch':
      return `Fetch ${input.url}`;
    case 'SandboxNetworkAccess':
      return `Connect to ${input.host} from Bash`;
    case 'Skill':
      return `Skill ${input.skill ?? input.command ?? ''}`;
    case 'Edit':
    case 'Write':
      return `${name} ${base(input.file_path)}`;
    default:
      return name;
  }
}
