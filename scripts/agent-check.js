#!/usr/bin/env node
// Offline checks of the agent loop with a scripted provider and browser: Stop while an
// action's safety check runs, and a history that ends in tool calls without results.

import assert from "node:assert/strict";
import { Agent } from "../src/agent.js";
import { providers } from "../src/providers/index.js";
import { DEFAULTS } from "../src/config-core.js";

const config = { ...structuredClone(DEFAULTS), keys: { ...DEFAULTS.keys, openai: "test" } };
const click = { type: "tool_call", id: "call_click", name: "browser", input: { action: "left_click", coordinate: [5, 5] } };
let requests = [];
let replies = [];
providers.openai = {
  describeError: () => null,
  turn: async ({ messages, signal }) => {
    requests.push(structuredClone(messages));
    if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    return replies.shift();
  },
  // The safety check takes a moment and fails when the task is stopped, like a real request.
  classify: ({ signal }) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ verdict: "allow", reason: "ok" }), 200);
      signal?.addEventListener("abort", () => (clearTimeout(timer), reject(new Error("Request was aborted."))));
    }),
};

let actions = 0;
let prompts = 0;
const agent = new Agent({ emit: () => {}, askPermission: async () => (prompts++, "allow") });
agent.browser = {
  setAdSkipping: async () => {},
  startTask: async () => {},
  endTask: async () => {},
  currentPage: async () => ({ id: "t1", title: "Page", url: "https://example.com/" }),
  currentUrl: async () => "https://example.com/",
  describeTarget: async () => null,
  callInPage: async () => false,
  run: async () => (actions++, "clicked"),
};

// Stop during the safety check: no prompt, no click, and a history that ends in results.
replies = [{ content: [click], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } }];
const run = agent.run("click it", config);
setTimeout(() => agent.stop(), 50);
await run;
assert.equal(prompts, 0, "a stopped safety check must not ask for permission");
assert.equal(actions, 0, "a stopped action must not run");
assert.equal(agent.messages.at(-1).content[0].type, "tool_result");
assert.equal(agent.messages.at(-1).content[0].isError, true);

// A history ending in an unanswered call (a reopened mid-task save) is repaired first.
agent.restore({ messages: [{ role: "user", content: [{ type: "text", text: "click it" }] }, { role: "assistant", content: [click], raw: null }] });
requests = [];
replies = [{ content: [{ type: "text", text: "done" }], raw: null, stop: "end", usage: { input: 1, output: 1 } }];
await agent.run("next", config);
const sent = requests[0];
assert.ok(!sent.some((m) => m.role === "assistant" && m.content.some((b) => b.type === "tool_call" && b.id === "call_click")), "unanswered call was sent");
assert.equal(sent.at(-1).role, "user");

console.log("agent checks passed");
