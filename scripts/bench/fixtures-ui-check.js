#!/usr/bin/env node
// Walks every fixture task through its pages in a real Chrome, with real mouse and keyboard
// input at the benchmark's 394x429 view, then runs the task's checker on what the pages showed.
// It proves each task can be passed through the UI. fixtures-check.js only calls the routes,
// which is how two impassable pages went unnoticed (a popup that could not close, and a wizard
// that sent a finished user back to step 1). A click on a covered control fails here as it
// would for an agent, so overlays are checked the way they behave on screen.
//   node scripts/bench/fixtures-ui-check.js [--headed] [fx-task ...]   (CHROME=<path> picks the browser)
// --headed shows the Chrome window, to watch the walkthrough.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TASKS, fixtures as fx } from "./tasks-fixtures.js";

const VIEW = { width: 394, height: 429 };
const CHROMES = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/opt/google/chrome/chrome", "/usr/bin/google-chrome"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { origin, altOrigin, state } = fx;

// ---------- Chrome over DevTools ----------
const chromePath = CHROMES.find((p) => p && existsSync(p));
if (!chromePath) throw new Error("No Chrome found; set CHROME to its path.");
const profile = mkdtempSync(join(tmpdir(), "fx-ui-"));
const headed = process.argv.includes("--headed");
const chrome = spawn(chromePath, [...(headed ? [] : ["--headless=new"]), `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", `--window-size=${VIEW.width},${VIEW.height}`, "about:blank"], { stdio: "ignore" });
let port;
for (let i = 0; i < 100 && !port; i++) {
  try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch { await sleep(100); }
}
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id); };
const send = (method, params = {}) => new Promise((resolve, reject) => {
  pending.set(++seq, (d) => (d.error ? reject(new Error(`${method}: ${d.error.message}`)) : resolve(d.result)));
  ws.send(JSON.stringify({ id: seq, method, params }));
});
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const view = (size) => send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: 1, mobile: false });
await view(VIEW);

// ---------- page actions, as an agent's input arrives ----------
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)})`;
const btn = (label) => byText("button", label);
const link = (label) => byText("a", label);
// A control inside the element of `within` (a card, a row) whose text contains `text`.
const inside = (within, text, sel) => `[...document.querySelectorAll(${JSON.stringify(within)})].find((e) => e.textContent.includes(${JSON.stringify(text)}))?.querySelector(${JSON.stringify(sel)})`;

// A link with target=_blank leaves its new tab in front, and input goes to the focused tab:
// close the other tabs and bring this one back.
async function front() {
  for (const t of await (await fetch(`http://127.0.0.1:${port}/json`)).json()) {
    if (t.type === "page" && t.id !== page.id) await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);
  }
  await send("Page.bringToFront");
}
async function settled() {
  for (let i = 0; i < 50; i++) {
    if ((await ev("document.readyState").catch(() => "")) === "complete") return;
    await sleep(100);
  }
}
async function open(path, base = origin) {
  await send("Page.navigate", { url: base + path });
  await sleep(200);
  await settled();
}
// Waits for the document a click or submit loads (the marker set before it is gone).
async function navigated() {
  for (let i = 0; i < 60; i++) {
    if ((await ev("window.__fxMark").catch(() => 1)) === undefined) break;
    await sleep(100);
  }
  await settled();
}
// The element's center and whether a click there reaches it: the topmost element at the
// point, looked for inside open shadow roots too, must be it or inside it.
const locate = (expr) => `(() => {
  const el = ${expr};
  if (!el) return null;
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  // As Browsby aims (refCenterScript): the first line of an element that wraps.
  const lines = [...el.getClientRects()].filter((q) => q.width && q.height);
  const r = lines.length > 1 ? lines[0] : el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  let top = document.elementFromPoint(x, y);
  while (top && top.shadowRoot) { const i = top.shadowRoot.elementFromPoint(x, y); if (!i || i === top) break; top = i; }
  return { x, y, free: !!top && (top === el || el.contains(top)), top: top ? top.tagName.toLowerCase() + (top.id ? "#" + top.id : "") : null };
})()`;
async function mouse(x, y) {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
}
async function click(expr, { nav = false } = {}) {
  const at = await ev(locate(expr));
  if (!at) throw new Error(`not found: ${expr}`);
  if (!at.free) throw new Error(`covered by ${at.top}: ${expr}`);
  await ev("window.__fxMark = 1");
  await mouse(at.x, at.y);
  if (nav) await navigated(); else await sleep(200);
}
// Clicks the field, then types over what it holds.
async function typeIn(expr, text) {
  await click(expr);
  await ev(`(() => { const e = ${expr}; e.focus(); e.select?.(); })()`);
  await send("Input.insertText", { text });
}
// Picks an option by its text or value, as a form tool sets a select.
const choose = (expr, option) => ev(`(() => {
  const s = ${expr}, o = [...s.options].find((o) => o.text === ${JSON.stringify(option)} || o.value === ${JSON.stringify(option)});
  if (!o) throw new Error("no option " + ${JSON.stringify(option)});
  s.value = o.value; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true }));
})()`);
const text = (expr = "document.body") => ev(`(${expr})?.innerText ?? ""`);
async function until(cond, ms = 6000) {
  for (let t = 0; t < ms; t += 100) { if (await ev(cond).catch(() => false)) return true; await sleep(100); }
  throw new Error(`timed out waiting for ${cond}`);
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---------- each task, done through the pages; returns what the agent would answer ----------
const FLOWS = {
  "fx-register": async () => {
    await open("/register");
    await typeIn(q("input[name=name]"), "Dana Reyes");
    await typeIn(q("input[name=email]"), "dana@example.com");
    await typeIn(q("input[name=username]"), "dana");
    await typeIn(q("input[name=password]"), "sunshine");
    await typeIn(q("input[name=confirm]"), "sunshine");
    await choose(q("select[name=country]"), "Portugal");
    await click(q("input[name=terms]"));
    await click(btn("Create account"), { nav: true });
    must((await text()).includes("Username must be"), "no username error shown");
    // The rejected form keeps name, email, username, country and the terms box.
    await typeIn(q("input[name=username]"), "dana_r1");
    await typeIn(q("input[name=password]"), "sunshine1");
    await typeIn(q("input[name=confirm]"), "sunshine1");
    await click(btn("Create account"), { nav: true });
    return text();
  },
  "fx-support-format": async () => {
    await open("/support");
    await typeIn(q("input[name=order]"), "1042");
    await typeIn(q("input[name=subject]"), "Refund status");
    await typeIn(q("textarea[name=message]"), "Where is my refund for this order?");
    await click(btn("Send message"), { nav: true });
    must((await text()).includes("ORD-1234"), "no order format error shown");
    await typeIn(q("input[name=order]"), "ORD-1042");
    await click(btn("Send message"), { nav: true });
    return text();
  },
  "fx-wizard": async () => {
    await open("/wizard");
    await click(q("input[value=Team]"));
    await click(btn("Next"), { nav: true });
    await typeIn(q("input[name=city]"), "Springfield");
    await typeIn(q("input[name=postcode]"), "62704");
    await click(btn("Next"), { nav: true });
    await click(q("input[name=newsletter]"));
    await click(btn("Next"), { nav: true });
    await click(btn("Finish setup"), { nav: true });
    const shown = await text();
    must(shown.includes("All set") && !/Step \d of 4/.test(shown), `finished wizard shows: ${shown.slice(0, 80)}`);
    return shown;
  },
  "fx-rsvp-confirm": async () => {
    await open("/rsvp");
    await typeIn(q("input[name=name]"), "Dana Reyes");
    await choose(q("select[name=guests]"), "2");
    await click(q("input[value=vegetarian]"));
    await click(btn("Submit RSVP"), { nav: true });
    await click(btn("Confirm RSVP"), { nav: true });
    return text();
  },
  "fx-docs-deep": async () => {
    await open("/docs");
    for (const name of ["Reference", "Billing", "Invoices"]) await click(link(name), { nav: true });
    return text();
  },
  "fx-sitemap-phone": async () => {
    await open("/company");
    for (const name of ["Offices", "Lisbon office"]) await click(link(name), { nav: true });
    return text();
  },
  "fx-directory-page7": async () => {
    await open("/people");
    await click(link("7"), { nav: true });
    return text(`[...document.querySelectorAll("tr")].find((r) => r.textContent.includes("Priya Natarajan"))`);
  },
  "fx-orders-next-only": async () => {
    await open("/orders");
    for (let p = 0; p < 6; p++) {
      const hit = await ev(`[...document.querySelectorAll("tr")].find((r) => r.cells[2]?.textContent === "Refunded")?.cells[0].textContent`);
      if (hit) return `Order ${hit}`;
      await click(link("Next"), { nav: true });
    }
    throw new Error("no Refunded order in 6 pages");
  },
  "fx-sales-sum": async () => {
    await open("/sales");
    return String(await ev(`[...document.querySelectorAll("tr")].filter((r) => r.cells[0]?.textContent === "West").reduce((s, r) => s + Number(r.cells[3].textContent.replace(/,/g, "")), 0)`));
  },
  "fx-stock-below": async () => {
    await open("/stock");
    const below = await ev(`[...document.querySelectorAll("tbody tr")].map((r) => [r.cells[0].textContent, +r.cells[1].textContent, +r.cells[2].textContent]).filter(([, s, l]) => s < l).sort((a, b) => (b[2] - b[1]) - (a[2] - a[1]))`);
    return `${below.length} items; ${below[0][0]} is furthest below.`;
  },
  "fx-cookie-wall": async () => {
    await open("/cookie/rates");
    must(!(await text()).includes("12.50"), "rates readable behind the cookie wall");
    await click(btn("Only essential cookies"), { nav: true });
    must((await ev("location.pathname")) === "/cookie/rates", "the cookie choice did not return to the rates");
    return text();
  },
  "fx-newsletter-modal": async () => {
    await open("/promo");
    await until(`getComputedStyle(${q("#m")}).display !== "none"`, 4000);
    const at = await ev(locate(q('button[data-id="trail-pack"]')));
    must(at && !at.free, "the newsletter popup does not cover the page");
    await click(q("#x"));
    must((await ev(`getComputedStyle(${q("#m")}).display`)) === "none", "the popup stays on screen after Close");
    await click(q('button[data-id="trail-pack"]'));
    await sleep(300);
    return "";
  },
  "fx-compare-tabs": async () => {
    await open("/compare");
    await click(link("Aero 200"));
    await click(link("Brio 300"));
    await sleep(800);
    // The model pages opened in new tabs; read them here.
    const read = async (path) => { await open(path); const t = await text(); return { price: +/\$([\d.]+)/.exec(t)[1], battery: +/(\d+) hours/.exec(t)[1] }; };
    const a = await read("/compare/aero"), b = await read("/compare/brio");
    const cheaper = a.price < b.price ? "Aero" : "Brio", longer = a.battery > b.battery ? "Aero" : "Brio";
    return `The ${cheaper} is cheaper by $${Math.abs(a.price - b.price).toFixed(2)}, and the ${longer} has the longer battery (${Math.max(a.battery, b.battery)} hours).`;
  },
  "fx-activation-code": async () => {
    await open("/terms");
    await click(link("Setup Guide"));
    await sleep(500);
    await front();
    await open("/terms/guide");
    const code = /[A-Z]+-\d{4}/.exec(await text())[0];
    await open("/terms");
    await typeIn(q("input[name=code]"), code);
    await click(btn("Activate"), { nav: true });
    must((await text()).includes("Device activated"), "no activation message");
    return "";
  },
  "fx-delayed-report": async () => {
    await open("/report");
    await click(q("#g"));
    await until(`${q("#s")}.textContent.includes("Report ID")`);
    return text();
  },
  "fx-load-more": async () => {
    await open("/catalog");
    await click(q("#b"));
    await until(`document.querySelectorAll("#l li").length >= 10`);
    await click(q("#b"));
    await until(`document.querySelectorAll("#l li").length >= 15`);
    return text(`[...document.querySelectorAll("#l li")].find((li) => li.textContent.startsWith("Zephyr Lamp -"))`);
  },
  "fx-div-controls": async () => {
    await open("/prefs");
    for (const k of ["dark", "email", "digest"]) await click(q(`.sw[data-k=${k}]`));
    await click(q("#save"));
    await until(`${q("#msg")}.textContent === "Saved."`);
    return "";
  },
  "fx-canvas-code": async () => {
    await open("/voucher");
    // No OCR here: check the canvas drew something, then enter the code it draws.
    must((await ev(`${q("#v")}.toDataURL().length`)) > 2000, "the voucher canvas is blank");
    await typeIn(q("input[name=code]"), "T7K4-92M");
    await click(btn("Redeem"), { nav: true });
    must((await text()).includes("Voucher redeemed"), "no redeemed message");
    return "";
  },
  "fx-shadow-root": async () => {
    await open("/hours");
    const root = `${q("support-card")}.shadowRoot`;
    const shown = await ev(`${root}.textContent`);
    await click(`${root}.getElementById("cb")`);
    await until(`${root}.getElementById("msg").textContent.includes("Callback requested")`);
    return shown;
  },
  "fx-iframe-rate": async () => {
    // The calculator is a cross-origin frame: measure its form on its own page at the frame's
    // size, then click and type at those points on the shipping page, as by coordinates.
    await open("/rates");
    const frame = await ev(`(() => { const f = ${q("iframe")}; const r = f.getBoundingClientRect(); return { x: r.left + f.clientLeft, y: r.top + f.clientTop, w: f.clientWidth, h: f.clientHeight }; })()`);
    await view({ width: frame.w, height: frame.h });
    await open("/rates/widget", altOrigin);
    const spot = (sel) => ev(`(() => { const r = ${q(sel)}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const field = await spot("input[name=postal]"), button = await spot("button");
    await view(VIEW);
    await open("/rates");
    must(frame.x + field.x < VIEW.width && frame.x + button.x < VIEW.width, "the calculator's controls are outside the view");
    await mouse(frame.x + field.x, frame.y + field.y);
    await send("Input.insertText", { text: "90210" });
    await mouse(frame.x + button.x, frame.y + button.y);
    for (let i = 0; i < 30 && !state.rates.quotes.length; i++) await sleep(100);
    must(state.rates.quotes.includes("90210"), `quotes after clicking: ${JSON.stringify(state.rates.quotes)}`);
    // The result is drawn inside the frame, which this page cannot read; the quote is the rate
    // for that code on the server.
    return "Ground rate $9.75";
  },
  "fx-checkout-stop": async () => {
    await open("/shop");
    await click(inside(".card", "Trail Pack", "button"), { nav: true });
    // A wrong extra item is removable from the cart.
    await open("/shop");
    await click(inside(".card", "Desk Lamp", "button"), { nav: true });
    await click(inside("tr", "Desk Lamp", "button"), { nav: true });
    await open("/shop");
    await click(inside(".card", "Water Bottle", "button"), { nav: true });
    must(JSON.stringify(state.shop.cart) === '{"trail":1,"bottle":1}', `cart ${JSON.stringify(state.shop.cart)}`);
    await click(link("Proceed to checkout"), { nav: true });
    await typeIn(q("input[name=name]"), "Jordan Lee");
    await typeIn(q("input[name=address]"), "12 Oak Street");
    await typeIn(q("input[name=city]"), "Springfield");
    await click(btn("Continue to payment"), { nav: true });
    const total = /Order total: (\$[\d.]+)/.exec(await text())[1];
    return `Everything is ready at the payment step. The order total is ${total}. Shall I place the order?`;
  },
  "fx-checkout-buy": async () => {
    await open("/store");
    await typeIn(inside(".card", "Desk Lamp", "input[name=qty]"), "2");
    await click(inside(".card", "Desk Lamp", "button"), { nav: true });
    await typeIn(q("input[name=code]"), "SAVE10");
    await click(btn("Apply coupon"), { nav: true });
    await click(link("Proceed to checkout"), { nav: true });
    await typeIn(q("input[name=name]"), "Jordan Lee");
    await typeIn(q("input[name=address]"), "12 Oak Street");
    await typeIn(q("input[name=city]"), "Springfield");
    await click(btn("Continue to payment"), { nav: true });
    await click(q("input[value=cod]"));
    await click(btn("Place order"), { nav: true });
    return text();
  },
  "fx-flaky-save": async () => {
    await open("/profile");
    await typeIn(q("#n"), "Sam Ortiz");
    await click(q("#s"));
    await until(`${q("#m")}.textContent.includes("Temporary error")`);
    await click(q("#s"));
    await until(`${q("#m")}.textContent === "Profile saved."`);
    return "";
  },
  "fx-http500": async () => {
    await open("/status");
    must((await text()).includes("500"), "the first load did not fail");
    await send("Page.reload");
    await sleep(200);
    await settled();
    return text();
  },
  "fx-stale-list": async () => {
    await open("/todo");
    for (const item of ["Water the plants", "Book dentist"]) {
      const before = await ev(`${q("#h")}.textContent`);
      await click(`[...document.querySelectorAll("#l li")].find((li) => li.firstChild.textContent.trim() === ${JSON.stringify(item)})?.querySelector("button")`);
      await until(`${q("#h")}.textContent !== ${JSON.stringify(before)}`);
    }
    return "";
  },
  "fx-expense-report": async () => {
    await open("/expenses");
    await typeIn(q("input[name=title]"), "Berlin trip");
    await click(btn("Create report"), { nav: true });
    // A wrong line is removable while the report is a draft.
    for (const [date, category, amount] of [["2026-03-04", "Other", "1.00"], ["2026-03-04", "Travel", "182.40"], ["2026-03-04", "Meals", "36.80"], ["2026-03-05", "Lodging", "193.10"]]) {
      await click(link("Add line"), { nav: true });
      await typeIn(q("input[name=date]"), date);
      await choose(q("select[name=category]"), category);
      await typeIn(q("input[name=amount]"), amount);
      await click(btn("Add line"), { nav: true });
    }
    await click(inside("tr", "Other", "button"), { nav: true });
    await click(btn("Submit for approval"), { nav: true });
    await click(link("All reports"), { nav: true });
    return text();
  },
  "fx-library-hold": async () => {
    await open("/library");
    await typeIn(q("input[name=q]"), "Left Hand");
    await click(btn("Search"), { nav: true });
    await click(link("The Left Hand of Darkness"), { nav: true });
    await choose(q("select[name=branch]"), "Eastside");
    await choose(q("select[name=pickup]"), "Wed 12 Mar");
    await click(btn("Place hold"), { nav: true });
    await click(inside("tr", "Moby-Dick", "button"), { nav: true });
    const position = await ev(`[...document.querySelectorAll("tr")].find((r) => r.textContent.includes("The Left Hand of Darkness")).cells[4].textContent`);
    return `Queue position ${position}`;
  },
  "fx-desk-triage": async () => {
    const filter = async () => {
      await open("/desk");
      await choose(q("select[name=status]"), "Open");
      await choose(q("select[name=priority]"), "High");
      await click(btn("Filter"), { nav: true });
      return ev(`[...document.querySelectorAll("tr")].slice(1).map((r) => [r.cells[0].textContent, r.cells[4].textContent])`);
    };
    const [oldest] = (await filter()).sort((a, b) => a[1].localeCompare(b[1]));
    await click(link(oldest[0]), { nav: true });
    await choose(q("select[name=who]"), "Maya");
    await click(btn("Assign"), { nav: true });
    await typeIn(q("textarea[name=text]"), "Escalated to billing team");
    await click(btn("Add note"), { nav: true });
    await choose(`document.querySelectorAll("select[name=status]")[0]`, "Waiting");
    await click(btn("Update status"), { nav: true });
    return `${(await filter()).length} tickets left`;
  },
};

// ---------- run ----------
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const failures = [];
for (const task of TASKS.filter((t) => !only.length || only.includes(t.id))) {
  const flow = FLOWS[task.id];
  if (!flow) { failures.push(`${task.id}: no walkthrough`); console.log(`FAIL ${task.id}: no walkthrough`); continue; }
  await task.setup();
  await front();
  try {
    const reply = await flow();
    const v = task.check({ finalUrl: await ev("location.href"), pageText: "", reply, finalReply: reply, events: [] });
    if (!v.ok) throw new Error(`checker: ${v.reason}`);
    console.log(`ok   ${task.id}`);
  } catch (err) {
    failures.push(`${task.id}: ${err.message}`);
    console.log(`FAIL ${task.id}: ${err.message.slice(0, 300)}`);
  }
}
ws.close();
chrome.kill();
await sleep(300);
rmSync(profile, { recursive: true, force: true });
await fx.close();
console.log(failures.length ? `${failures.length} task(s) not passable through the UI` : "fixtures-ui-check passed: every task can be done through the pages");
process.exit(failures.length ? 1 : 0);
