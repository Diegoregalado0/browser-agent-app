// Fast self-test for the fixture sites and their tasks (no browser, no model):
//   node scripts/bench/fixtures-check.js
// It crawls every page, then for each task checks that setup() resets state, that the
// checker fails on an untouched site, and that it passes after the task is done through the
// real HTTP routes (so the routes are exercised too). Exits non-zero on any failure.

import { TASKS, fixtures as fx } from "./tasks-fixtures.js";
import { FIXTURES_VERSION } from "./fixtures/server.js";

const { origin, altOrigin, state } = fx;
const failures = [];
const fail = (msg) => { failures.push(msg); console.error(`FAIL ${msg}`); };
const expect = (cond, msg) => { if (!cond) fail(msg); };

const get = (path, base = origin) => fetch(base + path, { redirect: "follow" });
// POSTs a form without following the redirect, as the browser's first request would.
const post = (path, body = {}) => fetch(origin + path, { method: "POST", body: new URLSearchParams(body), redirect: "manual" });
const posts = async (...calls) => { for (const [p, b] of calls) await post(p, b); };

// ---------- crawl ----------
async function crawl() {
  const seen = new Set(), queue = [origin + "/__sitemap"];
  let count = 0;
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const res = await fetch(url);
    const html = await res.text();
    count++;
    // /status answers 500 on the first load on purpose.
    if (!(res.status < 300) && !(url.endsWith("/status") && res.status === 500)) fail(`GET ${url} -> ${res.status}`);
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const next = new URL(m[1].replaceAll("&amp;", "&"), url).href;
      if ((next.startsWith(origin) || next.startsWith(altOrigin)) && !next.includes("#")) queue.push(next);
    }
  }
  return count;
}

// ---------- each task: done through the routes, as a good agent would ----------
const DONE = {
  "fx-register": async () => { await posts(["/register", { name: "Dana Reyes", email: "dana@example.com", username: "dana", password: "sunshine", confirm: "sunshine", country: "Portugal", terms: "yes" }]); await posts(["/register", { name: "Dana Reyes", email: "dana@example.com", username: "dana_r1", password: "sunshine1", confirm: "sunshine1", country: "Portugal", terms: "yes" }]); return ""; },
  "fx-support-format": async () => { await posts(["/support", { order: "1042", subject: "Refund status", message: "Where is my refund for this order?" }], ["/support", { order: "ORD-1042", subject: "Refund status", message: "Where is my refund for this order?" }]); return ""; },
  "fx-wizard": async () => { await posts(["/wizard/1", { plan: "Team" }], ["/wizard/2", { city: "Springfield", postcode: "62704" }], ["/wizard/3", { newsletter: "yes" }], ["/wizard/finish"]);
    // After finishing, the result page says so (it once redirected back to step 1).
    if (!/All set/.test(await (await get("/wizard/5")).text())) fail("fx-wizard: the finished wizard does not show its result page");
    return ""; },
  "fx-rsvp-confirm": async () => { await posts(["/rsvp/submit", { name: "Dana Reyes", guests: "2", meal: "vegetarian" }], ["/rsvp/confirm"]); return "Confirmed, reference RSVP-2041."; },
  "fx-docs-deep": async () => { await get("/docs/reference/billing/invoices"); return "84 months"; },
  "fx-sitemap-phone": async () => { await get("/company/offices/lisbon"); return "+351 21 555 0142"; },
  "fx-directory-page7": async () => "Priya Natarajan: Legal, extension 4568",
  "fx-orders-next-only": async () => "Order 1033",
  "fx-sales-sum": async () => "The West total is 40,425.",
  "fx-stock-below": async () => "4 items; Bolt M8 is furthest below.",
  "fx-cookie-wall": async () => { await posts(["/cookie/consent", { choice: "essential" }]); return "Express costs $12.50."; },
  "fx-newsletter-modal": async () => { await posts(["/promo/wishlist", { id: "trail-pack" }]); return ""; },
  "fx-compare-tabs": async () => { await get("/compare/aero"); await get("/compare/brio"); return "Aero is cheaper by $30.50; Brio has the longer battery (22 hours)."; },
  "fx-activation-code": async () => { await posts(["/terms/activate", { code: "maple-4471" }]); return ""; },
  "fx-delayed-report": async () => { await posts(["/report/start"]); return "Report ID: RPT-48213"; },
  "fx-load-more": async () => { await get("/catalog/items?offset=5"); await get("/catalog/items?offset=10"); return "$38.00"; },
  "fx-div-controls": async () => { await posts(["/prefs/save", { dark: "true", email: "false", digest: "true" }]); return ""; },
  "fx-canvas-code": async () => { await posts(["/voucher/redeem", { code: "t7k4 92m" }]); return ""; },
  "fx-shadow-root": async () => { await posts(["/hours/callback"]); return "Support closes at 17:45."; },
  "fx-iframe-rate": async () => { await fetch(altOrigin + "/rates/quote", { method: "POST", body: new URLSearchParams({ postal: "90210" }) }); return "$9.75"; },
  "fx-checkout-stop": async () => { await posts(["/shop/cart/add", { id: "trail", qty: "1" }], ["/shop/cart/add", { id: "bottle", qty: "1" }], ["/shop/checkout", { name: "Jordan Lee", address: "12 Oak Street", city: "Springfield" }]); return "Total is $69.98. I stopped before payment; shall I place it?"; },
  "fx-checkout-buy": async () => { await posts(["/store/cart/add", { id: "lamp", qty: "2" }], ["/store/cart/coupon", { code: "SAVE10" }], ["/store/checkout", { name: "Jordan Lee", address: "12 Oak Street", city: "Springfield" }], ["/store/order", { method: "cod" }]); return "Order ORD-5001 placed."; },
  "fx-flaky-save": async () => { await posts(["/profile/save", { name: "Sam Ortiz" }], ["/profile/save", { name: "Sam Ortiz" }]); return ""; },
  "fx-http500": async () => { await get("/status"); await get("/status"); return "Monday to Saturday 9:00 to 18:00"; },
  "fx-stale-list": async () => { await posts(["/todo/archive", { id: "2" }], ["/todo/archive", { id: "1" }]); return ""; },
  "fx-expense-report": async () => {
    await posts(["/expenses/new", { title: "Berlin trip" }], ["/expenses/r/1/add", { date: "2026-03-04", category: "Travel", amount: "182.40" }], ["/expenses/r/1/add", { date: "2026-03-04", category: "Meals", amount: "36.80" }], ["/expenses/r/1/add", { date: "2026-03-05", category: "Lodging", amount: "193.10" }], ["/expenses/r/1/submit"]);
    return "Total $412.30";
  },
  "fx-library-hold": async () => { await posts(["/library/reserve", { id: "1", branch: "Eastside", pickup: "Wed 12 Mar" }], ["/library/holds/cancel", { id: "H-1" }]); return "Queue position 3"; },
  "fx-desk-triage": async () => { await posts(["/desk/t/107/assign", { who: "Maya" }], ["/desk/t/107/note", { text: "Escalated to billing team" }], ["/desk/t/107/status", { status: "Waiting" }]); return "2 tickets left"; },
};

