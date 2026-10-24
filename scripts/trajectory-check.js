#!/usr/bin/env node
// Checks the trajectory recorder (src/trajectory.js), its file sink and the exporter with a
// scripted provider and browser: off by default, never in Ghost mode, the recorded inputs are
// exactly what the provider received, every redaction class, sensitive-site exclusion, the
// screenshot placeholder, retention, end reasons, and the export format the Qwen3.6 chat
// template expects. No model, network or browser is used.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../src/agent.js";
import { providers } from "../src/providers/index.js";
import { DEFAULTS, mergeConfig } from "../src/config-core.js";
import { createController } from "../src/controller.js";
import { RETENTION, SCREENSHOT_PLACEHOLDER, TrajectoryRecorder, inputsOf, redactor, retain } from "../src/trajectory.js";
import { appendTrajectories, readTrajectories } from "./trajectory-file.js";
import { examples, exportTrajectories, renderChatML } from "./export-trajectories.js";

const base = { ...structuredClone(DEFAULTS), permissionMode: "auto", keys: { ...DEFAULTS.keys, openai: "test" } };
const on = { ...base, recordTrajectories: true };
let received = [];
let replies = [];
providers.openai = {
  describeError: () => null,
  turn: async ({ messages, system, tools }) => {
    received.push(JSON.parse(JSON.stringify({ messages, system, tools })));
    return replies.shift();
  },
  classify: async () => ({ verdict: "allow", reason: "ok" }),
};
const reply = (text) => ({ content: [{ type: "text", text }], raw: null, stop: "end", usage: { input: 10, output: 2 } });
const calls = (...content) => ({ content, raw: { native: "kept by the provider only" }, stop: "tool_use", usage: { input: 10, output: 2 } });
const call = (id, name, input) => ({ type: "tool_call", id, name, input });

// A scripted browser: urls[i] is the address at the i-th currentUrl call after it is set (the
// last one repeats); outputs answer browser.run by tool name; ref_pw is a password field.
function browser({ urls = ["https://shop.test/"], outputs = {} } = {}) {
  let n = 0;
  const url = () => urls[Math.min(n++, urls.length - 1)];
  return {
    startTask: async () => {},
    endTask: async () => {},
    currentPage: async () => ({ id: "t1", title: "Shop", url: urls.at(-1) }),
    currentUrl: async () => url(),
    describeTarget: async () => null,
    targetFrame: async () => null,
    callInPage: async (_, ref) => ref === "ref_pw",
    run: async (name, input) => outputs[name]?.(input) ?? "ok",
  };
}
function recorded(options = {}) {
  const sink = { records: [], append: async (r) => sink.records.push(JSON.parse(JSON.stringify(r))) };
  const recorder = new TrajectoryRecorder({ sink, ...options });
  const agent = new Agent({ emit: () => {}, askPermission: async () => "once" });
  agent.recorder = recorder;
  return { agent, recorder, sink };
}
async function runOnce({ config = on, script, b = browser(), request = "do it", options } = {}) {
  const r = recorded(options);
  r.agent.browser = b;
  received = [];
  replies = script;
  await r.agent.run(request, config);
  await r.recorder.idle();
  return r;
}

// Off by default: the settings are off, and a recorder records nothing until switched on.
assert.equal(mergeConfig({}).recordTrajectories, false);
assert.equal(mergeConfig({}).recordScreenshots, false);
{
  const { sink } = await runOnce({ config: base, script: [reply("hi")] });
  assert.equal(sink.records.length, 0, "recorded with the setting off");
}

