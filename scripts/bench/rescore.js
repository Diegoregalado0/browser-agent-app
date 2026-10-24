#!/usr/bin/env node
// Recomputes the metrics of finished benchmark runs from their saved events, so runs scored
// by older versions of metrics.js compare on equal terms. Usage: rescore.js <run.json>...
// Rewrites each run's json and prints its summary; pass/fail verdicts are kept as recorded.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { summarize, taskMetrics } from "./metrics.js";

for (const file of process.argv.slice(2)) {
  const run = JSON.parse(readFileSync(file, "utf8"));
  const dir = file.replace(/\.json$/, "");
  for (const row of run.rows) {
    const log = `${dir}/${row.task}${run.rows.some((r) => r.run > 1) ? `.run${row.run}` : ""}.events.jsonl`;
    if (!existsSync(log)) continue;
    const events = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l).event).filter(Boolean);
    const timedOut = /timed out|stalled/.test(row.reason);
    const agentError = /^agent error/.test(row.reason) ? row.reason : null;
    row.metrics = taskMetrics(events, { ok: row.success, timedOut, agentError });
  }
  const groups = (key) => Object.fromEntries([...new Set(run.rows.map((r) => r[key]).filter(Boolean))].map((g) => [g, summarize(run.rows.filter((r) => r[key] === g))]));
  run.summary = { all: summarize(run.rows), bySplit: groups("split"), byCategory: groups("category") };
  writeFileSync(file, JSON.stringify(run, null, 2));
  console.log(file.split("/").pop(), JSON.stringify(run.summary.all));
}
