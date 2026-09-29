import {
  readPageScript,
  refCenterScript,
  formInputScript,
  pageTextScript,
  describeTargetScript,
  youtubeAdSkipperScript,
  adOverlayRemoverScript,
  hitTestScript,
  resolveElementScript,
  agentCursorScript,
} from "./page-scripts.js";
import { sleep } from "./limits.js";

const AD_SKIPPER_SOURCE = `(${youtubeAdSkipperScript.toString()})();(${adOverlayRemoverScript.toString()})()`;

// Screenshots are scaled to at most this width; coordinates the model sends back are in
// screenshot pixels and are mapped to CSS pixels before input is dispatched.
const SCREENSHOT_MAX_WIDTH = 1280;
const PAGE_OUTLINE_MAX_CHARS = 40000;
const PAGE_TEXT_MAX_CHARS = 60000;
const NETWORK_LOG_MAX_ENTRIES = 500;
const NETWORK_BODY_MAX_CHARS = 8000;
const ELEMENT_HTML_MAX_CHARS = 20000;
// Typing shown character by character takes at most about this long in total.
const SHOWN_TYPING_MAX_MS = 3000;

// The easing of the visible pointer (CSS ease-out), applied to the real mouse path too.
const easeOut = (t) => 1 - (1 - t) ** 3;

export const BROWSER_TOOL_DEFS = [
  {
    name: "browser",
    description:
      "Mouse, keyboard and screenshot control inside the current browser tab's page. Coordinates are pixels in the most " +
      "recent browser screenshot (origin top-left). For clicks and hover you may pass a ref from read_page/find instead of " +
      "a coordinate. Take a screenshot to see the page, and again after actions whose effect you need to verify.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "screenshot", "left_click", "right_click", "double_click", "triple_click", "hover",
            "type", "key", "scroll", "left_click_drag", "wait",
          ],
        },
        coordinate: { type: "array", items: { type: "number" }, description: "[x, y] in screenshot pixels" },
        ref: { type: "string", description: "Element ref such as ref_12, as an alternative to coordinate" },
        start_coordinate: { type: "array", items: { type: "number" }, description: "Drag start [x, y]" },
        text: {
          type: "string",
          description: "For type: text to insert. For key: space-separated keys or chords, e.g. 'Enter' or 'cmd+a Backspace'.",
        },
        modifiers: { type: "string", description: "Modifier chord held during a click, e.g. 'cmd' or 'shift'" },
        scroll_direction: { type: "string", enum: ["up", "down", "left", "right"] },
        scroll_amount: { type: "number", description: "Scroll ticks (default 3, about 100px each)" },
        duration: { type: "number", description: "Seconds to wait (wait action, max 10)" },
      },
      required: ["action"],
    },
  },
  {
    name: "navigate",
    description:
      "Load a URL, or pass 'back' / 'forward' to move through history. Waits for the page to load. Reuses the current tab " +
      "when this task opened it; set new_tab to keep the current tab as it is and load the URL in a new one. Tabs this " +
      "task did not open are never reused.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" }, new_tab: { type: "boolean", description: "Open in a new tab (default false)" } },
      required: ["url"],
    },
  },
  {
    name: "read_page",
    description:
      "Return an outline of the current page (roles, names, values) with refs for actionable elements. Use filter " +
      "'interactive' for only controls. Refs stay valid until the page navigates.",
    input_schema: { type: "object", properties: { filter: { type: "string", enum: ["all", "interactive"] } } },
  },
  {
    name: "find",
    description: "Search the page outline for elements whose role, name, or attributes match the query words. Returns matching lines with refs.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "form_input",
    description: "Set a form control by ref: text for inputs/textareas, option text or value for selects, true/false for checkboxes and radios.",
    input_schema: {
      type: "object",
      properties: { ref: { type: "string" }, value: { type: ["string", "boolean", "number"] } },
      required: ["ref", "value"],
    },
  },
  {
    name: "get_page_text",
    description: "Return the readable text of the current page (article or main content when present). Best for reading long content.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "javascript_exec",
    description:
      "Evaluate JavaScript in the current page's main world and return the JSON-serialized result. The code is an " +
      "expression; wrap statements in an IIFE. Promises are awaited.",
    input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  },
  {
    name: "network_requests",
    description:
      "List recent network requests of the current tab, newest last: method, status, resource type, duration, size, URL. " +
      "For debugging pages (failed API calls, slow or missing resources). Recording starts when the agent first uses a " +
      "tab, so reload to capture a page load. Pass request_id for one request's headers and response body.",
    input_schema: {
      type: "object",
      properties: {
        url_contains: { type: "string", description: "Only requests whose URL contains this text" },
        type: { type: "string", description: "Only this resource type, e.g. Fetch, XHR, Document, Script, Image" },
        failed_only: { type: "boolean", description: "Only failed requests and HTTP status 400 or higher" },
        limit: { type: "number", description: "Most recent requests to list (default 40, max 200)" },
        request_id: { type: "string", description: "Request number from the list, for full details" },
        clear: { type: "boolean", description: "Clear the recorded requests for this tab" },
      },
    },
  },
  {
    name: "edit_html",
    description:
      "Read or replace an element's HTML in the current page, by ref from read_page/find or by CSS selector. Omit html " +
      "to get the element's current HTML. mode 'outer' (default) replaces the element itself, 'inner' its contents. " +
      "Edits change only this page view and are lost on reload.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        selector: { type: "string", description: "CSS selector, when the element has no ref" },
        html: { type: "string", description: "New HTML; omit to read" },
        mode: { type: "string", enum: ["outer", "inner"] },
      },
    },
  },
  {
    name: "tabs",
    description: "List, open, switch to, or close tabs in the agent browser. Switching makes that tab the target of all page tools.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "create", "switch", "close"] },
        tab_id: { type: "string", description: "Tab id from list" },
        url: { type: "string", description: "For create" },
      },
      required: ["action"],
    },
  },
];