// Ghost mode never records, even with the setting on; the same controller records once it is off.
{
  for (const ghostMode of [true, false]) {
    const sink = { records: [], append: async (r) => sink.records.push(r) };
    let recorder;
    const controller = createController({
      loadConfig: async () => ({ ...structuredClone(on), ghostMode }),
      saveConfig: async () => {},
      loadUsage: async () => null,
      saveUsage: async () => {},
      sessions: { save: async () => {}, list: async () => [], load: async () => ({}), remove: async () => {}, removeAll: async () => {} },
      ensureBrowser: async (a) => (a.browser ??= browser()),
      trajectories: (options) => (recorder = new TrajectoryRecorder({ ...options, sink })),
    });
    const send = controller.connect({ send: () => {} });
    await send({ type: "hello" });
    replies = [reply("hi")];
    await send({ type: "run", text: "say hi" });
    await recorder.idle();
    assert.equal(sink.records.length, ghostMode ? 0 : 1, ghostMode ? "Ghost mode recorded a task" : "a saved conversation was not recorded");
    if (!ghostMode) assert.match(sink.records[0].sessionId, /\S/, "the record has no session id");
  }
  // Ghost mode starting mid-task (an incognito window opening) drops the record too.
  let ghost = false;
  const { agent, recorder, sink } = recorded({ allowed: () => !ghost });
  agent.browser = browser();
  replies = [calls(call("g1", "browser", { action: "screenshot" })), reply("done")];
  agent.browser.run = async () => ((ghost = true), "ok");
  await agent.run("go", on);
  await recorder.idle();
  assert.equal(sink.records.length, 0, "a task that went Ghost mid-way was recorded");
}

// Exact input: every step's rebuilt messages, the system prompt and the tools equal what the
// provider received (less the provider-native raw copy, which is never stored).
{
  const script = [
    calls(call("c1", "browser", { action: "left_click", coordinate: [5, 5] })),
    calls(call("c2", "navigate", { url: "https://shop.test/cart" }), call("c3", "notes", { action: "append", text: "cart opened" })),
    reply("The cart is open."),
  ];
  const { sink } = await runOnce({ script, request: "open the cart" });
  const [rec] = sink.records;
  assert.equal(rec.steps.length, 3);
  const noRaw = (messages) => messages.map(({ raw: _raw, ...m }) => m);
  inputsOf(rec).forEach((messages, i) => assert.deepEqual(messages, noRaw(received[i].messages), `step ${i} input differs from what the provider received`));
  assert.equal(rec.system, received[0].system);
  assert.deepEqual(rec.tools, received[0].tools);
  assert.match(rec.promptHash, /^[0-9a-f]{12}$/);
  assert.ok(rec.steps[1].input.prefix === received[0].messages.length, "later steps do not share the earlier messages");
  assert.ok(!JSON.stringify(rec).includes("kept by the provider only"), "the provider's raw copy was stored");
  assert.deepEqual(rec.steps[1].toolResults.map((t) => [t.id, t.isError, typeof t.durationMs]), [["c2", false, "number"], ["c3", false, "number"]]);
  assert.equal(rec.steps[2].output.content[0].text, "The cart is open.");
  assert.equal(rec.end.reason, "reply");
  assert.equal(rec.outcome.label, "unlabeled");
  assert.equal(rec.taskIndex, 0);
  for (const k of ["latencyMs", "usage", "stop"]) assert.ok(k in rec.steps[0].output);
}

