#!/usr/bin/env node
// Runs the Browsby benchmark: one command drives the real built extension in a throwaway
// Chrome profile over DevTools, same as `browser-agent` does, and runs each task by
// talking to the panel's in-page controller (globalThis.agentHost) the way the UI does.
// Writes bench-results/<run-id>.json and .md, and every agent event per task to
// bench-results/<run-id>/<task>.events.jsonl.
//
// Usage:
//   node scripts/bench/run.js --provider openai --model qwen3.6-35b-a3b \
//     --base-url http://localhost:8081/v1 --runs 1
//   node scripts/bench/run.js --provider ollama --model gemma4:26b --host http://localhost:11436
//   BENCH_KEY=$(grep ^MISTRAL_API_KEY= ~/browser-agent/.env | cut -d= -f2) \
//     node scripts/bench/run.js --provider mistral --model ministral-14b-latest
//
// Flags: --provider --model --runs N --tasks a,b --host --base-url --timeout(ms)
//        --port (DevTools port; 0 = any free one) --thinking on|off
// Stress flags (scripts/bench/tasks-limits.js and the soak): --max-steps N (default 60),
//        --no-usage-limits (no per-task or daily token cap, no request pacing), --debug
//        (debug events: per-request tokens and timing, context compactions),
//        --max-hours H (start no new task after H hours), --sample-ms N (resource samples
//        every N ms while a task runs, see stress-sampler.js), --recover-browser (start a
//        fresh browser when the test browser dies mid-run instead of failing every task left).
// The mistral provider's key comes from the BENCH_KEY environment variable, never a flag
// (command-line args are visible to every user via `ps`), and is never logged.
// --thinking defaults to off for ollama and openai (local/self-hosted servers, where
// thinking costs real minutes per step on shared hardware) and on for mistral (its default
// behavior, unaffected by local GPU load). Pass --thinking on to compare explicitly.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "../../src/config-core.js";
import { taskMetrics } from "./stress-metrics.js";
import { ResourceSampler } from "./stress-sampler.js";

const PROJECT_DIR = join(fileURLToPath(import.meta.url), "..", "..", "..");
const RESULTS_DIR = join(PROJECT_DIR, "bench-results");

function parseArgs(argv) {
  const args = { runs: 1, timeout: 240000, port: 0, "stall-ms": 120000, gate: "http://127.0.0.1:8090" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, inlineVal] = a.slice(2).split("=");
    const flag = ["no-usage-limits", "debug", "recover-browser"].includes(k);
    const val = flag ? (inlineVal ?? "1") : (inlineVal ?? argv[++i]);
    args[k] = val;
  }
  return args;
}

process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
process.on("exit", (code) => console.error(`process exiting with code ${code}`));

const args = parseArgs(process.argv.slice(2));
// --taskfile picks an alternate task module (e.g. tasks-stress.js), same TASKS shape.
const taskFilePath = args.taskfile
  ? args.taskfile.startsWith("/")
    ? args.taskfile
    : join(PROJECT_DIR, "scripts", "bench", args.taskfile)
  : join(PROJECT_DIR, "scripts", "bench", "tasks.js");
const { TASKS } = await import(`file://${taskFilePath}`);
if (!args.provider || !args.model) {
  console.error("Usage: node scripts/bench/run.js --provider <openai|ollama|mistral> --model <id> [--host|--base-url] [--runs N] [--tasks a,b] [--timeout ms] [--stall-ms ms] [--gate url] [--thinking on|off]");
  process.exit(1);
}

const defaultThinking = (provider) => (provider === "ollama" || provider === "openai" ? "off" : "on");
const thinkingArg = args.thinking || defaultThinking(args.provider);
if (!["on", "off"].includes(thinkingArg)) throw new Error('--thinking must be "on" or "off".');
const thinking = thinkingArg === "on";

const taskIds = args.tasks ? args.tasks.split(",").map((s) => s.trim()) : TASKS.map((t) => t.id);
const selectedTasks = TASKS.filter((t) => taskIds.includes(t.id));
if (!selectedTasks.length) {
  console.error(`No matching tasks for --tasks ${args.tasks}. Known ids: ${TASKS.map((t) => t.id).join(", ")}`);
  process.exit(1);
}

