#!/usr/bin/env node
// Offline check of Gemini through Vertex AI with an OAuth access token: with a project set,
// a turn and a safety check go to that project's global Vertex endpoint with the token as a
// bearer token and an empty API-key header, under both the Node and the browser (extension)
// builds of the SDK; without one they still go to the Gemini API with the key.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROVIDER = new URL("../src/providers/gemini.js", import.meta.url).href;

const probe = `
  const { turn, classify } = await import(${JSON.stringify(PROVIDER)});
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const h = new Headers(init.headers);
    seen.push({ url: String(url), auth: h.get("authorization"), key: h.get("x-goog-api-key") });
    throw new Error("stub");
  };
  const tools = [{ name: "noop", description: "Does nothing.", input_schema: { type: "object", properties: {} } }];
  const messages = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
  for (const config of [{ thinking: false, geminiVertexProject: "demo-project-1" }, { thinking: false }]) {
    await turn({ apiKey: "TOKEN", model: "gemini-3.8-flash", config, system: "s", tools, messages }).catch(() => {});
    await classify({ apiKey: "TOKEN", model: "gemini-3.5-flash-lite", config, system: "s", text: "t", schema: { type: "object" } }).catch(() => {});
  }
  console.log(JSON.stringify(seen));
`;

for (const conditions of [[], ["--conditions=browser"]]) {
  const res = spawnSync(process.execPath, [...conditions, "--input-type=module", "-e", probe], { encoding: "utf8", cwd: fileURLToPath(new URL("..", import.meta.url)) });
  assert.equal(res.status, 0, res.stderr);
  const seen = JSON.parse(res.stdout.trim().split("\n").at(-1));
  const build = conditions.length ? "browser" : "node";
  assert.equal(seen.length, 4, `${build}: expected 4 requests, saw ${seen.length}`);
  const [vTurn, vCheck, gTurn, gCheck] = seen;
  for (const r of [vTurn, vCheck]) {
    assert.match(r.url, /^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/demo-project-1\/locations\/global\/publishers\/google\/models\//, `${build}: ${r.url}`);
    assert.equal(r.auth, "Bearer TOKEN", build);
    assert.equal(r.key, "", build);
  }
  assert.match(vTurn.url, /gemini-3\.8-flash:streamGenerateContent/, build);
  for (const r of [gTurn, gCheck]) {
    assert.match(r.url, /^https:\/\/generativelanguage\.googleapis\.com\//, `${build}: ${r.url}`);
    assert.equal(r.auth, null, build);
    assert.equal(r.key, "TOKEN", build);
  }
}

console.log("gemini vertex checks passed");
