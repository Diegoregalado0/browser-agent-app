import { createSettings } from "./settings.js";

const $ = (id) => document.getElementById(id);
const log = $("log");
const params = new URLSearchParams(location.search);
const token = params.get("t");
// The extension edition hosts the controller in this page and provides agentHost; the
// local edition reaches it over a WebSocket.
const host = globalThis.agentHost;
const GHOST_TEXT = "This session will not be saved";
const GHOST_LOCKED_TEXT = "Ghost mode is on during incognito mode";
// Inside the browser's side panel the "Browser" button has nothing to bring forward.
if (host || params.get("embed") === "sidebar") document.documentElement.classList.add("in-sidebar");
// Set by the side panel in an incognito window, where Ghost mode is locked on.
const incognito = host ? host.incognito : params.get("incognito") === "1";

let ws;
let link = null;
let config = null;
let running = false;
const toolRows = new Map();
// Saved conversations for the history list, newest first, and the one on screen.
let sessions = [];
let currentSession = null;

// Stroke icons, 24x24 viewBox.
const ICONS = {
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  history: '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3"/><path d="M3 3.5V8.3h4.8"/><path d="M12 7.5V12l3 2"/>',
  ghost: '<path d="M12 2.5a7.5 7.5 0 0 0-7.5 7.5v11l2.6-2.2 2.45 2.2L12 18.8l2.45 2.2 2.45-2.2 2.6 2.2V10A7.5 7.5 0 0 0 12 2.5Z"/><path d="M9.5 10h.01M14.5 10h.01"/>',
  compose: '<path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M17.6 3.4a2 2 0 0 1 2.9 2.9L12 14.8l-3.6.9.9-3.6Z"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.9 12.5a1.5 1.5 0 0 0 1.5 1.5h6.2a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  general: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  models: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5"/>',
  shield: '<path d="M12 2.8 4.5 5.6v5.9c0 4.6 3.1 8.4 7.5 9.7 4.4-1.3 7.5-5.1 7.5-9.7V5.6Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  svg.innerHTML = ICONS[name];
  return svg;
}

for (const node of document.querySelectorAll("[data-icon]")) node.prepend(icon(node.dataset.icon));

const settings = createSettings({ $, el, icon, send });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Whether the selected provider can run: it has a key, or needs none (Ollama).
const providerReady = () => config.provider === "ollama" || config.keyInfo?.[config.provider]?.source !== "none";

// First run, or no key for the selected provider: ask for one before anything else.
function onboarding() {
  const box = el("div", "empty onboarding");
  box.append(
    el("h2", null, "Welcome to Browser Agent"),
    el("p", null, "Describe a task and the agent does it in this window's tabs: it opens pages, clicks, types, and reports back."),
    el("p", "empty-sub", "It uses your own API key from Anthropic, OpenAI, Google, or Mistral. The key stays in this browser profile and is sent only to that provider, which bills your account for what the agent uses."),
  );
  const add = el("button", "primary", "Add an API key");
  add.onclick = () => settings.open("models");
  box.append(add);
  return box;
}

function emptyState() {
  if (config && config.edition === "extension" && !providerReady()) return onboarding();
  const ghost = config?.ghostMode;
  const box = el("div", "empty");
  if (ghost) box.append(icon("ghost"));
  box.append(el("p", null, ghost ? GHOST_TEXT : "Describe a task. The agent works in its own tabs in the agent browser."));
  if (ghost && config.ghostLocked) box.append(el("p", "empty-sub", GHOST_LOCKED_TEXT));
  return box;
}

function resetLog() {
  toolRows.clear();
  group = null;
  textNode = null;
  thinkingBody = null;
  log.replaceChildren(emptyState());
}

function append(node) {
  log.querySelector(".empty")?.remove();
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.append(node);
  if (nearBottom) log.scrollTop = log.scrollHeight;
  return node;
}

function send(msg) {
  link?.send(msg);
}