// --resume <file>: continue a run a crash interrupted. Its json names the rows already
// done (run+task pairs), which are skipped; its runId is reused so the same two files get
// overwritten in place rather than starting a new pair.
let resumedRows = [];
let runId = `${args.provider}-${args.model.replace(/[^\w.-]/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
if (args.resume) {
  const { readFileSync } = await import("node:fs");
  const prior = JSON.parse(readFileSync(args.resume, "utf8"));
  resumedRows = prior.rows;
  runId = args.resume.replace(/\.json$/, "").split("/").pop();
  console.log(`Resuming ${args.resume}: ${resumedRows.length} row(s) already done.`);
}
const done = new Set(resumedRows.map((r) => `${r.run}:${r.task}`));

// Build the config the panel will read for this run. Reuses the app's own merge/validation
// instead of hand-rolling a config shape.
function buildConfig() {
  const overrides = { provider: args.provider, models: {}, keys: {}, guardModels: {}, permissionMode: "guarded", maxSteps: Number(args["max-steps"]) || 60, thinking };
  if (args["no-usage-limits"]) overrides.limits = { requestsPerMinute: 0, actionsPerMinute: 0, taskTokens: 0, dailyTokens: 0 };
  if (args.debug) overrides.debugMode = true;
  overrides.models[args.provider] = args.model;
  if (args.provider === "ollama") {
    overrides.ollamaHost = args.host || "http://localhost:11436";
    // No key needed; guard uses the same model (DEFAULT_GUARD_MODELS.ollama is already "").
  } else if (args.provider === "openai") {
    overrides.openaiBaseUrl = args.baseUrl || args["base-url"] || "http://localhost:8081/v1";
    overrides.keys.openai = args.key || "local";
    // Note: src/providers/openai.js only forwards config.thinking on the Responses API path
    // (official OpenAI); its Chat Completions path, used for a custom base URL like a
    // llama.cpp router, sends no reasoning/thinking control at all. Thinking there is
    // whatever the server itself defaults to - this flag has no effect on that request.
    // The default guard model (gpt-6-luna) does not exist on a local server; use the
    // model under test for safety checks too, same as the local providers already do.
    overrides.guardModels.openai = args.model;
  } else if (args.provider === "mistral") {
    if (!process.env.BENCH_KEY) throw new Error("Mistral needs its API key in the BENCH_KEY environment variable.");
    overrides.keys.mistral = process.env.BENCH_KEY;
  } else {
    throw new Error(`Unsupported provider "${args.provider}". Use openai, ollama, or mistral.`);
  }
  return mergeConfig(overrides);
}

// A cheap, fast reachability check before each task - not a real model call, just whether
// the local server/tunnel answers at all. Mistral is a cloud API, not a local tunnel that
// can drop out from under the Mac sleeping, so it is not checked here.
async function endpointReachable() {
  if (args.provider === "mistral") return { ok: true };
  const url = args.provider === "ollama" ? `${args.host || "http://localhost:11436"}/api/tags` : `${(args.baseUrl || args["base-url"] || "http://localhost:8081/v1").replace(/\/$/, "")}/models`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok ? { ok: true } : { ok: false, reason: `${url} answered with HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: `${url} is unreachable (${err.message})` };
  }
}

// Pricing is only meaningful for billed cloud calls; local servers run on hardware already
// paid for, so their cost column reads "-". $0.20/1M tokens (in and out) for Ministral 14B,
// from docs.mistral.ai/inference/pricing as of 2026-10 - reported as an estimate below
// since it was looked up, not read from a live billing API.
const CLOUD_PRICING_PER_MTOK = {
  "ministral-14b-latest": { in: 0.2, out: 0.2 },
};

function costFor(provider, model, input, output) {
  if (provider !== "mistral") return null;
  const price = CLOUD_PRICING_PER_MTOK[model];
  if (!price) return null;
  return { amount: (input / 1e6) * price.in + (output / 1e6) * price.out, estimate: true };
}

