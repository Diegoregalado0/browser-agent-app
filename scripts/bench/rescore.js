#!/usr/bin/env node
// Recomputes the metrics of finished benchmark runs from their saved events, so runs scored
// by older versions of metrics.js compare on equal terms.
// Usage: rescore.js [--recheck <fixture task id>] <run.json>...
// Rewrites each run's json and prints its summary. Pass/fail verdicts are kept as recorded,
// except with --recheck: that fixture task's checker runs again on its saved final reply (for
// a checker that reads only the reply, corrected after the run).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { answerText, finalAnswer, summarize, taskMetrics } from "./metrics.js";

const args = process.argv.slice(2);
const at = args.indexOf("--recheck");
const recheck = at >= 0 ? args.splice(at, 2)[1] : null;
const recheckTask = recheck && (await import("./tasks-fixtures.js")).TASKS.find((t) => t.id === recheck);
if (recheck && !recheckTask) throw new Error(`No fixture task ${recheck}`);

for (const file of args) {
  const run = JSON.parse(readFileSync(file, "utf8"));
  const dir = file.replace(/\.json$/, "");
  for (const row of run.rows) {
    const log = `${dir}/${row.task}${run.rows.some((r) => r.run > 1) ? `.run${row.run}` : ""}.events.jsonl`;
    if (!existsSync(log)) continue;
    const events = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l).event).filter(Boolean);
    const reply = answerText(events);
    if (row.task === recheck && !/timed out|stalled|^agent error/.test(row.reason)) {
      const v = recheckTask.check({ reply, finalReply: finalAnswer(events), events });
      [row.success, row.reason] = [v.ok, v.reason];
    }
    const timedOut = /timed out|stalled/.test(row.reason);
    const agentError = /^agent error/.test(row.reason) ? row.reason : null;
    row.metrics = taskMetrics(events, { ok: row.success, timedOut, agentError });
  }
  const groups = (key) => Object.fromEntries([...new Set(run.rows.map((r) => r[key]).filter(Boolean))].map((g) => [g, summarize(run.rows.filter((r) => r[key] === g))]));
  run.summary = { all: summarize(run.rows), bySplit: groups("split"), byCategory: groups("category") };
  writeFileSync(file, JSON.stringify(run, null, 2));
  console.log(file.split("/").pop(), JSON.stringify(run.summary.all));
}
