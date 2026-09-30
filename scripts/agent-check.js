#!/usr/bin/env node
// Offline checks of the agent loop with a scripted provider and browser: Stop while an
// action's safety check runs, and a history that ends in tool calls without results. Also
// the checks on keys, settings and reply rendering, and the sandbox's default-profile guard.

import assert from "node:assert/strict";
import { Agent } from "../src/agent.js";
import { providers } from "../src/providers/index.js";
import { DEFAULTS, keyProblem, mergeConfig } from "../src/config-core.js";
import { renderMarkdown } from "../ui/markdown.js";
import * as openai from "../src/providers/openai.js";
import * as ollama from "../src/providers/ollama.js";
import OpenAI from "openai";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createController } from "../src/controller.js";
import { DiscordBridge } from "../src/remote-discord.js";
import { WebSocketServer } from "ws";
import { OutlookGraph } from "../src/outlook-graph.js";
import { Guard } from "../src/guard.js";
import { formatHeaders } from "../src/browser-tools.js";

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

// A batch of form fields has its safety checks run together, and a blocked field still
// does not run.
const field = (id, value) => ({ type: "tool_call", id, name: "form_input", input: { ref: id, value } });
const filled = [];
agent.reset();
agent.browser.currentUrl = async () => "https://example.com/";
agent.browser.run = async (name, input) => (filled.push(input.value), "set");
providers.openai.classify = ({ text }) =>
  new Promise((resolve) => setTimeout(() => resolve(/"forbidden"/.test(text) ? { verdict: "block", reason: "no" } : { verdict: "allow", reason: "ok" }), 300));
replies = [
  { content: [field("f1", "a"), field("f2", "forbidden"), field("f3", "c")], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } },
  { content: [{ type: "text", text: "done" }], raw: null, stop: "end", usage: { input: 1, output: 1 } },
];
let started = Date.now();
await agent.run("fill the form", config);
const batchMs = Date.now() - started;
assert.deepEqual(filled, ["a", "c"], "the blocked field ran, or an allowed one did not");
assert.ok(batchMs < 800, `three 300ms safety checks took ${batchMs}ms, so they did not run together`);

// A safety model the account cannot use (Mistral's zero quota) fails at once instead of
// retrying, and the action falls back to asking.
let guardCalls = 0;
providers.openai.classify = async () => {
  guardCalls++;
  throw Object.assign(new Error("Rate limit exceeded"), { status: 429, headers: new Headers({ "x-ratelimit-limit-req-minute": "0" }) });
};
started = Date.now();
const blocked = await new Guard().checkAction({ config, userRequests: ["x"], page: { title: "", url: "https://example.com/" }, name: "browser", input: {} });
assert.equal(blocked.verdict, "ask");
assert.equal(guardCalls, 1, `a zero-quota safety model was retried ${guardCalls - 1} times`);
assert.ok(Date.now() - started < 500, "a zero-quota safety model was retried after a wait");

// Network recording hides sign-in headers from the model.
const shownHeaders = formatHeaders({ Cookie: "sid=1", Authorization: "Bearer x", "X-CSRF-Token": "t", "x-api-key": "k", "Content-Type": "text/html" });
assert.ok(!/sid=1|Bearer x|: t$|: k$/m.test(shownHeaders), shownHeaders);
assert.match(shownHeaders, /Content-Type: text\/html/);

// Mistral's model list: only chat models with tool support can run the agent.
const listServer = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ object: "list", data: [
    { id: "ministral-14b-latest", capabilities: { completion_chat: true, function_calling: true } },
    { id: "mistral-embed", capabilities: { completion_chat: false, function_calling: false } },
    { id: "voxtral-mini-transcribe", capabilities: { completion_chat: false, function_calling: false } },
    { id: "gpt-plain" },
  ] }));
});
await new Promise((r) => listServer.listen(0, "127.0.0.1", r));
const chatModels = await openai.listModels({ apiKey: "test", config: { ...config, openaiBaseUrl: `http://127.0.0.1:${listServer.address().port}/v1` } });
assert.deepEqual(chatModels, ["gpt-plain", "ministral-14b-latest"]);
listServer.close();

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
started = Date.now();
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
const probe = (n) => ({ type: "tool_call", id: `call_find${n}`, name: "find", input: { query: "quiz answer" } });
const notices = [];
const looping = new Agent({ emit: (e) => e.type === "notice" && notices.push(e.text), askPermission: async () => "allow" });
looping.browser = {
  ...agent.browser,
  run: async (name) => {
    if (name === "find") throw new Error("Cannot find context with specified id 12");
    return "ok";
  },
};
const loopConfig = { ...config, permissionMode: "auto" };
requests = [];
replies = Array.from({ length: 30 }, (_, n) => ({ content: [probe(n)], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } }));
await looping.run("read the quiz", loopConfig);
const loopResult = (i) => looping.messages.filter((m) => m.role === "user" && m.content[0].type === "tool_result")[i].content[0].content[0].text;
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