// Every redaction class, in the request, page output, model text and tool inputs.
{
  const page = [
    "Contact ada@example.com or +1 415 555 0100.",
    "Card 4111 1111 1111 1111, IBAN GB82 WEST 1234 5698 7654 32.",
    "Authorization: Bearer abcdefghij0123456789 and key sk-proj-ABCDEFGHijklmnop1234.",
    "Your verification code is 482913.",
    'Saved {"password": "s3cret-field"} at https://shop.test/cb?token=tok999&ok=1#access_token=frag123',
  ].join("\n");
  const script = [
    calls(call("p1", "browser", { action: "type", ref: "ref_pw", text: "hunter2-secret" })),
    calls(call("p2", "get_page_text", {})),
    calls(call("p3", "form_input", { ref: "ref_code", value: "482913" })),
    reply("I signed in with hunter2-secret and mailed ada@example.com."),
  ];
  const b = browser({ outputs: { get_page_text: () => page } });
  const { sink } = await runOnce({ script, b, request: "sign in, my phone is (415) 555-0199" });
  const text = JSON.stringify(sink.records[0]);
  for (const secret of ["hunter2-secret", "ada@example.com", "415 555 0100", "555-0199", "4111 1111", "GB82", "abcdefghij0123456789", "sk-proj", "482913", "s3cret-field", "tok999", "frag123"]) {
    assert.ok(!text.includes(secret), `${secret} reached the record`);
  }
  const counts = sink.records[0].redactions;
  for (const cls of ["password", "email", "phone", "card", "iban", "token", "code", "url", "secretField"]) assert.ok(counts[cls] > 0, `no ${cls} redaction counted: ${JSON.stringify(counts)}`);
  assert.match(text, /\[email\].*\[phone\]|\[phone\].*\[email\]/s);
  // Text that only looks like numbers is left alone.
  const plain = "On 2026-10-24 at 10:30 the order 123456789 cost 1,299.00 from 192.168.1.100 (sha 3f786850e387550fdab836ed7e6dc881de23001b).";
  assert.equal(redactor().text(plain), plain);
  const noLuhn = redactor();
  noLuhn.text("card 4111111111111112");
  assert.equal(noLuhn.counts.card, undefined, "a number failing the card checksum counted as a card");
}

// Sensitive sites: steps from the first one on such a site are dropped, with the content of the
// results that led there; a task that starts on one is not recorded at all.
{
  const script = [calls(call("s1", "navigate", { url: "https://www.paypal.com/myaccount" })), calls(call("s2", "browser", { action: "screenshot" })), reply("Balance shown.")];
  const b = browser({ urls: ["https://shop.test/", "https://shop.test/", "https://www.paypal.com/myaccount"], outputs: { navigate: () => "Balance: $1,234" } });
  const { sink } = await runOnce({ script, b });
  const [rec] = sink.records;
  assert.equal(rec.steps.length, 1);
  assert.deepEqual(rec.excluded, { reason: "sensitive_site", fromStep: 1 });
  assert.deepEqual(rec.steps[0].toolResults[0].content, []);
  assert.ok(!JSON.stringify(rec).includes("Balance"), "sensitive page content was stored");
  assert.equal(rec.end.page.url, "[sensitive site]");
  const started = await runOnce({ script: [reply("hi")], b: browser({ urls: ["https://chase.com/"] }) });
  assert.equal(started.sink.records.length, 0, "a task on a sensitive site was recorded");
  assert.equal(exportTrajectories([{ ...rec, outcome: { label: "success" } }]).report.examples, 0, "an excluded trajectory was exported");
}

