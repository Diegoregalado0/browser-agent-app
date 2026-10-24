#!/usr/bin/env node
// Turns recorded trajectories (src/trajectory.js) into supervised fine-tuning data. Nothing is
// exported unless this is run by hand; it reads local files and writes local files only.
//
// Usage:
//   node scripts/export-trajectories.js <trajectories.jsonl>... --out <dir>
//     [--outcomes success,failure] (labels to keep; default success) [--chatml]
//
// Writes <dir>/train.jsonl, one example per line in OpenAI chat form, which the Qwen3.6 GGUF
// chat template (llama.cpp) renders as is:
//   {"messages": [{role: system|user|assistant|tool, ...}], "tools": [{type: "function", function}]}
// Assistant tool calls carry function.arguments as objects; tool results are role "tool"
// messages. Assistant messages have weight 1 when they are a reply the model gave to exactly
// that history, else 0 (replies from earlier tasks, or from before the history was trimmed).
// --chatml adds "text", the example pre-rendered as ChatML by renderChatML below.
// Also <dir>/review.md (each example, abridged, for a person to read before any use) and
// <dir>/redaction-report.json (what was redacted when recorded, what the re-check found now,
// and what was skipped and why). Every string is put through the redaction again here.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inputsOf, redactor } from "../src/trajectory.js";
import { readTrajectories } from "./trajectory-file.js";

const IMAGE_TEXT = "[screenshot]";
// Replies that are not examples to learn from.
const NOT_A_TARGET = new Set(["unreadable", "max_tokens", "refusal"]);

const textOf = (blocks) =>
  (blocks ?? [])
    .map((b) => (b.type === "text" ? b.text : b.type === "image" ? IMAGE_TEXT : ""))
    .filter(Boolean)
    .join("\n");

// One neutral history message (src/agent.js) as OpenAI chat messages.
function toChat(message, weight) {
  if (message.role === "assistant") {
    const calls = message.content.filter((b) => b.type === "tool_call");
    return [
      {
        role: "assistant",
        content: textOf(message.content),
        ...(calls.length && { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.input ?? {} } })) }),
        weight,
      },
    ];
  }
  const results = message.content.filter((b) => b.type === "tool_result");
  const rest = message.content.filter((b) => b.type !== "tool_result");
  return [
    ...results.map((r) => ({ role: "tool", tool_call_id: r.id, name: r.name, content: textOf(r.content) })),
    ...(rest.length ? [{ role: "user", content: textOf(rest) }] : []),
  ];
}

const sameContent = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A trajectory's examples. Consecutive steps whose requests only grew (each one the previous
// request, its reply and the tool results) share one example, with every reply in it trained;
// a request that rewrote the history (trimming, a summary, the progress experiment's task
// state) starts a new example. Returns [{ messages, tools, steps: [first, last] }].
export function examples(record) {
  const inputs = inputsOf(record);
  const tools = record.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const out = [];
  let segment = [];
  const flush = () => {
    if (!segment.length) return;
    const lastStep = segment.at(-1);
    const history = [...inputs[lastStep], { role: "assistant", content: record.steps[lastStep].output.content }];
    const trained = new Set(segment.filter((i) => isTarget(record.steps[i].output)).map((i) => inputs[i].length));
    if (trained.size) {
      const messages = [{ role: "system", content: record.system }, ...history.flatMap((m, i) => toChat(m, trained.has(i) ? 1 : 0))];
      out.push({ messages, tools, steps: [segment[0], lastStep] });
    }
    segment = [];
  };
  for (let i = 0; i < record.steps.length; i++) {
    const prev = segment.at(-1);
    const grows = prev !== undefined && record.steps[i].input.prefix >= inputs[prev].length && sameContent(inputs[i][inputs[prev].length]?.content, record.steps[prev].output.content);
    if (!grows) flush();
    segment.push(i);
  }
  flush();
  return out;
}

const isTarget = (output) => !NOT_A_TARGET.has(output.stop) && (output.content ?? []).some((b) => (b.type === "text" && b.text.trim()) || b.type === "tool_call");