async function freshProfile() {
  return mkdtempSync(join(tmpdir(), "browser-agent-bench-"));
}

async function main() {
  // A long run with many CDP round trips has hit Node exiting early with "Detected
  // unsettled top-level await" (exit code 13) partway through, with no rejection or
  // exception logged - the event loop briefly saw nothing registered as pending between
  // two awaits and decided the program was done, even though main()'s own promise was
  // not settled yet. A trivial always-pending timer keeps the loop from ever looking
  // empty; cleared in the finally block below once the run actually finishes.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    return await runBenchmark();
  } finally {
    clearInterval(keepAlive);
  }
}

async function runBenchmark() {
  const home = await freshProfile();
  process.env.BROWSER_AGENT_HOME = home;
  console.log(`Profile: ${home}`);

  const { connectChrome, browserProcesses, buildOutdated } = await import("../../src/chrome.js");
  // The agent under test is the built extension, not src/: a build older than the sources
  // (a checkout moved to another commit) would benchmark the code it was built from.
  if (buildOutdated()) {
    console.log("Building the extension...");
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync(process.execPath, [join(PROJECT_DIR, "scripts", "build-extension.js")], { stdio: "inherit" });
    if (res.status !== 0) throw new Error("Extension build failed.");
  }

  let { cdp, sessionId } = await startBrowser(connectChrome, browserProcesses);

  const config = buildConfig();
  await setConfig(cdp, sessionId, config);
  const runStarted = Date.now();
  const maxMs = Number(args["max-hours"]) > 0 ? Number(args["max-hours"]) * 3600000 : Infinity;
  let browserRestarts = 0;

  const rows = [...resumedRows];
  for (let run = 1; run <= Number(args.runs); run++) {
    for (const task of selectedTasks) {
      if (done.has(`${run}:${task.id}`)) {
        console.log(`\n[run ${run}] ${task.id}: already done (resumed), skipping`);
        continue;
      }
      // A dead tunnel (the Mac sleeping, a dropped SSH forward) used to grind through
      // every remaining task recording a fake 0-step, full-timeout "fail" against a model
      // that was never actually reached. Check first and abort the whole run instead -
      // what is already in rows/on disk stands, and nothing misleading gets added to it.
      const reachable = await endpointReachable();
      if (!reachable.ok) {
        console.error(`\nAborting: ${reachable.reason}. Results so far are unaffected; rerun with --resume once it answers again.`);
        process.exit(1);
      }
      if (Date.now() - runStarted >= maxMs) {
        console.log(`\nStopping: --max-hours ${args["max-hours"]} reached.`);
        break;
      }
      await waitServerIdle();
      console.log(`\n[run ${run}] ${task.id}: ${task.name}`);
      let result;
      const sampler = Number(args["sample-ms"]) > 0 ? new ResourceSampler(Number(args["sample-ms"])) : null;
      try {
        openEventLog(task, run);
        sampler?.start(eventLogPath.replace(/\.events\.jsonl$/, ".resources.jsonl"));
        result = await runTask(cdp, sessionId, task, Number(args.timeout));
      } catch (err) {
        // A dropped connection (tunnel or test browser blip) fails this task instead of
        // the whole run, so the remaining tasks and the report still happen; rerun the
        // task flagged this way once the underlying disruption is resolved.
        console.error(`  -> harness error: ${err.message}`);
        result = { ok: false, reason: `harness error: ${err.message}`, steps: 0, tokensIn: 0, tokensOut: 0, wallMs: 0 };
        if (args["recover-browser"]) {
          console.error("  -> starting a fresh browser for the remaining tasks");
          try {
            cdp.close();
          } catch {}
          const { chrome } = browserProcesses();
          if (chrome) {
            process.kill(chrome, "SIGTERM");
            const gone = Date.now() + 10000;
            while (browserProcesses().chrome && Date.now() < gone) await sleep(200);
          }
          ({ cdp, sessionId } = await startBrowser(connectChrome, browserProcesses));
          await setConfig(cdp, sessionId, config);
          browserRestarts++;
          result.browserRestarted = true;
        }
      }
      const resources = sampler ? await sampler.stop() : null;
      const cost = costFor(args.provider, args.model, result.tokensIn, result.tokensOut);
      rows.push({
        run,
        task: task.id,
        name: task.name,
        success: result.ok,
        reason: result.reason,
        steps: result.steps,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        wallMs: result.wallMs,
        costUsd: cost,
        ...(task.dim ? { dim: task.dim, rung: task.rung } : {}),
        startedAt: result.startedAt,
        metrics: result.metrics,
        ...(resources ? { resources } : {}),
        ...(result.browserRestarted ? { browserRestarted: true, browserRestarts } : {}),
      });
      console.log(`  -> ${result.ok ? "PASS" : "FAIL"} (${result.reason}) steps=${result.steps} tokens=${result.tokensIn + result.tokensOut} time=${(result.wallMs / 1000).toFixed(1)}s`);
      // Written after every task, not just at the end, so a crash mid-run only costs the
      // task in flight: --resume picks up from here, same two files, overwritten in place.
      writeReport({ runId, provider: args.provider, model: args.model, thinking: thinkingArg, rows });
    }
  }

  cdp.close();
  const { chrome } = browserProcesses();
  if (chrome) {
    process.kill(chrome, "SIGTERM");
    const end = Date.now() + 10000;
    while (browserProcesses().chrome && Date.now() < end) await sleep(200);
  }
  await removeProfile(home);
}

