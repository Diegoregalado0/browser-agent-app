#!/usr/bin/env node
// Offline checks of the agent loop with a scripted provider and browser: Stop while an
// action's safety check runs, and a history that ends in tool calls without results.

import assert from "node:assert/strict";
import { Agent } from "../src/agent.js";
import { providers } from "../src/providers/index.js";
import { DEFAULTS } from "../src/config-core.js";
import * as openai from "../src/providers/openai.js";
import { createServer } from "node:http";

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

// OpenAI pacing, against a local server that answers like the API: after a response
// reports an empty token budget, the next request waits for it to refill, and a 429 is
// not retried instantly by the SDK.
let hits = 0;
let reply429 = false;
const server = createServer((req, res) => {
  hits++;
  req.resume();
  req.on("end", () => {
    const headers = { "content-type": "application/json", "x-ratelimit-limit-tokens": "1000", "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "2s" };
    if (reply429) {
      res.writeHead(429, headers).end(JSON.stringify({ error: { message: "Rate limit reached", type: "tokens" } }));
      return;
    }
    res.writeHead(200, headers).end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { total_tokens: 10 } }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const pacingConfig = { openaiBaseUrl: `http://127.0.0.1:${server.address().port}/v1` };
const ask = () => openai.classify({ apiKey: "test", model: "pace-test", config: pacingConfig, system: "s", text: "t", schema: {} });
await ask();
let started = Date.now();
await ask();
const waited = Date.now() - started;
assert.ok(waited >= 800, `request after an empty budget waited only ${waited}ms`);
reply429 = true;
hits = 0;
await new Promise((r) => setTimeout(r, 2100));
await assert.rejects(ask);
assert.equal(hits, 1, "a 429 was retried by the SDK");
server.close();

console.log("agent checks passed");
