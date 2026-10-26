#!/usr/bin/env node
// Runs the fixture tasks by hand with another browser agent (for example HoloTab) and scores
// each with the same checker the benchmark uses. It serves the fixture sites on this computer
// and a scoring page: for each task, press Start (resets the task's site and starts a timer),
// give the prompt to the other agent, then paste its final answer and press Score. Results are
// saved to bench-results/manual-<agent>-<time>.json after every score.
//   node scripts/bench/manual-run.js --agent holotab [--tasks fx-a,fx-b] [--port 47199]
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { TASKS, FIXTURES_VERSION, fixtures as fx } from "./tasks-fixtures.js";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const agent = opt("--agent", "other").replace(/[^\w.-]/g, "_");
const wanted = opt("--tasks", "").split(",").filter(Boolean);
const tasks = TASKS.filter((t) => !wanted.length || wanted.includes(t.id));
const started = new Map();
const results = {};
mkdirSync("bench-results", { recursive: true });
const file = `bench-results/manual-${agent}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const save = () => writeFileSync(file, JSON.stringify({ agent, fixturesVersion: FIXTURES_VERSION, origin: fx.origin, results }, null, 2));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const page = () => {
  const done = Object.values(results), passed = done.filter((r) => r.ok).length;
  return `<!doctype html><meta charset="utf-8"><title>Manual run: ${esc(agent)}</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:24px;max-width:980px}.t{border:1px solid #ccc;border-radius:8px;padding:12px 14px;margin:12px 0}
.p{background:#f6f6f6;padding:8px;border-radius:6px;white-space:pre-wrap}textarea{width:100%;height:60px}.ok{color:#0a6b2b}.bad{color:#b00020}button{margin:6px 6px 0 0}</style>
<h1>Manual run: ${esc(agent)}</h1><p>Fixtures v${FIXTURES_VERSION}. Scored ${done.length} of ${tasks.length}, passed ${passed}. Results: <code>${esc(file)}</code></p>
<p>For each task: <b>Start</b> (resets that site and starts the timer), give the prompt to the agent, wait until it finishes, paste its final answer, then <b>Score</b>. Do not help the agent.</p>
${tasks.map((t) => { const r = results[t.id]; return `<div class="t" id="${t.id}"><b>${t.id}</b> (${t.category}, ${t.split})${r ? ` <span class="${r.ok ? "ok" : "bad"}">${r.ok ? "PASS" : "FAIL"} in ${r.seconds}s: ${esc(r.reason.slice(0, 160))}</span>` : ""}
<div class="p">${esc(t.prompt)}</div><button onclick="go('${t.id}','start')">Start</button><button onclick="navigator.clipboard.writeText(${esc(JSON.stringify(t.prompt))})">Copy prompt</button>
<textarea placeholder="The agent's final answer"></textarea><button onclick="go('${t.id}','score')">Score</button></div>`; }).join("")}
<script>async function go(id,what){const box=document.getElementById(id);const reply=box.querySelector("textarea").value;
const r=await fetch("/"+what,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,reply})});
if(what==="start")box.querySelector("button").textContent="Started "+new Date().toLocaleTimeString();else location.reload();}</script>`;
};

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    if (req.method === "GET") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(page()); }
    const { id, reply = "" } = JSON.parse(body || "{}");
    const task = tasks.find((t) => t.id === id);
    if (!task) { res.writeHead(404); return res.end(); }
    if (req.url === "/start") { await task.setup(); started.set(id, Date.now()); }
    if (req.url === "/score") {
      const v = task.check({ finalUrl: "", pageText: "", reply, finalReply: reply, events: [] });
      results[id] = { ok: v.ok, reason: v.reason, reply, seconds: started.has(id) ? Math.round((Date.now() - started.get(id)) / 1000) : null, scoredAt: new Date().toISOString() };
      save();
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
});
server.listen(Number(opt("--port", "47199")), "127.0.0.1", () => {
  console.log(`Scoring page: http://127.0.0.1:${server.address().port}/  (fixture sites at ${fx.origin}; Ctrl+C to stop)`);
});
