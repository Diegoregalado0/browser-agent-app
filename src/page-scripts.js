// Functions serialized with Function.prototype.toString() and run inside the page.
// Each one must be fully self-contained: no imports, no closures over module scope.

// Builds a compact, indented outline of the page. Elements that can be acted on get a
// stable ref id (ref_N) that the other tools accept in place of coordinates. Same-origin
// iframes are walked in place; cross-origin ones are listed but their contents are not.
// shotWidth: list only the controls in the viewport, one per line with a coarse box in
// the pixels of a screenshot scaled to at most this width, and return them as items too.
export function readPageScript(interactiveOnly, maxChars, shotWidth = 0) {
  const inView = shotWidth > 0;
  if (inView) interactiveOnly = true;
  const scale = inView ? Math.min(1, shotWidth / innerWidth) : 1;
  const items = [];
  let visual = null;
  // id: which document the refs belong to; a new document numbers its refs from 1 again.
  const store = (window.__agentRefStore ||= { seq: 0, map: new Map(), id: Math.random().toString(36).slice(2) });
  const refFor = (el) => {
    if (!el.__agentRef) {
      el.__agentRef = "ref_" + ++store.seq;
      store.map.set(el.__agentRef, new WeakRef(el));
    }
    return el.__agentRef;
  };

  const INTERACTIVE_SELECTOR = [
    "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
    "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]", "[role=tab]",
    "[role=menuitem]", "[role=option]", "[role=switch]", "[role=combobox]", "[role=textbox]",
    "[role=searchbox]", "[role=slider]", "[contenteditable='']", "[contenteditable=true]",
    "[onclick]", "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  const STRUCTURAL = {
    H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading",
    NAV: "navigation", MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", ASIDE: "complementary",
    FORM: "form", DIALOG: "dialog", TABLE: "table", UL: "list", OL: "list", LI: "listitem",
    IMG: "img", LABEL: "label", P: "paragraph",
  };
  const IMPLICIT = {
    A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", SUMMARY: "button",
  };

  const isVisible = (el) => {
    const s = el.ownerDocument.defaultView.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || s.display === "contents";
  };
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    if (el.tagName === "INPUT") {
      const t = (el.type || "text").toLowerCase();
      if (["checkbox", "radio"].includes(t)) return t;
      if (["button", "submit", "reset", "image"].includes(t)) return "button";
      if (t === "range") return "slider";
      if (t === "search") return "searchbox";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return IMPLICIT[el.tagName] || STRUCTURAL[el.tagName] || el.tagName.toLowerCase();
  };

  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.innerText || "").join(" ");
      if (clean(text)) return clean(text);
    }
    if (el.labels && el.labels.length) return clean(el.labels[0].innerText);
    const attr = el.getAttribute("alt") || el.getAttribute("placeholder") || el.getAttribute("title");
    if (attr) return clean(attr);
    if (el.tagName === "INPUT" && ["submit", "button", "reset"].includes(el.type)) return clean(el.value);
    return clean(el.innerText || el.textContent || "");
  };

  const lines = [];
  let size = 0;
  let truncated = false;

  const push = (line) => {
    if (size + line.length > maxChars) {
      truncated = true;
      return;
    }
    lines.push(line);
    size += line.length + 1;
  };

  const describe = (el, role, interactive) => {
    let line = role;
    const name = clip(nameOf(el), interactive ? 100 : 200);
    if (name) line += ` "${name.replace(/"/g, "'")}"`;
    if (interactive) line += ` [${refFor(el)}]`;
    if (el.tagName === "A" && el.getAttribute("href")) line += ` href="${clip(el.getAttribute("href"), 120)}"`;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if (el.type && el.tagName === "INPUT") line += ` type=${el.type}`;
      if (["checkbox", "radio"].includes(el.type)) line += el.checked ? " checked" : " unchecked";
      // A password is never read back, only whether the field is filled.
      else if (el.value) line += el.type === "password" ? " value=[hidden]" : ` value="${clip(el.value, 80)}"`;
    }
    if (el.tagName === "SELECT") {
      const opts = [...el.options].map((o) => (o.selected ? `*${clean(o.text)}` : clean(o.text)));
      line += ` options=[${clip(opts.join(" | "), 300)}]`;
    }
    if (el.disabled) line += " disabled";
    if (el.getAttribute("aria-expanded")) line += ` expanded=${el.getAttribute("aria-expanded")}`;
    return line;
  };

  // The part of an element's box inside the viewport, as "x,y wxh" in screenshot pixels,
  // or null when none of it is. (ox, oy): the offset of the element's frame.
  const boxOf = (el, ox, oy) => {
    const r = el.getBoundingClientRect();
    const left = Math.max(0, r.left + ox);
    const top = Math.max(0, r.top + oy);
    const right = Math.min(innerWidth, r.right + ox);
    const bottom = Math.min(innerHeight, r.bottom + oy);
    if (right <= left || bottom <= top) return null;
    const px = (v) => Math.round(v * scale);
    return { text: `${px(left)},${px(top)} ${px(right - left)}x${px(bottom - top)}`, area: (right - left) * (bottom - top) };
  };

  const walk = (root, depth, ox = 0, oy = 0) => {
    for (const el of root.children) {
      if (truncated) return;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD"].includes(el.tagName.toUpperCase())) continue;
      if (!isVisible(el)) continue;
      // A large canvas shows content no outline can (a map, a game, a chart).
      if (inView && el.tagName === "CANVAS" && (boxOf(el, ox, oy)?.area ?? 0) > innerWidth * innerHeight * 0.2) visual ||= "a large canvas";
      if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
        let body = null;
        try {
          body = el.contentDocument?.body;
        } catch {}
        const name = clip(clean(el.getAttribute("title") || el.getAttribute("name")), 100);
        const src = clip(el.getAttribute("src") || "", 120);
        const box = inView ? boxOf(el, ox, oy) : null;
        if (inView && !box) continue;
        const line = "iframe" + (name ? ` "${name.replace(/"/g, "'")}"` : "") + (src ? ` src="${src}"` : "") +
          (body ? "" : " (cross-origin: its contents are not in this outline; use a screenshot and coordinates)");
        if (inView) {
          if (!body && box.area > innerWidth * innerHeight * 0.2) visual ||= "a large cross-origin frame";
          if (!body) {
            items.push({ ref: `frame ${src}`, line, box: box.text });
            push(`${line} @${box.text}`);
          }
        } else push("  ".repeat(depth) + line);
        if (body) {
          const fr = el.getBoundingClientRect();
          walk(body, depth + 1, ox + fr.left + el.clientLeft, oy + fr.top + el.clientTop);
        }
        continue;
      }

      const interactive = el.matches(INTERACTIVE_SELECTOR);
      const structural = !interactiveOnly && STRUCTURAL[el.tagName] !== undefined;
      const leafText =
        !interactiveOnly &&
        !interactive &&
        el.children.length === 0 &&
        clean(el.textContent).length > 0;

      let nextDepth = depth;
      if (inView) {
        const box = interactive && boxOf(el, ox, oy);
        if (box) {
          const line = describe(el, roleOf(el), true);
          items.push({ ref: el.__agentRef, line, box: box.text });
          push(`${line} @${box.text}`);
        }
      } else if (interactive || structural || leafText) {
        const role = leafText && !structural ? "text" : roleOf(el);
        push("  ".repeat(depth) + describe(el, role, interactive));
        nextDepth = depth + 1;
      }
      // Interactive elements' text is already in their name; don't repeat it.
      if (!interactive || el.children.length > 3) walk(el, nextDepth, ox, oy);
      if (el.shadowRoot) walk(el.shadowRoot, nextDepth, ox, oy);
    }
  };

  walk(document.body || document.documentElement, 0);

  return {
    url: location.href,
    title: document.title,
    viewport: `${innerWidth}x${innerHeight}`,
    scroll: `${Math.round(scrollX)},${Math.round(scrollY)} of ${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`,
    tree: lines.join("\n") + (truncated ? "\n[truncated: page outline exceeded the size limit; use find or scroll]" : ""),
    ...(inView && { items, visual, doc: store.id }),
  };
}

