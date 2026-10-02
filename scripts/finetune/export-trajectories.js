#!/usr/bin/env node
// Exports successful benchmark trajectories as chat-format JSONL for LoRA fine-tuning.
//
// Input: benchmark result sets, each a <run-id>.json (rows with task, run, success, steps,
// wallMs) plus a <run-id>/ directory of per-task event logs (<task>[.run<N>].events.jsonl,
// one JSON line per agent event, written as {t, event} or {t, marker}). Only rows whose
// check passed, whose log has no timeout marker and whose step count is within the filter
// are exported. Each record is one trajectory:
//   { messages: [system, user, (assistant{content,tool_calls}, tool...)*], metadata }
// Screenshots become a placeholder; the page text the agent saw stays in the tool result.
// Secrets are redacted by key name and by value pattern before anything is written.
//
// Usage:
//   node scripts/finetune/export-trajectories.js [--in DIR[,DIR]] [--out FILE]
//        [--min-steps N] [--max-steps N]
// --in defaults to ~/bench-results (and its runs/ subdirectories). Output defaults to stdout
// when --out is omitted; the summary always goes to stderr.

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = join(fileURLToPath(import.meta.url), "..", "..", "..");

const SECRET_KEY = /key|token|secret|password|passwd|authorization|credential|cookie|session[_-]?id/i;
const SECRET_VALUE = [
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "[redacted]"],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[redacted]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\b(authorization|cookie|set-cookie|x-api-key|api[_-]?key|password|passwd|secret|token)(["']?\s*[:=]\s*)(["']?)[^\s"',;&]+/gi, "$1$2$3[redacted]"],
  [/([?&](?:api[_-]?key|key|token|access_token|password|auth|sig|signature)=)[^&\s"']+/gi, "$1[redacted]"],
];

export function redactString(text) {
  let out = text;
  for (const [re, rep] of SECRET_VALUE) out = out.replace(re, rep);
  return out;
}

export function redact(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) && v !== null && typeof v !== "object" ? "[redacted]" : redact(v)]));
  }
  return value;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const [k, inline] = argv[i].slice(2).split("=");
    args[k] = inline ?? argv[++i];
  }
  return args;
}

// Tool result content is a string or an array of text/image blocks; either becomes text.
function resultText(content) {
  if (typeof content === "string") return content;
  const blocks = Array.isArray(content) ? content : [];
  const parts = blocks.map((b) => (b?.type === "text" ? b.text ?? "" : b?.type === "image" ? "[screenshot omitted]" : ""));
  return parts.filter(Boolean).join("\n");
}

// Folds an event stream into chat messages. An assistant turn starts at assistant_start (or
// at a tool_call that follows tool results) and holds its reply text and tool calls; its
// tool results follow it as tool messages. Unknown event types are ignored.
export function eventsToMessages(events) {
  const messages = [];
  let turn = null;
  let results = [];
  const flush = () => {
    if (turn && (turn.content || turn.tool_calls.length)) {
      const msg = { role: "assistant", content: turn.content };
      if (turn.tool_calls.length) msg.tool_calls = turn.tool_calls;
      messages.push(msg, ...results);
    }
    turn = null;
    results = [];
  };
  const open = () => (turn = { content: "", tool_calls: [] });
  for (const e of events) {
    if (e.type === "assistant_start") {
      flush();
      open();
    } else if (e.type === "reply") {
      if (!turn || results.length) {
        flush();
        open();
      }
      turn.content = turn.content ? `${turn.content}\n${e.text}` : e.text;
    } else if (e.type === "tool_call") {
      if (!turn || results.length) {
        flush();
        open();
      }
      turn.tool_calls.push({ id: e.id, type: "function", function: { name: e.name, arguments: JSON.stringify(e.input ?? {}) } });
    } else if (e.type === "tool_result") {
      if (!turn) continue;
      const text = resultText(e.content);
      results.push({ role: "tool", tool_call_id: e.id, content: e.isError ? `Error: ${text}` : text });
    }
  }
  flush();
  return messages;
}

