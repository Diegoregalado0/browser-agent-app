#!/usr/bin/env node
// Offline checks of the agent loop with a scripted provider and browser: Stop while an
// action's safety check runs, and a history that ends in tool calls without results.

import assert from "node:assert/strict";
import { Agent } from "../src/agent.js";
import { providers } from "../src/providers/index.js";
import { DEFAULTS } from "../src/config-core.js";
import * as openai from "../src/providers/openai.js";
import { explainScriptError } from "../src/browser-tools.js";
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

// Compaction: once requests grow large, older long tool output and screenshots are trimmed
// in one pass, the latest messages are kept whole, and no pass runs again until the
// request has grown by half.
const read = (id) => ({ type: "tool_call", id, name: "get_page_text", input: {} });
const longText = "x".repeat(20000);
let sizes = [5000, 13000, 14000, 16000, 20000, 1000];
replies = ["a", "b", "c", "d", "e"].map((id) => ({ content: [read(id)], raw: null, stop: "tool_use", usage: { input: sizes.shift(), output: 1 } }));
replies.push({ content: [{ type: "text", text: "done" }], raw: null, stop: "end", usage: { input: sizes.shift(), output: 1 } });
agent.reset();
agent.browser.run = async () => [{ type: "text", text: longText }, { type: "image", mediaType: "image/jpeg", data: "AAAA" }];
requests = [];
const lengths = [];
providers.openai.turn = async ({ messages }) => {
  lengths.push(JSON.stringify(messages).length);
  requests.push(structuredClone(messages));
  return replies.shift();
};
await agent.run("read them", config);
const resultText = (m) => m.content.find((b) => b.type === "tool_result")?.content[0].text.length;
// Request 3 follows a 13000-token request, but every result is still recent: nothing changes.
assert.equal(resultText(requests[2][2]), 20000, "recent tool output was trimmed");
// Request 4 follows 14000: the oldest result is trimmed, the latest ones are kept whole.
assert.ok(resultText(requests[3][2]) < 2000, "old tool output was not trimmed");
assert.ok(requests[3][2].content[0].content.every((b) => b.type !== "image"), "old screenshot was kept");
assert.equal(resultText(requests[3].at(-1)), 20000, "the latest tool output was trimmed");
// Requests 5 and 6 follow 16000 and 20000 (< 14000 * 1.5): no new pass, so the prefix sent
// in request 4 stays exactly the same and remains cacheable.
assert.deepEqual(requests[5].slice(0, requests[3].length), requests[3], "compaction ran again too soon");

// Site notes ride along with the first tool result on a matching site, once per conversation.
agent.reset();
agent.browser.run = async () => "done";
agent.browser.currentUrl = async () => "https://catcourses.ucmerced.edu/courses/1";
providers.openai.turn = async ({ messages }) => {
  requests.push(structuredClone(messages));
  return replies.shift();
};
requests = [];
replies = [
  { content: [read("g1")], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } },
  { content: [read("g2")], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } },
  { content: [{ type: "text", text: "done" }], raw: null, stop: "end", usage: { input: 1, output: 1 } },
];
await agent.run("check my courses", config);
const notes = JSON.stringify(requests.at(-1)).match(/Site notes for CatCourses/g) ?? [];
assert.equal(notes.length, 1, "CatCourses notes were not given exactly once");

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

// Loop guard: a call that keeps failing the same way gets a note telling the model to
// change approach, and the task stops before it burns the step budget.
const probe = (n) => ({ type: "tool_call", id: `call_js${n}`, name: "javascript_exec", input: { code: "document.querySelector('iframe').contentDocument.title" } });
const nullError = "TypeError: Cannot read properties of null (reading 'contentDocument')\n    at <anonymous>:1:33";
const notices = [];
const looping = new Agent({ emit: (e) => e.type === "notice" && notices.push(e.text), askPermission: async () => "allow" });
looping.browser = {
  ...agent.browser,
  run: async (name) => {
    if (name === "javascript_exec") throw new Error(explainScriptError(nullError));
    return "ok";
  },
};
const loopConfig = { ...config, developerTools: true, permissionMode: "auto" };
requests = [];
replies = Array.from({ length: 30 }, (_, n) => ({ content: [probe(n)], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } }));
await looping.run("read the quiz", loopConfig);
const loopResult = (i) => looping.messages.filter((m) => m.role === "user" && m.content[0].type === "tool_result")[i].content[0].content[0].text;
assert.match(loopResult(0), /selector matched no element.*iframe itself/s, "javascript_exec null errors explain the cause");
assert.doesNotMatch(loopResult(0), /Loop check/, "a single failure gets no loop note");
assert.match(loopResult(1), /Loop check.*already failed/s, "a repeated failing call gets a loop note");
assert.equal(requests.length, 5, `the stuck task made ${requests.length} model requests, expected it to stop after 5`);
assert.ok(notices.some((t) => /seems stuck/.test(t)), "the user is told the task stopped");

// A page read that keeps returning the same thing between actions gets a note too.
const readCall = { type: "tool_call", id: "call_read", name: "read_page", input: {} };
looping.browser.run = async () => "same outline";
replies = [readCall, click, readCall, click, readCall].map((c) => ({ content: [c], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } }));
replies.push({ content: [{ type: "text", text: "done" }], raw: null, stop: "end", usage: { input: 1, output: 1 } });
await looping.run("next page", loopConfig);
const reads = looping.messages.flatMap((m) => m.content).filter((b) => b.type === "tool_result" && b.name === "read_page");
assert.equal(reads.at(-1).content.at(-1).text.startsWith("[Loop check]"), true, "a repeated identical read gets a loop note");

console.log("agent checks passed");