// Scrolls a ref'd element into view and returns its center in CSS pixels.
export function refCenterScript(ref) {
  const el = window.__agentRefStore?.map.get(ref)?.deref();
  if (!el || !el.isConnected) return { error: `${ref} not found; call read_page again to refresh refs` };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  let x = r.left + r.width / 2;
  let y = r.top + r.height / 2;
  // An element in a same-origin iframe: add each frame's content-box offset.
  for (let w = el.ownerDocument.defaultView; w.frameElement; w = w.parent) {
    const f = w.frameElement;
    const fr = f.getBoundingClientRect();
    const s = w.parent.getComputedStyle(f);
    x += fr.left + f.clientLeft + parseFloat(s.paddingLeft);
    y += fr.top + f.clientTop + parseFloat(s.paddingTop);
  }
  return { x: Math.round(x), y: Math.round(y) };
}

export function formInputScript(ref, value) {
  const el = window.__agentRefStore?.map.get(ref)?.deref();
  if (!el || !el.isConnected) return { error: `${ref} not found; call read_page again to refresh refs` };
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.focus();
  const fire = () => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  if (el.tagName === "SELECT") {
    const want = String(value).toLowerCase();
    const opt = [...el.options].find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want);
    if (!opt) return { error: `No option "${value}". Options: ${[...el.options].map((o) => o.text.trim()).join(", ")}` };
    el.value = opt.value;
    fire();
    return { ok: `Selected "${opt.text.trim()}"` };
  }
  if (el.type === "checkbox" || el.type === "radio") {
    const want = value === true || value === "true" || value === "on" || value === 1;
    if (el.checked !== want) el.click();
    return { ok: `${el.type} is now ${el.checked ? "checked" : "unchecked"}` };
  }
  if (el.isContentEditable) {
    el.textContent = String(value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return { ok: "Set content" };
  }
  if ("value" in el) {
    // Use the native setter so frameworks (React etc.) observe the change.
    const view = el.ownerDocument.defaultView;
    const proto = el.tagName === "TEXTAREA" ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
    fire();
    return { ok: `Set value to "${String(value).slice(0, 80)}"` };
  }
  return { error: `${ref} is not a form field` };
}

