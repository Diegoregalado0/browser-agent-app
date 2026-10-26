#!/usr/bin/env node
// Runs the fixture tasks with H Company's own agent harness (holo-desktop-cli, `holo run`)
// instead of Browsby, and scores them with the same checkers: Holo4 in its home harness.
// Each task: reset the task's site, open Chrome at the task's first address on the agent's
// virtual desktop, run `holo run "<prompt>"` with a time limit, then check the site state and
// holo's final answer. holo drives the whole desktop and can run shell commands, so it runs as
// the unprivileged user that owns that desktop (see desk.sh); this script only starts it.
//   node scripts/bench/holo-run.js --base-url http://127.0.0.1:8098/v1 [--model holo4-35b-a3b]
//     [--tasks fx-a,fx-b] [--max-time-s 900] [--user holoagent]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { TASKS, FIXTURES_VERSION, fixtures as fx } from "./tasks-fixtures.js";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const baseUrl = opt("--base-url", "http://127.0.0.1:8098/v1");
const model = opt("--model", "holo4-35b-a3b");
const maxTime = Number(opt("--max-time-s", "900"));
const user = opt("--user", "holoagent");
const wanted = opt("--tasks", "").split(",").filter(Boolean);
const tasks = TASKS.filter((t) => !wanted.length || wanted.includes(t.id));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = `bench-results/holo-harness-${model}-${stamp}`;
mkdirSync(dir, { recursive: true });

// Runs a command as the agent's user with its desktop environment; resolves with its output.
const asAgent = (cmd, cmdArgs, { timeoutMs } = {}) => new Promise((resolve) => {
  const env = ["DISPLAY=127.0.0.1:99", `XAUTHORITY=/home/${user}/.xauth-holo`, "XDG_SESSION_TYPE=x11"];
  const child = spawn("sudo", ["-n", "-u", user, "-H", "env", ...env, cmd, ...cmdArgs], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const timer = timeoutMs && setTimeout(() => child.kill("SIGTERM"), timeoutMs);
  child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
});

// holo prints its final answer in a box headed "✓ answer"; take the text inside it.
export function answerFrom(out) {
  const lines = out.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const start = lines.findLastIndex((l) => /✓ answer/.test(l));
  if (start < 0) return lines.findLast((l) => /^answer → /.test(l))?.replace(/^answer → /, "").trim() ?? "";
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (/^╰/.test(l)) break;
    body.push(l.replace(/^│\s?/, "").replace(/\s*│\s*$/, ""));
  }
  return body.join("\n").trim();
}

const rows = [];
const save = () => writeFileSync(`${dir}.json`, JSON.stringify({ harness: "holo-desktop-cli", model, baseUrl, maxTime, fixturesVersion: FIXTURES_VERSION, rows }, null, 2));
await asAgent(`/home/${user}/desk.sh`, ["start", "about:blank"]);
for (const task of tasks) {
  await task.setup();
  const first = /http:\/\/127\.0\.0\.1:\d+\/[\w/-]*/.exec(task.prompt)?.[0] ?? "about:blank";
  await asAgent(`/home/${user}/desk.sh`, ["open", first]);
  const started = Date.now();
  // A little past holo's own budget, so a stuck run is still ended.
  const { code, out } = await asAgent("/opt/holo/bin/holo", ["run", task.prompt, "--base-url", baseUrl, "--model", model, "--max-time-s", String(maxTime), "--no-kill-switch"], { timeoutMs: (maxTime + 60) * 1000 });
  const wallMs = Date.now() - started;
  writeFileSync(`${dir}/${task.id}.log`, out);
  const reply = answerFrom(out);
  let verdict;
  try { verdict = task.check({ finalUrl: "", pageText: "", reply, finalReply: reply, events: [] }); } catch (err) { verdict = { ok: false, reason: `checker threw: ${err.message}` }; }
  const timedOut = wallMs >= maxTime * 1000;
  rows.push({ task: task.id, split: task.split, category: task.category, success: verdict.ok, reason: timedOut && !verdict.ok ? `timed out after ${maxTime}s` : verdict.reason, reply, exit: code, wallMs });
  save();
  console.log(`${verdict.ok ? "PASS" : "FAIL"} ${task.id} ${Math.round(wallMs / 1000)}s ${verdict.ok ? "" : verdict.reason.slice(0, 160)}`);
}
const passed = rows.filter((r) => r.success).length;
console.log(`${passed}/${rows.length} passed; results ${dir}.json`);
await asAgent(`/home/${user}/desk.sh`, ["stop"]);
await fx.close();
process.exit(0);