// JSON as Python's json.dumps writes it (", " and ": "), which the template's tojson follows.
function pyJson(v) {
  if (Array.isArray(v)) return `[${v.map(pyJson).join(", ")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${pyJson(x)}`).join(", ")}}`;
  return JSON.stringify(v);
}

// The tool instructions the Qwen3.5/3.6 template puts in the system turn. To be checked
// byte for byte against the GGUF's own template before training on the text form.
const TOOL_INSTRUCTIONS =
  "If you choose to call a function ONLY reply in the following format with NO suffix:\n\n<tool_call>\n<function=example_function_name>\n<parameter=example_parameter_1>\nvalue_1\n</parameter>\n<parameter=example_parameter_2>\nThis is the value for the second parameter\nthat can span\nmultiple lines\n</parameter>\n</function>\n</tool_call>\n\n<IMPORTANT>\nReminder:\n- Function calls MUST follow the specified format: an inner <function=...></function> block must be nested within <tool_call></tool_call> XML tags\n- Required parameters MUST be specified\n- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after\n- If there is no function call available, answer the question like a helpful assistant\n</IMPORTANT>";

// An example as ChatML in the Qwen3.6 template's conventions, thinking off: tools as JSON in
// the system turn, tool calls as <tool_call><function=..><parameter=..> blocks (non-string
// values JSON-encoded), tool results as <tool_response> blocks in user turns, and an empty
// think block on the replies after the last user request.
export function renderChatML({ messages, tools }) {
  const [system, ...rest] = messages[0]?.role === "system" ? messages : [null, ...messages];
  let out = "";
  if (tools?.length) {
    out += `<|im_start|>system\n# Tools\n\nYou have access to the following functions:\n\n<tools>${tools.map((t) => `\n${pyJson(t)}`).join("")}\n</tools>\n\n${TOOL_INSTRUCTIONS}`;
    out += `${system?.content ? `\n\n${system.content}` : ""}<|im_end|>\n`;
  } else if (system) out += `<|im_start|>system\n${system.content}<|im_end|>\n`;
  const lastQuery = rest.findLastIndex((m) => m.role === "user");
  rest.forEach((m, i) => {
    if (m.role === "user") out += `<|im_start|>user\n${m.content}<|im_end|>\n`;
    else if (m.role === "tool") {
      if (rest[i - 1]?.role !== "tool") out += "<|im_start|>user";
      out += `\n<tool_response>\n${m.content}\n</tool_response>`;
      if (rest[i + 1]?.role !== "tool") out += "<|im_end|>\n";
    } else if (m.role === "assistant") {
      const content = (m.content ?? "").trim();
      out += `<|im_start|>assistant\n${i > lastQuery ? "<think>\n\n</think>\n\n" : ""}${content}`;
      (m.tool_calls ?? []).forEach((call, n) => {
        const fn = call.function ?? call;
        out += `${n ? "\n" : content ? "\n\n" : ""}<tool_call>\n<function=${fn.name}>\n`;
        for (const [name, value] of Object.entries(fn.arguments ?? {})) out += `<parameter=${name}>\n${typeof value === "string" ? value : pyJson(value)}\n</parameter>\n`;
        out += "</function>\n</tool_call>";
      });
      out += "<|im_end|>\n";
    }
  });
  return out;
}

// Reads records, keeps the selected outcomes, re-checks redaction and builds the three outputs.
export function exportTrajectories(records, { outcomes = ["success"], chatml = false } = {}) {
  const report = { trajectories: records.length, exported: 0, examples: 0, skipped: {}, redactedWhenRecorded: {}, foundByRecheck: {} };
  const skip = (why) => (report.skipped[why] = (report.skipped[why] ?? 0) + 1);
  const lines = [];
  const review = ["# Trajectory export for review", "", `Outcomes kept: ${outcomes.join(", ")}. Read every example before using any of it.`, ""];
  for (const record of records) {
    if (record.excluded) {
      skip(`excluded (${record.excluded.reason})`);
      continue;
    }
    if (!outcomes.includes(record.outcome?.label)) {
      skip(`outcome ${record.outcome?.label ?? "missing"}`);
      continue;
    }
    for (const [cls, n] of Object.entries(record.redactions ?? {})) report.redactedWhenRecorded[cls] = (report.redactedWhenRecorded[cls] ?? 0) + n;
    const found = examples(record);
    if (!found.length) {
      skip("no trainable reply");
      continue;
    }
    report.exported++;
    for (const example of found) {
      const recheck = redactor();
      const messages = recheck.value(example.messages);
      for (const [cls, n] of Object.entries(recheck.counts)) report.foundByRecheck[cls] = (report.foundByRecheck[cls] ?? 0) + n;
      const line = { messages, tools: example.tools };
      if (chatml) line.text = renderChatML(line);
      lines.push(JSON.stringify(line));
      report.examples++;
      review.push(
        `## Example ${report.examples}`,
        "",
        `Trajectory ${record.id}, task ${record.bench?.task ?? record.taskIndex}, steps ${example.steps[0]}-${example.steps[1]}, outcome ${record.outcome.label}${record.outcome.reason ? ` (${record.outcome.reason})` : ""}, ended by ${record.end?.reason}.`,
        "",
        ...messages.slice(1).map((m) => {
          const calls = (m.tool_calls ?? []).map((c) => ` -> ${c.function.name} ${JSON.stringify(c.function.arguments)}`).join("");
          const text = String(m.content ?? "").replace(/\s+/g, " ").slice(0, 400);
          return `- **${m.role}${m.weight ? " (trained)" : ""}**: ${text}${calls}`.slice(0, 900);
        }),
        "",
      );
    }
  }
  if (Object.keys(report.foundByRecheck).length) review.splice(3, 0, `Warning: the re-check redacted more text (${JSON.stringify(report.foundByRecheck)}); see redaction-report.json.`, "");
  return { train: lines.map((l) => `${l}\n`).join(""), review: review.join("\n"), report };
}

function main(argv) {
  const files = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") opts.out = argv[++i];
    else if (argv[i] === "--outcomes") opts.outcomes = argv[++i].split(",").map((s) => s.trim());
    else if (argv[i] === "--chatml") opts.chatml = true;
    else files.push(argv[i]);
  }
  if (!files.length || !opts.out) {
    console.error("Usage: node scripts/export-trajectories.js <trajectories.jsonl>... --out <dir> [--outcomes success,failure] [--chatml]");
    process.exit(1);
  }
  const { train, review, report } = exportTrajectories(files.flatMap(readTrajectories), opts);
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, "train.jsonl"), train);
  writeFileSync(join(opts.out, "review.md"), review);
  writeFileSync(join(opts.out, "redaction-report.json"), JSON.stringify(report, null, 2));
  console.log(`Exported ${report.examples} example(s) from ${report.exported} of ${report.trajectories} trajectories to ${opts.out}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