// Tool servers (Outlook's interface): their tools reach the model under mcp__ names,
// read-only tools skip the safety check while the others get it, and tool errors come
// back as errors.
const mcp = {
  toolDefs: () => ["read_note", "send_note", "broken"].map((n) => ({ name: `mcp__Test__${n}`, description: n, input_schema: { type: "object", properties: {} } })),
  has: (name) => name.startsWith("mcp__Test__"),
  isReadOnly: (name) => name !== "mcp__Test__send_note",
  call: async (name, input) => {
    if (name === "mcp__Test__broken") throw new Error("nope");
    return [{ type: "text", text: name === "mcp__Test__read_note" ? "note" : `sent to ${input.to}` }];
  },
};

const checked = [];
providers.openai.classify = async ({ text }) => (checked.push(text), { verdict: "allow", reason: "ok" });
const mcpCall = (id, name, input = {}) => ({ type: "tool_call", id, name, input });
agent.reset();
agent.mcp = mcp;
replies = [
  { content: [mcpCall("m1", "mcp__Test__read_note"), mcpCall("m2", "mcp__Test__send_note", { to: "ada" }), mcpCall("m3", "mcp__Test__broken")], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } },
  { content: [{ type: "text", text: "done" }], raw: null, stop: "end", usage: { input: 1, output: 1 } },
];
await agent.run("send the note to ada", config);
const mcpResults = agent.messages.flatMap((m) => m.content).filter((b) => b.type === "tool_result");
assert.equal(mcpResults[0].content[0].text, "note");
assert.equal(mcpResults[1].content[0].text, "sent to ada");
assert.ok(mcpResults[2].isError && /nope/.test(mcpResults[2].content[0].text), "a tool error did not come back as an error");
assert.equal(checked.length, 1, `expected one safety check (send_note), got ${checked.length}`);
assert.match(checked[0], /mcp__Test__send_note/);
agent.mcp = null;

// Controller: permission prompts carry ids, and remote clients are limited.
let hostConfig = { ...structuredClone(DEFAULTS), keys: { ...DEFAULTS.keys, openai: "test" } };
const controller = createController({
  loadConfig: async () => structuredClone(hostConfig),
  saveConfig: async (c) => (hostConfig = structuredClone(c)),
  loadUsage: async () => null,
  saveUsage: async () => {},
  sessions: { save: async () => {}, list: async () => [], load: async () => ({}), remove: async () => {}, removeAll: async () => {} },
  ensureBrowser: async () => {},
});
const localEvents = [];
const remoteEvents = [];
const fromLocal = controller.connect({ send: (e) => localEvents.push(e) });
const fromRemote = controller.connect({ send: (e) => remoteEvents.push(e) }, { remote: true });
const lastPrompt = () => localEvents.filter((e) => e.type === "permission_request").at(-1);
const settled = (promise) => Promise.race([promise, new Promise((r) => setTimeout(() => r("pending"), 50))]);

await fromRemote({ type: "save_config", patch: { maxSteps: 3 } });
assert.notEqual(hostConfig.maxSteps, 3, "a remote client changed settings");

const site = controller.agent.askPermission({ text: "Use a.test?", allowAlways: true, origin: "https://a.test", kind: "site" });
const siteId = lastPrompt().id;
await fromLocal({ type: "permission", decision: "once", id: "p999" });
assert.equal(await settled(site), "pending", "an answer for another prompt was accepted");
await fromRemote({ type: "permission", decision: "always", id: siteId });
assert.equal(await site, "once", "remote always was not reduced to once");
assert.ok(!hostConfig.approvedOrigins.includes("https://a.test"), "a remote answer changed the approved sites");

