#!/usr/bin/env node
// Checks scripts/bench/metrics.js on synthetic event streams with known answers.
import assert from "node:assert/strict";
import { summarize, taskMetrics } from "./metrics.js";

const call = (name, input) => ({ type: "tool_call", name, input });
const result = (isError, text = "ok") => ({ type: "tool_result", isError, content: [{ type: "text", text }] });

// A task that fails one click, retries it the same way (a repeat), gets a loop note, then
// replies; the checker failed, so the reply was a premature claim of completion.
const premature = [
  { type: "speed", firstTokenMs: 100 },
  call("navigate", { url: "http://a.test/" }),
  result(false),
  { type: "speed", firstTokenMs: 300 },
  call("browser", { action: "left_click", ref: "ref_3" }),
  result(true, "ref_3 is covered by another element"),
  { type: "speed", firstTokenMs: 200 },
  call("browser", { action: "left_click", ref: "ref_3" }),
  result(true, "ref_3 is covered by another element\n\n[Loop check] The same call failed twice."),
  call("notes", { action: "read" }),
  result(false),
  { type: "guard", verdict: "allow" },
  { type: "permission_request", kind: "safety" },
  { type: "reply", text: "Done." },
  { type: "task_stats", text: "18 tok/s average · 5k tokens · 40s · safety checks 25% of the time" },
];
const m = taskMetrics(premature, { ok: false, timedOut: false, agentError: null });
assert.equal(m.modelCalls, 3);
assert.equal(m.actions, 3, "notes is not a browser action");
assert.equal(m.notesCalls, 1);
assert.equal(m.toolErrors, 2);
assert.equal(m.repeatedCalls, 1);
assert.equal(m.loopNotes, 1);
assert.equal(m.loopStop, false);
assert.deepEqual(m.prompts, { safety: 1 });
assert.equal(m.safetyChecks, 1);
assert.equal(m.safetyShare, 0.25);
assert.equal(m.premature, true);
assert.equal(m.recovered, false);
assert.equal(m.firstTokenMs, 200);

// The same events on a passing task: recovered, not premature.
const passed = taskMetrics(premature, { ok: true, timedOut: false, agentError: null });
assert.equal(passed.recovered, true);
assert.equal(passed.premature, false);

// Not premature when the task timed out, the agent asked a question, or the loop guard stopped it.
assert.equal(taskMetrics(premature, { ok: false, timedOut: true }).premature, false);
assert.equal(taskMetrics([...premature, { type: "question", text: "Which one?" }], { ok: false }).premature, false);
const stopped = taskMetrics([...premature, { type: "notice", text: "Stopped because the agent seems stuck: same error." }], { ok: false });
assert.equal(stopped.loopStop, true);
assert.equal(stopped.premature, false);

const rows = [
  { success: false, reason: "checker", wallMs: 40000, tokensIn: 4000, tokensOut: 100, metrics: m },
  { success: true, reason: "ok", wallMs: 20000, tokensIn: 2000, tokensOut: 50, metrics: passed },
  { success: false, reason: "timed out after 240s", wallMs: 240000, tokensIn: 0, tokensOut: 0, metrics: null },
];
const s = summarize(rows);
assert.equal(s.passed, 1);
assert.equal(s.premature, 1);
assert.equal(s.timeouts, 1);
assert.equal(s.recoveryRate, 0.5, "of the two tasks with tool errors, one passed");
assert.equal(Math.round(s.avgWallS), 100);
console.log("bench metrics checks passed");
