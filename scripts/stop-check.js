#!/usr/bin/env node
// Offline checks of Stop, with a scripted provider and browser: Stop ends a task whose
// model request, browser action or safety check never returns, and nothing of that task
// reaches the user or the history afterwards.

import assert from "node:assert/strict";
import { Agent } from "../src/agent.js";
import { providers } from "../src/providers/index.js";
import { DEFAULTS } from "../src/config-core.js";

const config = { ...structuredClone(DEFAULTS), keys: { ...DEFAULTS.keys, openai: "test" } };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const click = (id) => ({ type: "tool_call", id, name: "browser", input: { action: "left_click", coordinate: [5, 5] } });
const done = { content: [{ type: "text", text: "done" }], raw: null, stop: "end", usage: { input: 1, output: 1 } };

// A provider whose turns follow a script: a reply, or "hang", a request that ignores its
// abort signal and returns only when the check releases it.
let script = [];
let hung = [];
let classify = async () => ({ verdict: "allow", reason: "ok" });
providers.openai = {
  describeError: () => null,
  turn: ({ onText }) => {
    const next = script.shift();
    if (next !== "hang") return Promise.resolve(next);
    return new Promise((resolve) => hung.push((reply) => (onText("late text"), resolve(reply))));
  },
  classify: (args) => classify(args),
};

const events = [];
let actions = 0;
let hangActions = false;
const heldActions = [];
const log = [];
let endTaskMs = 0;
const agent = new Agent({ emit: (e) => events.push(e), askPermission: async () => "allow" });
agent.browser = {
  startTask: async () => log.push("start"),
  endTask: async () => {
    await tick(endTaskMs);
    log.push("end");
  },
  currentPage: async () => ({ id: "t1", title: "Page", url: "https://example.com/" }),
  currentUrl: async () => "https://example.com/",
  describeTarget: async () => null,
  targetFrame: async () => null,
  callInPage: async () => false,
  run: () => (actions++, hangActions ? new Promise((resolve) => heldActions.push(resolve)) : Promise.resolve("clicked")),
};

// A request that never returns: Stop ends the task at once, with its notice and status,
// and drops the unanswered request from the history.
const auto = { ...config, permissionMode: "auto" };
script = ["hang"];
const first = agent.run("open the page", auto);
await tick();
assert.equal(agent.running, true);
endTaskMs = 100;
agent.stop();
assert.equal(agent.running, false, "Stop left the task running");
assert.ok(events.some((e) => e.type === "notice" && e.text === "Stopped."));
assert.deepEqual(events.at(-1), { type: "status", running: false });
assert.deepEqual(agent.messages, [], "the unanswered request stayed in the history");

// The next task starts at once, after the stopped task's browser release.
script = [done];
await agent.run("try again", auto);
endTaskMs = 0;
assert.deepEqual(log, ["start", "end", "start", "end"], "the next task began before the stopped one released the browser");
assert.deepEqual(agent.messages.map((m) => m.role), ["user", "assistant"]);
assert.equal(agent.messages[1].content[0].text, "done");

// The hung request returns late with text and a tool call: none of it is shown, written
// or run.
const eventsBefore = events.length;
const historyBefore = JSON.stringify(agent.messages);
hung.shift()({ content: [click("late_click")], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } });
await first;
await tick();
assert.equal(events.length, eventsBefore, `the stopped task emitted ${JSON.stringify(events.slice(eventsBefore))}`);
assert.equal(JSON.stringify(agent.messages), historyBefore, "the stopped task wrote to the history");
assert.equal(actions, 0, "the stopped task ran an action");
assert.equal(log.filter((l) => l === "end").length, 2, "the stopped task released the browser again");

// A browser action that never returns: Stop closes the tool round with a result for each
// call, so the history is valid for the next request, and the late result is dropped.
agent.reset();
events.length = 0;
hangActions = true;
script = [{ content: [click("c1")], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } }];
const second = agent.run("click it", auto);
await tick();
assert.equal(heldActions.length, 1);
agent.stop();
assert.equal(agent.running, false);
const closing = agent.messages.at(-1);
assert.equal(closing.role, "user");
assert.equal(closing.content[0].type, "tool_result");
assert.equal(closing.content[0].id, "c1");
assert.equal(closing.content[0].isError, true);
hangActions = false;
script = [done];
await agent.run("never mind", auto);
const settled = JSON.stringify(agent.messages);
const settledEvents = events.length;
heldActions.shift()("clicked late");
await second;
await tick();
assert.equal(JSON.stringify(agent.messages), settled, "a late action result reached the history");
assert.equal(events.length, settledEvents, "a late action result was shown");
assert.deepEqual(agent.messages.map((m) => m.role), ["user", "assistant", "user", "user", "assistant"]);

// A safety check that never returns: Stop ends the task, the action never runs, and no
// prompt or guard verdict appears later.
agent.reset();
events.length = 0;
actions = 0;
const heldChecks = [];
classify = () => new Promise((resolve) => heldChecks.push(resolve));
script = [{ content: [click("c2")], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } }];
let prompts = 0;
agent.askPermission = async () => (prompts++, "allow");
const third = agent.run("click it", config);
await tick();
assert.equal(heldChecks.length, 1);
agent.stop();
assert.equal(agent.running, false);
const checkEvents = events.length;
heldChecks.shift()({ verdict: "ask", reason: "late" });
await third;
await tick();
assert.equal(events.length, checkEvents, "the stopped check emitted events");
assert.equal(prompts, 0, "the stopped check asked for permission");
assert.equal(actions, 0, "the stopped check let the action run");
classify = async () => ({ verdict: "allow", reason: "ok" });

console.log("stop checks passed");