function summarize(name, input) {
  if (name === "browser" || name === "desktop") {
    const target = input.ref || (input.coordinate ? `(${input.coordinate.join(", ")})` : "");
    const text = input.text ? ` "${input.text.slice(0, 40)}"` : "";
    return `${input.action} ${target}${text}${input.scroll_direction ? " " + input.scroll_direction : ""}`.trim();
  }
  if (name === "navigate") return `${input.url}${input.new_tab ? " (new tab)" : ""}`;
  if (name === "find") return input.query;
  if (name === "form_input") return `${input.ref} = ${JSON.stringify(input.value)}`.slice(0, 60);
  if (name === "tabs") return [input.action, input.tab_id, input.url].filter(Boolean).join(" ");
  if (name === "javascript_exec") return (input.code || "").slice(0, 60);
  if (name === "read_page") return input.filter || "all";
  if (name === "network_requests") return input.request_id ? `#${input.request_id}` : [input.type, input.url_contains, input.failed_only && "failed"].filter(Boolean).join(" ");
  if (name === "edit_html") return `${input.ref || input.selector || ""}${input.html === undefined ? " (read)" : ` ${input.mode || "outer"}`}`;
  return "";
}

// A collapsible group that holds consecutive actions and thinking between replies.
let group = null;

function ensureGroup() {
  if (group) return group;
  const details = append(el("details", "steps"));
  const summary = details.appendChild(el("summary"));
  const body = details.appendChild(el("div", "steps-body"));
  group = { details, summary, body, actions: 0, errors: 0, thoughts: 0, done: false };
  renderGroupSummary(group);
  return group;
}

function renderGroupSummary(g) {
  const parts = [];
  if (g.actions) parts.push(`${g.done ? "Ran" : "Running"} ${g.actions} action${g.actions === 1 ? "" : "s"}`);
  if (g.thoughts && !g.actions) parts.push(g.done ? "Thought" : "Thinking");
  g.summary.replaceChildren(parts.join(" · ") || "Working");
  if (g.errors) g.summary.append(" · ", el("span", "err-count", `${g.errors} error${g.errors === 1 ? "" : "s"}`));
}

function closeGroup() {
  if (!group) return;
  group.done = true;
  renderGroupSummary(group);
  group = null;
}

let textNode = null;
let thinkingBody = null;

// Minimal Markdown for replies: bold, italic, inline code, http(s) links, bullet and
// numbered lists. Everything is escaped first, so reply text cannot inject HTML.
function renderMarkdown(src) {
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  const out = [];
  let list = null;
  for (const line of src.split("\n")) {
    const item = /^\s*(?:[-*]|(\d+)\.)\s+(.*)$/.exec(line);
    if (item) {
      const tag = item[1] ? "ol" : "ul";
      if (list !== tag) {
        if (list) out.push(`</${list}>`);
        out.push(`<${tag}>`);
        list = tag;
      }
      out.push(`<li>${inline(item[2])}</li>`);
      continue;
    }
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
    out.push(line.trim() ? `<p>${inline(line)}</p>` : "");
  }
  if (list) out.push(`</${list}>`);
  return out.join("");
}

function renderBlocks(container, blocks) {
  for (const b of blocks) {
    if (b.type === "image") {
      const img = el("img");
      img.src = `data:${b.mediaType};base64,${b.data}`;
      container.append(img);
    } else container.append(el("div", null, b.text));
  }
}

function setRunning(value) {
  running = value;
  $("send").textContent = running ? "Stop" : "Send";
  $("dot").className = `dot ${running ? "running" : "idle"}`;
}

function renderHeader() {
  if (!config) return;
  document.documentElement.dataset.edition = config.edition;
  $("model").textContent = config.models[config.provider] || "No model selected";
  const ghost = Boolean(config.ghostMode);
  document.documentElement.classList.toggle("ghost", ghost);
  $("toggle-ghost").setAttribute("aria-pressed", String(ghost));
  $("toggle-ghost").disabled = Boolean(config.ghostLocked);
  $("toggle-ghost").title = config.ghostLocked ? GHOST_LOCKED_TEXT : ghost ? GHOST_TEXT : "Ghost mode";
  $("input").placeholder = ghost ? GHOST_TEXT : "What should it do?";
  const empty = log.querySelector(".empty");
  if (empty) empty.replaceWith(emptyState());
}