// Pids of every process (Chrome main, helpers, crashpad) still holding the profile dir.
function profileHolders(home) {
  try {
    return execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
      .split("\n")
      .filter((row) => row.includes(home))
      .map((row) => Number(row.trim().split(/\s+/)[0]))
      .filter((pid) => pid && pid !== process.pid);
  } catch {
    return [];
  }
}

// Results are already on disk when this runs, so nothing here may fail the run. Chrome
// helpers keep writing into the profile for a moment after the main process exits: wait for
// them to go, then retry the removal, and only warn if the directory still will not go.
async function removeProfile(home) {
  const gone = Date.now() + 15000;
  while (profileHolders(home).length && Date.now() < gone) await sleep(200);
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    console.log(`\nCleaned up temp profile ${home}.`);
  } catch (err) {
    console.warn(`\nWarning: could not remove temp profile ${home}: ${err.message}`);
  }
}

// Opens the test browser and returns a CDP client plus a session on the side panel whose
// controller answers. Real Chrome on a virtual display sometimes dies or leaves a
// panel that never answers right after launch (opening the panel twice closes it, and Chrome
// has crashed outright), so each attempt is bounded and a failed one starts a fresh browser.
async function startBrowser(connectChrome, browserProcesses) {
  const bounded = (promise, ms) => Promise.race([promise, sleep(ms).then(() => null)]);
  const alive = () => browserProcesses().chrome != null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    let cdp = null;
    try {
      cdp = await connectChrome({ devtoolsPort: Number(args.port) || 0 });
      // A transient socket error (the tunnel or the test browser blipping) must not crash the
      // whole run; the current task's checks below will see a dead connection and fail it.
      cdp.on("error", (err) => console.error(`CDP socket error: ${err.message}`));
      let nudged = Date.now() - 9000;
      const end = Date.now() + 60000;
      while (Date.now() < end && alive()) {
        const targets = await bounded(cdp.send("Target.getTargets"), 5000);
        const panel = targets?.targetInfos.find((t) => t.type === "page" && t.url.endsWith("/sidepanel.html"));
        if (!panel) {
          if (Date.now() - nudged > 12000) {
            nudged = Date.now();
            const { keeper } = browserProcesses();
            if (keeper) process.kill(keeper, "SIGUSR2");
          }
          await sleep(500);
          continue;
        }
        const attached = await bounded(cdp.send("Target.attachToTarget", { targetId: panel.targetId, flatten: true }), 5000);
        if (!attached) break;
        const { sessionId } = attached;
        if (!(await bounded(installBridge(cdp, sessionId), 5000))) break;
        const reset = await bounded(cdp.send("Runtime.evaluate", { expression: 'window.__bench.send({type:"reset"})', returnByValue: true }, sessionId), 5000);
        if (reset) return { cdp, sessionId };
        break;
      }
    } catch (err) {
      console.error(`  -> browser start failed: ${err.message}`);
    }
    console.error(`  -> browser start attempt ${attempt} did not reach a working side panel${alive() ? "" : " (Chrome exited)"}; starting a fresh browser`);
    try {
      cdp?.close();
    } catch {}
    const { chrome } = browserProcesses();
    if (chrome) {
      process.kill(chrome, "SIGTERM");
      const gone = Date.now() + 10000;
      while (browserProcesses().chrome && Date.now() < gone) await sleep(200);
    }
    await sleep(2000);
  }
  throw new Error("The extension's side panel never answered.");
}