const password = controller.agent.askPermission({ text: "Type a password?", allowAlways: false, kind: "password" });
const passwordId = lastPrompt().id;
await fromRemote({ type: "permission", decision: "once", id: passwordId });
assert.equal(await settled(password), "pending", "a password prompt was approved remotely");
await fromLocal({ type: "permission", decision: "once", id: passwordId });
assert.equal(await password, "once");

// Input checks: a pasted block that is not a key is refused before it is saved, tested or
// sent, with a message that does not repeat it; settings are checked by type and bounds.
const pasted = "sk-proj-abc123 — from my notes\n⌘K to open\nsecond line";
const noEcho = (text) => assert.ok(!/abc123|notes|⌘|second line/.test(text), `message repeats the pasted text: ${text}`);
assert.ok(keyProblem(pasted.trim()));
noEcho(keyProblem(pasted.trim()));
assert.equal(keyProblem("sk-proj-Ab_12-xYz"), null);
localEvents.length = 0;
await fromLocal({ type: "save_config", patch: { keys: { openai: pasted } } });
assert.equal(hostConfig.keys.openai, "test", "a pasted block was saved as the key");
noEcho(localEvents.find((e) => e.type === "error").text);
await fromLocal({ type: "test_provider", provider: "openai", key: pasted });
const tested = localEvents.find((e) => e.type === "provider_test");
assert.equal(tested.ok, false);
noEcho(tested.text);
// A bad key already saved fails with a readable message, not the browser's Headers error.
const stored = await providers.anthropic.listModels({ apiKey: pasted }).catch((err) => err.message);
assert.match(stored, /saved Anthropic API key .* Settings > Models/);
noEcho(stored);

for (const patch of [
  { ollamaHost: "file:///etc/passwd" },
  { ollamaHost: "javascript:alert(1)" },
  { openaiBaseUrl: "https://user:pass@evil.example/v1" },
  { approvedOrigins: "https://bank.example https://a.test" },
  { approvedOrigins: ["javascript:alert(1)"] },
  { sensitiveSites: "mybank.example" },
  { limits: { requestsPerMinute: "abc" } },
  { limits: { taskTokens: -1 } },
  { maxSteps: 1e9 },
  { customInstructions: "x".repeat(20000) },
  { models: { gemini: "../../v1beta/files?x=" } },
  { permissionMode: "off" },
  { debugMode: "yes" },
]) {
  const before = JSON.stringify(hostConfig);
  await fromLocal({ type: "save_config", patch });
  assert.equal(JSON.stringify(hostConfig), before, `saved a bad value: ${JSON.stringify(patch).slice(0, 80)}`);
}
await fromLocal({ type: "save_config", patch: JSON.parse('{"__proto__": {"permissionMode": "auto"}, "mcpServers": [], "maxSteps": 12, "limits": {"taskTokens": 5}}') });
assert.equal(hostConfig.maxSteps, 12);
assert.equal(hostConfig.limits.taskTokens, 5);
assert.equal(hostConfig.limits.dailyTokens, DEFAULTS.limits.dailyTokens, "a partial limits patch dropped the others");
assert.ok(!("mcpServers" in hostConfig) && Object.getPrototypeOf(hostConfig) === Object.prototype);
localEvents.length = 0;
await fromLocal({ type: "run", text: "x".repeat(60000) });
assert.match(localEvents.find((e) => e.type === "error").text, /too long/);
// Values loaded from storage get the same checks and fall back to their defaults.
const loaded = mergeConfig({ approvedOrigins: "https://a.test", limits: { requestsPerMinute: Infinity }, ollamaHost: "ftp://x", maxSteps: 5 });
assert.deepEqual(loaded.approvedOrigins, []);
assert.equal(loaded.limits.requestsPerMinute, DEFAULTS.limits.requestsPerMinute);
assert.equal(loaded.ollamaHost, DEFAULTS.ollamaHost);
assert.equal(loaded.maxSteps, 5);
// Settings from older versions that no longer exist are dropped on load.
const retired = mergeConfig({ skipYoutubeAds: true, developerTools: true, maxSteps: 7 });
assert.ok(!("skipYoutubeAds" in retired) && !("developerTools" in retired), "a retired setting survived loading");
assert.equal(retired.maxSteps, 7);
// Sensitive sites saved before these checks keep working: addresses become hostnames and
// only unusable entries are dropped.
assert.deepEqual(mergeConfig({ sensitiveSites: ["https://MyBank.example/login", "*.pay.example", "not a site", 7] }).sensitiveSites, ["mybank.example", "*.pay.example"]);