// Wrong answers, given after the task was done on the site (so only the reply is wrong), must
// fail; each is the mistake an agent is likeliest to make on that task.
const WRONG_REPLY = {
  "fx-rsvp-confirm": "Confirmed, reference RSVP-2014.",
  "fx-docs-deep": "Invoices are kept for 36 months.",
  "fx-sitemap-phone": "The Lisbon office fax is +351 21 555 0143.",
  "fx-directory-page7": "Priya: Legal, extension 4148.",
  "fx-orders-next-only": "Order 1052",
  "fx-sales-sum": "The West total is 36,550.",
  "fx-stock-below": "3 items; Hinge is furthest below.",
  "fx-cookie-wall": "Express costs $7.80.",
  "fx-compare-tabs": "The Brio 300 is cheaper by $30.50; the Aero 200 has the longer battery (22 hours vs 18).",
  "fx-delayed-report": "Report ID: RPT-00001",
  "fx-load-more": "The Zephyr Lamp Shade is $12.00.",
  "fx-shadow-root": "Support closes at 17:00.",
  "fx-iframe-rate": "The ground rate is $7.90.",
  "fx-checkout-stop": "Total is $69.98.",
  "fx-checkout-buy": "Order ORD-9999 placed.",
  "fx-http500": "Open 9:00 to 17:00.",
  "fx-expense-report": "Total $375.50",
  "fx-library-hold": "Done: hold H-3 placed, you are number 2 in the queue.",
  "fx-desk-triage": "3 tickets left",
};
// Right answers worded differently from the done-flow's must pass: a checker that rejects them
// fails a correct agent. The last entry of each list is also tested as the only reply.
const RIGHT_REPLY = {
  "fx-rsvp-confirm": ["All set. Your RSVP reference is **RSVP-2041**."],
  "fx-docs-deep": ["Invoices are retained for 84 months (receipts, by contrast, for 36 months).", "Receipts: 36 months. Let me check invoices.\nInvoices are retained for **84 months**."],
  "fx-sitemap-phone": ["Phone: +351 21 555 0142 (fax +351 21 555 0143)."],
  "fx-directory-page7": ["Priya Natarajan works in **Legal**, extension **4568**."],
  "fx-orders-next-only": ["The first refunded order is **1033** (1052 is refunded too, but later)."],
  "fx-sales-sum": ["West Q3 revenue: $40,425.00", "40425"],
  "fx-stock-below": ["Four items are below their reorder level; Bolt M8 is furthest below (15 vs 60)."],
  "fx-cookie-wall": ["Express shipping is **$12.50**."],
  "fx-compare-tabs": ["The Aero 200 is cheaper by $30.5, and the Brio 300 has the longer battery: 22 hours vs 18."],
  "fx-delayed-report": ["The report is ready: RPT-48213."],
  "fx-load-more": ["The Zephyr Lamp costs $38."],
  "fx-shadow-root": ["Support closes at 5:45 pm on weekdays, and I requested a callback."],
  "fx-iframe-rate": ["Ground rate for 90210: $9.75 (zone 4)."],
  "fx-checkout-stop": ["Everything is ready at the payment step. The order total is $69.98. Shall I place the order?", "I added both items and entered the shipping details.\nThe total is $69.98. Do you want me to pay now?"],
  "fx-checkout-buy": ["Your order number is ORD-5001."],
  "fx-http500": ["Harbor Clinic is open Monday to Saturday, 9am to 6pm.", "Mon-Sat 09:00-18:00, closed Sundays."],
  "fx-expense-report": ["The Berlin trip report shows a total of $412.30."],
  "fx-library-hold": ["Hold H-3 is placed for Wed 12 Mar at Eastside; you are third in the queue.", "Queue position: 3rd."],
  "fx-desk-triage": ["Ticket 107 is now Waiting with Maya; two Open High tickets remain (104 and 111)."],
};

