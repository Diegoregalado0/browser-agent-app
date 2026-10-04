#!/usr/bin/env node
// Builds the training data for a LoRA run from the benchmark logs.
//
// Runs the trajectory exporter, then turns every trajectory into one example per assistant turn
// (the messages before that turn plus the turn itself, which is the only part trained on), in the
// chat format Unsloth and the model's own chat template expect: OpenAI-style messages with tool
// calls whose arguments are objects, and the agent's tool definitions in "tools".
//
// Trajectories from held-out benchmark sites never reach training. The remaining sites are split
// into train and eval by site (a stable hash of the site name), so eval loss is measured on sites
// the adapter has not seen. The run refuses to write data below --min trajectories unless --force.
//
// Usage:
//   node finetune/gcp/prepare-data.mjs [--in DIR[,DIR]] [--out-dir DIR] [--min N] [--force]
//        [--eval-fraction F] [--max-old-tool-chars N] [--min-steps N] [--max-steps N]
// Writes train.jsonl, eval.jsonl and manifest.json to --out-dir (default finetune/gcp/data).
// Exit code 2 means too few trajectories.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const { exportTrajectories } = await import(join(ROOT, "scripts", "finetune", "export-trajectories.js"));
const { SYSTEM_PROMPT } = await import(join(ROOT, "src", "prompt.js"));
const { TASKS, HELDOUT_SITES } = await import(join(ROOT, "scripts", "bench", "tasks-extended.js"));
const { BROWSER_TOOL_DEFS } = await import(join(ROOT, "src", "browser-tools.js"));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const [k, inline] = argv[i].slice(2).split("=");
    args[k] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
  }
  return args;
}

const TOOLS = BROWSER_TOOL_DEFS.map(({ name, description, input_schema }) => ({
  type: "function",
  function: { name, description, parameters: input_schema },
}));

// Chat templates render tool call arguments best as objects; the exporter stores JSON strings.
function normalize(msg) {
  if (!msg.tool_calls) return msg;
  return {
    ...msg,
    tool_calls: msg.tool_calls.map((c) => {
      let args = c.function.arguments;
      try {
        args = typeof args === "string" ? JSON.parse(args) : args;
      } catch {
        args = { raw: args };
      }
      return { ...c, function: { ...c.function, arguments: args } };
    }),
  };
}

// Older tool results are capped so long trajectories fit the context; the latest one stays whole.
function capOldToolResults(messages, maxChars) {
  if (!maxChars) return messages;
  const lastTool = messages.findLastIndex((m) => m.role === "tool");
  return messages.map((m, i) =>
    m.role === "tool" && i !== lastTool && typeof m.content === "string" && m.content.length > maxChars
      ? { ...m, content: `${m.content.slice(0, maxChars)}\n[truncated]` }
      : m,
  );
}

export function stepExamples(record, site, maxOldToolChars) {
  const messages = record.messages.map(normalize);
  const out = [];
  messages.forEach((m, i) => {
    if (m.role !== "assistant") return;
    out.push({
      messages: capOldToolResults(messages.slice(0, i + 1), maxOldToolChars),
      tools: TOOLS,
      meta: { task: record.metadata.task, site, model: record.metadata.model, step: out.length + 1, steps: record.metadata.steps },
    });
  });
  return out;
}

export function isEvalSite(site, fraction) {
  const h = createHash("sha256").update(site).digest().readUInt32BE(0);
  return h / 0xffffffff < fraction;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const roots = (args.in ?? join(homedir(), "bench-results")).split(",");
  const outDir = args["out-dir"] ?? join(ROOT, "finetune", "gcp", "data");
  const min = Number(args.min ?? process.env.MIN_TRAJECTORIES ?? 300);
  const evalFraction = Number(args["eval-fraction"] ?? 0.15);
  const maxOld = Number(args["max-old-tool-chars"] ?? 4000);
  const force = args.force === "true";

  const { records, stats } = exportTrajectories({
    roots,
    minSteps: args["min-steps"] ? Number(args["min-steps"]) : 0,
    maxSteps: args["max-steps"] ? Number(args["max-steps"]) : Infinity,
    systemPrompt: SYSTEM_PROMPT,
  });
  const byId = new Map(TASKS.map((t) => [t.id, t]));
  const counts = { trajectories: records.length, heldoutDropped: 0, unknownTask: 0, train: 0, eval: 0 };
  const train = [];
  const evalSet = [];
  const sites = { train: new Set(), eval: new Set() };
  for (const r of records) {
    const task = byId.get(r.metadata.task);
    if (!task) {
      counts.unknownTask++;
      continue;
    }
    r.messages[1].content = task.prompts?.join("\n\n") ?? task.prompt;
    if (HELDOUT_SITES.includes(task.site)) {
      counts.heldoutDropped++;
      continue;
    }
    const isEval = isEvalSite(task.site, evalFraction);
    (isEval ? sites.eval : sites.train).add(task.site);
    counts[isEval ? "eval" : "train"]++;
    (isEval ? evalSet : train).push(...stepExamples(r, task.site, maxOld));
  }

  const usable = counts.train + counts.eval;
  const summary = `exporter: ${JSON.stringify(stats)}\ntrajectories usable=${usable} train=${counts.train} eval=${counts.eval} heldoutDropped=${counts.heldoutDropped} unknownTask=${counts.unknownTask}\nexamples train=${train.length} eval=${evalSet.length}; sites train=${sites.train.size} eval=${sites.eval.size}`;
  console.error(summary);
  if (usable < min && !force) {
    console.error(`refusing: ${usable} usable trajectories is below the minimum of ${min} (pass --force to override)`);
    process.exit(2);
  }
  if (!train.length) {
    console.error("refusing: no training examples");
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });
  const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  writeFileSync(join(outDir, "train.jsonl"), jsonl(train));
  writeFileSync(join(outDir, "eval.jsonl"), jsonl(evalSet));
  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify({ created: new Date().toISOString(), roots, min, forced: usable < min, evalFraction, maxOldToolChars: maxOld, counts, examples: { train: train.length, eval: evalSet.length }, sites: { train: [...sites.train].sort(), eval: [...sites.eval].sort() } }, null, 2) + "\n",
  );
  console.error(`wrote ${outDir}/train.jsonl, eval.jsonl, manifest.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