// Reply rendering: markup is escaped, only http(s) links become links, and a URL inside a
// link cannot add attributes to it.
for (const reply of [
  "[click](https://a.example/(https://b.example/style=position:fixed;inset:0)",
  '[x](javascript:alert(1)) <img src=x onerror=alert(1)> https://ok.example/"onmouseover=alert(1)',
  "**[a](https://a.example)** *https://b.example/*x*",
]) {
  const html = renderMarkdown(reply);
  for (const [tag] of html.matchAll(/<[^>]*>/g)) {
    assert.match(tag, /^<\/?(p|ul|ol|li|code|strong|em|a)>$|^<a href="https:\/\/[^"<>\s]+" target="_blank" rel="noopener noreferrer">$/, `unsafe markup: ${html}`);
  }
}

// Discord bridge against a local stand-in for Discord's gateway and API: pairing only with
// the code, only the owner's messages and button presses count, a task started from
// Discord reports its prompt and reply there, and the token never reaches the UI.
const discordCalls = [];
let messageIds = 0;
const discordApi = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    discordCalls.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : null, auth: req.headers.authorization });
    const json = (value) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (req.url === "/users/@me/channels") return json({ id: "dm1" });
    if (req.url.startsWith("/channels/dm1/messages") && req.method === "POST") return json({ id: `m${++messageIds}` });
    if (req.url.startsWith("/interactions/")) return res.writeHead(204).end();
    json({});
  });
});
await new Promise((r) => discordApi.listen(0, "127.0.0.1", r));
const gateway = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise((r) => gateway.once("listening", r));
let gatewaySocket;
gateway.on("connection", (socket) => {
  gatewaySocket = socket;
  socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));
  socket.on("message", (data) => {
    const msg = JSON.parse(data);
    if (msg.op === 2 && msg.d.token === "bot-token") socket.send(JSON.stringify({ op: 0, s: 1, t: "READY", d: { user: { id: "b1", username: "duomo-bot" } } }));
  });
});
const dispatch = (t, d) => gatewaySocket.send(JSON.stringify({ op: 0, s: 2, t, d }));
const dm = (userId, content) => dispatch("MESSAGE_CREATE", { channel_id: "dm1", author: { id: userId, username: userId }, content });
const press = (userId, customId) =>
  dispatch("INTERACTION_CREATE", { type: 3, id: `i${Math.random()}`, token: "t", user: { id: userId }, data: { custom_id: customId }, message: { content: "prompt" } });
