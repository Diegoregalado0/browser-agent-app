// Website-fixture tasks, run against deterministic local sites (fixtures/server.js), which
// this module starts on free ports when the runner loads it. Run with
// --taskfile tasks-fixtures.js. Unlike the live-web tasks, the same run twice sees the same
// pages, so agent changes can be compared. Checkers prefer the server's recorded state
// (orders, form submissions, settings) over the reply wording.
// Every task has a category (forms, navigation, pagination, tables, popups, tabs, dynamic,
// inaccessible, checkout, recovery, long), a split ("dev" for tuning, "heldout" for
// confirming a change did not overfit), and a setup() that resets the task's site so a
// rerun starts clean. Both fixture hosts are on this computer, so both are allowPrivate.

import { FIXTURES_VERSION, SALES, startFixtures, person, orderStatus } from "./fixtures/server.js";

const fx = await startFixtures();
// The runner exits on its own when the tasks are done; the fixtures do not hold it open.
fx.server.unref();
fx.altServer.unref();
export { FIXTURES_VERSION };
export const fixtures = fx;

const { origin, state } = fx;
const allowPrivate = [new URL(origin).hostname, new URL(fx.altOrigin).hostname];
const u = (path) => `${origin}${path}`;
const has = (text, word) => text.toLowerCase().includes(word.toLowerCase());
// Reply with thousands separators removed, so "40,425" and "40425" both match.
const plain = (text) => text.replace(/(\d),(?=\d{3}\b)/g, "$1");
const verdict = (ok, pass, fail) => ({ ok, reason: ok ? pass : fail });
const visited = (site, path) => state[site].visits.includes(path);
const STOPPED = /\b(stop(ped)?|paus(ed|e)|hold(ing)? off|before (placing|paying|payment|you)|not (yet )?(placed|paid|ordered|submitted|completed)|haven'?t|have not|did not|didn'?t|confirm|let me know|would you like|ready (for|to)|your (go-ahead|call|approval))\b/i;

// Builds a task: `site` names the fixture site setup() resets.
const task = (site, id, category, split, name, prompt, check, extra = {}) => ({
  id: `fx-${id}`, name: `Fixture: ${name}`, category, split, prompt, check, allowPrivate,
  setup: async () => fx.reset(site),
  ...extra,
});

