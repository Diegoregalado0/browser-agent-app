#!/usr/bin/env node
// Markdown tables for a stress run: the limits ladder by dimension and rung, host resources
// per task and per rung with the moments the host looked saturated, and (for a soak run,
// many runs of one task cycle) how pass rate, step time and memory moved cycle by cycle.
//
// Usage: node scripts/bench/stress-report.js <run.json> [<run.json> ...] [--soak]
// The rows' metrics and resources come from run.js --debug --sample-ms.

import { readFileSync } from "node:fs";
import { errorType } from "./stress-metrics.js";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const soak = process.argv.includes("--soak");
const rows = files.flatMap((f) => JSON.parse(readFileSync(f, "utf8")).rows);

const mean = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const fmt = (x, d = 1) => (x == null ? "-" : Number(x).toFixed(d));
const table = (head, lines) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...lines.map((l) => `| ${l.join(" | ")} |`)].join("\n");
const group = (list, keyOf) => {
  const m = new Map();
  for (const r of list) {
    const k = keyOf(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};
const stops = (g) =>
  [...group(g, (r) => (r.success ? "pass" : r.metrics?.stop && r.metrics.stop !== "answered" ? r.metrics.stop : errorType(r.reason))).entries()]
    .map(([k, v]) => `${k} ${v.length}`)
    .join(", ");

const out = [];

if (!soak) {
  out.push("## Ladder", "");
  const order = ["horizon", "breadth", "memory", "precision", "recovery"];
  const byTask = group(rows, (r) => r.task);
  const lines = [...byTask.values()]
    .sort((a, b) => order.indexOf(a[0].dim) - order.indexOf(b[0].dim) || a[0].rung - b[0].rung)
    .map((g) => {
      const m = (f) => mean(g.map((r) => r.metrics?.[f]));
      return [
        g[0].dim,
        g[0].task,
        g[0].rung,
        `${g.filter((r) => r.success).length}/${g.length}`,
        fmt(m("score"), 2),
        fmt(mean(g.map((r) => r.steps)), 0),
        fmt(mean(g.map((r) => r.wallMs / 60000))),
        `${fmt(m("stepSecFirstQ"))} / ${fmt(m("stepSecLastQ"))}`,
        fmt(m("maxInputTokens"), 0),
        fmt(m("compactions")),
        fmt(m("loopNotes")),
        fmt(m("toolErrors")),
        stops(g),
      ];
    });
  out.push(
    table(["Dim", "Task", "Rung", "Pass", "Score", "Steps", "Min", "s/step first/last q", "Max ctx", "Compact", "Loop notes", "Tool errs", "Outcomes"], lines),
    "",
  );
}

// Resources: mean and peak per task (or per cycle for a soak), then whole-run averages.
const withRes = rows.filter((r) => r.resources);
if (withRes.length) {
  const resLine = (label, g) => {
    const m = (f) => mean(g.map((r) => r.resources.mean[f]));
    const p = (f, min) => (min ? Math.min : Math.max)(...g.map((r) => r.resources.peak[f]).filter((x) => typeof x === "number"));
    const flags = g.reduce((a, r) => a + r.resources.flags.memPsiOver10 + r.resources.flags.loadOver12, 0);
    const swap = Math.max(...g.map((r) => r.resources.swapGrowthMb));
    return [
      label,
      `${fmt(m("cpuPct"), 0)} / ${fmt(p("cpuPct"), 0)}`,
      `${fmt(m("load1"))} / ${fmt(p("load1"))}`,
      `${fmt(m("availMb") / 1024)} / ${fmt(p("availMb", true) / 1024)}`,
      `${fmt(m("cacheMb") / 1024)}`,
      `${fmt(m("swapMb"), 0)} (+${swap})`,
      `${fmt(m("psiCpu"))} / ${fmt(p("psiCpu"))}`,
      `${fmt(m("psiMem"))} / ${fmt(p("psiMem"))}`,
      `${fmt(m("psiIo"))} / ${fmt(p("psiIo"))}`,
      `${fmt(m("vramMb"), 0)} / ${fmt(p("vramMb"), 0)}`,
      `${fmt(m("llamaCpu"), 0)} / ${fmt(p("llamaCpu"), 0)}`,
      `${fmt(m("llamaRssMb") / 1024)} / ${fmt(p("llamaRssMb") / 1024)}`,
      `${fmt(m("chromeCpu"), 0)} / ${fmt(p("chromeCpu"), 0)}`,
      `${fmt(m("chromeRssMb") / 1024)} / ${fmt(p("chromeRssMb") / 1024)}`,
      `${fmt(m("xvfbCpu"), 0)} / ${fmt(m("xvfbRssMb"), 0)}`,
      `${fmt(m("nodeCpu"), 0)} / ${fmt(m("nodeRssMb"), 0)}`,
      flags,
    ];
  };
  const head = [
    soak ? "Cycle" : "Task",
    "CPU % mean/peak",
    "Load1 mean/peak",
    "Avail GB mean/min",
    "Cache GB",
    "Swap MB (growth)",
    "PSI cpu",
    "PSI mem",
    "PSI io",
    "VRAM MB",
    "llama CPU %",
    "llama RSS GB",
    "Chrome CPU %",
    "Chrome RSS GB",
    "Xvfb CPU%/MB",
    "node CPU%/MB",
    "Flagged samples",
  ];
  out.push("## Resources", "", "Process CPU is % of one core (1200 = all 12). Flagged samples: memory PSI above 10 or load above 12.", "");
  const groups = soak ? group(withRes, (r) => r.run) : group(withRes, (r) => r.task);
  out.push(table(head, [...groups.entries()].map(([k, g]) => resLine(k, g))), "");
  if (!soak) {
    out.push("### Per rung", "");
    out.push(table(["Dim/rung", ...head.slice(1)], [...group(withRes, (r) => `${r.dim} ${r.rung}`).entries()].map(([k, g]) => resLine(k, g))), "");
  }
  out.push("### Whole run", "", table(["Scope", ...head.slice(1)], [resLine("all tasks", withRes)]), "");
  const flagged = withRes.filter((r) => r.resources.flags.swapGrowth || r.resources.flags.memPsiOver10 || r.resources.flags.loadOver12 || r.resources.flags.cpuSaturated);
  out.push(
    "### Flagged moments",
    "",
    flagged.length
      ? table(
          ["Task", "Run", "Started", "Swap growth MB", "Mem PSI>10 samples", "Load>12 samples", "CPU>=95% samples", "First flag"],
          flagged.map((r) => [r.task, r.run, r.startedAt, r.resources.swapGrowthMb, r.resources.flags.memPsiOver10, r.resources.flags.loadOver12, r.resources.flags.cpuSaturated, r.resources.firstFlagAt ? new Date(r.resources.firstFlagAt).toISOString() : "-"]),
        )
      : "None.",
    "",
  );
}

if (soak) {
  out.push("## Soak cycles", "");
  const lines = [...group(rows, (r) => r.run).entries()].map(([run, g]) => [
    run,
    g[0].startedAt?.slice(0, 16) ?? "-",
    `${g.filter((r) => r.success).length}/${g.length}`,
    fmt(g.reduce((a, r) => a + r.wallMs, 0) / 60000, 0),
    fmt(mean(g.map((r) => r.metrics?.stepSecMedian))),
    fmt(mean(g.map((r) => r.metrics?.reqSecMedian))),
    fmt(mean(g.map((r) => r.resources?.mean.chromeRssMb)), 0),
    fmt(mean(g.map((r) => r.resources?.mean.llamaRssMb)), 0),
    fmt(mean(g.map((r) => r.resources?.mean.availMb)), 0),
    g.filter((r) => /harness error|stalled|timed out/.test(r.reason)).length,
    g.filter((r) => r.browserRestarted).length,
  ]);
  out.push(table(["Cycle", "Start (UTC)", "Pass", "Wall min", "s/step median", "s/request median", "Chrome RSS MB", "llama RSS MB", "Avail MB", "Wedges", "Browser restarts"], lines), "");
  const byTask = group(rows, (r) => r.task);
  out.push(
    "### Per task over the soak",
    "",
    table(
      ["Task", "Pass", "s/step median first cycle / last cycle", "Outcomes"],
      [...byTask.entries()].map(([id, g]) => [id, `${g.filter((r) => r.success).length}/${g.length}`, `${fmt(g[0].metrics?.stepSecMedian)} / ${fmt(g.at(-1).metrics?.stepSecMedian)}`, stops(g)]),
    ),
    "",
  );
}

console.log(out.join("\n"));