// Injects a small bridge: a client connected to the in-page controller, whose events are
// buffered on window.__bench for this script to drain.
async function installBridge(cdp, sessionId) {
  const expr = `
    (() => {
      if (window.__bench) return true;
      window.__bench = { events: [] };
      const api = globalThis.agentHost.connect((e) => window.__bench.events.push(e));
      window.__bench.send = api.send;
      return true;
    })()
  `;
  return cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sessionId);
}

async function setConfig(cdp, sessionId, config) {
  const expr = `chrome.storage.local.set({ config: ${JSON.stringify(config)} })`;
  await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
}

// Every agent event of a task goes to bench-results/<run-id>/<task>.events.jsonl, one JSON
// line each with the time it was drained, so a stalled task shows where it hung. Values under
// credential-looking keys are replaced before anything is written.
let eventLogPath = null;
const SECRET_KEY = /key|token|secret|password|authorization|credential/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v)]));
  }
  return value;
}

function logEvent(entry) {
  if (!eventLogPath) return;
  try {
    appendFileSync(eventLogPath, JSON.stringify(redact({ t: Date.now(), ...entry })) + "\n");
  } catch {}
}

function openEventLog(task, run) {
  const dir = join(RESULTS_DIR, runId);
  mkdirSync(dir, { recursive: true });
  eventLogPath = join(dir, `${task.id}${Number(args.runs) > 1 ? `.run${run}` : ""}.events.jsonl`);
}

async function drainEvents(cdp, sessionId) {
  const { result } = await cdp.send("Runtime.evaluate", { expression: "JSON.stringify(window.__bench.events.splice(0))", returnByValue: true }, sessionId);
  const events = JSON.parse(result.value);
  const now = Date.now();
  for (const e of events) {
    logEvent({ event: e });
    Object.defineProperty(e, "at", { value: now, enumerable: false });
  }
  return events;
}

// Fixed permission policy: allow ordinary prompts (safety checks, new-site approvals),
// deny anything that reaches a sensitive site or a password field. Never answered as
// "always", since that would persist a setting change between tasks/runs.
function decisionFor(kind) {
  return ["sensitive", "password"].includes(kind) ? "deny" : "once";
}

async function answerPermission(cdp, sessionId, id, decision) {
  const expr = `window.__bench.send(${JSON.stringify({ type: "permission", id, decision })})`;
  await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sessionId);
}

async function readActiveTab(cdp, sessionId) {
  const expr = `
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const all = await chrome.tabs.query({});
      return JSON.stringify({ url: tab?.url || "", title: tab?.title || "", tabCount: all.length });
    })()
  `;
  const { result } = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
  const { url, title, tabCount } = JSON.parse(result.value);
  let pageText = "";
  let formValues = [];
  try {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const tabTarget = targetInfos.find((t) => t.type === "page" && t.url === url);
    if (tabTarget) {
      const { sessionId: tabSession } = await cdp.send("Target.attachToTarget", { targetId: tabTarget.targetId, flatten: true });
      const textEval = await cdp.send("Runtime.evaluate", { expression: "document.body ? document.body.innerText.slice(0, 8000) : ''", returnByValue: true }, tabSession);
      pageText = textEval.result.value || "";
      const formEval = await cdp.send("Runtime.evaluate", { expression: FORM_VALUES_EXPR, returnByValue: true }, tabSession);
      formValues = JSON.parse(formEval.result.value || "[]");
      await cdp.send("Target.detachFromTarget", { sessionId: tabSession });
    }
  } catch {}
  return { url, title, pageText, formValues, tabCount };
}