export const TASKS = [
  // ---------- forms ----------
  task("register", "register", "forms", "dev", "registration with validation errors",
    `Register an account at ${u("/register")}. Full name Dana Reyes, email dana@example.com, username "dana", password "sunshine" (enter it in both password boxes), country Portugal, and accept the terms. If the site rejects anything, fix it by adjusting my username and password minimally (for example by adding characters or digits to what I gave) and resubmit until the account is created.`,
    () => {
      const [u1] = state.register.users;
      const ok = state.register.users.length === 1 && u1.name === "Dana Reyes" && u1.email === "dana@example.com" && u1.country === "Portugal"
        && u1.username.startsWith("dana") && u1.password.startsWith("sunshine");
      return verdict(ok, `registered ${u1?.username} after ${state.register.rejected} rejection(s)`, `users=${JSON.stringify(state.register.users)}`);
    }, { allowPassword: true }),
  task("support", "support-format", "forms", "dev", "form error revealed only after submit",
    `Use the contact form at ${u("/support")} to message support about my order 1042. Subject: "Refund status". Message: "Where is my refund for this order?". Make sure the message is actually sent.`,
    () => {
      const [m] = state.support.messages;
      const ok = state.support.messages.length === 1 && m.order === "ORD-1042" && has(m.subject, "refund status");
      return verdict(ok, "message sent with order ORD-1042", `messages=${JSON.stringify(state.support.messages)} rejected=${state.support.rejected}`);
    }),
  task("wizard", "wizard", "forms", "heldout", "four-step setup wizard",
    `Set up my account with the wizard at ${u("/wizard")}. Choose the Team plan, delivery city Springfield with postcode 62704, turn the newsletter on and text messages off, then finish the setup.`,
    () => {
      const [w] = state.wizard.completed;
      const ok = state.wizard.completed.length === 1 && w.plan === "Team" && w.city === "Springfield" && w.postcode === "62704" && w.newsletter === true && w.sms === false;
      return verdict(ok, "wizard finished with the right choices", `completed=${JSON.stringify(state.wizard.completed)} draft=${JSON.stringify(state.wizard.draft)}`);
    }),
  task("rsvp", "rsvp-confirm", "forms", "dev", "success only on the confirmation page",
    `RSVP to the spring picnic at ${u("/rsvp")} for Dana Reyes with 2 guests and the vegetarian meal. Tell me the RSVP reference you get.`,
    ({ reply }) => {
      const [r] = state.rsvp.confirmed;
      const ok = state.rsvp.confirmed.length === 1 && r.name === "Dana Reyes" && r.guests === 2 && r.meal === "vegetarian" && has(reply, "RSVP-2041");
      return verdict(ok, "RSVP confirmed and reference reported", `confirmed=${JSON.stringify(state.rsvp.confirmed)} pending=${JSON.stringify(state.rsvp.pending)} reply=${reply.slice(0, 100)}`);
    }),

  // ---------- navigation ----------
  task("docs", "docs-deep", "navigation", "dev", "four levels deep in the docs",
    `On the documentation site at ${u("/docs")}, find out how long invoices are retained under Billing, and tell me the number of months.`,
    ({ reply }) => {
      const read = visited("docs", "/docs/reference/billing/invoices");
      const ok = read && /\b84\b/.test(reply) && !/\b36\b/.test(reply);
      return verdict(ok, "opened the Invoices article and said 84", `invoicesOpened=${read} reply=${reply.slice(0, 120)}`);
    }),
  task("company", "sitemap-phone", "navigation", "heldout", "office phone via menus",
    `On the Northwind site at ${u("/company")}, what is the phone number of the Lisbon office?`,
    ({ reply }) => {
      const ok = visited("company", "/company/offices/lisbon") && reply.replace(/\D/g, "").includes("351215550142");
      return verdict(ok, "gave the Lisbon phone number", `reply=${reply.slice(0, 120)}`);
    }),

  // ---------- pagination ----------
  task("people", "directory-page7", "pagination", "dev", "person deep in a paged directory",
    `In the staff directory at ${u("/people")}, find Priya Natarajan and tell me her department and extension.`,
    ({ reply }) => {
      const p = person(64);
      const ok = has(reply, p.dept) && reply.includes(String(p.ext));
      return verdict(ok, "gave department and extension", `want ${p.dept} / ${p.ext}, reply=${reply.slice(0, 120)}`);
    }),
  task("orders", "orders-next-only", "pagination", "heldout", "first refunded order, next-only paging",
    `The order list at ${u("/orders")} is long. Find the first order, going through the list from the top, whose status is Refunded, and give me its order number.`,
    ({ reply }) => {
      const first = [...Array(60).keys()].find((i) => orderStatus(i) === "Refunded") + 1000;
      const ok = reply.includes(String(first)) && !reply.includes("1052");
      return verdict(ok, `said ${first}`, `want ${first}, reply=${reply.slice(0, 120)}`);
    }),

  // ---------- tables ----------
  task("sales", "sales-sum", "tables", "dev", "sum a column for one region",
    `The sales table at ${u("/sales")} lists revenue per rep. What was the total Q3 revenue for the West region? Give me the number.`,
    ({ reply }) => {
      const west = String(SALES.filter(([region]) => region === "West").reduce((sum, row) => sum + row[3], 0));
      const ok = new RegExp(`\\b${west}\\b`).test(plain(reply));
      return verdict(ok, `said ${west}`, `reply=${reply.slice(0, 120)}`);
    }),
  task("stock", "stock-below", "tables", "heldout", "compare columns row by row",
    `On the inventory page at ${u("/stock")}, how many items are in stock below their reorder level (strictly below), and which item is furthest below its level?`,
    ({ reply }) => {
      const ok = /\b(4|four)\b/i.test(reply) && has(reply, "Bolt M8");
      return verdict(ok, "said 4 and Bolt M8", `reply=${reply.slice(0, 120)}`);
    }),

  // ---------- popups ----------
  task("cookie", "cookie-wall", "popups", "dev", "cookie wall blocking the page",
    `Go to ${u("/cookie")} and tell me the price of Express shipping. I don't want any optional cookies, so decline those if the site asks.`,
    ({ reply }) => {
      const ok = state.cookie.consent === "essential" && reply.includes("12.50");
      return verdict(ok, "declined optional cookies and said $12.50", `consent=${state.cookie.consent} reply=${reply.slice(0, 120)}`);
    }),
  task("promo", "newsletter-modal", "popups", "heldout", "delayed modal over the page",
    `On ${u("/promo")}, add the Trail Pack to the wishlist. Don't sign me up for any newsletter or anything else.`,
    () => {
      const ok = state.promo.wishlist.length === 1 && state.promo.wishlist[0] === "trail-pack" && state.promo.subscribed.length === 0;
      return verdict(ok, "only the Trail Pack is wishlisted, no signup", `wishlist=${state.promo.wishlist} subscribed=${state.promo.subscribed}`);
    }),

  // ---------- tabs ----------
  task("compare", "compare-tabs", "tabs", "dev", "compare two product pages",
    `At ${u("/compare")} there are two headphone models. Open both model pages and tell me which one is cheaper, by how much, and which has the longer battery life.`,
    ({ reply }) => {
      const both = visited("compare", "/compare/aero") && visited("compare", "/compare/brio");
      const ok = both && reply.includes("30.50") && has(reply, "Aero") && /\b22\b/.test(reply) && has(reply, "Brio");
      return verdict(ok, "compared both pages correctly", `bothOpened=${both} reply=${reply.slice(0, 140)}`);
    }),
  task("terms", "activation-code", "tabs", "heldout", "carry a code from a new tab",
    `Activate my device at ${u("/terms")}. The activation code is in the Setup Guide that the page links to.`,
    () => verdict(state.terms.activated, "device activated", `activated=${state.terms.activated} wrong=${state.terms.wrongCodes}`)),

  // ---------- dynamic ----------
  task("report", "delayed-report", "dynamic", "dev", "content that appears after a delay",
    `On ${u("/report")}, generate the monthly report and tell me its Report ID.`,
    ({ reply }) => {
      const ok = state.report.started >= 1 && reply.includes("RPT-48213");
      return verdict(ok, "started the report and gave the ID", `started=${state.report.started} reply=${reply.slice(0, 120)}`);
    }),
  task("catalog", "load-more", "dynamic", "dev", "item behind Load more",
    `What is the price of the Zephyr Lamp (not the lamp shade) in the catalog at ${u("/catalog")}?`,
    ({ reply }) => {
      const ok = state.catalog.loads >= 2 && /\b38(\.00)?\b/.test(reply);
      return verdict(ok, "said $38.00 after loading more", `loads=${state.catalog.loads} reply=${reply.slice(0, 120)}`);
    }),

  // ---------- inaccessible ----------
  task("prefs", "div-controls", "inaccessible", "dev", "toggles built from plain divs",
    `On the preferences page at ${u("/prefs")}, turn Dark mode on, turn Email alerts off, turn Weekly digest on, and save the changes.`,
    () => {
      const s = state.prefs.saved;
      const ok = state.prefs.saves >= 1 && s.dark === true && s.email === false && s.digest === true;
      return verdict(ok, "saved the three settings", `saved=${JSON.stringify(s)} saves=${state.prefs.saves}`);
    }),
  task("voucher", "canvas-code", "inaccessible", "heldout", "code drawn on a canvas",
    `My gift voucher at ${u("/voucher")} shows its code in the picture on the page. Redeem the voucher with that code.`,
    () => verdict(state.voucher.redeemed.length === 1, "redeemed the voucher", `redeemed=${state.voucher.redeemed} wrong=${state.voucher.wrong}`)),
  task("hours", "shadow-root", "inaccessible", "dev", "content inside a shadow root",
    `On the help centre page ${u("/hours")}, tell me when support closes on weekdays, and request a callback.`,
    ({ reply }) => {
      const ok = state.hours.callbacks >= 1 && /17:45|5:45\s*pm/i.test(reply);
      return verdict(ok, "callback requested and closing time given", `callbacks=${state.hours.callbacks} reply=${reply.slice(0, 120)}`);
    }),
  task("rates", "iframe-rate", "inaccessible", "dev", "calculator in a cross-origin iframe",
    `The shipping page ${u("/rates")} has a rate calculator. What ground rate does it give for postal code 90210?`,
    ({ reply }) => {
      const ok = state.rates.quotes.includes("90210") && reply.includes("9.75");
      return verdict(ok, "asked for 90210 and said $9.75", `quotes=${state.rates.quotes} reply=${reply.slice(0, 120)}`);
    }),

  // ---------- checkout ----------
  task("shop", "checkout-stop", "checkout", "heldout", "prepare checkout, stop before paying",
    `At ${u("/shop")}, add one Trail Pack and one Water Bottle to the cart and go through checkout up to the payment step, using shipping details Jordan Lee, 12 Oak Street, Springfield. Do not place the order: stop before paying and tell me the order total so I can approve it.`,
    ({ reply }) => {
      const cart = state.shop.cart;
      const ok = state.shop.orders.length === 0 && cart.trail === 1 && cart.bottle === 1 && state.shop.shipping?.name === "Jordan Lee" && reply.includes("69.98") && STOPPED.test(reply);
      return verdict(ok, "cart and shipping ready, no order, total reported", `orders=${state.shop.orders.length} cart=${JSON.stringify(cart)} shipping=${JSON.stringify(state.shop.shipping)} reply=${reply.slice(0, 120)}`);
    }),
  task("store", "checkout-buy", "checkout", "dev", "buy with a coupon",
    `At ${u("/store")}, buy 2 Desk Lamps using the coupon code SAVE10, shipping to Jordan Lee, 12 Oak Street, Springfield, and pay with cash on delivery. Tell me the order number.`,
    ({ reply }) => {
      const [o] = state.store.orders;
      const ok = state.store.orders.length === 1 && o.items.lamp === 2 && Object.keys(o.items).length === 1 && o.coupon === "SAVE10" && o.total === 7700 && o.method === "cod" && reply.includes(o.number);
      return verdict(ok, "one correct order placed", `orders=${JSON.stringify(state.store.orders)} reply=${reply.slice(0, 80)}`);
    }),

  // ---------- recovery ----------
  task("profile", "flaky-save", "recovery", "dev", "action that fails once, then works",
    `On ${u("/profile")}, change the display name to "Sam Ortiz" and save the profile. Make sure it really saved.`,
    () => verdict(state.profile.saved === "Sam Ortiz", `saved after ${state.profile.attempts} attempt(s)`, `saved=${state.profile.saved} attempts=${state.profile.attempts}`)),
  task("status", "http500", "recovery", "dev", "page errors on first load",
    `What are the opening hours of Harbor Clinic? The page is ${u("/status")}.`,
    ({ reply }) => {
      const ok = state.status.hits >= 2 && /\b9(:00)?\b/.test(reply) && /18:00|6(:00)?\s*pm/i.test(reply);
      return verdict(ok, "retried after the 500 and gave the hours", `hits=${state.status.hits} reply=${reply.slice(0, 120)}`);
    }),
  task("todo", "stale-list", "recovery", "heldout", "list that re-renders after each action",
    `In my task list at ${u("/todo")}, archive "Water the plants" and "Book dentist", and nothing else.`,
    () => {
      const a = [...state.todo.archived].sort();
      const ok = a.length === 2 && a[0] === "Book dentist" && a[1] === "Water the plants";
      return verdict(ok, "archived exactly the two tasks", `archived=${JSON.stringify(a)}`);
    }),

  // ---------- long workflows ----------
  task("expenses", "expense-report", "long", "dev", "create, fill and submit an expense report",
    `At ${u("/expenses")}, create an expense report titled "Berlin trip" with three lines: 2026-03-04 Travel 182.40, 2026-03-04 Meals 36.80, 2026-03-05 Lodging 193.10. Submit it for approval, then open the list of all reports and tell me the total shown for it.`,
    ({ reply }) => {
      const [r] = state.expenses.reports;
      const lines = r ? r.lines.map((l) => `${l.date} ${l.category} ${l.cents}`).sort().join("|") : "";
      const want = ["2026-03-04 Meals 3680", "2026-03-04 Travel 18240", "2026-03-05 Lodging 19310"].sort().join("|");
      const ok = state.expenses.reports.length === 1 && r.title === "Berlin trip" && r.status === "Submitted" && lines === want && reply.includes("412.30");
      return verdict(ok, "report submitted with three lines, total reported", `reports=${JSON.stringify(state.expenses.reports)} reply=${reply.slice(0, 80)}`);
    }),
  task("library", "library-hold", "long", "heldout", "search, reserve, cancel another hold",
    `At the library ${u("/library")}, find the novel "The Left Hand of Darkness" and place a hold on it for pickup at the Eastside branch on Wed 12 Mar. Then cancel my existing hold on Moby-Dick (leave my other holds alone). Finally tell me my queue position for the new hold.`,
    ({ reply }) => {
      const h = state.library.holds, add = h.find((x) => x.title === "The Left Hand of Darkness");
      const ok = h.length === 2 && add?.branch === "Eastside" && add.pickup === "Wed 12 Mar" && h.some((x) => x.title === "Emma") && !h.some((x) => x.title === "Moby-Dick") && /\b(3|third|3rd)\b/i.test(reply);
      return verdict(ok, "hold placed, Moby-Dick cancelled, position 3", `holds=${JSON.stringify(h)} reply=${reply.slice(0, 80)}`);
    }),
  task("desk", "desk-triage", "long", "dev", "triage the oldest high-priority ticket",
    `In the help desk at ${u("/desk")}, find the oldest (earliest created date) ticket that is both Open and High priority. Assign it to Maya, add the internal note "Escalated to billing team", and set its status to Waiting. Then tell me how many Open, High priority tickets are left.`,
    ({ reply }) => {
      const t = (id) => state.desk.tickets.find((x) => x.id === id);
      const done = t(107).assignee === "Maya" && t(107).status === "Waiting" && t(107).notes.some((n) => has(n, "Escalated to billing team"));
      const untouched = [104, 111].every((id) => t(id).assignee === null && t(id).status === "Open" && t(id).notes.length === 0);
      const ok = done && untouched && /\b(2|two)\b/i.test(reply);
      return verdict(ok, "ticket 107 triaged, 2 left", `t107=${JSON.stringify(t(107))} untouched=${untouched} reply=${reply.slice(0, 80)}`);
    }),
];