const until = async (test, what) => {
  for (let i = 0; i < 100 && !test(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(test(), what);
};
const sentTexts = () => discordCalls.filter((c) => c.path === "/channels/dm1/messages" && c.method === "POST").map((c) => c.body.content);

const bridge = new DiscordBridge({
  controller,
  loadConfig: async () => structuredClone(hostConfig),
  saveConfig: async (c) => (hostConfig = structuredClone(c)),
  api: `http://127.0.0.1:${discordApi.address().port}`,
  gateway: `ws://127.0.0.1:${gateway.address().port}`,
});
await bridge.configure("bot-token");
await until(() => bridge.state === "connected", "the bridge did not connect");
const code = hostConfig.discord.pairCode;
assert.ok(!JSON.stringify(await bridge.status()).includes("bot-token"), "the bot token reached the UI status");

dm("stranger", "WRONGCODE");
dm("owner", code);
await until(() => hostConfig.discord.userId === "owner", "the pairing code did not pair the owner");
assert.match(sentTexts().at(-1), /Paired/);

controller.agent.browser = agent.browser;
agent.browser.currentUrl = async () => "https://example.com/";
agent.browser.run = async () => "clicked";
providers.openai.classify = async () => ({ verdict: "ask", reason: "check with the user" });
providers.openai.turn = async () => replies.shift();
replies = [
  { content: [{ type: "tool_call", id: "d1", name: "browser", input: { action: "left_click", coordinate: [1, 1] } }], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } },
  { content: [{ type: "text", text: "all done" }], raw: null, stop: "end", usage: { input: 1, output: 1 } },
];
dm("stranger", "delete everything");
dm("owner", "click the button");
await until(() => discordCalls.some((c) => c.body?.components), "no prompt with buttons reached Discord");
const promptCall = discordCalls.find((c) => c.body?.components);
const allow = promptCall.body.components[0].components.find((b) => b.label === "Allow").custom_id;
press("stranger", allow);
await until(() => discordCalls.some((c) => c.body?.data?.content === "Not for you."), "a stranger's button press was not refused");
press("owner", allow);
await until(() => sentTexts().includes("all done"), "the final reply did not reach Discord");
assert.ok(!sentTexts().some((t) => /delete everything/.test(t)), "a stranger's message was acted on");
assert.ok(discordCalls.every((c) => c.auth === "Bot bot-token"), "a request went out without the bot token");
bridge.stop();
gateway.close();
discordApi.close();

// Web search: the provider's search tool is in the request only when the setting is on,
// and assistant turns holding search items are replayed exactly. The real SDKs run
// against a fetch that records each request body and answers with a canned stream.
const { turn: anthropicTurn } = await import("../src/providers/anthropic.js");
const { isBotCheck } = await import("../src/browser-tools.js");
const { SYSTEM_PROMPT } = await import("../src/prompt.js");
const realFetch = globalThis.fetch;
const bodies = [];
let sse = [];
globalThis.fetch = async (url, init) => {
  bodies.push(JSON.parse(init.body));
  const text = sse.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
};
const noop = () => {};
const userTurn = [{ role: "user", content: [{ type: "text", text: "who won" }] }];
const searchTools = (body) => body.tools.filter((t) => t.type !== "function" && !t.input_schema);

const searched = [
  { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "nobel literature" } },
  { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://www.nobelprize.org/", title: "Nobel", encrypted_content: "enc", page_age: null }] },
  { type: "text", text: "It was ", citations: null },
  { type: "text", text: "someone.", citations: [{ type: "web_search_result_location", url: "https://www.nobelprize.org/", title: "Nobel", encrypted_index: "idx", cited_text: "x" }] },
];
sse = [
  { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } },
  ...searched.flatMap((block, index) => [
    { type: "content_block_start", index, content_block: block },
    { type: "content_block_stop", index },
  ]),
  { type: "message_delta", delta: { stop_reason: "pause_turn" }, usage: { output_tokens: 5, server_tool_use: { web_search_requests: 1 } } },
  { type: "message_stop" },
];
const aConfig = { ...config, thinking: false };
const aTurn = (cfg, messages) => anthropicTurn({ apiKey: "test", model: "claude-sonnet-4-6", config: cfg, system: "s", tools: [], messages, signal: undefined, onText: noop, onThinking: noop });
const paused = await aTurn(aConfig, userTurn);
assert.deepEqual(searchTools(bodies.at(-1)), [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]);
assert.equal(paused.stop, "pause", "pause_turn did not map to pause");
assert.deepEqual(paused.content, [{ type: "text", text: "It was someone." }], "cited text blocks were not joined");
await aTurn(aConfig, [...userTurn, { role: "assistant", content: paused.content, raw: paused.raw }]);
assert.deepEqual(bodies.at(-1).messages[1].content.slice(0, 2), searched.slice(0, 2), "Anthropic search blocks were not replayed");
await aTurn({ ...aConfig, webSearch: false }, userTurn);
assert.equal(searchTools(bodies.at(-1)).length, 0, "Anthropic web search sent with the setting off");