export function pageTextScript(maxChars) {
  const root = document.querySelector("article") || document.querySelector("main") || document.body;
  const text = (root?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  return {
    url: location.href,
    title: document.title,
    source: root === document.body ? "body" : root.tagName.toLowerCase(),
    text: text.length > maxChars ? text.slice(0, maxChars) + "\n[truncated]" : text,
  };
}

// Describes the element a ref names, or the element at a CSS-pixel point, so safety
// checks can see what an action will actually hit.
export function describeTargetScript(ref, x, y) {
  const el = ref ? window.__agentRefStore?.map.get(ref)?.deref() : document.elementFromPoint(x, y);
  if (!el) return null;
  const target = el.closest("a,button,input,select,textarea,label,[role],[onclick]") || el;
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim().slice(0, 120);
  // A password field's value would show in the permission prompt and reach the safety model.
  const value = target.type === "password" ? "" : target.value;
  const name = target.getAttribute("aria-label") || target.getAttribute("placeholder") || value || target.innerText || target.getAttribute("title") || "";
  const tag = target.tagName.toLowerCase();
  const role = target.getAttribute("role") || (tag === "input" ? `input[type=${target.type}]` : tag);
  const form = target.form?.getAttribute("action");
  return [
    `${role} "${clean(name)}"`,
    target.getAttribute("href") && `href=${clean(target.getAttribute("href"))}`,
    form && `form action=${clean(form)}`,
  ]
    .filter(Boolean)
    .join(" ");
}

// Reports what actually sits on top of a ref'd element's center, so a click that would
// land on an overlay fails loudly instead of hitting the overlay. For an element in an
// iframe only that iframe's document is tested.
export function hitTestScript(ref) {
  const el = window.__agentRefStore?.map.get(ref)?.deref();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const top = el.ownerDocument.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!top || el === top || el.contains(top) || top.contains(el)) return null;
  if (el.labels && [...el.labels].some((l) => l === top || l.contains(top))) return null;
  const desc = top.tagName.toLowerCase() + (top.id ? `#${top.id}` : "") + (top.src ? ` src=${String(top.src).slice(0, 80)}` : "");
  return desc;
}