// Keeps huge data: URLs and tracking-laden links from flooding tool output.
function shortUrl(url) {
  return url.length > 200 ? url.slice(0, 200) + "…" : url;
}

function formatBytes(n) {
  if (n === undefined) return "";
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : n >= 1024 ? `${(n / 1024).toFixed(1)}kB` : `${n}B`;
}

function formatHeaders(headers = {}) {
  return Object.entries(headers)
    .map(([k, v]) => `  ${k}: ${String(v).slice(0, 300)}`)
    .join("\n");
}

// Bot checks from search engines and Cloudflare, by URL, title, or the text of a short page.
// Retrying them only makes the block last longer.
const BOT_CHECK_URL = /^https?:\/\/([^/]+\.)?(google\.[a-z.]+\/sorry\/|bing\.com\/turing\/captcha|search\.brave\.com\/captcha)|\/cdn-cgi\/challenge-platform\//i;
const BOT_CHECK_TITLE = /^(just a moment\.\.\.|attention required! \| cloudflare|verify you are human)$/i;
const BOT_CHECK_TEXT = /unusual traffic from your computer|bots use duckduckgo too|verify you are human|checking if the site connection is secure|confirm (that )?you are (a )?human|are you a robot/i;

export function isBotCheck(url = "", title = "", text = "") {
  return BOT_CHECK_URL.test(url) || BOT_CHECK_TITLE.test(title.trim()) || (text.length < 3000 && BOT_CHECK_TEXT.test(text));
}

function normalizeUrl(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}

function jpegSize(base64) {
  const buf = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const u16 = (i) => (buf[i] << 8) | buf[i + 1];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = u16(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: u16(i + 5), width: u16(i + 7) };
    i += 2 + len;
  }
  return null;
}

const MODIFIER_BITS = { alt: 1, option: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, super: 4, shift: 8 };

function parseModifiers(chord) {
  if (!chord) return 0;
  return chord.toLowerCase().split("+").reduce((bits, m) => bits | (MODIFIER_BITS[m.trim()] || 0), 0);
}