// Every form control on the page, as task.check sees it: what a precision task filled in.
const FORM_VALUES_EXPR = `JSON.stringify([...document.querySelectorAll("input, select, textarea")].map((el) => ({
  name: el.name || "", id: el.id || "", type: (el.type || el.tagName).toLowerCase(),
  value: el.tagName === "SELECT" ? (el.selectedOptions[0]?.text || "").trim() : el.value,
  checked: Boolean(el.checked),
})))`;

// After a stalled request is stopped, the model server may still be generating for it.
// Starting the next task on a busy slot would queue behind (or be starved by) the wedged
// request, so wait until the server reports idle. llama-server's /slots says so directly
// when it is reachable without a model name; otherwise the gate's /gaming/status `active`
// count stands in. Both reads are bounded, and a server that never settles is logged, not fatal.
const IDLE_WAIT_MS = 180000;
let serverMayBeBusy = false;

async function serverBusy() {
  const base = (args.baseUrl || args["base-url"] || "").replace(/\/v1\/?$/, "").replace(/\/$/, "");
  for (const root of [args.gate, base].filter(Boolean)) {
    try {
      const res = await fetch(`${root.replace(/\/$/, "")}/slots`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const slots = await res.json();
        if (Array.isArray(slots)) return slots.some((s) => s.is_processing);
      }
    } catch {}
  }
  try {
    const res = await fetch(`${args.gate.replace(/\/$/, "")}/gaming/status`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) return Number((await res.json()).active) > 0;
  } catch {}
  return false;
}

async function waitServerIdle() {
  if (!serverMayBeBusy) return;
  const deadline = Date.now() + IDLE_WAIT_MS;
  let waited = false;
  while (await serverBusy()) {
    if (Date.now() >= deadline) {
      console.error(`  -> server still busy after ${IDLE_WAIT_MS / 1000}s; starting the next task anyway`);
      break;
    }
    if (!waited) console.error("  -> waiting for the model server to finish the stalled request");
    waited = true;
    await sleep(2000);
  }
  serverMayBeBusy = false;
}

// How long to wait for the agent to report stopped after a timed-out task.
const STOP_GRACE_MS = 120000;

