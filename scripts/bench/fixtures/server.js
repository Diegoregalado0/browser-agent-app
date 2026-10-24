// Deterministic local websites for the fixture benchmark (tasks-fixtures.js). One Node
// stdlib HTTP server hosts many small "sites", one per path prefix (/register, /shop, ...).
// Pages never use randomness, external resources or the clock in their content, so a run
// differs only by what the agent does. Every meaningful effect (a submitted form, an
// order, a changed setting) is recorded in `state`, one entry per site, so checkers verify
// outcomes on the server instead of trusting the agent's reply.
//   startFixtures({ port }) -> { server, altServer, origin, altOrigin, state, reset, close }
// altOrigin is a second listener on the hostname "localhost" (origin uses 127.0.0.1), which
// makes a page on origin embedding altOrigin a genuine cross-origin iframe.
// reset(site) restores one site to its initial state; reset() restores all of them.

import { createServer } from "node:http";

// Bump when a page, rule or data value changes, so results from different versions are
// never compared as if the fixtures were the same.
export const FIXTURES_VERSION = "1";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const toCents = (s) => Math.round(parseFloat(s) * 100);

const STYLE = `body{font:16px/1.5 system-ui,sans-serif;margin:24px;max-width:780px}nav a,.crumbs a{margin-right:12px}
.err{color:#b00020;border:1px solid #b00020;padding:8px 12px;margin:12px 0;background:#fff4f4}.ok{color:#0a6b2b}
label{display:block;margin:10px 0}table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #888;padding:4px 10px;text-align:left}
button,.btn{padding:6px 14px;margin:4px 0}.card{border:1px solid #bbb;padding:12px;margin:12px 0}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10;display:flex;align-items:center;justify-content:center}
.overlay .box{background:#fff;padding:24px;max-width:420px}`;