function readEvents(path) {
  const events = [];
  const markers = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.marker) markers.push(d);
    else events.push(d.event ?? d);
  }
  return { events, markers };
}

function resultSets(roots) {
  const dirs = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    dirs.push(root);
    const runs = join(root, "runs");
    if (existsSync(runs)) for (const d of readdirSync(runs)) dirs.push(join(runs, d));
  }
  const sets = [];
  for (const dir of dirs) {
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      let data;
      try {
        data = JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch {
        continue;
      }
      if (!Array.isArray(data?.rows)) continue;
      const stamp = f.replace(/\.json$/, "");
      sets.push({ stamp, model: data.model, provider: data.provider, rows: data.rows, logDir: join(dir, stamp) });
    }
  }
  return sets;
}

function logPath(set, row, runCount) {
  const names = [`${row.task}.run${row.run}.events.jsonl`, `${row.task}.events.jsonl`];
  if (runCount <= 1) names.reverse();
  return names.map((n) => join(set.logDir, n)).find(existsSync) ?? null;
}

export function exportTrajectories({ roots, minSteps = 0, maxSteps = Infinity, systemPrompt }) {
  const records = [];
  const seen = new Set();
  const stats = { rows: 0, passed: 0, noLog: 0, timedOut: 0, filteredSteps: 0, empty: 0, duplicates: 0 };
  for (const set of resultSets(roots)) {
    const runs = new Set(set.rows.map((r) => r.run));
    for (const row of set.rows) {
      stats.rows++;
      if (!row.success) continue;
      stats.passed++;
      const path = logPath(set, row, runs.size);
      if (!path) {
        stats.noLog++;
        continue;
      }
      const { events, markers } = readEvents(path);
      if (markers.some((m) => m.marker === "timeout" || m.timedOut)) {
        stats.timedOut++;
        continue;
      }
      const steps = events.filter((e) => e.type === "tool_call").length;
      if (steps < minSteps || steps > maxSteps) {
        stats.filteredSteps++;
        continue;
      }
      const key = `${row.task}|${set.model}|${set.stamp}|${row.run}`;
      if (seen.has(key)) {
        stats.duplicates++;
        continue;
      }
      const body = eventsToMessages(events);
      if (!body.length) {
        stats.empty++;
        continue;
      }
      const user = events.find((e) => e.type === "user")?.text ?? row.prompt ?? row.name;
      seen.add(key);
      records.push(
        redact({
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: user }, ...body],
          metadata: { task: row.task, model: set.model, provider: set.provider, run_stamp: set.stamp, run: row.run, steps, wall_ms: row.wallMs },
        }),
      );
    }
  }
  return { records, stats };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const roots = (args.in ?? join(homedir(), "bench-results")).split(",");
  const { SYSTEM_PROMPT } = await import(`file://${join(PROJECT_DIR, "src", "prompt.js")}`);
  const { TASKS } = await import(`file://${join(PROJECT_DIR, "scripts", "bench", "tasks-extended.js")}`);
  const { records, stats } = exportTrajectories({
    roots,
    minSteps: args["min-steps"] ? Number(args["min-steps"]) : 0,
    maxSteps: args["max-steps"] ? Number(args["max-steps"]) : Infinity,
    systemPrompt: SYSTEM_PROMPT,
  });
  // The logs hold no user turn, so the task prompt comes from the task definition.
  const prompts = new Map(TASKS.map((t) => [t.id, t.prompts?.join("\n\n") ?? t.prompt]));
  for (const r of records) if (prompts.has(r.metadata.task)) r.messages[1].content = prompts.get(r.metadata.task);
  const out = records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
  if (args.out) writeFileSync(args.out, out);
  else process.stdout.write(out);
  console.error(`rows=${stats.rows} passed=${stats.passed} exported=${records.length} noLog=${stats.noLog} timedOut=${stats.timedOut} outsideStepRange=${stats.filteredSteps} empty=${stats.empty} duplicates=${stats.duplicates}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