const searchCall = { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "nobel literature" } };
const answer = { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "It was someone.", annotations: [] }] };
const response = { id: "resp_1", object: "response", status: "completed", model: "gpt-test", output: [searchCall, answer], usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0 } } };
sse = [
  { type: "response.created", sequence_number: 0, response: { ...response, status: "in_progress", output: [] } },
  { type: "response.output_item.added", sequence_number: 1, output_index: 0, item: searchCall },
  { type: "response.output_item.done", sequence_number: 2, output_index: 0, item: searchCall },
  { type: "response.output_item.added", sequence_number: 3, output_index: 1, item: { ...answer, content: [] } },
  { type: "response.content_part.added", sequence_number: 4, output_index: 1, item_id: "msg_1", content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
  { type: "response.output_text.delta", sequence_number: 5, output_index: 1, item_id: "msg_1", content_index: 0, delta: "It was someone." },
  { type: "response.output_item.done", sequence_number: 6, output_index: 1, item: answer },
  { type: "response.completed", sequence_number: 7, response },
];
const oTurn = (cfg, messages) => openai.turn({ apiKey: "test", model: "gpt-test", config: cfg, system: "s", tools: [], messages, signal: undefined, onText: noop, onThinking: noop });
const oResult = await oTurn(config, userTurn);
assert.deepEqual(searchTools(bodies.at(-1)), [{ type: "web_search" }]);
assert.deepEqual(oResult.content, [{ type: "text", text: "It was someone." }]);
await oTurn(config, [...userTurn, { role: "assistant", content: oResult.content, raw: oResult.raw }]);
assert.deepEqual(bodies.at(-1).input[1], searchCall, "OpenAI web_search_call was not replayed");
await oTurn({ ...config, webSearch: false }, userTurn);
assert.equal(searchTools(bodies.at(-1)).length, 0, "OpenAI web search sent with the setting off");
// A custom base URL speaks Chat Completions, which has no hosted search.
sse = [];
globalThis.fetch = async (url, init) => (bodies.push(JSON.parse(init.body)), new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
await oTurn({ ...config, openaiBaseUrl: "http://127.0.0.1:9/v1" }, userTurn);
assert.ok(bodies.at(-1).tools.every((t) => t.type === "function"), "Chat Completions got a hosted search tool");
globalThis.fetch = realFetch;

assert.ok(!SYSTEM_PROMPT.includes("google.com/search"), "the prompt still sends the model to Google result pages");
assert.ok(isBotCheck("https://www.google.com/sorry/index?continue=x"));
assert.ok(isBotCheck("https://example.com/", "Just a moment..."));
assert.ok(isBotCheck("https://html.duckduckgo.com/html/?q=a", "a at DuckDuckGo", "Unfortunately, bots use DuckDuckGo too."));
assert.ok(!isBotCheck("https://en.wikipedia.org/wiki/CAPTCHA", "CAPTCHA - Wikipedia", "Are you a robot? ".repeat(200)), "a long article was taken for a bot check");
// Outlook through Microsoft Graph against a local stand-in for the token endpoint and
// Graph: request shapes, renewal on expiry and on a rejected token, errors, and tokens
// kept out of results and status.
const graphCalls = [];
let graphAccess = "at1";
const graphServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    graphCalls.push({ method: req.method, url: req.url, body, auth: req.headers.authorization, prefer: req.headers.prefer });
    const json = (status, value) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (req.url === "/auth/token") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "authorization_code") return json(200, { access_token: graphAccess, refresh_token: "rt1", expires_in: 3600 });
      if (form.get("refresh_token") === "rt-revoked") return json(400, { error: "invalid_grant", error_description: "AADSTS70000: revoked" });
      graphAccess = `at${graphCalls.length}`;
      return json(200, { access_token: graphAccess, refresh_token: "rt2", expires_in: 3600 });
    }
    if (req.headers.authorization !== `Bearer ${graphAccess}`) return json(401, { error: { code: "InvalidAuthenticationToken", message: "expired" } });
    const path = req.url.replace(/^\/graph/, "");
    if (path.startsWith("/me?")) return json(200, { userPrincipalName: "ada@example.edu" });
    if (path.startsWith("/me/mailFolders/inbox/messages")) return json(200, { value: [{ id: "m1", subject: "Hi", from: { emailAddress: { address: "bob@x.test" } }, receivedDateTime: "2026-09-28T10:00:00Z", bodyPreview: "hello", isRead: false }] });
    if (path.startsWith("/me/messages/m1?")) return json(200, { subject: "Hi", from: { emailAddress: { address: "bob@x.test" } }, toRecipients: [], ccRecipients: [], receivedDateTime: "t", body: { content: "Body text" } });
    if (path === "/me/messages/m1/createReply") return json(201, { id: "d1" });
    if (path === "/me/messages/d1/send") return res.writeHead(202).end();
    if (path.startsWith("/me/calendarView")) return json(200, { value: [] });
    if (path === "/me/events") return json(201, { subject: "Lunch", start: { dateTime: "2026-09-29T12:00:00.0000000" } });
    json(404, { error: { code: "ErrorItemNotFound", message: "The specified object was not found in the store." } });
  });
});
await new Promise((r) => graphServer.listen(0, "127.0.0.1", r));
const graphBase = `http://127.0.0.1:${graphServer.address().port}`;
let outlookAuth = null;
// Microsoft's page, as chrome.identity would show it: answers with a code for the state
// it was given, or fails when there is no signed-in session to reuse silently.
let signInPage = null;
const outlook = new OutlookGraph({
  clientId: "client-1",
  loadAuth: async () => structuredClone(outlookAuth),
  saveAuth: async (a) => (outlookAuth = structuredClone(a)),
  redirectUri: "https://abc.chromiumapp.org/",
  launchAuth: async (url, interactive) => {
    signInPage = new URL(url);
    if (!interactive) throw new Error("User interaction required.");
    return `https://abc.chromiumapp.org/?code=c1&state=${signInPage.searchParams.get("state")}`;
  },
  authority: `${graphBase}/auth`,
  graph: `${graphBase}/graph`,
});
await outlook.init();
assert.equal(outlook.toolDefs().length, 0, "Outlook tools offered before sign-in");
assert.equal(await outlook.signIn(), "ada@example.edu");
assert.equal(signInPage.searchParams.get("code_challenge_method"), "S256");
assert.equal(signInPage.searchParams.get("client_id"), "client-1");
assert.equal(signInPage.searchParams.get("redirect_uri"), "https://abc.chromiumapp.org/");
assert.match(signInPage.searchParams.get("scope"), /offline_access.*Mail\.Send/);
const redeemForm = new URLSearchParams(graphCalls[0].body);
const verifierHash = createHash("sha256").update(redeemForm.get("code_verifier")).digest("base64url");
assert.equal(verifierHash, signInPage.searchParams.get("code_challenge"), "the PKCE verifier does not match its challenge");
assert.equal(redeemForm.get("grant_type"), "authorization_code");
await assert.rejects(
  new OutlookGraph({ loadAuth: async () => null, saveAuth: async () => {}, launchAuth: async (url) => `https://abc.chromiumapp.org/?code=x&state=forged`, clientId: "c" }).signIn(),
  /unexpected answer/,
);
await assert.rejects(new OutlookGraph({ loadAuth: async () => null, saveAuth: async () => {}, clientId: "" }).signIn(), /not set up/);
// Without a client id (and so without the identity permission), a sign-in stored by an
// earlier build gives the model no Outlook tools.
const unconfigured = new OutlookGraph({ loadAuth: async () => ({ refreshToken: "r" }), saveAuth: async () => {}, clientId: "" });
await unconfigured.init();
assert.equal(unconfigured.toolDefs().length, 0, "Outlook tools offered without a client id");
assert.equal((await unconfigured.status()).signedIn, false);
assert.ok(JSON.stringify(outlook.toolDefs()).length < 2500, "Outlook tool definitions grew past a few hundred tokens");
assert.ok(outlook.isReadOnly("mcp__outlook__mail_read") && !outlook.isReadOnly("mcp__outlook__send"), "send must count as an action");
const listed = (await outlook.call("mcp__outlook__mail_search", {}))[0].text;
assert.match(listed, /id: m1[\s\S]*bob@x\.test \(unread\)/);
assert.match(graphCalls.at(-1).url, /\/me\/mailFolders\/inbox\/messages\?\$orderby=receivedDateTime%20desc&\$top=10/);
assert.match((await outlook.call("mcp__outlook__mail_read", { id: "m1" }))[0].text, /Body text/);
assert.equal(graphCalls.at(-1).prefer, 'outlook.body-content-type="text"');
// An expired access token is renewed with the refresh token before the request.
outlookAuth.expiresAt = 0;
assert.match((await outlook.call("mcp__outlook__draft", { body: "Thanks!", reply_to_id: "m1" }))[0].text, /draft_id: d1/);
assert.equal(new URLSearchParams(graphCalls.at(-2).body).get("refresh_token"), "rt1");
assert.equal(JSON.parse(graphCalls.at(-1).body).comment, "Thanks!");
assert.equal(outlookAuth.refreshToken, "rt2");
// A rejected access token is renewed once and the request retried.
graphAccess = "server-side-rotation";
assert.equal((await outlook.call("mcp__outlook__send", { draft_id: "d1" }))[0].text, "Sent.");
assert.equal(graphCalls.at(-1).url, "/graph/me/messages/d1/send");
await outlook.call("mcp__outlook__events", { start: "2026-09-29", end: "2026-09-30" });
assert.ok(new URL(graphCalls.at(-1).url, graphBase).searchParams.get("startDateTime").endsWith("Z"), "calendar range not sent as UTC");
const created = await outlook.call("mcp__outlook__event_create", { subject: "Lunch", start: "2026-09-29T12:00", end: "2026-09-29T13:00" });
assert.match(created[0].text, /Lunch/);
assert.ok(JSON.parse(graphCalls.at(-1).body).start.timeZone, "event created without a time zone");
await assert.rejects(outlook.call("mcp__outlook__mail_read", { id: "missing" }), /Outlook: The specified object was not found/);
const status = await outlook.status();
assert.ok(status.signedIn && !JSON.stringify(status).match(/rt2|at\d/), "Outlook status leaked a token");
// A revoked refresh token signs out, with a message the model can relay.
outlookAuth = { ...outlookAuth, refreshToken: "rt-revoked", expiresAt: 0 };
await assert.rejects(outlook.call("mcp__outlook__mail_search", {}), /sign in again/);
assert.equal(signInPage.searchParams.get("prompt"), "none", "a failed refresh did not try a silent sign-in first");
assert.equal(outlookAuth, null);
assert.equal(outlook.has("mcp__outlook__mail_search"), false);
graphServer.close();