async function runTask(cdp, sessionId, task, timeoutMs) {
  await cdp.send("Runtime.evaluate", { expression: 'window.__bench.send({type:"reset"})', returnByValue: true }, sessionId);
  await drainEvents(cdp, sessionId);

  // task.prompts (an array) chains several user turns in one conversation, with no reset
  // between them, before the checker runs; task.prompt (a single string) is still the
  // common case and behaves exactly as before.
  const prompts = task.prompts || [task.prompt];
  const started = Date.now();
  // Index into events where each user turn starts, for task.check's turnReplies.
  const turnStarts = [];
  const end = started + timeoutMs;
  const events = [];
  let timedOut = false;
  let stalled = false;
  let agentError = null;
  const stallMs = Number(args["stall-ms"]);
  let lastActivity = Date.now();

  for (let i = 0; i < prompts.length && !timedOut && !agentError; i++) {
    const prompt = prompts[i];
    turnStarts.push(events.length);
    await cdp.send("Runtime.evaluate", { expression: `window.__bench.send(${JSON.stringify({ type: "run", text: prompt })})`, returnByValue: true }, sessionId);
    let finished = false;
    // The controller rejects "run" with an error reply, not a thrown exception, when the
    // previous turn's agent is still finishing (see the stop-grace wait below); catch that
    // here and retry once it actually stops, rather than silently recording an empty turn.
    // Every event drained anywhere is kept, including a fast reply in the same batch.
    const firstBatch = await drainEvents(cdp, sessionId);
    events.push(...firstBatch);
    if (firstBatch.some((e) => e.type === "status" && e.running === false)) finished = true;
    const firstError = firstBatch.find((e) => e.type === "error" && !/already running/i.test(e.text));
    if (firstError) {
      agentError = firstError.text;
      finished = true;
    }
    if (!finished && firstBatch.some((e) => e.type === "error" && /already running/i.test(e.text))) {
      console.error(`  -> previous turn's agent was still finishing; waiting up to ${STOP_GRACE_MS / 1000}s before retrying`);
      const waitDeadline = Date.now() + STOP_GRACE_MS;
      while (Date.now() < waitDeadline) {
        await sleep(500);
        const batch = await drainEvents(cdp, sessionId);
        events.push(...batch);
        if (batch.some((e) => e.type === "status" && e.running === false)) break;
      }
      await cdp.send("Runtime.evaluate", { expression: `window.__bench.send(${JSON.stringify({ type: "run", text: prompt })})`, returnByValue: true }, sessionId);
    }

    // Records drained events: the agent's answers to permission prompts, the end of the
    // turn, and an error the agent ended it with (a run it rejected or that threw before
    // the task began sends no status at all, so waiting out the timeout would hide why).
    const take = async (batch) => {
      if (batch.length) lastActivity = Date.now();
      for (const e of batch) {
        events.push(e);
        if (e.type === "permission_request") await answerPermission(cdp, sessionId, e.id, decisionFor(e.kind));
        if (e.type === "status" && e.running === false) finished = true;
        if (e.type === "error" && !timedOut) {
          agentError = e.text;
          finished = true;
        }
      }
    };

    // A deadline checked only between iterations does not bound an iteration already in
    // flight: if one drainEvents/cdp.send round trip stalls, the loop could overrun
    // --timeout. Racing each iteration against the remaining budget caps it at the deadline.
    // An iteration that loses the race still records what it drains when it lands: Stop,
    // sent right after, ends the task at once, and its events would otherwise be drained
    // by that iteration and lost, leaving the stop-grace wait below to time out.
    lastActivity = Date.now();
    while (!finished && Date.now() < end) {
      if (stallMs > 0 && Date.now() - lastActivity >= stallMs) {
        stalled = true;
        break;
      }
      const remaining = end - Date.now();
      const iteration = sleep(300).then(() => drainEvents(cdp, sessionId)).then(take);
      const inTime = await Promise.race([iteration.then(() => true), sleep(remaining).then(() => false)]);
      if (!inTime) {
        iteration.catch(() => {});
        break;
      }
    }
    if (!finished) {
      timedOut = true;
      serverMayBeBusy = true;
      logEvent({ marker: stalled ? "stalled" : "timeout", ...(stalled ? { idleMs: Date.now() - lastActivity } : {}) });
      logEvent({ marker: "stop_sent" });
      await cdp.send("Runtime.evaluate", { expression: 'window.__bench.send({type:"stop"})', returnByValue: true }, sessionId);
      // Stop ends the task at once; the wait is bounded for an agent that does not answer,
      // since the next "run" would be rejected as "already running" if we moved on early.
      const stopDeadline = Date.now() + STOP_GRACE_MS;
      while (!finished && Date.now() < stopDeadline) {
        await sleep(500);
        await take(await drainEvents(cdp, sessionId));
      }
      if (!finished) {
        const last = events.slice(-5).map((e) => e.type + (e.text ? `: ${e.text.slice(0, 120)}` : "")).join(" | ");
        console.error(`  -> agent did not report stopped within ${STOP_GRACE_MS / 1000}s of grace; the next task may start blocked. Last events: ${last || "none"}`);
      }
    }
  }
  const wallMs = Date.now() - started;
  logEvent({ marker: "task_end", timedOut });

  const steps = events.filter((e) => e.type === "tool_call").length;
  const usage = [...events].reverse().find((e) => e.type === "usage");
  const reply = events.filter((e) => e.type === "reply").map((e) => e.text).join("\n");

  const { url: finalUrl, pageText, formValues, tabCount } = await readActiveTab(cdp, sessionId);
  const turnReplies = turnStarts.map((start, i) =>
    events
      .slice(start, turnStarts[i + 1] ?? events.length)
      .filter((e) => e.type === "reply")
      .map((e) => e.text)
      .join("\n"),
  );
  const turnToolCalls = turnStarts.map((start, i) => events.slice(start, turnStarts[i + 1] ?? events.length).filter((e) => e.type === "tool_call").length);

  let verdict;
  if (agentError) {
    verdict = { ok: false, reason: `agent error: ${agentError}` };
  } else if (timedOut) {
    verdict = { ok: false, reason: stalled ? `stalled: no events for ${stallMs / 1000}s, stopped` : `timed out after ${timeoutMs / 1000}s` };
  } else {
    try {
      verdict = task.check({ finalUrl, pageText, reply, events, formValues, tabCount, turnReplies, turnToolCalls });
    } catch (err) {
      verdict = { ok: false, reason: `checker threw: ${err.message}` };
    }
  }

  return {
    ok: verdict.ok,
    reason: verdict.reason,
    steps,
    tokensIn: usage?.usage?.input ?? 0,
    tokensOut: usage?.usage?.output ?? 0,
    wallMs,
    startedAt: new Date(started).toISOString(),
    metrics: { ...taskMetrics(events, { agentError, timedOut, stalled }), score: verdict.score },
  };
}