const NAMED_KEYS = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};
for (let i = 1; i <= 12; i++) NAMED_KEYS[`f${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i };

// Editing shortcuts need an explicit editor command; synthetic key events alone don't trigger them.
const EDIT_COMMANDS = { a: "selectAll", c: "copy", v: "paste", x: "cut", z: "undo" };

function describeKey(token) {
  const parts = token.split("+");
  const base = parts.pop();
  const modifiers = parseModifiers(parts.join("+"));
  const named = NAMED_KEYS[base.toLowerCase()];
  let def;
  if (named) def = { ...named };
  else if (base.length === 1) {
    const upper = base.toUpperCase();
    const code = /[a-z]/i.test(base) ? `Key${upper}` : /\d/.test(base) ? `Digit${base}` : undefined;
    def = { key: base, code, keyCode: upper.charCodeAt(0), text: base };
  } else throw new Error(`Unknown key "${base}"`);

  const commandModifier = modifiers & (2 | 4);
  if (commandModifier) delete def.text;
  const command = commandModifier ? EDIT_COMMANDS[base.toLowerCase()] : undefined;
  return { def, modifiers, commands: command ? [command] : undefined };
}

export class Browser {
  // transport: how pages are reached (the chrome.debugger transport, or a test stand-in).
  // Tab ids come from the transport.
  constructor(transport) {
    this.transport = transport;
    // While a task runs with highlighting on, its current tab sits in an "Agent" tab group.
    this.highlighting = false;
    this.highlightQueue = Promise.resolve();
    // Tabs opened during the current task; the agent may navigate and close only these.
    this.taskTabs = new Set();
    this.currentId = null;
    this.skipYoutubeAds = false;
    this.attached = new Set();
    this.adSkipperIds = new Map();
    // Network requests per attached tab: { since, seq, entries, byRequestId }.
    this.networkLogs = new Map();
    // With showActions on, a visible pointer glides to each target and typing appears
    // character by character. pointers holds its last spot per tab, in CSS pixels.
    this.showActions = false;
    this.pointers = new Map();
    transport.onAttach = (id) => this.#prepareTab(id);
    transport.onEvent = (id, method, params) => this.#onNetworkEvent(id, method, params);
    transport.onDetach = (id) => {
      this.attached.delete(id);
      this.adSkipperIds.delete(id);
      this.networkLogs.delete(id);
      this.pointers.delete(id);
    };
  }

  // Runs once each time the transport attaches to a tab.
  async #prepareTab(id) {
    this.attached.add(id);
    this.networkLogs.set(id, { since: Date.now(), seq: 0, entries: [], byRequestId: new Map() });
    await this.transport.send(id, "Network.enable").catch(() => {});
    if (this.skipYoutubeAds) await this.#installAdSkipper(id);
  }

  #onNetworkEvent(id, method, p) {
    const log = this.networkLogs.get(id);
    if (!log) return;
    const entry = log.byRequestId.get(p.requestId);
    switch (method) {
      case "Network.requestWillBeSent": {
        // A redirect reuses the request id: finish the previous hop and start a new entry.
        if (entry && p.redirectResponse) {
          entry.status = p.redirectResponse.status;
          entry.statusText = p.redirectResponse.statusText;
          entry.responseHeaders = p.redirectResponse.headers;
          entry.duration = Math.round((p.timestamp - entry.timestamp) * 1000);
          entry.redirected = true;
        }
        const e = {
          id: String(++log.seq),
          requestId: p.requestId,
          url: p.request.url,
          method: p.request.method,
          type: p.type || "Other",
          time: p.wallTime * 1000,
          timestamp: p.timestamp,
          requestHeaders: p.request.headers,
          postData: p.request.postData?.slice(0, 2000),
        };
        log.entries.push(e);
        log.byRequestId.set(p.requestId, e);
        if (log.entries.length > NETWORK_LOG_MAX_ENTRIES) {
          const dropped = log.entries.shift();
          if (log.byRequestId.get(dropped.requestId) === dropped) log.byRequestId.delete(dropped.requestId);
        }
        return;
      }
      case "Network.responseReceived":
        if (!entry) return;
        entry.status = p.response.status;
        entry.statusText = p.response.statusText;
        entry.mimeType = p.response.mimeType;
        entry.responseHeaders = p.response.headers;
        entry.fromCache = p.response.fromDiskCache || p.response.fromServiceWorker || undefined;
        if (p.type) entry.type = p.type;
        return;
      case "Network.loadingFinished":
        if (!entry) return;
        entry.size = p.encodedDataLength;
        entry.duration = Math.round((p.timestamp - entry.timestamp) * 1000);
        entry.done = true;
        return;
      case "Network.loadingFailed":
        if (!entry) return;
        entry.error = p.blockedReason ? `blocked: ${p.blockedReason}` : p.canceled ? "canceled" : p.errorText;
        entry.duration = Math.round((p.timestamp - entry.timestamp) * 1000);
        entry.done = true;
    }
  }

  // Every change of the tab the tools act on goes through here, so the highlight follows.
  #setCurrent(id) {
    if (id === this.currentId) return;
    this.currentId = id;
    this.cssPerPixel = null;
    if (this.highlighting) this.#highlight();
  }

  // Moves the "Agent" tab group to the current tab, or removes it when no task runs.
  // Calls are queued so quick tab switches apply in order.
  #highlight() {
    const id = this.highlighting ? this.currentId : null;
    this.highlightQueue = this.highlightQueue.then(() => this.transport.highlight(id).catch(() => {}));
    return this.highlightQueue;
  }

  pages() {
    return this.transport.pages();
  }

  async currentPage() {
    const pages = await this.pages();
    const page = pages.find((p) => p.id === this.currentId);
    if (page) return page;
    if (!pages[0]) pages.push({ id: await this.transport.createBlank(), title: "", url: "about:blank" });
    this.#setCurrent(pages[0].id);
    return pages[0];
  }

  async currentUrl() {
    return (await this.currentPage()).url;
  }

  async #installAdSkipper(id) {
    try {
      // New-document scripts only run once the Page domain is enabled on the session.
      await this.transport.send(id, "Page.enable");
      const { identifier } = await this.transport.send(id, "Page.addScriptToEvaluateOnNewDocument", { source: AD_SKIPPER_SOURCE });
      this.adSkipperIds.set(id, identifier);
      await this.transport.send(id, "Runtime.evaluate", { expression: AD_SKIPPER_SOURCE });
    } catch {}
  }

  // Called at the start of every task: tabs from earlier tasks and the user's own tabs
  // become protected, so this task opens new tabs instead of taking them over.
  // Also points the agent at the tab the user is looking at, so "this page" means it,
  // and with highlight on, marks the tab the agent works in with an "Agent" tab group.
  async startTask({ highlight = false } = {}) {
    this.taskTabs.clear();
    this.highlighting = highlight;
    const active = await this.transport.activeId();
    if (active) this.#setCurrent(active);
    if (highlight) await this.#highlight();
  }

  async endTask() {
    if (this.highlighting) {
      this.highlighting = false;
      await this.#highlight();
    }
    // The extension edition detaches here, which removes Chrome's debugging banner.
    await this.transport.release?.();
  }

  #isBlank(page) {
    return /^(about:blank|chrome:\/\/new-tab-page\/?|chrome:\/\/newtab\/?)$/.test(page.url);
  }

  // Opens a tab for this task as a tab in the current tab's window, next to it, and
  // makes it current.
  async #openTaskTab(url = "about:blank") {
    this.transport.checkUrl?.(url);
    const id = await this.transport.openTab({ openerId: this.currentId, url });
    this.#setCurrent(id);
    this.taskTabs.add(id);
    await this.bringToFront();
    return id;
  }

  // Turns the YouTube ad skipper on or off for tabs the agent has attached to.
  async setAdSkipping(enabled) {
    this.skipYoutubeAds = enabled;
    for (const id of this.attached) {
      const scriptId = this.adSkipperIds.get(id);
      if (enabled && !scriptId) await this.#installAdSkipper(id);
      if (!enabled && scriptId) {
        await this.transport.send(id, "Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId }).catch(() => {});
        this.adSkipperIds.delete(id);
      }
    }
  }

  async send(method, params = {}) {
    const { id } = await this.currentPage();
    return this.transport.send(id, method, params);
  }

  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result.value;
  }

  callInPage(fn, ...args) {
    return this.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
  }

  async bringToFront() {
    const { id } = await this.currentPage();
    await this.transport.activate(id);
  }

  async waitForLoad(timeoutMs = 20000) {
    const start = Date.now();
    await sleep(250);
    while (Date.now() - start < timeoutMs) {
      try {
        if ((await this.evaluate("document.readyState")) === "complete") return;
      } catch {
        // The execution context is replaced mid-navigation; keep polling.
      }
      await sleep(200);
    }
  }

  async #settle() {
    await sleep(300);
    try {
      if ((await this.evaluate("document.readyState")) !== "complete") await this.waitForLoad();
    } catch {
      await this.waitForLoad();
    }
  }

  async #viewport() {
    return this.evaluate(
      "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, x: visualViewport.pageLeft, y: visualViewport.pageTop })",
    );
  }

  async screenshot() {
    await this.bringToFront();
    const vp = await this.#viewport();
    const width = Math.min(vp.w, SCREENSHOT_MAX_WIDTH);
    // The model sees the page without the agent's pointer drawn over it.
    await this.#cursorVisible(false);
    const { data } = await this.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 75,
      // The output is also multiplied by devicePixelRatio, so divide it back out.
      clip: { x: vp.x, y: vp.y, width: vp.w, height: vp.h, scale: width / vp.w / vp.dpr },
    });
    await this.#cursorVisible(true);
    const size = jpegSize(data) || { width, height: Math.round((vp.h * width) / vp.w) };
    this.cssPerPixel = vp.w / size.width;
    return { data, ...size };
  }

  async #point(input, key = "coordinate") {
    if (input.ref && key === "coordinate") {
      const res = await this.callInPage(refCenterScript, input.ref);
      if (res.error) throw new Error(res.error);
      if (["left_click", "right_click", "double_click", "triple_click"].includes(input.action)) {
        const cover = await this.callInPage(hitTestScript, input.ref);
        if (cover) {
          throw new Error(
            `${input.ref} is covered by another element (${cover}), probably an ad or popup overlay. ` +
              "Take a screenshot, close or dismiss the overlay, then retry.",
          );
        }
      }
      return res;
    }
    const coord = input[key];
    if (!Array.isArray(coord) || coord.length !== 2) throw new Error(`${key} [x, y] or ref is required for ${input.action}`);
    if (!this.cssPerPixel) {
      const vp = await this.#viewport();
      this.cssPerPixel = vp.w / Math.min(vp.w, SCREENSHOT_MAX_WIDTH);
    }
    return { x: Math.round(coord[0] * this.cssPerPixel), y: Math.round(coord[1] * this.cssPerPixel) };
  }

  #mouse(type, x, y, extra = {}) {
    return this.send("Input.dispatchMouseEvent", { type, x, y, ...extra });
  }

  async #cursorVisible(visible) {
    const at = this.pointers.get(this.currentId);
    if (this.showActions && at) await this.callInPage(agentCursorScript, at, null, 0, false, visible).catch(() => {});
  }

  // Moves the mouse to (x, y). With showActions on, the visible pointer glides there and
  // the real mouse follows the same eased path, so hover effects appear along the way.
  // drag holds the left button during the move.
  async #glide(x, y, { click = false, drag = false, modifiers = 0 } = {}) {
    const held = drag ? { button: "left", buttons: 1 } : {};
    const from = this.pointers.get(this.currentId);
    if (!this.showActions) {
      if (drag && from) {
        for (let i = 1; i <= 10; i++) {
          await this.#mouse("mouseMoved", from.x + ((x - from.x) * i) / 10, from.y + ((y - from.y) * i) / 10, held);
        }
      } else await this.#mouse("mouseMoved", x, y, { modifiers, ...held });
      this.pointers.set(this.currentId, { x, y });
      return;
    }
    const start = from ?? { x: x - 120, y: y + 90 };
    const distance = Math.hypot(x - start.x, y - start.y);
    const ms = Math.round(Math.min(600, Math.max(180, 160 + distance * 0.45)));
    await this.callInPage(agentCursorScript, start, { x, y }, ms, click).catch(() => {});
    const steps = Math.max(6, Math.round(ms / 25));
    for (let i = 1; i <= steps; i++) {
      const t = easeOut(i / steps);
      await this.#mouse("mouseMoved", start.x + (x - start.x) * t, start.y + (y - start.y) * t, { modifiers, ...held });
      await sleep(ms / steps);
    }
    this.pointers.set(this.currentId, { x, y });
  }

  async #click(x, y, { button = "left", count = 1, modifiers = 0 } = {}) {
    await this.#glide(x, y, { click: true, modifiers });
    for (let i = 1; i <= count; i++) {
      await this.#mouse("mousePressed", x, y, { button, clickCount: i, modifiers });
      await this.#mouse("mouseReleased", x, y, { button, clickCount: i, modifiers });
    }
  }

  async #pressKeys(text) {
    for (const token of text.trim().split(/\s+/)) {
      const { def, modifiers, commands } = describeKey(token);
      const common = { key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, modifiers };
      await this.send("Input.dispatchKeyEvent", {
        ...common,
        type: def.text ? "keyDown" : "rawKeyDown",
        text: def.text,
        unmodifiedText: def.text,
        commands,
      });
      await this.send("Input.dispatchKeyEvent", { ...common, type: "keyUp" });
    }
  }

  // Types one character at a time at a quick pace, after the pointer glides to the
  // focused field.
  async #typeShown(text) {
    const field = await this.evaluate(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + Math.min(r.width / 2, 24)), y: Math.round(r.top + r.height / 2) };
    })()`).catch(() => null);
    if (field) await this.#glide(field.x, field.y);
    const chars = [...text];
    const delay = Math.min(45, Math.max(8, SHOWN_TYPING_MAX_MS / chars.length));
    for (const ch of chars) {
      await this.send("Input.insertText", { text: ch });
      await sleep(delay * (0.7 + Math.random() * 0.6));
    }
  }

  // form_input with showActions on: the pointer glides to the field. A text field is
  // clicked, cleared and typed into; for other fields (selects, checkboxes, radios) and
  // when the typed value did not stick, this returns null and the caller sets the value.
  async #formInputShown(input) {
    const center = await this.callInPage(refCenterScript, input.ref);
    if (center.error) return null;
    const typeable = await this.evaluate(`(() => {
      const el = window.__agentRefStore?.map.get(${JSON.stringify(input.ref)})?.deref();
      if (el?.isContentEditable) return true;
      const text = ["text", "search", "email", "tel", "url", "password", "number"];
      return (el?.tagName === "INPUT" && text.includes(el.type)) || el?.tagName === "TEXTAREA";
    })()`).catch(() => false);
    if (!typeable || (typeof input.value !== "string" && typeof input.value !== "number")) {
      await this.#glide(center.x, center.y, { click: true });
      return null;
    }
    const value = String(input.value);
    await this.#click(center.x, center.y);
    await this.callInPage(formInputScript, input.ref, "");
    await this.#typeShown(value);
    const now = await this.evaluate("document.activeElement?.isContentEditable ? document.activeElement.textContent : document.activeElement?.value").catch(() => null);
    return now === value ? `Set value to "${value.slice(0, 80)}"` : null;
  }

  async #pageAction(input) {
    switch (input.action) {
      case "screenshot": {
        const shot = await this.screenshot();
        return [
          { type: "image", mediaType: "image/jpeg", data: shot.data },
          { type: "text", text: `Browser screenshot ${shot.width}x${shot.height}` },
        ];
      }
      case "left_click":
      case "right_click":
      case "double_click":
      case "triple_click": {
        const p = await this.#point(input);
        const button = input.action === "right_click" ? "right" : "left";
        const count = { double_click: 2, triple_click: 3 }[input.action] || 1;
        await this.#click(p.x, p.y, { button, count, modifiers: parseModifiers(input.modifiers) });
        await this.#settle();
        return `${input.action} at ${input.ref || JSON.stringify(input.coordinate)}`;
      }
      case "hover": {
        const p = await this.#point(input);
        await this.#glide(p.x, p.y);
        return `Hovered ${input.ref || JSON.stringify(input.coordinate)}`;
      }
      case "left_click_drag": {
        const from = await this.#point(input, "start_coordinate");
        const to = await this.#point(input);
        await this.#glide(from.x, from.y);
        await this.#mouse("mousePressed", from.x, from.y, { button: "left", clickCount: 1 });
        await this.#glide(to.x, to.y, { drag: true });
        await this.#mouse("mouseReleased", to.x, to.y, { button: "left", clickCount: 1 });
        return "Dragged";
      }
      case "type": {
        if (typeof input.text !== "string") throw new Error("text is required for type");
        if (this.showActions) await this.#typeShown(input.text);
        else await this.send("Input.insertText", { text: input.text });
        return `Typed ${input.text.length} characters`;
      }
      case "key": {
        if (!input.text) throw new Error("text is required for key");
        await this.#pressKeys(input.text);
        await this.#settle();
        return `Pressed ${input.text}`;
      }
      case "scroll": {
        const vp = await this.#viewport();
        const p = input.coordinate || input.ref ? await this.#point(input) : { x: vp.w / 2, y: vp.h / 2 };
        const delta = (input.scroll_amount ?? 3) * 100;
        const dir = input.scroll_direction || "down";
        if (this.showActions) await this.#glide(p.x, p.y);
        await this.#mouse("mouseWheel", p.x, p.y, {
          deltaX: dir === "left" ? -delta : dir === "right" ? delta : 0,
          deltaY: dir === "up" ? -delta : dir === "down" ? delta : 0,
        });
        await sleep(250);
        return `Scrolled ${dir}`;
      }
      case "wait": {
        const secs = Math.min(Math.max(input.duration ?? 2, 0), 10);
        await sleep(secs * 1000);
        return `Waited ${secs}s`;
      }
      default:
        throw new Error(`Unknown action ${input.action}`);
    }
  }

  async #networkRequests(input) {
    // Attaching to the tab starts its recording, so make sure it is attached.
    await this.send("Runtime.evaluate", { expression: "0" });
    const log = this.networkLogs.get(this.currentId);
    if (!log) throw new Error("Network recording is not available for this tab.");
    if (input.clear) {
      log.entries = [];
      log.byRequestId.clear();
      log.since = Date.now();
      return "Cleared the recorded requests for this tab.";
    }
    if (input.request_id) {
      const e = log.entries.find((x) => x.id === String(input.request_id).replace(/^#/, ""));
      if (!e) throw new Error(`No request #${input.request_id} in the recent requests of this tab`);
      const lines = [
        `#${e.id} ${e.method} ${e.url}`,
        `Status: ${e.error ? `failed (${e.error})` : e.status ? `${e.status} ${e.statusText || ""}`.trim() : "pending"}`,
        `Type: ${e.type}${e.mimeType ? ` (${e.mimeType})` : ""}${e.fromCache ? ", from cache" : ""}`,
        `Started: ${new Date(e.time).toISOString()}${e.duration !== undefined ? `, took ${e.duration}ms` : ""}${e.size !== undefined ? `, ${formatBytes(e.size)} transferred` : ""}`,
        "",
        "Request headers:",
        formatHeaders(e.requestHeaders),
      ];
      if (e.postData) lines.push("", "Request body:", e.postData);
      if (e.responseHeaders) lines.push("", "Response headers:", formatHeaders(e.responseHeaders));
      if (e.done && !e.error && !e.redirected) {
        try {
          const { body, base64Encoded } = await this.send("Network.getResponseBody", { requestId: e.requestId });
          const text = base64Encoded ? `[binary, ${formatBytes(Math.round((body.length * 3) / 4))}]` : body;
          lines.push("", "Response body:", text.length > NETWORK_BODY_MAX_CHARS ? text.slice(0, NETWORK_BODY_MAX_CHARS) + "\n[truncated]" : text);
        } catch {
          lines.push("", "Response body: not available (no longer buffered)");
        }
      }
      return lines.join("\n");
    }
    const type = input.type?.toLowerCase();
    const filtered = log.entries.filter(
      (e) =>
        (!input.url_contains || e.url.includes(input.url_contains)) &&
        (!type || e.type.toLowerCase() === type) &&
        (!input.failed_only || e.error || e.status >= 400),
    );
    const limit = Math.min(Math.max(input.limit ?? 40, 1), 200);
    const shown = filtered.slice(-limit);
    const since = new Date(log.since).toTimeString().slice(0, 8);
    const header = `Recorded since ${since}; showing ${shown.length} of ${filtered.length} matching (${log.entries.length} total), newest last.`;
    if (!shown.length) return `${header}\nNo requests. Reload the page to capture its load.`;
    const rows = shown.map((e) => {
      const status = e.error ? `failed(${e.error})` : e.status ?? "pending";
      const timing = [e.duration !== undefined && `${e.duration}ms`, formatBytes(e.size)].filter(Boolean).join(" ");
      return `#${e.id} ${e.method} ${status} ${e.type}${timing ? ` ${timing}` : ""} ${shortUrl(e.url)}`;
    });
    return `${header}\n${rows.join("\n")}`;
  }

  async #editHtml(input) {
    if (!input.ref && !input.selector) throw new Error("ref or selector is required");
    const found = await this.send("Runtime.evaluate", {
      expression: `(${resolveElementScript.toString()})(${JSON.stringify(input.ref || null)}, ${JSON.stringify(input.selector || null)})`,
    });
    if (found.exceptionDetails) throw new Error(found.exceptionDetails.exception?.description?.replace(/^Error: /, "").split("\n")[0]);
    const objectId = found.result.objectId;
    const outerHtml = async (id) => {
      const res = await this.send("Runtime.callFunctionOn", { objectId: id, functionDeclaration: "function () { return this.outerHTML; }", returnByValue: true });
      const html = res.result.value || "";
      return html.length > ELEMENT_HTML_MAX_CHARS ? html.slice(0, ELEMENT_HTML_MAX_CHARS) + "\n[truncated]" : html;
    };
    if (input.html === undefined) return outerHtml(objectId);

    // DevTools edits bypass Trusted Types, which make innerHTML assignment throw on many sites.
    await this.send("DOM.getDocument", { depth: 0 });
    const setOuter = async (id, html) => {
      const { nodeId } = await this.send("DOM.requestNode", { objectId: id });
      await this.send("DOM.setOuterHTML", { nodeId, outerHTML: html });
    };
    if (input.mode === "inner") {
      const marker = await this.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: "function () { const m = document.createElement('span'); this.replaceChildren(m); return m; }",
      });
      if (input.html) await setOuter(marker.result.objectId, input.html);
      else await this.send("Runtime.callFunctionOn", { objectId: marker.result.objectId, functionDeclaration: "function () { this.remove(); }" });
      return `Replaced the contents. The element is now:\n${(await outerHtml(objectId)).slice(0, 2000)}`;
    }
    await setOuter(objectId, input.html);
    return "Replaced the element. Refs inside it no longer work; use read_page or find for new refs.";
  }

  async #tabs(input) {
    switch (input.action) {
      case "list": {
        const pages = await this.pages();
        return pages
          .map((p) => `${p.id === this.currentId ? "* " : "  "}${p.id}: ${p.title} | ${shortUrl(p.url)}${this.taskTabs.has(p.id) ? " [opened this task]" : ""}`)
          .join("\n");
      }
      case "create": {
        const id = await this.#openTaskTab(input.url ? normalizeUrl(input.url) : undefined);
        if (input.url) await this.waitForLoad();
        return `Opened tab ${id} and made it the current tab`;
      }
      case "switch": {
        if (!input.tab_id) throw new Error("tab_id is required");
        const tabId = String(input.tab_id);
        if (!(await this.pages()).some((p) => p.id === tabId)) throw new Error(`No tab ${tabId}`);
        this.#setCurrent(tabId);
        const page = await this.currentPage();
        await this.bringToFront();
        return `Current tab is now ${page.id}: ${page.title} | ${shortUrl(page.url)}`;
      }
      case "close": {
        const id = input.tab_id ? String(input.tab_id) : this.currentId;
        if (!this.taskTabs.has(id)) {
          throw new Error("You can only close tabs you opened during this task. Leave other tabs open; switch away from them instead.");
        }
        await this.transport.close(id);
        this.taskTabs.delete(id);
        if (id === this.currentId) this.#setCurrent(null);
        return `Closed tab ${id}`;
      }
      default:
        throw new Error(`Unknown tabs action ${input.action}`);
    }
  }

  // Returns tool output: a string or an array of text/image blocks.
  async run(name, input) {
    const output = await this.#run(name, input);
    await this.highlightQueue;
    return output;
  }

  async #run(name, input) {
    switch (name) {
      case "browser":
        return this.#pageAction(input);
      case "navigate": {
        let note = "";
        if (input.url !== "back" && input.url !== "forward") {
          this.transport.checkUrl?.(normalizeUrl(input.url));
          const page = await this.currentPage();
          if (input.new_tab) {
            const id = await this.#openTaskTab();
            note = ` (new tab ${id}; previous tab ${page.id} unchanged)`;
          } else if (this.taskTabs.has(page.id)) {
            // Already this task's tab.
          } else if (this.#isBlank(page)) {
            this.taskTabs.add(page.id);
          } else {
            const id = await this.#openTaskTab();
            note = ` (new tab ${id}, because tab ${page.id} was not opened by this task; it is unchanged)`;
          }
        }
        if (input.url === "back" || input.url === "forward") {
          const { currentIndex, entries } = await this.send("Page.getNavigationHistory");
          const entry = entries[currentIndex + (input.url === "back" ? -1 : 1)];
          if (!entry) throw new Error(`No ${input.url} history entry`);
          await this.send("Page.navigateToHistoryEntry", { entryId: entry.id });
        } else {
          const url = normalizeUrl(input.url);
          const { id } = await this.currentPage();
          const errorText = await this.transport.navigate(id, url);
          if (errorText) throw new Error(`Navigation failed: ${errorText}`);
        }
        this.cssPerPixel = null;
        await this.waitForLoad();
        const page = await this.currentPage();
        const loaded = `Loaded: ${shortUrl(page.title)} | ${shortUrl(page.url)}${note}`;
        const text = await this.evaluate("document.body?.innerText.slice(0, 3000) ?? ''").catch(() => "");
        if (!isBotCheck(page.url, page.title, text)) return loaded;
        return `${loaded}\nThis page is a bot check. Do not retry it or try to solve it: use a different source (another site, or web search if you have it), or ask the user.`;
      }
      case "read_page": {
        const res = await this.callInPage(readPageScript, input.filter === "interactive", PAGE_OUTLINE_MAX_CHARS);
        return `URL: ${shortUrl(res.url)}\nTitle: ${res.title}\nViewport: ${res.viewport}, scroll ${res.scroll}\n\n${res.tree}`;
      }
      case "find": {
        const res = await this.callInPage(readPageScript, false, 200000);
        const words = input.query.toLowerCase().split(/\s+/).filter(Boolean);
        const matches = res.tree
          .split("\n")
          .map((l) => l.trim())
          .map((line) => ({ line, score: words.filter((w) => line.toLowerCase().includes(w)).length }))
          .filter((m) => m.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 25);
        if (matches.length) return matches.map((m) => m.line).join("\n");
        const frames = res.tree.includes("(cross-origin:") ? " The page has cross-origin iframes, whose contents find cannot search." : "";
        return `No elements matched "${input.query}".${frames} Take a screenshot to see the page, or use read_page.`;
      }
      case "form_input": {
        if (this.showActions) {
          const shown = await this.#formInputShown(input);
          if (shown) return shown;
        }
        const res = await this.callInPage(formInputScript, input.ref, input.value);
        if (res.error) throw new Error(res.error);
        return res.ok;
      }
      case "get_page_text": {
        const res = await this.callInPage(pageTextScript, PAGE_TEXT_MAX_CHARS);
        return `URL: ${shortUrl(res.url)}\nTitle: ${res.title}\nSource: <${res.source}>\n\n${res.text}`;
      }
      case "javascript_exec": {
        const value = await this.evaluate(input.code).catch((err) => {
          throw new Error(explainScriptError(err.message));
        });
        const out = value === undefined ? "undefined" : JSON.stringify(value, null, 2);
        return out.length > 30000 ? out.slice(0, 30000) + "\n[truncated]" : out;
      }
      case "tabs":
        return this.#tabs(input);
      case "network_requests":
        return this.#networkRequests(input);
      case "edit_html":
        return this.#editHtml(input);
      default:
        throw new Error(`Unknown browser tool ${name}`);
    }
  }

  // What a browser/form_input action will hit, for safety checks. Null when unknown.
  async describeTarget(input) {
    try {
      if (input.ref) return await this.callInPage(describeTargetScript, input.ref, 0, 0);
      if (Array.isArray(input.coordinate) && this.cssPerPixel) {
        const [x, y] = input.coordinate.map((v) => Math.round(v * this.cssPerPixel));
        return await this.callInPage(describeTargetScript, null, x, y);
      }
    } catch {}
    return null;
  }
}