async function main() {
  const started = Date.now();
  const pages = await crawl();
  console.log(`crawled ${pages} pages (fixtures v${FIXTURES_VERSION})`);

  expect(TASKS.length >= 24 && TASKS.length <= 30, `task count ${TASKS.length} outside 24-30`);
  const cats = new Set(["forms", "navigation", "pagination", "tables", "popups", "tabs", "dynamic", "inaccessible", "checkout", "recovery", "long"]);
  expect(new Set(TASKS.map((t) => t.id)).size === TASKS.length, "duplicate task ids");
  for (const c of cats) expect(TASKS.some((t) => t.category === c), `no task in category ${c}`);
  const held = TASKS.filter((t) => t.split === "heldout").length;
  expect(held >= TASKS.length / 4 && held <= TASKS.length / 2, `heldout count ${held} of ${TASKS.length}`);

  fx.reset();
  const initial = JSON.stringify(state);
  for (const t of TASKS) {
    const tag = t.id;
    expect(cats.has(t.category) && ["dev", "heldout"].includes(t.split), `${tag}: bad category/split`);
    expect(t.prompt.includes(origin) && t.allowPrivate.includes("127.0.0.1"), `${tag}: prompt lacks the fixture URL or allowPrivate`);
    for (const m of t.prompt.matchAll(/http:\/\/127\.0\.0\.1:\d+(\/[\w/-]*)/g)) {
      const res = await get(m[1]);
      expect(res.status < 300 || (m[1] === "/status" && res.status === 500), `${tag}: prompt URL ${m[1]} -> ${res.status}`);
    }
    fx.reset();
    const input = (reply) => ({ finalUrl: origin, pageText: "", reply, events: [] });

    await t.setup();
    expect(!t.check(input("")).ok, `${tag}: passes on an untouched site`);
    expect(!t.check(input("I could not do it.")).ok, `${tag}: passes with a vague reply`);
    if (WRONG_REPLY[tag]) { await DONE[tag](); expect(!t.check(input(WRONG_REPLY[tag])).ok, `${tag}: passes with a wrong answer`); await t.setup(); }
    for (const right of RIGHT_REPLY[tag] ?? []) {
      await DONE[tag]();
      const lines = right.split("\n");
      const v = t.check({ ...input(right), finalReply: lines.at(-1) });
      expect(v.ok, `${tag}: fails a right answer (${right.slice(0, 50)}): ${v.reason}`);
      await t.setup();
    }

    const before = JSON.stringify(state);
    const reply = await DONE[tag]?.();
    const stateful = JSON.stringify(state) !== before;
    expect(reply !== undefined, `${tag}: no done-flow in the self-test`);
    const verdict = t.check(input(reply ?? ""));
    expect(verdict.ok, `${tag}: fails after the task is done: ${verdict.reason}`);

    await t.setup();
    // A reply-only task has no server state to reset, so the same reply may pass again.
    if (stateful) expect(!t.check(input(reply ?? "")).ok, `${tag}: still passes after setup()`);
    fx.reset();
    expect(JSON.stringify(state) === initial, `${tag}: setup()/reset left state changed`);
    await t.setup();
  }

  // Pages: what an agent sees must match what the task assumes.
  fx.reset();
  // No page lists the other test sites: an agent looking for a home page finds nothing.
  expect((await get("/")).status === 404, "the site root lists the test sites");
  // The newsletter popup is shown and closed with the hidden attribute; .overlay sets display,
  // which beats the browser's own [hidden] rule, so the page must restore it (v1 and v2 had
  // this bug, and no agent could pass fx-newsletter-modal).
  expect((await (await get("/promo")).text()).includes(".overlay[hidden]{display:none}"), "fx-newsletter-modal: the popup cannot be hidden");
  // The cookie wall hides the rates until a choice is made, and the choice keeps you there.
  expect(!(await (await get("/cookie/rates")).text()).includes("12.50"), "fx-cookie-wall: the rates show behind the wall");
  const consent = await post("/cookie/consent", { choice: "essential", back: "/cookie/rates" });
  expect(consent.headers.get("location") === "/cookie/rates", "fx-cookie-wall: the choice does not return to the rates");
  expect((await (await get("/cookie/rates")).text()).includes("12.50"), "fx-cookie-wall: no rates after the choice");
  // The voucher redeems once; a second redemption is refused and says so.
  fx.reset();
  await posts(["/voucher/redeem", { code: "T7K4-92M" }], ["/voucher/redeem", { code: "T7K4-92M" }]);
  expect(state.voucher.redeemed.length === 1 && state.voucher.repeats === 1, `fx-canvas-code: voucher state ${JSON.stringify(state.voucher)}`);
  expect((await (await get("/voucher")).text()).includes("already been redeemed"), "fx-canvas-code: a repeat redemption is not shown as refused");
  // The finished wizard's page shows no step counter.
  fx.reset();
  await posts(["/wizard/1", { plan: "Team" }], ["/wizard/2", { city: "Springfield", postcode: "62704" }], ["/wizard/3", { newsletter: "yes" }], ["/wizard/finish"]);
  expect(!/Step \d of 4/.test(await (await get("/wizard/5")).text()), "fx-wizard: the result page shows a step counter");
  // A wrong cart line or expense line can be removed, as on a real site; a remove without a
  // line removes nothing.
  fx.reset();
  await posts(["/shop/cart/add", { id: "trail", qty: "3" }], ["/shop/cart/remove", { id: "trail" }], ["/shop/cart/add", { id: "trail", qty: "1" }]);
  expect(JSON.stringify(state.shop.cart) === '{"trail":1}', `fx-checkout-stop: cart after remove ${JSON.stringify(state.shop.cart)}`);
  await posts(["/expenses/new", { title: "Berlin trip" }], ["/expenses/r/1/add", { date: "2026-03-04", category: "Travel", amount: "36.80" }], ["/expenses/r/1/add", { date: "2026-03-05", category: "Lodging", amount: "193.10" }], ["/expenses/r/1/remove", {}], ["/expenses/r/1/remove", { line: "0" }]);
  expect(state.expenses.reports[0].lines.length === 1 && state.expenses.reports[0].lines[0].category === "Lodging", `fx-expense-report: lines after remove ${JSON.stringify(state.expenses.reports[0].lines)}`);

  // The state-reading tasks above must also hold up against partial progress.
  fx.reset();
  await posts(["/shop/cart/add", { id: "trail", qty: "1" }], ["/shop/cart/add", { id: "bottle", qty: "1" }], ["/shop/checkout", { name: "Jordan Lee", address: "1 A", city: "B" }], ["/shop/order", { method: "cod" }]);
  expect(!TASKS.find((t) => t.id === "fx-checkout-stop").check({ reply: "Total $69.98, stopped.", events: [] }).ok, "fx-checkout-stop: passes although an order was placed");
  fx.reset();

  const secs = (Date.now() - started) / 1000;
  console.log(`${TASKS.length} tasks checked in ${secs.toFixed(1)}s`);
  expect(secs < 10, `self-test took ${secs.toFixed(1)}s (limit 10s)`);
  await fx.close();
  if (failures.length) { console.error(`${failures.length} failure(s)`); process.exit(1); }
  console.log("fixtures-check passed");
}

main().catch((err) => { console.error(err); process.exit(1); });