// Renders a saved or in-progress conversation, reusing the live event handlers.
function renderTranscript(items) {
  resetLog();
  for (const item of items) {
    if (item.type === "user") {
      closeGroup();
      textNode = null;
      append(el("div", "msg user", item.text));
    } else if (item.type === "assistant") {
      closeGroup();
      append(el("div", "msg assistant")).innerHTML = renderMarkdown(item.text);
      textNode = null;
    } else if (item.type === "tool_call") handlers.tool_call(item);
    else if (item.type === "tool_result") handlers.tool_result(item);
  }
  closeGroup();
  textNode = null;
  if (!running) activity.stop();
  log.scrollTop = log.scrollHeight;
}

// Groups the history list by age, like Today / Yesterday / Previous 7 days / Older.
function dayBucket(iso) {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const t = new Date(iso).getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - 86400000) return "Yesterday";
  if (t >= startOfToday - 7 * 86400000) return "Previous 7 days";
  if (t >= startOfToday - 30 * 86400000) return "Previous 30 days";
  return "Older";
}

function timeLabel(iso) {
  const d = new Date(iso);
  return dayBucket(iso) === "Today" || dayBucket(iso) === "Yesterday"
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function renderHistory() {
  const list = $("history-list");
  const query = $("history-search").value.trim().toLowerCase();
  const shown = sessions.filter((s) => !query || s.title.toLowerCase().includes(query));
  list.replaceChildren();
  if (!shown.length) {
    list.append(el("div", "history-empty", query ? "No sessions match." : "Your sessions will show up here."));
    return;
  }
  let bucket = null;
  for (const s of shown) {
    const b = dayBucket(s.updated);
    if (b !== bucket) {
      list.append(el("div", "history-group", b));
      bucket = b;
    }
    const row = el("div", "history-item");
    if (s.id === currentSession) row.classList.add("current");
    const open = el("button", "history-open");
    open.append(el("span", "history-title", s.title), el("span", "history-time", timeLabel(s.updated)));
    open.onclick = () => {
      if (running) return;
      send({ type: "open_session", id: s.id });
      closeMenu();
    };
    const del = el("button", "icon-btn history-delete");
    del.append(icon("trash"));
    del.title = "Delete session";
    del.setAttribute("aria-label", `Delete ${s.title}`);
    del.onclick = () => {
      const confirm = el("div", "history-confirm");
      const yes = el("button", "danger", "Delete");
      const no = el("button", null, "Cancel");
      yes.onclick = () => send({ type: "delete_session", id: s.id });
      no.onclick = () => renderHistory();
      confirm.append(el("span", null, "Delete this session?"), yes, no);
      row.replaceChildren(confirm);
      no.focus();
    };
    row.append(open, del);
    list.append(row);
  }
}

const VERBS = ["Thinking", "Working", "Considering", "Pondering", "Calculating", "Figuring it out", "Planning"];
const randomVerb = () => `${VERBS[Math.floor(Math.random() * VERBS.length)]}…`;

function describeAction(name, input) {
  const target = input.ref ? ` ${input.ref}` : "";
  if (name === "navigate") {
    if (input.url === "back" || input.url === "forward") return `Going ${input.url}…`;
    try {
      return `Opening ${new URL(/^[a-z]+:/i.test(input.url) ? input.url : `https://${input.url}`).hostname}…`;
    } catch {
      return "Opening page…";
    }
  }
  if (name === "browser" || name === "desktop") {
    const where = name === "desktop" ? " (desktop)" : "";
    const map = {
      screenshot: "Taking a screenshot",
      left_click: `Clicking${target}`,
      right_click: `Right-clicking${target}`,
      double_click: `Double-clicking${target}`,
      triple_click: `Selecting${target}`,
      hover: `Hovering${target}`,
      type: `Typing "${(input.text || "").slice(0, 30)}"`,
      key: `Pressing ${input.text || ""}`,
      scroll: `Scrolling ${input.scroll_direction || "down"}`,
      left_click_drag: "Dragging",
      drag: "Dragging",
      move: "Moving the mouse",
      wait: `Waiting ${input.duration ?? 2}s`,
      focus_browser: "Focusing the browser",
    };
    return `${map[input.action] || input.action}${where}…`;
  }
  return (
    {
      read_page: "Reading the page…",
      find: `Finding "${input.query || ""}"…`,
      form_input: `Filling${target}…`,
      get_page_text: "Reading the page text…",
      javascript_exec: "Running JavaScript…",
      network_requests: "Checking network requests…",
      edit_html: input.html === undefined ? "Reading element HTML…" : "Editing the page…",
      tabs: `${{ list: "Listing", create: "Opening", switch: "Switching", close: "Closing" }[input.action] || "Managing"} tabs…`,
    }[name] || `Running ${name}…`
  );
}

// Drives the status line: animated glyph, current verb, elapsed time, output tokens.
const activity = (() => {
  const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
  let frame = 0;
  let started = 0;
  let timer = null;
  let reportedTokens = 0;
  let streamedChars = 0;

  const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const render = () => {
    $("spinner").textContent = GLYPHS[(frame = (frame + 1) % GLYPHS.length)];
    const secs = Math.floor((Date.now() - started) / 1000);
    const tokens = reportedTokens + Math.round(streamedChars / 4);
    $("activity-meta").textContent = `(${secs}s${tokens ? ` · ↓ ${fmt(tokens)} tokens` : ""})`;
  };
  return {
    start() {
      if (timer) return;
      started = Date.now();
      reportedTokens = 0;
      streamedChars = 0;
      $("activity").hidden = false;
      this.set(randomVerb());
      timer = setInterval(render, 120);
      render();
    },
    stop() {
      clearInterval(timer);
      timer = null;
      $("activity").hidden = true;
    },
    set(text) {
      $("activity-verb").textContent = text;
    },
    addChars(n) {
      streamedChars += n;
    },
    // Exact output tokens for this task so far; replaces the streamed-text estimate.
    setOutputTokens(taskTotal) {
      reportedTokens = taskTotal;
      streamedChars = 0;
    },
  };
})();

const handlers = {
  config(msg) {
    config = msg.config;
    renderHeader();
    settings.render(config);
  },
  conversation(msg) {
    currentSession = msg.id;
    renderTranscript(msg.transcript);
  },
  cleared() {
    currentSession = null;
    resetLog();
    renderHistory();
  },
  session(msg) {
    currentSession = msg.id;
    if (!$("menu").hidden) send({ type: "list_sessions" });
  },
  sessions(msg) {
    sessions = msg.sessions;
    currentSession = msg.current;
    renderHistory();
  },
  status(msg) {
    setRunning(msg.running);
    if (msg.running) activity.start();
    else {
      activity.stop();
      closeGroup();
    }
  },
  assistant_start() {
    textNode = null;
    thinkingBody = null;
    activity.set(randomVerb());
  },
  text(msg) {
    if (!textNode) {
      closeGroup();
      textNode = append(el("div", "msg assistant"));
      textNode.raw = "";
    }
    textNode.raw += msg.delta;
    textNode.innerHTML = renderMarkdown(textNode.raw);
    log.scrollTop = log.scrollHeight;
    activity.addChars(msg.delta.length);
    activity.set("Writing…");
  },
  thinking(msg) {
    const g = ensureGroup();
    if (!thinkingBody) {
      g.thoughts++;
      renderGroupSummary(g);
      const details = g.body.appendChild(el("details", "thinking"));
      details.append(el("summary", null, "Thinking"));
      thinkingBody = details.appendChild(el("div"));
    }
    thinkingBody.textContent += msg.delta;
    activity.addChars(msg.delta.length);
    activity.set("Thinking…");
  },
  tool_call(msg) {
    const g = ensureGroup();
    g.actions++;
    renderGroupSummary(g);
    const details = g.body.appendChild(el("details", "tool pending"));
    details.append(el("summary", null, `${msg.name}: ${summarize(msg.name, msg.input || {})}`));
    const body = details.appendChild(el("div", "body"));
    toolRows.set(msg.id, { details, body, group: g });
    textNode = null;
    thinkingBody = null;
    activity.set(describeAction(msg.name, msg.input || {}));
  },
  tool_result(msg) {
    const row = toolRows.get(msg.id);
    if (!row) return;
    row.details.classList.remove("pending");
    if (msg.isError) {
      row.details.classList.add("err");
      row.group.errors++;
      renderGroupSummary(row.group);
      // Errors stay visible inline so they are not hidden inside a collapsed group.
      row.group.body.insertBefore(el("div", "msg error step-error", msg.content.map((b) => b.text || "").join(" ")), row.details.nextSibling);
    }
    renderBlocks(row.body, msg.content);
    activity.set(randomVerb());
  },
  notice(msg) {
    closeGroup();
    textNode = null;
    append(el("div", "msg notice", msg.text));
    const wait = /waiting (\d+)s/.exec(msg.text);
    if (wait) activity.set(`Rate limited, waiting ${wait[1]}s…`);
  },
  error(msg) {
    if (settings.isOpen) return settings.toast(msg.text, "error");
    closeGroup();
    textNode = null;
    append(el("div", "msg error", msg.text));
  },
  permission_request(msg) {
    $("perm-text").textContent = msg.text;
    document.querySelector('#permission [data-decision="always"]').hidden = !msg.allowAlways;
    $("permission").hidden = false;
    activity.set("Waiting for your approval…");
  },
  permission_closed() {
    $("permission").hidden = true;
  },
  usage(msg) {
    const u = msg.usage;
    $("model").title = `This session: ${u.input.toLocaleString()} input tokens (${u.cachedInput.toLocaleString()} cached), ${u.output.toLocaleString()} output tokens`;
    activity.setOutputTokens(msg.taskOutput ?? 0);
  },
};

function receive(msg) {
  (handlers[msg.type] || settings.handlers[msg.type])?.(msg);
}

function connect() {
  if (host) {
    link = host.connect(receive);
    send({ type: "hello", incognito });
    return;
  }
  ws = new WebSocket(`ws://${location.host}/ws?t=${token}`);
  link = { send: (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg)) };
  ws.onopen = () => send({ type: "hello", incognito });
  ws.onmessage = (e) => receive(JSON.parse(e.data));
  ws.onclose = () => {
    $("dot").className = "dot";
    $("model").textContent = "disconnected, retrying…";
    setTimeout(connect, 1500);
  };
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (running) return send({ type: "stop" });
  const text = $("input").value.trim();
  if (!text) return;
  $("input").value = "";
  append(el("div", "msg user", text));
  closeGroup();
  textNode = null;
  send({ type: "run", text });
});