// A javascript_exec error with a hint at the usual cause, so the model looks at the page
// instead of guessing at selectors again.
export function explainScriptError(message) {
  const first = message.split("\n")[0];
  let hint = "";
  if (/Blocked a frame|SecurityError|cross-origin/i.test(first)) {
    hint =
      "The code reached into a cross-origin iframe, which page scripts cannot access. Interact with it by screenshot " +
      "coordinates, or navigate to the iframe's src.";
  } else if (/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(first)) {
    hint = "The page navigated while the code ran. Take a screenshot or use read_page to see the new page.";
  } else if (/of (null|undefined)|is (null|undefined)|null is not an object/.test(first)) {
    // "reading 'contentDocument'" means the iframe itself was not found.
    const frame = /reading '(contentDocument|contentWindow)'/.test(first) ? " Here it was the iframe itself." : "";
    hint =
      "Something the code expected is missing, usually because a selector matched no element." + frame +
      " The page may have changed or navigated, or the content is in an iframe (contentDocument is null for " +
      "cross-origin iframes). Do not retry with another guessed selector: use read_page or find to see what is on the " +
      "page now, or take a screenshot.";
  }
  return hint ? `${first}\n${hint}` : message;
}

// The origin a tool call acts on, for site permission checks; null when it touches no page.
export function originForToolCall(name, input, currentUrl) {
  if (name === "tabs" || (name === "browser" && input.action === "wait")) return null;
  const url = name === "navigate" && !["back", "forward"].includes(input.url) ? normalizeUrl(input.url) : currentUrl;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
