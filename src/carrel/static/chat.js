// The chat under the PDF. The server passes Claude Code's messages through as they are, each
// as {seq, kind, data}, `kind` being the SDK's class name. The reply is drawn as markdown;
// everything else is a one-line row that opens on a tap. A kind this page does not know is a
// plain row with its name, so an SDK update never breaks the chat, it only looks plainer.

import { marked } from './vendor/marked/marked.esm.js';
import DOMPurify from './vendor/dompurify/purify.es.mjs';
import { parsePaperLink } from './links.js';

const RESULT_PREVIEW = 4000;
// System messages that say nothing to the reader.
const QUIET_SYSTEM = new Set(['thinking_tokens', 'status']);

export function startChat({ pdf, currentPage, openTarget }) {
  const log = document.getElementById('log');
  const form = document.getElementById('ask');
  const question = document.getElementById('question');
  const send = document.getElementById('send');
  const stop = document.getElementById('stop');

  let socket = null;
  let busy = false;
  // Answer blocks drawn from the stream that the complete message has not yet replaced.
  const streamed = [];
  const toolRows = new Map();
  const permissionRows = new Map();

  function connect() {
    const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
    socket = new WebSocket(`${scheme}${location.host}/ws`);
    socket.addEventListener('message', (event) => show(JSON.parse(event.data)));
    socket.addEventListener('close', (event) => {
      socket = null;
      setBusy(false);
      row('error', `Disconnected${event.reason ? `: ${event.reason}` : ''}. The next question starts a new session.`);
    });
    return new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  }

  async function ask(text) {
    if (!text.trim() || busy) return;
    if (!socket) await connect();
    const bubble = append('div', 'question');
    bubble.textContent = text;
    setBusy(true);
    socket.send(JSON.stringify({ type: 'ask', text, paper: pdf, page: currentPage() }));
  }

  function setBusy(value) {
    busy = value;
    send.hidden = value;
    stop.hidden = !value;
  }

  function show({ kind, data }) {
    switch (kind) {
      case 'StreamEvent':
        return streamEvent(data);
      case 'AssistantMessage':
        return assistant(data);
      case 'UserMessage':
        return toolResults(data);
      case 'SystemMessage':
        if (data.subtype === 'init') return row('system', `Session started · ${data.data?.model ?? ''}`);
        return QUIET_SYSTEM.has(data.subtype) ? undefined : folded('system', data.subtype, data);
      case 'HookEventMessage':
        return undefined; // the reader's own hooks, on every turn
      case 'RateLimitEvent':
        return rateLimit(data.rate_limit_info ?? {});
      case 'ResultMessage':
        return result(data);
      case 'PermissionRequest':
        return permission(data);
      case 'PermissionDecision':
        return decided(data);
      case 'Error':
        setBusy(false);
        return row('error', data.message);
      default:
        return folded('unknown', kind, data);
    }
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
        if (block.thinking) folded('thinking', 'Thinking', block.thinking);
      } else if ('name' in block && 'input' in block) {
        toolRows.set(block.id, folded('tool', describeTool(block.name, block.input), block.input));
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
    setBusy(false);
    streamed.length = 0;
    const parts = [data.is_error ? `Stopped: ${data.subtype}` : 'Done'];
    if (data.total_cost_usd != null) parts.push(`$${data.total_cost_usd.toFixed(2)}`);
    if (data.duration_ms != null) parts.push(`${Math.round(data.duration_ms / 1000)} s`);
    row('result', parts.join(' · '));
  }

  function rateLimit({ status, resets_at, utilization }) {
    if (status === 'allowed') return;
    const parts = [status === 'rejected' ? 'Usage limit reached' : 'Close to the usage limit'];
    if (utilization != null) parts.push(`${Math.round(utilization * 100)}% used`);
    if (resets_at) parts.push(`resets ${new Date(resets_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    row(status === 'rejected' ? 'error' : 'system', parts.join(' · '));
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
  }

  function decided({ id, allow }) {
    const buttons = permissionRows.get(id);
    if (buttons) buttons.replaceChildren(allow ? 'Allowed' : 'Denied');
  }

  // Drawing.

  function append(tag, className) {
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const element = log.appendChild(document.createElement(tag));
    element.className = className;
    if (stick) log.scrollTop = log.scrollHeight;
    return element;
  }

  function row(className, text) {
    append('div', `row ${className}`).textContent = text;
  }

  function folded(className, title, body) {
    const details = append('details', `row ${className}`);
    details.appendChild(document.createElement('summary')).textContent = title;
    const pre = details.appendChild(document.createElement('pre'));
    pre.textContent = typeof body === 'string' ? body : JSON.stringify(body, null, 1);
    return details;
  }

  function answerBlock() {
    const element = append('div', 'answer');
    let frame = 0;
    const block = {
      text: '',
      update(text) {
        block.text = text;
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
            element.innerHTML = DOMPurify.sanitize(marked.parse(block.text, { gfm: true }));
            for (const table of element.querySelectorAll('table')) {
              const wrap = document.createElement('div');
              wrap.className = 'table';
              table.replaceWith(wrap);
              wrap.append(table);
            }
            if (stick) log.scrollTop = log.scrollHeight;
          });
        }
      },
    };
    return block;
  }

  // Citations move the PDF; any other link opens in a new tab.
  log.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    const target = parsePaperLink(link.href);
    if (target) {
      openTarget(target);
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
    question.style.height = 'auto';
    question.style.height = `${Math.min(question.scrollHeight, 160)}px`;
  }
  question.addEventListener('input', grow);
  stop.addEventListener('click', () => socket?.send(JSON.stringify({ type: 'stop' })));
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