// Screenshots become a placeholder unless recordScreenshots keeps them; the file sink stores
// kept ones by content hash.
const shot = { type: "image", mediaType: "image/png", data: Buffer.from("png bytes").toString("base64") };
{
  const script = () => [calls(call("i1", "browser", { action: "screenshot" })), reply("Seen.")];
  const b = () => browser({ outputs: { browser: () => [shot] } });
  const omitted = (await runOnce({ script: script(), b: b() })).sink.records[0];
  const image = omitted.steps[0].toolResults[0].content[0];
  assert.deepEqual(image, { type: "image", mediaType: "image/png", omitted: SCREENSHOT_PLACEHOLDER });
  assert.ok(!JSON.stringify(omitted).includes(shot.data));
  const kept = (await runOnce({ config: { ...on, recordScreenshots: true }, script: script(), b: b() })).sink.records[0];
  assert.equal(kept.steps[0].toolResults[0].content[0].data, shot.data, "a kept screenshot lost its data");
  const dir = mkdtempSync(join(tmpdir(), "browsby-trajectory-"));
  try {
    appendTrajectories(dir, [kept]);
    const [line] = readTrajectories(join(dir, "trajectories.jsonl"));
    assert.match(line.steps[0].toolResults[0].content[0].file, /^screenshots\/[0-9a-f]{64}\.png$/);
    assert.ok(!JSON.stringify(line).includes(shot.data), "the file sink kept the screenshot inline");
    assert.equal(readFileSync(join(dir, line.steps[0].toolResults[0].content[0].file), "utf8"), "png bytes");

    // Retention on write: past maxDays and past maxTrajectories records go, and their screenshots.
    const now = Date.parse("2026-10-24T12:00:00Z");
    const at = (days) => new Date(now - days * 86400000).toISOString();
    const r = (id, days) => ({ id, endedAt: at(days), steps: [] });
    assert.deepEqual(retain([r("old", 40), r("a", 3), r("b", 2), r("c", 1)], { maxDays: 30, maxTrajectories: 2 }, now).map((x) => x.id), ["b", "c"]);
    assert.deepEqual(RETENTION, { maxDays: 30, maxTrajectories: 1000 });
    const kept2 = appendTrajectories(dir, [{ ...r("n1", 0), endedAt: new Date(Date.now() + 1000).toISOString() }, { ...r("n2", 0), endedAt: new Date(Date.now() + 2000).toISOString() }], { retention: { maxDays: 30, maxTrajectories: 2 }, now: Date.now() });
    assert.equal(kept2, 2);
    assert.deepEqual(readTrajectories(join(dir, "trajectories.jsonl")).map((x) => x.id), ["n1", "n2"]);
    assert.equal(readdirSync(join(dir, "screenshots")).length, 0, "a dropped record's screenshot was kept");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// End reasons.
{
  const reason = async (script, config = on, b = browser()) => (await runOnce({ script, config, b })).sink.records[0]?.end.reason;
  assert.equal(await reason([calls(call("q1", "ask_user", { question: "Which size?" }))]), "ask_user");
  assert.equal(await reason([calls(call("m1", "browser", { action: "screenshot" })), calls(call("m2", "browser", { action: "screenshot" }))], { ...on, maxSteps: 2 }), "max_steps");
  assert.equal(await reason([{ content: [], raw: null, stop: "refusal", usage: { input: 1, output: 1 } }]), "refusal");
  assert.equal(await reason([calls(call("l1", "browser", { action: "screenshot" }))], { ...on, limits: { ...on.limits, taskTokens: 5 } }), "limit");
  const failing = { ...on, maxSteps: 10 };
  const r = recorded();
  r.agent.browser = browser();
  replies = [calls(call("e1", "browser", { action: "screenshot" }))];
  providers.openai.turn = async () => {
    if (replies.length) return replies.shift();
    throw new Error("server down");
  };
  await r.agent.run("go", failing).catch(() => {});
  await r.recorder.idle();
  assert.equal(r.sink.records[0].end.reason, "error");
  assert.equal(r.sink.records[0].end.error, "server down");
  // Stop while a tool runs.
  const s = recorded();
  let release;
  s.agent.browser = { ...browser(), run: () => new Promise((resolve) => (release = resolve)) };
  replies = [calls(call("u1", "browser", { action: "screenshot" }))];
  providers.openai.turn = async () => replies.shift();
  const running = s.agent.run("go", on);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  s.agent.stop();
  release("ok");
  await running;
  await s.recorder.idle();
  assert.equal(s.sink.records[0].end.reason, "user_stop");
}

// Export: OpenAI chat form with tool calls as argument objects and tool results as tool
// messages, outcomes filtered (success by default), and ChatML in the template's conventions.
{
  providers.openai.turn = async ({ messages, system, tools }) => (received.push(JSON.parse(JSON.stringify({ messages, system, tools }))), replies.shift());
  const script = [calls(call("x1", "browser", { action: "left_click", coordinate: [5, 5] })), reply("Clicked it for ada@example.com.")];
  const { sink } = await runOnce({ script, request: "click the button" });
  const rec = { ...sink.records[0], outcome: { label: "success" } };
  const [example] = examples(rec);
  const roles = example.messages.map((m) => m.role);
  assert.deepEqual(roles, ["system", "user", "assistant", "tool", "assistant"]);
  const assistant = example.messages[2];
  assert.deepEqual(assistant.tool_calls, [{ id: "x1", type: "function", function: { name: "browser", arguments: { action: "left_click", coordinate: [5, 5] } } }]);
  assert.equal(assistant.weight, 1);
  assert.equal(example.messages[4].weight, 1);
  assert.equal(example.messages[3].tool_call_id, "x1");
  assert.equal(example.tools[0].type, "function");
  assert.ok(example.tools[0].function.parameters.properties, "tool parameters are missing");

  const text = renderChatML(example);
  assert.ok(text.startsWith("<|im_start|>system\n# Tools\n\nYou have access to the following functions:\n\n<tools>\n{\"type\": \"function\", \"function\": {\"name\": \"browser\""), text.slice(0, 200));
  assert.ok(text.includes("\n</tools>\n\n"));
  assert.ok(text.includes("<|im_start|>assistant\n<think>\n\n</think>\n\n<tool_call>\n<function=browser>\n<parameter=action>\nleft_click\n</parameter>\n<parameter=coordinate>\n[5, 5]\n</parameter>\n</function>\n</tool_call><|im_end|>\n"), "the tool call is not rendered in the template's form");
  assert.ok(text.includes("<|im_start|>user\n<tool_response>\nok\n</tool_response><|im_end|>\n"));
  assert.ok(text.endsWith("<|im_start|>assistant\n<think>\n\n</think>\n\nClicked it for [email].<|im_end|>\n"), text.slice(-200));
  assert.equal((text.match(/<\|im_start\|>/g) ?? []).length, (text.match(/<\|im_end\|>/g) ?? []).length);

  // A rewritten history starts a new example, and only the replies made to it are trained.
  const later = { ...rec, steps: rec.steps.map((s, i) => (i === 1 ? { ...s, input: { prefix: 0, messages: [{ role: "user", content: [{ type: "text", text: "summary" }] }] } } : s)) };
  const split = examples(later);
  assert.equal(split.length, 2);
  assert.deepEqual(split.map((e) => e.messages.filter((m) => m.weight === 1).length), [1, 1]);

  const out = exportTrajectories([rec, { ...rec, id: "f", outcome: { label: "failure" } }, { ...rec, id: "u", outcome: { label: "unlabeled" } }], { chatml: true });
  assert.equal(out.report.examples, 1);
  assert.deepEqual(out.report.skipped, { "outcome failure": 1, "outcome unlabeled": 1 });
  assert.ok(out.report.redactedWhenRecorded.email >= 1);
  assert.equal(JSON.parse(out.train).text, text);
  assert.equal(exportTrajectories([rec], { outcomes: ["failure"] }).report.examples, 0);
  // The re-check catches text that slipped past recording (an older record, or a new pattern).
  const leaky = structuredClone(rec);
  leaky.steps[1].output.content[0].text = "Mail bob@example.org";
  const rechecked = exportTrajectories([leaky]);
  assert.equal(rechecked.report.foundByRecheck.email, 1);
  assert.ok(!rechecked.train.includes("bob@example.org"));
  assert.match(rechecked.review, /Warning: the re-check redacted more text/);

  // The command writes the three files, and only when run.
  const dir = mkdtempSync(join(tmpdir(), "browsby-export-"));
  try {
    appendTrajectories(join(dir, "in"), [rec]);
    const res = spawnSync(process.execPath, ["scripts/export-trajectories.js", join(dir, "in", "trajectories.jsonl"), "--out", join(dir, "out"), "--chatml"], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    for (const f of ["train.jsonl", "review.md", "redaction-report.json"]) assert.ok(existsSync(join(dir, "out", f)), `${f} was not written`);
    assert.equal(readFileSync(join(dir, "out", "train.jsonl"), "utf8").trim().split("\n").length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("trajectory checks passed");