const shell = (title, body, head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style>${head}</head><body>${body}</body></html>`;

// ---------- Data ----------

const FIRST = ["Aiden", "Bella", "Carlos", "Dmitri", "Priya", "Elena", "Farid", "Grace", "Hugo", "Ines", "Jamal", "Keiko"];
const LAST = ["Abbott", "Baptiste", "Chen", "Dubois", "Eriksen", "Natarajan", "Okafor", "Petrov", "Quinn", "Rossi"];
const DEPTS = ["Engineering", "Finance", "Support", "Sales", "Legal"];
// Person i is FIRST[i % 12] LAST[floor(i / 12)]; Priya Natarajan is index 64, on page 7.
export const person = (i) => ({ name: `${FIRST[i % 12]} ${LAST[Math.floor(i / 12)]}`, dept: DEPTS[i % 5], ext: 4000 + ((i * 37) % 900) });
export const PEOPLE_COUNT = 120;

// Orders 1000..1059; the first Refunded one is 1033 (page 4), a later decoy is 1052.
export const orderStatus = (i) => (i === 33 || i === 52 ? "Refunded" : i % 3 === 0 ? "Delivered" : "Shipped");

export const SALES = [
  ["East", "Ines", 21000, 23500], ["West", "Avery", 11800, 12400], ["North", "Hugo", 9900, 10250],
  ["West", "Blake", 9100, 8950], ["South", "Grace", 14300, 15100], ["West", "Casey", 14000, 15200],
  ["East", "Farid", 17600, 16800], ["North", "Keiko", 8200, 9400], ["West", "Dana", 3600, 3875],
  ["South", "Jamal", 12200, 11900],
];

export const STOCK = [
  ["Widget A", 40, 25], ["Widget B", 8, 20], ["Bolt M6", 120, 100], ["Bolt M8", 15, 60], ["Nut M6", 300, 150], ["Washer", 55, 50],
  ["Gasket", 3, 10], ["Clamp", 22, 22], ["Hinge", 9, 30], ["Spring", 70, 40], ["Rivet", 500, 400], ["Cable tie", 90, 80],
];

const DOCS = {
  "": { t: "Documentation", x: "Choose a section." },
  guides: { t: "Guides", x: "Task-oriented guides." },
  reference: { t: "Reference", x: "Exact details about the platform." },
  support: { t: "Support", x: "Getting help." },
  "guides/quickstart": { t: "Quickstart", x: "Create an account, then invite a teammate. Sessions last 30 minutes." },
  "guides/security": { t: "Security", x: "Passwords must be rotated every 90 days." },
  "reference/billing": { t: "Billing", x: "Billing topics." },
  "reference/api": { t: "API", x: "API topics." },
  "reference/billing/invoices": { t: "Invoices", x: "Invoices are retained for 84 months after issue." },
  "reference/billing/receipts": { t: "Receipts", x: "Receipts are retained for 36 months after payment." },
  "reference/api/limits": { t: "Rate limits", x: "The API allows 600 requests per minute." },
  "support/contact": { t: "Contact", x: "Email help at the usual address. Replies within 2 days." },
};

const COMPANY = {
  "": { t: "Northwind", x: "A company with offices in several cities." },
  offices: { t: "Offices", x: "Where to find us." },
  careers: { t: "Careers", x: "Join the team." },
  "offices/lisbon": { t: "Lisbon office", x: "Rua Augusta 12. Phone +351 21 555 0142. Fax +351 21 555 0143." },
  "offices/oslo": { t: "Oslo office", x: "Karl Johans gate 4. Phone +47 22 55 01 99." },
  "offices/austin": { t: "Austin office", x: "Congress Ave 100. Phone +1 512 555 0188." },
  "careers/engineering": { t: "Engineering jobs", x: "Two openings. Apply at the usual address." },
  "careers/design": { t: "Design jobs", x: "One opening." },
};

const CATALOG = ["Alder Shelf", "Birch Stool", "Cedar Tray", "Dune Rug", "Elm Clock", "Fern Pot", "Glass Vase", "Hazel Mirror",
  "Iron Hook", "Juniper Box", "Kiln Mug", "Linen Throw", "Zephyr Lamp", "Zephyr Lamp Shade", "Willow Basket"];
const CATALOG_PRICES = [1800, 2250, 1500, 6400, 3100, 900, 2700, 4500, 700, 2000, 1100, 3600, 3800, 1200, 2900];

const PRODUCTS = { trail: ["Trail Pack", 4999], bottle: ["Water Bottle", 1499], lamp: ["Desk Lamp", 4000] };

const TODOS = [[1, "Water the plants"], [2, "Book dentist"], [3, "Call mum"], [4, "Pay rent"], [5, "Renew passport"], [6, "Buy stamps"]];

const BOOKS = [
  { id: 1, title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", genre: "Sci-Fi", year: 1969, queue: 2 },
  { id: 2, title: "The Dispossessed", author: "Ursula K. Le Guin", genre: "Sci-Fi", year: 1974, queue: 0 },
  { id: 3, title: "Dune", author: "Frank Herbert", genre: "Sci-Fi", year: 1965, queue: 4 },
  { id: 4, title: "Emma", author: "Jane Austen", genre: "Classic", year: 1815, queue: 1 },
  { id: 5, title: "Moby-Dick", author: "Herman Melville", genre: "Classic", year: 1851, queue: 0 },
  { id: 6, title: "Left Behind", author: "T. LaHaye", genre: "Thriller", year: 1995, queue: 3 },
  { id: 7, title: "The Hobbit", author: "J. R. R. Tolkien", genre: "Fantasy", year: 1937, queue: 3 },
];
const BRANCHES = ["Central", "Eastside", "Harbor"];
const PICKUPS = ["Mon 10 Mar", "Wed 12 Mar", "Sat 15 Mar"];

const TICKETS = [
  [101, "Login loop on mobile", "Medium", "Open", "2026-01-12"], [102, "Invoice PDF blank", "High", "Waiting", "2026-01-05"],
  [103, "Export timing out", "Low", "Open", "2026-02-11"], [104, "Double charge on renewal", "High", "Open", "2026-02-03"],
  [105, "Dark mode typo", "Low", "Closed", "2026-01-30"], [106, "SSO metadata error", "Medium", "Waiting", "2026-02-14"],
  [107, "Cannot change billing email", "High", "Open", "2026-01-20"], [108, "Webhook retries failing", "Medium", "Open", "2026-02-18"],
  [109, "Slow dashboard", "Medium", "Open", "2026-01-10"], [110, "API key rotation question", "Low", "Open", "2026-02-22"],
  [111, "Data deletion request", "High", "Open", "2026-02-20"], [112, "Refund not received", "High", "Closed", "2026-01-15"],
].map(([id, subject, priority, status, created]) => ({ id, subject, priority, status, created, assignee: null, notes: [] }));

const RATES = { 90210: "Zone 4, ground, $9.75", 10001: "Zone 2, ground, $6.20", 60601: "Zone 3, ground, $7.90" };

// Initial state of every site. Each site's state also gets `visits`: the pages (path plus
// query) the browser loaded, which checkers use to confirm the agent really went somewhere.
const SITES = {
  register: () => ({ users: [], rejected: 0 }),
  support: () => ({ messages: [], rejected: 0 }),
  wizard: () => ({ draft: {}, completed: [] }),
  rsvp: () => ({ pending: null, confirmed: [] }),
  docs: () => ({}),
  company: () => ({}),
  people: () => ({}),
  orders: () => ({}),
  sales: () => ({}),
  stock: () => ({}),
  cookie: () => ({ consent: null }),
  promo: () => ({ wishlist: [], subscribed: [] }),
  compare: () => ({}),
  terms: () => ({ activated: false, wrongCodes: 0 }),
  report: () => ({ started: 0 }),
  catalog: () => ({ loads: 0 }),
  prefs: () => ({ saved: { dark: false, email: true, digest: false }, saves: 0 }),
  voucher: () => ({ redeemed: [], wrong: 0 }),
  hours: () => ({ callbacks: 0 }),
  rates: () => ({ quotes: [] }),
  shop: () => ({ cart: {}, coupon: null, shipping: null, orders: [] }),
  store: () => ({ cart: {}, coupon: null, shipping: null, orders: [] }),
  profile: () => ({ attempts: 0, saved: null }),
  status: () => ({ hits: 0 }),
  todo: () => ({ archived: [] }),
  expenses: () => ({ reports: [] }),
  library: () => ({ holds: [{ id: "H-1", title: "Moby-Dick", branch: "Central", pickup: "Mon 10 Mar", position: 1 }, { id: "H-2", title: "Emma", branch: "Harbor", pickup: "Sat 15 Mar", position: 2 }], issued: 2 }),
  desk: () => ({ tickets: structuredClone(TICKETS) }),
};
const freshSite = (name) => ({ visits: [], ...SITES[name]() });

// ---------- Server ----------

export async function startFixtures({ port = 0 } = {}) {
  const state = {};
  const reset = (site) => { for (const n of site ? [site] : Object.keys(SITES)) state[n] = freshSite(n); };
  reset();
  const origins = { main: "", alt: "" };
  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, pattern, fn });

  const handle = (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url, "http://fixture.local");
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const c = {
        url, path, q: url.searchParams, form: new URLSearchParams(Buffer.concat(chunks).toString()),
        send: (status, html) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(html); },
        json: (status, obj) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); },
        redirect: (to) => { res.writeHead(303, { Location: to }); res.end(); },
      };
      if (path === "/favicon.ico") { res.writeHead(204); return res.end(); }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = typeof r.pattern === "string" ? (r.pattern === path ? [] : null) : r.pattern.exec(path);
        if (!m) continue;
        const site = path.split("/")[1];
        if (req.method === "GET" && state[site]) state[site].visits.push(path + url.search);
        return r.fn(c, m);
      }
      c.send(404, shell("Not found", "<h1>Not found</h1>"));
    });
  };

  // A sitemap of the fixture sites, for the self-test crawl; prompts link straight to sites.
  route("GET", "/", (c) => c.send(200, shell("Fixtures", `<h1>Fixtures v${FIXTURES_VERSION}</h1><ul>${[
    "register", "support", "wizard", "rsvp", "docs", "company", "people", "orders", "sales", "stock", "cookie", "promo", "compare", "terms", "report",
    "catalog", "prefs", "voucher", "hours", "rates", "shop", "store", "profile", "status", "todo", "expenses", "library", "desk",
  ].map((s) => `<li><a href="/${s}">${s}</a></li>`).join("")}</ul>`)));

  // ----- forms: registration with server-side validation -----
  const registerPage = (v = {}, errs = []) => shell("Create account", `<h1>Create your account</h1>
${errs.length ? `<div class="err" role="alert"><strong>Please fix the following:</strong><ul>${errs.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
<form method="post" action="/register">
<label>Full name <input name="name" value="${esc(v.name)}"></label>
<label>Email <input name="email" value="${esc(v.email)}"></label>
<label>Username <input name="username" value="${esc(v.username)}"></label>
<label>Password <input name="password" type="password"></label>
<label>Confirm password <input name="confirm" type="password"></label>
<label>Country <select name="country"><option value="">Choose...</option>${["Portugal", "Norway", "Canada"].map((o) => `<option${v.country === o ? " selected" : ""}>${o}</option>`).join("")}</select></label>
<label><input type="checkbox" name="terms" value="yes"${v.terms ? " checked" : ""}> I accept the terms</label>
<button type="submit">Create account</button></form>`);
  route("GET", "/register", (c) => c.send(200, registerPage()));
  route("POST", "/register", (c) => {
    const f = Object.fromEntries(c.form);
    const errs = [];
    if (!f.name?.trim()) errs.push("Full name is required.");
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(f.email ?? "")) errs.push("Enter a valid email address.");
    if (!/^[a-z0-9_]{6,20}$/.test(f.username ?? "")) errs.push("Username must be 6 to 20 characters: lowercase letters, digits or underscores.");
    if (!/^(?=.*\d).{8,}$/.test(f.password ?? "")) errs.push("Password must be at least 8 characters and include a digit.");
    else if (f.password !== f.confirm) errs.push("Passwords do not match.");
    if (!f.country) errs.push("Choose a country.");
    if (f.terms !== "yes") errs.push("You must accept the terms.");
    if (errs.length) { state.register.rejected++; return c.send(200, registerPage(f, errs)); }
    state.register.users.push({ name: f.name.trim(), email: f.email, username: f.username, password: f.password, country: f.country });
    c.redirect("/register/welcome");
  });
  route("GET", "/register/welcome", (c) => {
    const u = state.register.users.at(-1);
    c.send(200, shell("Welcome", u ? `<h1>Welcome, ${esc(u.name)}</h1><p class="ok">Your account ${esc(u.username)} is ready.</p>` : "<h1>No account yet</h1>"));
  });

  // ----- forms: support message whose order-number format is only revealed by the error -----
  const supportPage = (v = {}, err = "") => shell("Contact support", `<h1>Contact support</h1>
${err ? `<div class="err" role="alert">${esc(err)}</div>` : ""}
<form method="post" action="/support">
<label>Order number <input name="order" value="${esc(v.order)}"></label>
<label>Subject <input name="subject" value="${esc(v.subject)}"></label>
<label>Message <textarea name="message" rows="4">${esc(v.message)}</textarea></label>
<button type="submit">Send message</button></form>`);
  route("GET", "/support", (c) => c.send(200, supportPage()));
  route("POST", "/support", (c) => {
    const f = Object.fromEntries(c.form);
    const err = !/^ORD-\d{4}$/.test(f.order ?? "") ? "Order number must look like ORD-1234."
      : !f.subject?.trim() ? "Subject is required." : (f.message ?? "").trim().length < 10 ? "Message must be at least 10 characters." : "";
    if (err) { state.support.rejected++; return c.send(200, supportPage(f, err)); }
    state.support.messages.push({ order: f.order, subject: f.subject.trim(), message: f.message.trim() });
    c.redirect("/support/sent");
  });
  route("GET", "/support/sent", (c) => c.send(200, shell("Sent", state.support.messages.length ? "<h1>Message sent</h1><p class=\"ok\">Ticket T-7001 was created.</p>" : "<h1>Nothing sent</h1>")));

  // ----- forms: four-step wizard; each step needs the one before it -----
  const wiz = () => state.wizard;
  const wizNav = (n) => `<p>Step ${n} of 4</p>`;
  route("GET", /^\/wizard(?:\/(\d))?$/, (c, m) => {
    const n = Number(m[1] ?? 1), d = wiz().draft;
    if ((n >= 2 && !d.plan) || (n >= 3 && !d.city) || (n >= 4 && d.newsletter === undefined)) return c.redirect("/wizard/1");
    const bodies = {
      1: `<h1>Choose a plan</h1><form method="post" action="/wizard/1">${["Basic", "Pro", "Team"].map((p) => `<label><input type="radio" name="plan" value="${p}"> ${p}</label>`).join("")}<button>Next</button></form>`,
      2: `<h1>Delivery address</h1>${d.error ? `<div class="err" role="alert">${esc(d.error)}</div>` : ""}<form method="post" action="/wizard/2"><label>City <input name="city"></label><label>Postcode <input name="postcode"></label><button>Next</button></form>`,
      3: `<h1>Preferences</h1><form method="post" action="/wizard/3"><label><input type="checkbox" name="newsletter" value="yes"> Email me the newsletter</label><label><input type="checkbox" name="sms" value="yes"> Send me text messages</label><button>Next</button></form>`,
      4: `<h1>Review</h1><ul><li>Plan: ${esc(d.plan)}</li><li>City: ${esc(d.city)}</li><li>Postcode: ${esc(d.postcode)}</li><li>Newsletter: ${d.newsletter ? "yes" : "no"}</li><li>Text messages: ${d.sms ? "yes" : "no"}</li></ul><form method="post" action="/wizard/finish"><button>Finish setup</button></form>`,
      5: wiz().completed.length ? `<h1>All set</h1><p class="ok">Your account was set up.</p>` : "<h1>Not finished</h1>",
    };
    c.send(200, shell("Account setup", wizNav(Math.min(n, 4)) + (bodies[n] ?? bodies[1])));
  });
  route("POST", "/wizard/1", (c) => { const p = c.form.get("plan"); if (!p) return c.redirect("/wizard/1"); wiz().draft = { plan: p }; c.redirect("/wizard/2"); });
  route("POST", "/wizard/2", (c) => {
    const city = c.form.get("city")?.trim(), pc = c.form.get("postcode")?.trim();
    if (!city || !/^\d{5}$/.test(pc ?? "")) { wiz().draft.error = "Enter a city and a 5-digit postcode."; return c.redirect("/wizard/2"); }
    Object.assign(wiz().draft, { city, postcode: pc, error: "" }); c.redirect("/wizard/3");
  });
  route("POST", "/wizard/3", (c) => { Object.assign(wiz().draft, { newsletter: c.form.get("newsletter") === "yes", sms: c.form.get("sms") === "yes" }); c.redirect("/wizard/4"); });
  route("POST", "/wizard/finish", (c) => {
    const { error, ...d } = wiz().draft;
    if (d.plan && d.city && d.newsletter !== undefined) { wiz().completed.push(d); wiz().draft = {}; }
    c.redirect("/wizard/5");
  });

  // ----- forms: an RSVP that only counts after a second "Confirm" click -----
  route("GET", "/rsvp", (c) => c.send(200, shell("RSVP", `<h1>Spring picnic RSVP</h1><form method="post" action="/rsvp/submit">
<label>Name <input name="name"></label><label>Guests <select name="guests">${[1, 2, 3, 4].map((n) => `<option>${n}</option>`).join("")}</select></label>
<label><input type="radio" name="meal" value="standard" checked> Standard meal</label><label><input type="radio" name="meal" value="vegetarian"> Vegetarian meal</label>
<button>Submit RSVP</button></form>`)));
  route("POST", "/rsvp/submit", (c) => {
    const f = Object.fromEntries(c.form);
    if (!f.name?.trim()) return c.send(200, shell("RSVP", `<div class="err" role="alert">Name is required.</div><p><a href="/rsvp">Back</a></p>`));
    state.rsvp.pending = { name: f.name.trim(), guests: Number(f.guests), meal: f.meal };
    c.redirect("/rsvp/review");
  });
  route("GET", "/rsvp/review", (c) => {
    const p = state.rsvp.pending;
    c.send(200, shell("Review RSVP", p ? `<h1>Review your RSVP</h1><p>${esc(p.name)}, ${p.guests} guest(s), ${esc(p.meal)} meal.</p><p>Your RSVP is not final until you press Confirm.</p><form method="post" action="/rsvp/confirm"><button>Confirm RSVP</button></form>` : "<h1>Nothing to review</h1>"));
  });
  route("POST", "/rsvp/confirm", (c) => {
    if (state.rsvp.pending) { state.rsvp.confirmed.push(state.rsvp.pending); state.rsvp.pending = null; }
    c.redirect("/rsvp/done");
  });
  route("GET", "/rsvp/done", (c) => c.send(200, shell("RSVP", state.rsvp.confirmed.length ? `<h1>RSVP confirmed</h1><p class="ok">Your reference is RSVP-2041.</p>` : "<h1>No RSVP on file</h1>")));

  // ----- navigation: two multi-level link trees -----
  const tree = (base, title, nodes) => route("GET", new RegExp(`^${base}(?:/(.+))?$`), (c, m) => {
    const key = m[1] ?? "", n = nodes[key];
    if (!n) return c.send(404, shell("Not found", "<h1>Not found</h1>"));
    const prefix = key ? `${key}/` : "";
    const kids = Object.keys(nodes).filter((k) => k && k.startsWith(prefix) && !k.slice(prefix.length).includes("/"));
    const crumbs = [`<a href="${base}">${title}</a>`];
    key.split("/").filter(Boolean).forEach((_, i, a) => crumbs.push(`<a href="${base}/${a.slice(0, i + 1).join("/")}">${esc(nodes[a.slice(0, i + 1).join("/")].t)}</a>`));
    c.send(200, shell(n.t, `<div class="crumbs">${crumbs.join(" / ")}</div><h1>${esc(n.t)}</h1><p>${esc(n.x)}</p>${kids.length ? `<ul>${kids.map((k) => `<li><a href="${base}/${k}">${esc(nodes[k].t)}</a></li>`).join("")}</ul>` : ""}`));
  });
  tree("/docs", "Docs", DOCS);
  tree("/company", "Northwind", COMPANY);

  // ----- pagination -----
  const pager = (c, total, per, base, numbered, rows, head) => {
    const pages = Math.ceil(total / per), p = Math.min(Math.max(Number(c.q.get("page")) || 1, 1), pages);
    const nums = numbered ? Array.from({ length: pages }, (_, i) => (i + 1 === p ? `<strong>${i + 1}</strong>` : `<a href="${base}?page=${i + 1}">${i + 1}</a>`)).join(" ") : "";
    const prev = p > 1 ? `<a href="${base}?page=${p - 1}" rel="prev">Previous</a>` : "", next = p < pages ? `<a href="${base}?page=${p + 1}" rel="next">Next</a>` : "";
    return `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows(p).map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</table><p>Page ${p} of ${pages}</p><p>${prev} ${nums} ${next}</p>`;
  };
  const slice = (p, per, total, f) => Array.from({ length: Math.min(per, total - (p - 1) * per) }, (_, k) => f((p - 1) * per + k));
  route("GET", "/people", (c) => c.send(200, shell("Directory", `<h1>Staff directory</h1>${pager(c, PEOPLE_COUNT, 10, "/people", true, (p) => slice(p, 10, PEOPLE_COUNT, (i) => Object.values(person(i))), ["Name", "Department", "Extension"])}`)));
  route("GET", "/orders", (c) => c.send(200, shell("Orders", `<h1>Orders</h1>${pager(c, 60, 10, "/orders", false, (p) => slice(p, 10, 60, (i) => [`${1000 + i}`, FIRST[i % 12] + " " + LAST[(i * 7) % 10], orderStatus(i)]), ["Order", "Customer", "Status"])}`)));

  // ----- tables -----
  route("GET", "/sales", (c) => c.send(200, shell("Sales", `<h1>Regional sales</h1><table><tr><th>Region</th><th>Rep</th><th>Q2 revenue</th><th>Q3 revenue</th></tr>${SALES.map(([r, n, q2, q3]) => `<tr><td>${r}</td><td>${n}</td><td>${q2.toLocaleString("en-US")}</td><td>${q3.toLocaleString("en-US")}</td></tr>`).join("")}<tr><td colspan="3"><strong>All regions, Q3</strong></td><td><strong>${SALES.reduce((s, r) => s + r[3], 0).toLocaleString("en-US")}</strong></td></tr></table>`)));
  route("GET", "/stock", (c) => c.send(200, shell("Stock", `<h1>Inventory</h1><p>Click a column heading to sort.</p><table id="t"><thead><tr><th data-c="0">Item</th><th data-c="1">In stock</th><th data-c="2">Reorder level</th></tr></thead><tbody>${STOCK.map(([i, s, r]) => `<tr><td>${i}</td><td>${s}</td><td>${r}</td></tr>`).join("")}</tbody></table>
<script>document.querySelectorAll("th").forEach(function(h){h.style.cursor="pointer";h.onclick=function(){var c=+h.dataset.c,b=document.querySelector("tbody"),rows=[].slice.call(b.rows);rows.sort(function(x,y){var a=x.cells[c].textContent,z=y.cells[c].textContent;return c?a-z:a.localeCompare(z)});rows.forEach(function(r){b.appendChild(r)})}});</script>`)));

  // ----- popups: a cookie wall, then a delayed newsletter modal -----
  const cookieWall = () => state.cookie.consent ? "" : `<div class="overlay"><div class="box" role="dialog"><h2>We value your privacy</h2><p>We use cookies to improve this site.</p><form method="post" action="/cookie/consent"><button name="choice" value="all">Accept all cookies</button> <button name="choice" value="essential">Only essential cookies</button></form></div></div>`;
  route("GET", "/cookie", (c) => c.send(200, shell("Acme Freight", `${cookieWall()}<h1>Acme Freight</h1><nav><a href="/cookie">Home</a><a href="/cookie/rates">Shipping rates</a></nav><p>Reliable freight since 1998.</p>`)));
  route("GET", "/cookie/rates", (c) => c.send(200, shell("Shipping rates", `${cookieWall()}<h1>Shipping rates</h1><nav><a href="/cookie">Home</a><a href="/cookie/rates">Shipping rates</a></nav><table><tr><th>Service</th><th>Price</th></tr><tr><td>Economy</td><td>$4.25</td></tr><tr><td>Standard</td><td>$7.80</td></tr><tr><td>Express</td><td>$12.50</td></tr></table>`)));
  route("POST", "/cookie/consent", (c) => { state.cookie.consent = c.form.get("choice") === "essential" ? "essential" : "all"; c.redirect("/cookie"); });

  route("GET", "/promo", (c) => c.send(200, shell("Outfitters", `<h1>Outfitters</h1>
${[["trail-pack", "Trail Pack"], ["tent", "Two-person Tent"], ["stove", "Camp Stove"]].map(([id, n]) => `<div class="card"><strong>${n}</strong> <button data-id="${id}">Add to wishlist</button></div>`).join("")}
<div id="m" class="overlay" hidden><div class="box" role="dialog" aria-label="Newsletter"><button id="x" aria-label="Close">&times;</button><h2>Join our newsletter</h2><form method="post" action="/promo/subscribe"><label>Email <input name="email"></label><button>Subscribe</button></form></div></div>
<script>setTimeout(function(){document.getElementById("m").hidden=false},1500);document.getElementById("x").onclick=function(){document.getElementById("m").hidden=true};
document.querySelectorAll("[data-id]").forEach(function(b){b.onclick=function(){fetch("/promo/wishlist",{method:"POST",body:new URLSearchParams({id:b.dataset.id})});b.textContent="Added"}});</script>`)));
  route("POST", "/promo/wishlist", (c) => { const id = c.form.get("id"); if (!state.promo.wishlist.includes(id)) state.promo.wishlist.push(id); c.json(200, { ok: true }); });
  route("POST", "/promo/subscribe", (c) => { state.promo.subscribed.push(c.form.get("email") ?? ""); c.redirect("/promo"); });

  // ----- tabs -----
  route("GET", "/compare", (c) => c.send(200, shell("Compare", `<h1>Headphones</h1><p>Open each model's page for details (each opens in a new tab).</p><ul><li><a href="/compare/aero" target="_blank">Aero 200</a></li><li><a href="/compare/brio" target="_blank">Brio 300</a></li></ul>`)));
  route("GET", "/compare/aero", (c) => c.send(200, shell("Aero 200", `<h1>Aero 200</h1><p>Price: $249.00</p><p>Battery: 18 hours</p>`)));
  route("GET", "/compare/brio", (c) => c.send(200, shell("Brio 300", `<h1>Brio 300</h1><p>Price: $279.50</p><p>Battery: 22 hours</p>`)));
  route("GET", "/terms", (c) => c.send(200, shell("Activate", `<h1>Activate your device</h1>${state.terms.activated ? `<p class="ok">Device activated.</p>` : `<p>Enter the activation code from the <a href="/terms/guide" target="_blank">Setup Guide</a> (opens in a new tab).</p><form method="post" action="/terms/activate"><label>Activation code <input name="code"></label><button>Activate</button></form>`}`)));
  route("GET", "/terms/guide", (c) => c.send(200, shell("Setup Guide", `<h1>Setup Guide</h1><p>Step 1: charge the device. Step 2: your activation code is MAPLE-4471. Step 3: enter it on the activation page.</p>`)));
  route("POST", "/terms/activate", (c) => {
    if ((c.form.get("code") ?? "").trim().toUpperCase() === "MAPLE-4471") state.terms.activated = true; else state.terms.wrongCodes++;
    c.redirect("/terms");
  });

  // ----- dynamic content -----
  route("GET", "/report", (c) => c.send(200, shell("Reports", `<h1>Monthly report</h1><button id="g">Generate monthly report</button><p id="s"></p>
<script>document.getElementById("g").onclick=function(){fetch("/report/start",{method:"POST"});document.getElementById("s").textContent="Working on it...";setTimeout(function(){fetch("/report/status").then(function(r){return r.json()}).then(function(d){document.getElementById("s").textContent="Report ready. Report ID: "+d.id})},3000)}</script>`)));
  route("POST", "/report/start", (c) => { state.report.started++; c.json(200, { ok: true }); });
  route("GET", "/report/status", (c) => c.json(200, { id: "RPT-48213" }));

  const catItems = (from) => CATALOG.slice(from, from + 5).map((n, k) => `<li>${n} - ${money(CATALOG_PRICES[from + k])}</li>`).join("");
  route("GET", "/catalog", (c) => c.send(200, shell("Catalog", `<h1>Home goods</h1><ul id="l">${catItems(0)}</ul><button id="b">Load more</button>
<script>var off=5;document.getElementById("b").onclick=function(){fetch("/catalog/items?offset="+off).then(function(r){return r.json()}).then(function(d){document.getElementById("l").insertAdjacentHTML("beforeend",d.html);off+=5;if(off>=${CATALOG.length})document.getElementById("b").remove()})}</script>`)));
  route("GET", "/catalog/items", (c) => { state.catalog.loads++; c.json(200, { html: catItems(Number(c.q.get("offset")) || 0) }); });

  // ----- inaccessible controls -----
  route("GET", "/prefs", (c) => {
    const s = state.prefs.saved;
    c.send(200, shell("Preferences", `<h1>Preferences</h1>${[["dark", "Dark mode"], ["email", "Email alerts"], ["digest", "Weekly digest"]].map(([k, n]) => `<div style="display:flex;gap:12px;margin:10px 0"><div>${n}</div><div class="sw" data-k="${k}" data-on="${s[k]}" style="width:46px;height:22px;border-radius:11px;cursor:pointer;background:${s[k] ? "#2a7" : "#aaa"}"></div></div>`).join("")}
<div id="save" style="display:inline-block;padding:8px 16px;background:#246;color:#fff;cursor:pointer">Save changes</div><div id="msg"></div>
<script>document.querySelectorAll(".sw").forEach(function(e){e.onclick=function(){var on=e.dataset.on!=="true";e.dataset.on=on;e.style.background=on?"#2a7":"#aaa"}});
document.getElementById("save").onclick=function(){var p=new URLSearchParams();document.querySelectorAll(".sw").forEach(function(e){p.set(e.dataset.k,e.dataset.on)});fetch("/prefs/save",{method:"POST",body:p}).then(function(){document.getElementById("msg").textContent="Saved."})}</script>`));
  });
  route("POST", "/prefs/save", (c) => {
    state.prefs.saved = { dark: c.form.get("dark") === "true", email: c.form.get("email") === "true", digest: c.form.get("digest") === "true" };
    state.prefs.saves++; c.json(200, { ok: true });
  });

  route("GET", "/voucher", (c) => c.send(200, shell("Voucher", `<h1>Your gift voucher</h1><canvas id="v" width="420" height="130" style="border:1px solid #888"></canvas>
<form method="post" action="/voucher/redeem"><label>Voucher code <input name="code"></label><button>Redeem</button></form>${state.voucher.redeemed.length ? `<p class="ok">Voucher redeemed.</p>` : ""}
<script>var x=document.getElementById("v").getContext("2d");x.fillStyle="#fff7e0";x.fillRect(0,0,420,130);x.fillStyle="#333";x.font="16px sans-serif";x.fillText("Gift voucher - present this code at checkout",14,30);x.font="bold 44px monospace";x.fillText("T7K4-92M",14,90);</script>`)));
  route("POST", "/voucher/redeem", (c) => {
    const code = (c.form.get("code") ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (code === "T7K492M") state.voucher.redeemed.push(code); else state.voucher.wrong++;
    c.redirect("/voucher");
  });

  route("GET", "/hours", (c) => c.send(200, shell("Support", `<h1>Help centre</h1><support-card></support-card>
<script>customElements.define("support-card",class extends HTMLElement{connectedCallback(){var r=this.attachShadow({mode:"open"});r.innerHTML='<h2>Support desk</h2><p>Support hours: Mon-Fri 08:30-17:45 (closed weekends).</p><button id="cb">Request callback</button><p id="msg"></p>';r.getElementById("cb").onclick=function(){fetch("/hours/callback",{method:"POST"});r.getElementById("msg").textContent="Callback requested."}}});</script>`)));
  route("POST", "/hours/callback", (c) => { state.hours.callbacks++; c.json(200, { ok: true }); });

  route("GET", "/rates", (c) => c.send(200, shell("Shipping", `<h1>Shipping</h1><p>Use the calculator below to get a ground rate.</p><iframe src="${origins.alt}/rates/widget" title="Rate calculator" width="460" height="220"></iframe>`)));
  const widget = (result = "") => shell("Rate calculator", `<form method="post" action="/rates/quote"><label>Postal code <input name="postal"></label><button>Get rate</button></form>${result ? `<p><strong>${esc(result)}</strong></p>` : ""}`);
  route("GET", "/rates/widget", (c) => c.send(200, widget()));
  route("POST", "/rates/quote", (c) => {
    const p = (c.form.get("postal") ?? "").trim();
    state.rates.quotes.push(p);
    c.send(200, widget(RATES[p] ? `Rate for ${p}: ${RATES[p]}` : `No service to ${p}`));
  });

  // ----- checkout: the same shop code serves /shop (stop before paying) and /store (buy) -----
  const totals = (s) => {
    const sub = Object.entries(s.cart).reduce((t, [id, q]) => t + PRODUCTS[id][1] * q, 0);
    const discount = s.coupon === "SAVE10" ? Math.round(sub * 0.1) : 0, shipping = sub ? 500 : 0;
    return { sub, discount, shipping, total: sub - discount + shipping };
  };
  const shopSite = (name) => {
    const b = `/${name}`, S = () => state[name];
    route("GET", b, (c) => c.send(200, shell("Shop", `<h1>Outdoor shop</h1><nav><a href="${b}/cart">Cart</a></nav>${Object.entries(PRODUCTS).map(([id, [n, p]]) => `<div class="card"><strong>${n}</strong> ${money(p)}<form method="post" action="${b}/cart/add"><input type="hidden" name="id" value="${id}"><label>Quantity <input name="qty" value="1" size="2"></label><button>Add to cart</button></form></div>`).join("")}`)));
    route("POST", `${b}/cart/add`, (c) => {
      const id = c.form.get("id"), q = Math.max(1, parseInt(c.form.get("qty")) || 1);
      if (PRODUCTS[id]) S().cart[id] = (S().cart[id] ?? 0) + q;
      c.redirect(`${b}/cart`);
    });
    route("POST", `${b}/cart/coupon`, (c) => { S().coupon = (c.form.get("code") ?? "").trim().toUpperCase() || null; c.redirect(`${b}/cart`); });
    route("GET", `${b}/cart`, (c) => {
      const t = totals(S()), lines = Object.entries(S().cart);
      c.send(200, shell("Cart", `<h1>Your cart</h1>${lines.length ? `<table><tr><th>Item</th><th>Qty</th><th>Price</th></tr>${lines.map(([id, q]) => `<tr><td>${PRODUCTS[id][0]}</td><td>${q}</td><td>${money(PRODUCTS[id][1] * q)}</td></tr>`).join("")}</table>
<form method="post" action="${b}/cart/coupon"><label>Coupon code <input name="code" value="${esc(S().coupon)}"></label><button>Apply coupon</button></form>
<p>Subtotal: ${money(t.sub)}</p>${t.discount ? `<p>Discount (${esc(S().coupon)}): -${money(t.discount)}</p>` : S().coupon ? `<p class="err">Coupon ${esc(S().coupon)} is not valid.</p>` : ""}<p>Shipping: ${money(t.shipping)}</p><p><strong>Total: ${money(t.total)}</strong></p><a class="btn" href="${b}/checkout">Proceed to checkout</a>` : "<p>Your cart is empty.</p>"}`));
    });
    route("GET", `${b}/checkout`, (c) => c.send(200, shell("Checkout", `<h1>Shipping details</h1><form method="post" action="${b}/checkout"><label>Full name <input name="name"></label><label>Street address <input name="address"></label><label>City <input name="city"></label><button>Continue to payment</button></form>`)));
    route("POST", `${b}/checkout`, (c) => {
      const f = Object.fromEntries(c.form);
      if (!f.name?.trim() || !f.address?.trim() || !f.city?.trim()) return c.send(200, shell("Checkout", `<div class="err" role="alert">All shipping fields are required.</div><p><a href="${b}/checkout">Back</a></p>`));
      S().shipping = { name: f.name.trim(), address: f.address.trim(), city: f.city.trim() };
      c.redirect(`${b}/payment`);
    });
    route("GET", `${b}/payment`, (c) => {
      const t = totals(S());
      if (!t.sub || !S().shipping) return c.redirect(`${b}/cart`);
      c.send(200, shell("Payment", `<h1>Payment</h1><p>Order total: <strong>${money(t.total)}</strong></p><form method="post" action="${b}/order">
<label><input type="radio" name="method" value="card"> Pay by card</label><label>Card number <input name="card"></label>
<label><input type="radio" name="method" value="cod"> Cash on delivery</label><button>Place order</button></form>`));
    });
    route("POST", `${b}/order`, (c) => {
      const m = c.form.get("method"), t = totals(S());
      if (!t.sub || !S().shipping) return c.redirect(`${b}/cart`);
      if (!m || (m === "card" && !c.form.get("card")?.trim())) return c.send(200, shell("Payment", `<div class="err" role="alert">Choose a payment method and complete its details.</div><p><a href="${b}/payment">Back</a></p>`));
      S().orders.push({ number: `ORD-${5001 + S().orders.length}`, items: { ...S().cart }, coupon: S().coupon, total: t.total, method: m, shipping: S().shipping });
      S().cart = {}; S().coupon = null;
      c.redirect(`${b}/confirmation`);
    });
    route("GET", `${b}/confirmation`, (c) => { const o = S().orders.at(-1); c.send(200, shell("Confirmation", o ? `<h1>Order placed</h1><p class="ok">Order ${o.number} total ${money(o.total)}.</p>` : "<h1>No order placed</h1>")); });
  };
  shopSite("shop");
  shopSite("store");

  // ----- recovery -----
  route("GET", "/profile", (c) => c.send(200, shell("Profile", `<h1>Profile</h1><label>Display name <input id="n" value="Guest"></label><button id="s">Save profile</button><p id="m" role="status"></p>
<script>document.getElementById("s").onclick=function(){fetch("/profile/save",{method:"POST",body:new URLSearchParams({name:document.getElementById("n").value})}).then(function(r){return r.json().then(function(d){var m=document.getElementById("m");m.textContent=d.message;m.className=r.ok?"ok":"err"})})}</script>`)));
  route("POST", "/profile/save", (c) => {
    state.profile.attempts++;
    if (state.profile.attempts === 1) return c.json(503, { message: "Temporary error, please try again." });
    state.profile.saved = c.form.get("name"); c.json(200, { message: "Profile saved." });
  });
  route("GET", "/status", (c) => {
    state.status.hits++;
    if (state.status.hits === 1) return c.send(500, shell("Error", "<h1>500 Internal Server Error</h1><p>Something went wrong on our side.</p>"));
    c.send(200, shell("Harbor Clinic", `<h1>Harbor Clinic</h1><p>Opening hours: Monday to Saturday, 9:00 to 18:00. Closed on Sundays.</p>`));
  });
  route("GET", "/todo", (c) => c.send(200, shell("Tasks", `<h1>My tasks</h1><ul id="l"></ul><h2 id="h"></h2>
<script>var items=${JSON.stringify(TODOS.map(([id, t]) => ({ id, t })))},gone=[];function draw(){document.getElementById("l").innerHTML=items.map(function(i){return '<li>'+i.t+' <button data-id="'+i.id+'">Archive</button></li>'}).join("");document.getElementById("h").textContent="Archived: "+gone.length;
document.querySelectorAll("[data-id]").forEach(function(b){b.onclick=function(){fetch("/todo/archive",{method:"POST",body:new URLSearchParams({id:b.dataset.id})}).then(function(){var id=+b.dataset.id;gone.push(id);items=items.filter(function(i){return i.id!==id}).sort(function(a,z){return a.t.localeCompare(z.t)});draw()})}})}draw();</script>`)));
  route("POST", "/todo/archive", (c) => { const t = TODOS.find(([id]) => id === Number(c.form.get("id"))); if (t && !state.todo.archived.includes(t[1])) state.todo.archived.push(t[1]); c.json(200, { ok: true }); });

  // ----- long workflow 1: expense report -----
  const rep = (m) => state.expenses.reports[Number(m[1]) - 1];
  const repTotal = (r) => r.lines.reduce((s, l) => s + l.cents, 0);
  route("GET", "/expenses", (c) => c.send(200, shell("Expenses", `<h1>Expenses</h1><nav><a href="/expenses/reports">All reports</a></nav><form method="post" action="/expenses/new"><label>Report title <input name="title"></label><button>Create report</button></form>`)));
  route("POST", "/expenses/new", (c) => {
    const title = c.form.get("title")?.trim();
    if (!title) return c.send(200, shell("Expenses", `<div class="err" role="alert">A title is required.</div><p><a href="/expenses">Back</a></p>`));
    state.expenses.reports.push({ title, status: "Draft", lines: [] });
    c.redirect(`/expenses/r/${state.expenses.reports.length}`);
  });
  route("GET", /^\/expenses\/r\/(\d+)$/, (c, m) => {
    const r = rep(m); if (!r) return c.send(404, shell("Not found", "<h1>Not found</h1>"));
    c.send(200, shell(r.title, `<h1>${esc(r.title)}</h1><p>Status: ${r.status}</p><table><tr><th>Date</th><th>Category</th><th>Amount</th></tr>${r.lines.map((l) => `<tr><td>${l.date}</td><td>${l.category}</td><td>${money(l.cents)}</td></tr>`).join("")}</table><p>Total: ${money(repTotal(r))}</p>
${r.status === "Draft" ? `<p><a href="/expenses/r/${m[1]}/add">Add line</a></p><form method="post" action="/expenses/r/${m[1]}/submit"><button>Submit for approval</button></form>` : `<p class="ok">Submitted for approval.</p>`}<p><a href="/expenses/reports">All reports</a></p>`));
  });
  const lineForm = (id, err = "") => shell("Add line", `<h1>Add expense line</h1>${err ? `<div class="err" role="alert">${esc(err)}</div>` : ""}<form method="post" action="/expenses/r/${id}/add"><label>Date (YYYY-MM-DD) <input name="date"></label><label>Category <select name="category">${["Travel", "Meals", "Lodging", "Other"].map((o) => `<option>${o}</option>`).join("")}</select></label><label>Amount <input name="amount"></label><button>Add line</button></form>`);
  route("GET", /^\/expenses\/r\/(\d+)\/add$/, (c, m) => c.send(rep(m) ? 200 : 404, rep(m) ? lineForm(m[1]) : shell("Not found", "<h1>Not found</h1>")));
  route("POST", /^\/expenses\/r\/(\d+)\/add$/, (c, m) => {
    const r = rep(m), f = Object.fromEntries(c.form);
    if (!r || r.status !== "Draft") return c.redirect("/expenses");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date ?? "")) return c.send(200, lineForm(m[1], "Date must be in YYYY-MM-DD format."));
    if (!/^\d+(\.\d{1,2})?$/.test(f.amount ?? "") || toCents(f.amount) <= 0) return c.send(200, lineForm(m[1], "Amount must be a positive number."));
    r.lines.push({ date: f.date, category: f.category, cents: toCents(f.amount) });
    c.redirect(`/expenses/r/${m[1]}`);
  });
  route("POST", /^\/expenses\/r\/(\d+)\/submit$/, (c, m) => {
    const r = rep(m);
    if (r && r.lines.length) r.status = "Submitted";
    c.redirect(`/expenses/r/${m[1]}`);
  });
  route("GET", "/expenses/reports", (c) => c.send(200, shell("Reports", `<h1>All reports</h1><table><tr><th>Title</th><th>Status</th><th>Total</th></tr>${state.expenses.reports.map((r) => `<tr><td>${esc(r.title)}</td><td>${r.status}</td><td>${money(repTotal(r))}</td></tr>`).join("")}</table>`)));

  // ----- long workflow 2: library hold -----
  route("GET", "/library", (c) => c.send(200, shell("Library", `<h1>City Library</h1><nav><a href="/library/holds">My holds</a></nav><form method="get" action="/library/search"><label>Title or keyword <input name="q"></label><label>Genre <select name="genre"><option value="">Any</option>${["Sci-Fi", "Classic", "Thriller", "Fantasy"].map((g) => `<option>${g}</option>`).join("")}</select></label><button>Search</button></form>`)));
  route("GET", "/library/search", (c) => {
    const q = (c.q.get("q") ?? "").toLowerCase(), g = c.q.get("genre") ?? "";
    const hits = BOOKS.filter((b) => b.title.toLowerCase().includes(q) && (!g || b.genre === g));
    c.send(200, shell("Results", `<h1>Search results</h1>${hits.length ? `<ul>${hits.map((b) => `<li><a href="/library/book/${b.id}">${esc(b.title)}</a> (${b.year}, ${b.genre})</li>`).join("")}</ul>` : "<p>No matches.</p>"}<p><a href="/library">New search</a></p>`));
  });
  route("GET", /^\/library\/book\/(\d+)$/, (c, m) => {
    const b = BOOKS.find((x) => x.id === Number(m[1])); if (!b) return c.send(404, shell("Not found", "<h1>Not found</h1>"));
    c.send(200, shell(b.title, `<h1>${esc(b.title)}</h1><p>${esc(b.author)}, ${b.year}. ${b.genre}.</p><form method="post" action="/library/reserve"><input type="hidden" name="id" value="${b.id}">
<label>Pickup branch <select name="branch">${BRANCHES.map((o) => `<option>${o}</option>`).join("")}</select></label><label>Pickup date <select name="pickup">${PICKUPS.map((o) => `<option>${o}</option>`).join("")}</select></label><button>Place hold</button></form>`));
  });
  route("POST", "/library/reserve", (c) => {
    const b = BOOKS.find((x) => x.id === Number(c.form.get("id"))), br = c.form.get("branch"), pk = c.form.get("pickup");
    if (!b || !BRANCHES.includes(br) || !PICKUPS.includes(pk)) return c.redirect("/library");
    const L = state.library; L.issued++;
    L.holds.push({ id: `H-${L.issued}`, title: b.title, branch: br, pickup: pk, position: b.queue + 1 });
    c.redirect("/library/holds");
  });
  route("GET", "/library/holds", (c) => c.send(200, shell("My holds", `<h1>My holds</h1>${state.library.holds.length ? `<table><tr><th>Hold</th><th>Title</th><th>Branch</th><th>Pickup</th><th>Queue position</th><th></th></tr>${state.library.holds.map((h) => `<tr><td>${h.id}</td><td>${esc(h.title)}</td><td>${h.branch}</td><td>${h.pickup}</td><td>${h.position}</td><td><form method="post" action="/library/holds/cancel"><input type="hidden" name="id" value="${h.id}"><button>Cancel hold</button></form></td></tr>`).join("")}</table>` : "<p>No holds.</p>"}`)));
  route("POST", "/library/holds/cancel", (c) => { state.library.holds = state.library.holds.filter((h) => h.id !== c.form.get("id")); c.redirect("/library/holds"); });

  // ----- long workflow 3: help desk -----
  const T = () => state.desk.tickets;
  route("GET", "/desk", (c) => {
    const st = c.q.get("status") ?? "", pr = c.q.get("priority") ?? "";
    const rows = T().filter((t) => (!st || t.status === st) && (!pr || t.priority === pr));
    c.send(200, shell("Help desk", `<h1>Help desk</h1><form method="get" action="/desk"><label>Status <select name="status"><option value="">All</option>${["Open", "Waiting", "Closed"].map((o) => `<option${o === st ? " selected" : ""}>${o}</option>`).join("")}</select></label><label>Priority <select name="priority"><option value="">All</option>${["High", "Medium", "Low"].map((o) => `<option${o === pr ? " selected" : ""}>${o}</option>`).join("")}</select></label><button>Filter</button></form>
<p>${rows.length} ticket(s)</p><table><tr><th>ID</th><th>Subject</th><th>Priority</th><th>Status</th><th>Created</th><th>Assignee</th></tr>${rows.map((t) => `<tr><td><a href="/desk/t/${t.id}">${t.id}</a></td><td>${esc(t.subject)}</td><td>${t.priority}</td><td>${t.status}</td><td>${t.created}</td><td>${t.assignee ?? "-"}</td></tr>`).join("")}</table>`));
  });
  route("GET", /^\/desk\/t\/(\d+)$/, (c, m) => {
    const t = T().find((x) => x.id === Number(m[1])); if (!t) return c.send(404, shell("Not found", "<h1>Not found</h1>"));
    const opts = (list, cur) => list.map((o) => `<option${o === cur ? " selected" : ""}>${o}</option>`).join("");
    c.send(200, shell(`Ticket ${t.id}`, `<p><a href="/desk">Back to list</a></p><h1>Ticket ${t.id}: ${esc(t.subject)}</h1><p>Priority ${t.priority}. Status ${t.status}. Created ${t.created}. Assignee ${t.assignee ?? "none"}.</p>
<form method="post" action="/desk/t/${t.id}/assign"><label>Assign to <select name="who">${opts(["Maya", "Omar", "Priya"], t.assignee)}</select></label><button>Assign</button></form>
<form method="post" action="/desk/t/${t.id}/note"><label>Internal note <textarea name="text"></textarea></label><button>Add note</button></form>
<form method="post" action="/desk/t/${t.id}/status"><label>Status <select name="status">${opts(["Open", "Waiting", "Closed"], t.status)}</select></label><button>Update status</button></form>
<h2>Notes</h2><ul>${t.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`));
  });
  for (const [verb, apply] of [["assign", (t, f) => { t.assignee = f.get("who"); }], ["note", (t, f) => { if (f.get("text")?.trim()) t.notes.push(f.get("text").trim()); }], ["status", (t, f) => { t.status = f.get("status"); }]]) {
    route("POST", new RegExp(`^/desk/t/(\\d+)/${verb}$`), (c, m) => { const t = T().find((x) => x.id === Number(m[1])); if (t) apply(t, c.form); c.redirect(`/desk/t/${m[1]}`); });
  }

  // ----- listeners -----
  const listen = (host, p) => new Promise((resolve, reject) => {
    const server = createServer(handle);
    server.once("error", reject);
    server.listen(p, "127.0.0.1", () => resolve({ server, port: server.address().port, host }));
  });
  const main = await listen("127.0.0.1", port);
  const alt = await listen("localhost", 0);
  origins.main = `http://127.0.0.1:${main.port}`;
  origins.alt = `http://localhost:${alt.port}`;
  return {
    server: main.server, altServer: alt.server, origin: origins.main, altOrigin: origins.alt, state, reset,
    close: () => Promise.all([main.server, alt.server].map((s) => new Promise((r) => { s.close(r); s.closeAllConnections?.(); }))),
  };
}
