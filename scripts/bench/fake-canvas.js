// A small stand-in for a Canvas LMS site, for the Canvas benchmark tasks and checks: pages
// that carry Canvas's signals (the ENV object and the _csrf_token cookie) and show the same
// data as a few /api/v1 endpoints, which answer with Canvas's "while(1);" prefix. Dates are
// fixed relative to the day the server starts, so "due in the next 7 days" has one answer.
//   startFakeCanvas({ port, signedIn }) -> { server, origin, data }
// signedIn false: every API call answers 401 and every page redirects to /login/canvas.

import { createServer } from "node:http";

const DAY = 86400000;

// 18:59 UTC plus whole days: late morning in US time zones, so a due date is the same day there.
function day(offset) {
  const d = new Date();
  d.setUTCHours(18, 59, 0, 0);
  return new Date(d.getTime() + offset * DAY).toISOString().replace(/\.\d+Z$/, "Z");
}

export function fakeCanvasData() {
  const courses = [
    { id: 101, name: "BIO 001: Contemporary Biology", course_code: "BIO-001", score: 91.4, grade: "A-" },
    { id: 202, name: "MATH 021: Calculus I", course_code: "MATH-021", score: 84.2, grade: "B" },
    { id: 303, name: "WRI 010: College Reading and Composition", course_code: "WRI-010", score: 88.7, grade: "B+" },
  ];
  const assignments = [
    { id: 5001, course_id: 101, name: "Lab Report 3: Enzyme Kinetics", due_at: day(1), points_possible: 37, submission: { workflow_state: "unsubmitted" } },
    { id: 5002, course_id: 202, name: "Problem Set 6", due_at: day(3), points_possible: 15, submission: { workflow_state: "unsubmitted" } },
    { id: 5003, course_id: 303, name: "Essay 2 Draft", due_at: day(5), points_possible: 50, submission: { workflow_state: "submitted", submitted_at: day(-1) } },
    { id: 5004, course_id: 202, name: "Problem Set 5", due_at: day(-3), points_possible: 15, submission: { workflow_state: "graded", score: 13, grade: "13", submitted_at: day(-4) } },
    { id: 5005, course_id: 101, name: "Lab Report 4: Photosynthesis", due_at: day(12), points_possible: 37, submission: { workflow_state: "unsubmitted" } },
    { id: 5006, course_id: 303, name: "Reading Response 7", due_at: day(10), points_possible: 10, submission: { workflow_state: "unsubmitted" } },
  ];
  const announcements = [
    { id: 7001, course_id: 202, title: "Midterm moved to Thursday", posted_at: day(-1), author: "Prof. Alvarez", message: "<p>The midterm is now on <b>Thursday</b> in room COB 105. Bring a calculator.</p>" },
    { id: 7002, course_id: 202, title: "Welcome to Calculus I", posted_at: day(-20), author: "Prof. Alvarez", message: "<p>Welcome! Office hours are Mondays 2-4pm.</p>" },
    { id: 7003, course_id: 101, title: "Lab safety quiz opens Friday", posted_at: day(-2), author: "Dr. Chen", message: "<p>Complete the safety quiz before your next lab.</p>" },
  ];
  const conversations = [
    { id: 9001, subject: "Group project meeting", workflow_state: "unread", last_message_at: day(-0.2), participants: [{ name: "Jordan Lee" }], context_name: "WRI 010", last_message: "Can we meet Thursday at 3?" },
    { id: 9002, subject: "Re: Problem Set 5 regrade", workflow_state: "unread", last_message_at: day(-1), participants: [{ name: "Prof. Alvarez" }], context_name: "MATH 021", last_message: "I updated your score." },
    { id: 9003, subject: "Lab partner swap", workflow_state: "unread", last_message_at: day(-2), participants: [{ name: "Sam Patel" }], context_name: "BIO 001", last_message: "Would you swap lab sections?" },
    { id: 9004, subject: "Essay feedback", workflow_state: "read", last_message_at: day(-6), participants: [{ name: "Ms. Ortiz" }], context_name: "WRI 010", last_message: "Nice work on the outline." },
  ];
  const modules = {
    101: [
      { id: 1, name: "Week 6: Enzymes", items: [{ title: "Enzymes lecture slides", type: "File" }, { title: "Lab Report 3: Enzyme Kinetics", type: "Assignment", assignment: 5001 }] },
      { id: 2, name: "Week 7: Photosynthesis", items: [{ title: "Lab Report 4: Photosynthesis", type: "Assignment", assignment: 5005 }] },
    ],
    202: [{ id: 3, name: "Unit 3: Derivatives", items: [{ title: "Problem Set 5", type: "Assignment", assignment: 5004 }, { title: "Problem Set 6", type: "Assignment", assignment: 5002 }] }],
    303: [{ id: 4, name: "Essay 2", items: [{ title: "Essay 2 Draft", type: "Assignment", assignment: 5003 }, { title: "Reading Response 7", type: "Assignment", assignment: 5006 }] }],
  };
  return { courses, assignments, announcements, conversations, modules };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const shown = (iso) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

function page(title, body, course) {
  const nav = course
    ? `<nav id="section-tabs"><a href="/courses/${course.id}">Home</a> <a href="/courses/${course.id}/announcements">Announcements</a> <a href="/courses/${course.id}/assignments">Assignments</a> <a href="/courses/${course.id}/modules">Modules</a> <a href="/courses/${course.id}/grades">Grades</a></nav>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<script>ENV = {"ASSET_HOST":"","DOMAIN_ROOT_ACCOUNT_ID":"10000000000001","current_user_id":"7","current_user_roles":["user","student"],"TIMEZONE":"America/Los_Angeles"};</script>
<style>body{font-family:sans-serif;margin:0;display:flex}#header{width:84px;background:#2d3b45;min-height:100vh;padding:8px}#header a{color:#fff;display:block;margin:12px 0;font-size:12px}main{padding:16px 24px;flex:1}nav a{margin-right:12px}li{margin:6px 0}</style></head>
<body class="ic-app"><div id="header"><a href="/">Dashboard</a><a href="/courses">Courses</a><a href="/calendar">Calendar</a><a href="/conversations">Inbox</a></div>
<main id="content"><h1>${esc(title)}</h1>${nav}${body}</main></body></html>`;
}

export function startFakeCanvas({ port = 0, signedIn = true, host = "127.0.0.1" } = {}) {
  const data = fakeCanvasData();
  const course = (id) => data.courses.find((c) => c.id === Number(id));
  const assignmentUrl = (a) => `/courses/${a.course_id}/assignments/${a.id}`;
  const unread = data.conversations.filter((c) => c.workflow_state === "unread").length;
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
    res.end(`while(1);${JSON.stringify(body)}`);
  };

  const api = (path, q, res, origin) => {
    let m;
    if (path === "/api/v1/courses") {
      const withScores = q.getAll("include[]").includes("total_scores");
      return json(res, 200, data.courses.map((c) => ({ id: c.id, name: c.name, course_code: c.course_code, enrollments: [{ type: "student", ...(withScores && { computed_current_score: c.score, computed_current_grade: c.grade }) }] })));
    }
    if ((m = /^\/api\/v1\/courses\/(\d+)$/.exec(path)) && course(m[1])) {
      const c = course(m[1]);
      return json(res, 200, { id: c.id, name: c.name, course_code: c.course_code, enrollments: [{ type: "student", computed_current_score: c.score, computed_current_grade: c.grade }] });
    }
    if ((m = /^\/api\/v1\/courses\/(\d+)\/assignments$/.exec(path)) && course(m[1])) {
      // Pages of per_page, with Canvas's Link header.
      const all = data.assignments.filter((a) => a.course_id === Number(m[1])).sort((a, b) => a.due_at.localeCompare(b.due_at));
      const per = Number(q.get("per_page")) || 10;
      const pageNo = Number(q.get("page")) || 1;
      const slice = all.slice((pageNo - 1) * per, pageNo * per);
      const next = pageNo * per < all.length ? new URL(`${origin}${path}`) : null;
      if (next) {
        for (const [k, v] of q) if (k !== "page") next.searchParams.append(k, v);
        next.searchParams.set("page", String(pageNo + 1));
      }
      return json(
        res,
        200,
        slice.map((a) => ({ id: a.id, name: a.name, due_at: a.due_at, points_possible: a.points_possible, html_url: `${origin}${assignmentUrl(a)}`, submission: a.submission })),
        next ? { Link: `<${next.href}>; rel="next"` } : {},
      );
    }
    if ((m = /^\/api\/v1\/courses\/(\d+)\/discussion_topics$/.exec(path)) && course(m[1])) {
      const list = data.announcements.filter((a) => a.course_id === Number(m[1])).sort((a, b) => b.posted_at.localeCompare(a.posted_at));
      return json(res, 200, list.map((a) => ({ id: a.id, title: a.title, posted_at: a.posted_at, user_name: a.author, message: a.message, html_url: `${origin}/courses/${a.course_id}/discussion_topics/${a.id}` })));
    }
    if ((m = /^\/api\/v1\/courses\/(\d+)\/modules$/.exec(path)) && course(m[1])) {
      return json(res, 200, data.modules[m[1]].map((mod) => ({ id: mod.id, name: mod.name, state: "unlocked", items: mod.items.map((i) => ({ title: i.title, type: i.type, html_url: i.assignment ? `${origin}${assignmentUrl(data.assignments.find((a) => a.id === i.assignment))}` : undefined })) })));
    }
    if (path === "/api/v1/announcements") {
      const codes = q.getAll("context_codes[]");
      const list = data.announcements.filter((a) => codes.includes(`course_${a.course_id}`)).sort((a, b) => b.posted_at.localeCompare(a.posted_at));
      return json(res, 200, list.map((a) => ({ id: a.id, title: a.title, posted_at: a.posted_at, context_code: `course_${a.course_id}`, user_name: a.author, message: a.message, html_url: `${origin}/courses/${a.course_id}/discussion_topics/${a.id}` })));
    }
    if (path === "/api/v1/planner/items") {
      const start = Date.parse(q.get("start_date") || day(0));
      const end = Date.parse(q.get("end_date") || day(7));
      const items = data.assignments.filter((a) => Date.parse(a.due_at) >= start && Date.parse(a.due_at) < end).sort((a, b) => a.due_at.localeCompare(b.due_at));
      return json(
        res,
        200,
        items.map((a) => ({
          context_type: "Course",
          course_id: a.course_id,
          context_name: course(a.course_id).name,
          plannable_type: "assignment",
          plannable_date: a.due_at,
          plannable: { id: a.id, title: a.name, due_at: a.due_at, points_possible: a.points_possible },
          submissions: { submitted: a.submission.workflow_state !== "unsubmitted", graded: a.submission.workflow_state === "graded", missing: false, late: false },
          html_url: assignmentUrl(a),
        })),
      );
    }
    if (path === "/api/v1/users/self/todo") {
      const now = Date.now();
      return json(res, 200, data.assignments.filter((a) => a.submission.workflow_state === "unsubmitted" && Date.parse(a.due_at) > now).map((a) => ({ type: "submitting", context_name: course(a.course_id).name, assignment: { name: a.name, due_at: a.due_at, points_possible: a.points_possible, html_url: `${origin}${assignmentUrl(a)}` }, html_url: `${origin}${assignmentUrl(a)}` })));
    }
    if (path === "/api/v1/conversations/unread_count") return json(res, 200, { unread_count: String(unread) });
    if (path === "/api/v1/conversations") return json(res, 200, data.conversations);
    return json(res, 404, { errors: [{ message: "The specified resource does not exist." }] });
  };

  const html = (path, res) => {
    let m;
    const send = (title, body, c) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page(title, body, c));
    };
    const courseList = data.courses.map((c) => `<li><a href="/courses/${c.id}">${esc(c.name)}</a></li>`).join("");
    if (path === "/") return send("Dashboard", `<h2>Courses</h2><ul>${courseList}</ul>`);
    if (path === "/courses") return send("All Courses", `<ul>${courseList}</ul>`);
    if (path === "/conversations") {
      const rows = data.conversations.map((c) => `<li>${c.workflow_state === "unread" ? "<b>[Unread]</b> " : ""}${esc(c.subject)} - ${esc(c.participants[0].name)}</li>`).join("");
      return send("Inbox", `<p>Conversations</p><ul>${rows}</ul>`);
    }
    if (path === "/calendar") return send("Calendar", "<p>Calendar</p>");
    if (!(m = /^\/courses\/(\d+)(\/.*)?$/.exec(path)) || !course(m[1])) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page("Page Not Found", "<p>Oops, we couldn't find that page.</p>"));
    }
    const c = course(m[1]);
    const rest = m[2] || "";
    const own = data.assignments.filter((a) => a.course_id === c.id).sort((a, b) => a.due_at.localeCompare(b.due_at));
    if (!rest) return send(c.name, `<p>Welcome to ${esc(c.name)}.</p>`, c);
    if (rest === "/assignments") return send(`${c.course_code} Assignments`, `<ul>${own.map((a) => `<li><a href="${assignmentUrl(a)}">${esc(a.name)}</a> Due ${esc(shown(a.due_at))}</li>`).join("")}</ul>`, c);
    if ((m = /^\/assignments\/(\d+)$/.exec(rest))) {
      const a = own.find((x) => x.id === Number(m[1]));
      if (a) return send(a.name, `<div class="assignment-details"><p><b>Due</b> ${esc(shown(a.due_at))}</p><p><b>Points</b> ${a.points_possible}</p><p><b>Submitting</b> a file upload</p></div>`, c);
    }
    if (rest === "/grades") {
      const rows = own.map((a) => `<tr><td>${esc(a.name)}</td><td>${a.submission.score ?? "-"} / ${a.points_possible}</td></tr>`).join("");
      return send(`Grades for ${c.name}`, `<table>${rows}</table><p id="student-grades-final">Total: ${c.score}% (${c.grade})</p>`, c);
    }
    if (rest === "/announcements") {
      const list = data.announcements.filter((a) => a.course_id === c.id).sort((a, b) => b.posted_at.localeCompare(a.posted_at));
      return send(`${c.course_code} Announcements`, `<ul>${list.map((a) => `<li><a href="/courses/${c.id}/discussion_topics/${a.id}">${esc(a.title)}</a> posted ${esc(shown(a.posted_at))}<div>${a.message}</div></li>`).join("")}</ul>`, c);
    }
    if (rest === "/modules") return send(`${c.course_code} Modules`, data.modules[c.id].map((mod) => `<h3>${esc(mod.name)}</h3><ul>${mod.items.map((i) => `<li>${esc(i.title)}</li>`).join("")}</ul>`).join(""), c);
    if ((m = /^\/discussion_topics\/(\d+)$/.exec(rest))) {
      const a = data.announcements.find((x) => x.id === Number(m[1]) && x.course_id === c.id);
      if (a) return send(a.title, `<p>${esc(a.author)}, ${esc(shown(a.posted_at))}</p>${a.message}`, c);
    }
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("Page Not Found", "<p>Oops, we couldn't find that page.</p>"));
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const origin = `http://${req.headers.host}`;
    if (req.method !== "GET") {
      res.writeHead(405);
      return res.end();
    }
    const cookies = [`_csrf_token=fake${Date.now().toString(36)}; path=/`, "canvas_session=fake-session; path=/; HttpOnly"];
    if (url.pathname.startsWith("/api/v1/")) {
      if (!signedIn) return json(res, 401, { status: "unauthenticated", errors: [{ message: "user authorization required" }] });
      return api(url.pathname, url.searchParams, res, origin);
    }
    if (!signedIn && url.pathname !== "/login/canvas") {
      res.writeHead(302, { Location: "/login/canvas", "Set-Cookie": cookies[0] });
      return res.end();
    }
    res.setHeader("Set-Cookie", cookies);
    if (url.pathname === "/login/canvas") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page("Log In to Canvas", '<form><label>Email <input name="email"></label><label>Password <input type="password" name="password"></label><button>Log In</button></form>'));
    }
    html(url.pathname, res);
  });
  return new Promise((resolve) =>
    server.listen(port, host, () => {
      const origin = `http://${host}:${server.address().port}`;
      resolve({ server, origin, data });
    }),
  );
}