// The address of the frame an action lands in, when that is an iframe rather than the top
// page: the frame of the ref'd element, of the element at (x, y), or of the focused element
// when neither is given (typing). Same-origin frames are followed down; a cross-origin
// frame is known by its src.
export function targetFrameScript(ref, x, y) {
  const atPoint = !ref && x !== null;
  let el = ref ? window.__agentRefStore?.map.get(ref)?.deref() : atPoint ? document.elementFromPoint(x, y) : document.activeElement;
  while (el && (el.tagName === "IFRAME" || el.tagName === "FRAME")) {
    const doc = el.contentDocument;
    if (!doc) return el.src || null;
    if (atPoint) {
      const r = el.getBoundingClientRect();
      x -= r.left;
      y -= r.top;
      el = doc.elementFromPoint(x, y);
    } else el = doc.activeElement || doc.body;
  }
  return el && el.ownerDocument !== document ? el.ownerDocument.URL : null;
}

// Whether typing would go into a password field: the ref'd element, or the focused one.
export function passwordTargetScript(ref) {
  let el = ref ? window.__agentRefStore?.map.get(ref)?.deref() : document.activeElement;
  // Focus inside a same-origin iframe.
  while (!ref && el?.contentDocument?.activeElement) el = el.contentDocument.activeElement;
  return Boolean(el && el.tagName === "INPUT" && el.type === "password");
}

// The agent's visible pointer: glides from its last spot to (x, y) over ms, in CSS
// pixels, and pulses when click is set. It lives in a closed shadow root on the root
// element, ignores pointer events (so clicks and hit tests pass through it), and is
// rebuilt at `from` after a navigation. visible toggles it around screenshots.
export function agentCursorScript(from, to, ms, click, visible = true) {
  let host = window.__agentCursorHost;
  if (!host || !host.isConnected) {
    host = document.createElement("agent-cursor");
    host.style.cssText = "all: initial; position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; pointer-events: none;
        transition-property: transform; transition-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1);
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35)); will-change: transform; }
      .pulse { position: absolute; left: -11px; top: -11px; width: 22px; height: 22px; border-radius: 50%;
        border: 2px solid #3b82f6; opacity: 0; }
      .pulse.on { animation: agent-pulse 360ms ease-out; }
      @keyframes agent-pulse { from { opacity: 0.9; transform: scale(0.4); } to { opacity: 0; transform: scale(1.6); } }
      @media (prefers-reduced-motion: reduce) { .cursor { transition-duration: 0ms !important; } .pulse.on { animation: none; } }`;
    const cursor = document.createElement("div");
    cursor.className = "cursor";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "22");
    svg.setAttribute("height", "22");
    svg.setAttribute("viewBox", "0 0 22 22");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M3 2 L3 18 L7.5 14 L10.5 20.5 L13.5 19.2 L10.6 12.8 L16.5 12.8 Z");
    path.setAttribute("fill", "#3b82f6");
    path.setAttribute("stroke", "#ffffff");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    const pulse = document.createElement("div");
    pulse.className = "pulse";
    cursor.append(pulse, svg);
    root.append(style, cursor);
    cursor.style.transform = `translate(${from.x - 3}px, ${from.y - 2}px)`;
    host.cursor = cursor;
    host.pulse = pulse;
    document.documentElement.append(host);
    window.__agentCursorHost = host;
    // Commit the starting position so the first glide animates from it.
    cursor.getBoundingClientRect();
  }
  host.style.visibility = visible ? "visible" : "hidden";
  if (!to) return;
  const { cursor, pulse } = host;
  cursor.style.transitionDuration = `${ms}ms`;
  // The arrow's tip sits at (3, 2) in its box, so the tip lands on the point.
  cursor.style.transform = `translate(${to.x - 3}px, ${to.y - 2}px)`;
  if (click) {
    clearTimeout(host.pulseTimer);
    host.pulseTimer = setTimeout(() => {
      pulse.classList.remove("on");
      void pulse.offsetWidth;
      pulse.classList.add("on");
    }, ms);
  }
}
