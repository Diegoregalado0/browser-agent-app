#!/usr/bin/env node
// General-skills check: short prompts with deterministic answers (arithmetic, extraction, JSON,
// limits, summaries, translation, reading code, dates), sent straight to an OpenAI-compatible
// server, no browser. It shows whether a browser-tuned model kept the general skills Browsby
// users rely on. Each prompt runs --samples times with the server's own sampling settings.
//   node scripts/bench/general-skills.js --base-url http://127.0.0.1:8090/v1 --models a,b [--samples 3]
//   node scripts/bench/general-skills.js --self-check   (checkers against reference answers)
import { mkdirSync, writeFileSync } from "node:fs";

const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
const plain = (t) => t.replace(/(\d),(?=\d{3}\b)/g, "$1");
const only = (t) => t.trim().replace(/^[`"'*]+|[`"'*.]+$/g, "").trim();
const json = (t) => JSON.parse(t.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));

export const PROMPTS = [
  ["arithmetic", "What is 17 * 23 + 154? Answer with the number only.", (r) => only(r) === "545", "545"],
  ["percent", "A shirt costs $40. It is discounted by 15%, then 8% tax is added to the discounted price. What is the final price? Answer with the number only, two decimals.", (r) => /^\$?36\.72$/.test(only(r)), "36.72"],
  ["units", "How many minutes are in 3.5 hours? Answer with the number only.", (r) => only(r) === "210", "210"],
  ["dates", "Today is Tuesday, 2026-03-03. What is the date of the coming Friday? Answer in YYYY-MM-DD only.", (r) => only(r) === "2026-03-06", "2026-03-06"],
  ["logic", "Anna is older than Ben. Ben is older than Carl. Who is the youngest? Answer with one word.", (r) => /^carl$/i.test(only(r)), "Carl"],
  ["knowledge", "What is the capital of Australia? Answer with one word.", (r) => /^canberra$/i.test(only(r)), "Canberra"],
  ["sentiment", "Classify the sentiment of this review as positive, negative or neutral, one word only: \"The delivery was late and the box was crushed.\"", (r) => /^negative$/i.test(only(r)), "negative"],
  ["read-code", "What does this JavaScript print? Answer with the output only.\nconsole.log([1, 2, 3].map((x) => x * 2).join(\"-\"))", (r) => only(r) === "2-4-6", "2-4-6"],
  ["exact-format", "Reply with the word ready in all capital letters and nothing else.", (r) => r.trim() === "READY", "READY"],
  ["json-list", "List the three primary colors of paint (red, yellow, blue) as a JSON array of lowercase strings. Output only the JSON.", (r) => {
    try { return JSON.stringify(json(r).sort()) === '["blue","red","yellow"]'; } catch { return false; }
  }, '["red", "yellow", "blue"]'],
  ["extract-json", "From this email, extract the order number and the delivery date. Output only JSON with keys \"order\" and \"date\" (date as YYYY-MM-DD).\n\nHi Sam, your order ORD-77815 has shipped and will arrive on 14 April 2026. Thanks, the Shop team", (r) => {
    try { const o = json(r); return o.order === "ORD-77815" && o.date === "2026-04-14"; } catch { return false; }
  }, '{"order": "ORD-77815", "date": "2026-04-14"}'],
  ["summary", "Summarize this in under 40 words, keeping the date, city and budget:\n\nThe regional team met on Monday to plan the spring customer event. After comparing three venues, they chose a conference hall in Lisbon for Friday 12 June. The budget was capped at $12,000, covering catering and travel for twenty guests. Marta will send invitations next week.", (r) => {
    const t = plain(r);
    return words(r) < 40 && /lisbon/i.test(t) && /12 june|june 12/i.test(t) && /12000|12k/i.test(t);
  }, "The team picked a Lisbon conference hall for Friday 12 June, with a $12,000 budget for catering and travel for twenty guests; Marta sends invitations next week."],
  ["word-limit", "Describe the ocean in one sentence of at most 15 words.", (r) => words(r) >= 5 && words(r) <= 15 && (r.trim().match(/[.!?](\s|$)/g) ?? []).length <= 1, "The ocean is a vast, restless body of salt water covering most of Earth."],
  ["translate", "Translate into Spanish, output only the translation: \"The library opens at nine in the morning.\"", (r) => /biblioteca/i.test(r) && /nueve/i.test(r), "La biblioteca abre a las nueve de la mañana."],
  ["email", "Write a reply of at most three sentences that declines a meeting on Thursday and proposes Friday at 10 am instead. Output only the reply.", (r) => /friday/i.test(r) && /\b10\b/.test(r) && (r.trim().match(/[.!?](\s|$)/g) ?? []).length <= 3, "Thanks for the invite, but I can't make Thursday. Would Friday at 10 am work for you instead?"],
];

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

if (args.includes("--self-check")) {
  // Right answers worded differently from the reference must pass too.
  const ALSO_RIGHT = { "word-limit": "The vast, salty blue expanse covers most of Earth's surface." };
  for (const [id, , check, reference] of PROMPTS) {
    if (!check(reference)) throw new Error(`checker ${id} rejects its reference answer`);
    if (ALSO_RIGHT[id] && !check(ALSO_RIGHT[id])) throw new Error(`checker ${id} rejects a right answer: ${ALSO_RIGHT[id]}`);
    if (check("I don't know.")) throw new Error(`checker ${id} accepts a non-answer`);
  }
  console.log(`general-skills checkers passed (${PROMPTS.length} prompts)`);
  process.exit(0);
}

const base = opt("--base-url", "http://127.0.0.1:8090/v1").replace(/\/$/, "");
const models = opt("--models", "").split(",").filter(Boolean);
const samples = Number(opt("--samples", "3"));
if (!models.length) throw new Error("--models a,b is required");

const ask = async (model, prompt) => {
  const started = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 400 }),
    signal: AbortSignal.timeout(900000),
  });
  if (!res.ok) throw new Error(`${model}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return { text: body.choices?.[0]?.message?.content ?? "", ms: Date.now() - started };
};

const results = {};
for (const model of models) {
  results[model] = {};
  for (const [id, prompt, check] of PROMPTS) {
    const runs = [];
    for (let i = 0; i < samples; i++) {
      const { text, ms } = await ask(model, prompt);
      runs.push({ ok: check(text), ms, text: text.slice(0, 300) });
    }
    results[model][id] = runs;
    console.log(`${model.padEnd(20)} ${id.padEnd(13)} ${runs.filter((r) => r.ok).length}/${samples}`);
  }
}

console.log(`\n${"prompt".padEnd(13)} ${models.map((m) => m.slice(0, 18).padStart(18)).join(" ")}`);
for (const [id] of PROMPTS) console.log(`${id.padEnd(13)} ${models.map((m) => `${results[m][id].filter((r) => r.ok).length}/${samples}`.padStart(18)).join(" ")}`);
const total = (m) => Object.values(results[m]).flat();
console.log(`${"total".padEnd(13)} ${models.map((m) => `${total(m).filter((r) => r.ok).length}/${total(m).length}`.padStart(18)).join(" ")}`);
mkdirSync("bench-results", { recursive: true });
const file = `bench-results/general-skills-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ base, models, samples, results }, null, 2));
console.log(`\nWrote ${file}`);