function fmtCost(c) {
  return c == null ? "-" : `~$${c.amount.toFixed(4)} (estimate)`;
}

function writeReport({ runId, provider, model, thinking, rows }) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const jsonPath = join(RESULTS_DIR, `${runId}.json`);
  const mdPath = join(RESULTS_DIR, `${runId}.md`);
  writeFileSync(jsonPath, JSON.stringify({ provider, model, thinking, rows }, null, 2));

  const header = `| Task | Run | Success | Steps | Tokens in | Tokens out | Wall time (s) | Cost | Notes |\n|---|---|---|---|---|---|---|---|---|`;
  const lines = rows.map(
    (r) =>
      `| ${r.name} | ${r.run} | ${r.success ? "pass" : "fail"} | ${r.steps} | ${r.tokensIn} | ${r.tokensOut} | ${(r.wallMs / 1000).toFixed(1)} | ${fmtCost(r.costUsd)} | ${r.reason} |`,
  );

  const byTask = new Map();
  for (const r of rows) {
    if (!byTask.has(r.task)) byTask.set(r.task, []);
    byTask.get(r.task).push(r);
  }
  const summaryHeader = `| Task | Success rate | Avg steps | Avg tokens | Avg wall time (s) |\n|---|---|---|---|---|`;
  const summaryLines = [...byTask.entries()].map(([id, group]) => {
    const n = group.length;
    const rate = (group.filter((r) => r.success).length / n) * 100;
    const avg = (f) => (group.reduce((s, r) => s + f(r), 0) / n).toFixed(1);
    return `| ${group[0].name} | ${rate.toFixed(0)}% | ${avg((r) => r.steps)} | ${avg((r) => r.tokensIn + r.tokensOut)} | ${avg((r) => r.wallMs / 1000)} |`;
  });

  const overallRate = (rows.filter((r) => r.success).length / rows.length) * 100;
  const totalCost = rows.reduce((s, r) => s + (r.costUsd?.amount || 0), 0);
  const anyEstimate = rows.some((r) => r.costUsd);

  const md = [
    `# Browsby benchmark: ${provider} / ${model}`,
    "",
    `Thinking: ${thinking}.`,
    "",
    `Overall success rate: ${overallRate.toFixed(0)}% (${rows.filter((r) => r.success).length}/${rows.length}). Total cost: ${anyEstimate ? `~$${totalCost.toFixed(4)} (estimate)` : "-"}.`,
    "",
    "## Per-task summary",
    "",
    summaryHeader,
    ...summaryLines,
    "",
    "## All runs",
    "",
    header,
    ...lines,
    "",
  ].join("\n");
  writeFileSync(mdPath, md);
  console.log(`\nWrote ${jsonPath}\nWrote ${mdPath}`);
}

// The keep-alive timer in main() would otherwise hold a failed run open forever, and
// with it the shared GPU lock.
await main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
