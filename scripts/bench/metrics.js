// What a benchmark run measures beyond pass/fail, from the agent's own UI events, and the
// identity of the run (code, prompt, tools, model and server settings) so two runs can be
// compared knowing what differed. Pure functions over events, apart from runMeta, which
// reads git and the model server once per run.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);
const callKey = (e) => `${e.name} ${JSON.stringify(e.input ?? {})}`;
const textOf = (content) => (Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n") : String(content ?? ""));

// A final reply that hands the task back to the user (asks them to do or decide something)
// rather than claiming it is done.
const ASKS_USER = /\?\s*$|\b(could you|can you|would you|please (do|sign|log|enter|provide|confirm|check)|let me know|do you want|shall i|should i)\b/im;

// Tools that act on the page or browser, as opposed to the agent's notepad and questions.
const AGENT_TOOLS = new Set(["notes", "ask_user"]);

// The measurements of one task from its events. outcome: { ok, timedOut, agentError }.
// - modelCalls: requests to the main model (one speed event each); safetyChecks: guard events.
// - actions: tool calls that touch the browser or a service; notesCalls: notepad use.
// - toolErrors: failed tool calls; recovered: the task had tool errors and still passed.
// - repeatedCalls: tool calls identical (tool and input) to an earlier call in the task.
// - loopNotes / loopStop: [Loop check] notes in tool results, and a loop-guard stop.
// - prompts: permission prompts by kind; asked: the agent asked the user a question.
// - premature: the agent ended the task with a reply (not a timeout, error, question or
//   stop) and the checker failed, so it declared done when it was not.
export function taskMetrics(events, outcome) {
  const calls = events.filter((e) => e.type === "tool_call");
  const results = events.filter((e) => e.type === "tool_result");
  const seen = new Set();
  let repeatedCalls = 0;
  for (const c of calls) {
    if (AGENT_TOOLS.has(c.name)) continue;
    const key = callKey(c);
    if (seen.has(key)) repeatedCalls++;
    seen.add(key);
  }
  const toolErrors = results.filter((r) => r.isError).length;
  const loopNotes = results.filter((r) => textOf(r.content).includes("[Loop check]")).length;
  const notices = events.filter((e) => e.type === "notice").map((e) => e.text || "");
  const loopStop = notices.some((t) => /seems stuck/.test(t));
  const prompts = {};
  for (const e of events.filter((e) => e.type === "permission_request")) prompts[e.kind || "other"] = (prompts[e.kind || "other"] || 0) + 1;
  const replies = events.filter((e) => e.type === "reply");
  const lastReply = replies.at(-1)?.text ?? "";
  // A question asked with ask_user, or in the final reply's own words.
  const asked = events.some((e) => e.type === "question") || ASKS_USER.test(lastReply);
  const replied = replies.length > 0;
  const stoppedOther = loopStop || notices.some((t) => /^Stopped/.test(t));
  const speed = events.filter((e) => e.type === "speed");
  const stats = [...events].reverse().find((e) => e.type === "task_stats")?.text || "";
  const checkShare = Number(/safety checks (\d+)%/.exec(stats)?.[1] ?? NaN);
  return {
    modelCalls: speed.length,
    safetyChecks: events.filter((e) => e.type === "guard").length,
    safetyShare: Number.isFinite(checkShare) ? checkShare / 100 : null,
    actions: calls.filter((c) => !AGENT_TOOLS.has(c.name)).length,
    notesCalls: calls.filter((c) => c.name === "notes").length,
    screenshots: calls.filter((c) => c.name === "browser" && c.input?.action === "screenshot").length,
    toolErrors,
    recovered: toolErrors > 0 && outcome.ok,
    repeatedCalls,
    loopNotes,
    loopStop,
    prompts,
    asked,
    premature: !outcome.ok && replied && !asked && !outcome.timedOut && !outcome.agentError && !stoppedOther,
    firstTokenMs: speed.length ? Math.round(speed.reduce((s, e) => s + (e.firstTokenMs || 0), 0) / speed.length) : null,
  };
}

// Code, prompt, tools and server identity of a run. The prompt and tool hashes come from the
// sources the build is made from; serverArgs is the model server's own launch arguments for
// the model under test when it is a llama.cpp router (its /models lists them), else null.
export async function runMeta({ projectDir, taskFile, model, baseUrl, config }) {
  const git = (...a) => {
    try {
      return execFileSync("git", ["-C", projectDir, ...a], { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  const { SYSTEM_PROMPT } = await import(`file://${projectDir}/src/prompt.js`);
  const { BROWSER_TOOL_DEFS } = await import(`file://${projectDir}/src/browser-tools.js`);
  const { NOTES_TOOL_DEF } = await import(`file://${projectDir}/src/notes.js`);
  const { ASK_USER_TOOL_DEF } = await import(`file://${projectDir}/src/ask-user.js`);
  const taskModule = await import(`file://${taskFile}`);
  let serverArgs = null;
  if (baseUrl) {
    try {
      const root = baseUrl.replace(/\/v1\/?$/, "");
      const res = await fetch(`${root}/models`, { signal: AbortSignal.timeout(5000) });
      const entry = (await res.json()).data?.find((m) => m.id === model);
      serverArgs = entry?.status?.args ?? null;
    } catch {}
  }
  return {
    commit: git("rev-parse", "--short", "HEAD"),
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    dirty: Boolean(git("status", "--porcelain", "--untracked-files=no")),
    promptHash: sha(SYSTEM_PROMPT),
    toolSchemaHash: sha(JSON.stringify([BROWSER_TOOL_DEFS, NOTES_TOOL_DEF, ASK_USER_TOOL_DEF])),
    taskFile: taskFile.split("/").pop(),
    taskFileHash: sha(readFileSync(taskFile, "utf8")),
    benchVersion: taskModule.BENCH_VERSION ?? taskModule.FIXTURES_VERSION ?? null,
    model,
    serverArgs,
    settings: { thinking: config.localThinking ?? config.thinking, permissionMode: config.permissionMode, maxSteps: config.maxSteps, canvasTool: config.canvasTool },
    node: process.version,
    started: new Date().toISOString(),
  };
}

// Totals over rows (one per task run), for the report and for comparing runs.
export function summarize(rows) {
  const n = rows.length || 1;
  const sum = (f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
  const withErrors = rows.filter((r) => r.metrics?.toolErrors > 0);
  return {
    runs: rows.length,
    passed: rows.filter((r) => r.success).length,
    successRate: rows.filter((r) => r.success).length / n,
    avgWallS: sum((r) => r.wallMs) / n / 1000,
    avgModelCalls: sum((r) => r.metrics?.modelCalls) / n,
    avgActions: sum((r) => r.metrics?.actions) / n,
    avgTokens: sum((r) => r.tokensIn + r.tokensOut) / n,
    toolErrors: sum((r) => r.metrics?.toolErrors),
    recoveryRate: withErrors.length ? withErrors.filter((r) => r.success).length / withErrors.length : null,
    repeatedCalls: sum((r) => r.metrics?.repeatedCalls),
    loopNotes: sum((r) => r.metrics?.loopNotes),
    loopStops: rows.filter((r) => r.metrics?.loopStop).length,
    premature: rows.filter((r) => r.metrics?.premature).length,
    prompts: sum((r) => Object.values(r.metrics?.prompts ?? {}).reduce((a, b) => a + b, 0)),
    timeouts: rows.filter((r) => /timed out|stalled/.test(r.reason)).length,
  };
}