// The sandbox refuses the default profile when run without a terminal and no
// BROWSER_AGENT_HOME, and runs on a separate home.
const launcher = (env) =>
  spawnSync(process.execPath, [new URL("../bin/browser-agent.js", import.meta.url).pathname, "status"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const { BROWSER_AGENT_HOME: _, ...defaultEnv } = process.env;
const refused = launcher(defaultEnv);
assert.equal(refused.status, 1);
assert.match(refused.stderr, /Refusing to use the default profile/);
const sandboxHome = mkdtempSync(join(tmpdir(), "browser-agent-check-"));
const allowed = launcher({ ...defaultEnv, BROWSER_AGENT_HOME: sandboxHome });
rmSync(sandboxHome, { recursive: true, force: true });
assert.equal(allowed.status, 0, allowed.stderr);
assert.match(allowed.stdout, /Not running/);

// A sensitive-site prompt names what the action targets, and a decline tells the model to ask.
const sensitivePrompts = [];
const onBank = new Agent({ emit: () => {}, askPermission: async ({ text }) => (sensitivePrompts.push(text), "deny") });
onBank.browser = {
  ...agent.browser,
  currentUrl: async () => "https://www.paypal.com/us/home",
  currentPage: async () => ({ id: "t1", title: "PayPal", url: "https://www.paypal.com/us/home" }),
  describeTarget: async () => 'a "Sign Up"',
};
replies = [
  { content: [{ type: "tool_call", id: "c1", name: "browser", input: { action: "left_click", ref: "3" } }], raw: null, stop: "tool_use", usage: { input: 1, output: 1 } },
  { content: [{ type: "text", text: "ok" }], raw: null, stop: "end", usage: { input: 1, output: 1 } },
];
await onBank.run("sign up", { ...config, permissionMode: "auto" });
assert.match(sensitivePrompts[0], /left_click on a "Sign Up"\?$/);
// A bare-number ref is read as ref_N before any check sees it.
assert.equal(onBank.messages.at(-3).content[0].input.ref, "ref_3");
assert.match(onBank.messages.at(-2).content[0].content[0].text, /declined acting on www\.paypal\.com\. Do not retry/);

// An Ollama server that is not running, as the browser reports it.
assert.match(ollama.describeError(new TypeError("Failed to fetch")), /Is it running/);

// Running out of credit mid-stream arrives as an error event with no HTTP status.
const noCredit = new OpenAI.APIError(undefined, { code: "insufficient_quota", type: "insufficient_quota", message: "No credits." }, "No credits.", undefined);
assert.match(openai.describeError(noCredit), /^OpenAI account is out of credit/);
assert.equal(openai.describeError(new OpenAI.APIError(undefined, { message: "x" }, "x", undefined)), "OpenAI error: x");

console.log("agent checks passed");