$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

$("permission").addEventListener("click", (e) => {
  const decision = e.target.dataset?.decision;
  if (decision) send({ type: "permission", decision });
});

// The side menu: settings sections on top, past conversations below.
function openMenu() {
  settings.close();
  $("menu").hidden = false;
  $("menu-scrim").hidden = false;
  $("open-menu").setAttribute("aria-expanded", "true");
  $("history-search").value = "";
  renderHistory();
  send({ type: "list_sessions" });
  $("close-menu").focus();
}

function closeMenu() {
  $("menu").hidden = true;
  $("menu-scrim").hidden = true;
  $("open-menu").setAttribute("aria-expanded", "false");
}

$("open-menu").onclick = () => ($("menu").hidden ? openMenu() : closeMenu());
$("close-menu").onclick = closeMenu;
$("menu-scrim").onclick = closeMenu;
$("history-search").oninput = renderHistory;
$("new-chat").onclick = () => {
  closeMenu();
  send({ type: "reset" });
  resetLog();
  $("input").focus();
};
for (const button of document.querySelectorAll("[data-settings-page]")) {
  button.onclick = () => {
    closeMenu();
    // Back from a settings page returns to the menu.
    settings.open(button.dataset.settingsPage, { onBack: openMenu });
  };
}
$("toggle-ghost").onclick = () => {
  if (running) return;
  send({ type: "set_ghost", on: !config?.ghostMode });
};
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("menu").hidden) closeMenu();
  else if (settings.isOpen) settings.close();
});

$("show-browser").onclick = () => {
  closeMenu();
  send({ type: "open_browser" });
};
$("close-settings").onclick = () => settings.close();

resetLog();
connect();
