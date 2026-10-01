import { Ollama } from "ollama/browser";

// Native Ollama API rather than its OpenAI-compatible endpoint, so the context window
// (num_ctx) can be raised; screenshots and tool definitions overflow the default.

function toMessages(system, messages) {
  const out = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const toolCalls = m.content
        .filter((b) => b.type === "tool_call")
        .map((b) => ({ function: { name: b.name, arguments: b.input } }));
      out.push({ role: "assistant", content: text, ...(toolCalls.length && { tool_calls: toolCalls }) });
      continue;
    }
    const texts = [];
    const images = [];
    for (const b of m.content) {
      if (b.type === "tool_result") {
        const text = b.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
        const resultImages = b.content.filter((c) => c.type === "image").map((c) => c.data);
        out.push({
          role: "tool",
          tool_name: b.name,
          content: (b.isError ? "ERROR: " : "") + (text || "(image attached)"),
          ...(resultImages.length && { images: resultImages }),
        });
      } else if (b.type === "text") texts.push(b.text);
      else images.push(b.data);
    }
    if (texts.length || images.length) {
      out.push({ role: "user", content: texts.join("\n"), ...(images.length && { images }) });
    }
  }
  return out;
}

function client(config) {
  return new Ollama({ host: config.ollamaHost });
}

// Whether a model lists the "thinking" capability, asked once per host and model. Models
// without it reject a think field, and hybrid ones (qwen3.5, qwen3-vl) think unless told
// not to, so only these get one. A failed lookup is not kept, so the next call asks again.
const thinking = new Map();
function canThink(config, model) {
  const key = `${config.ollamaHost} ${model}`;
  if (!thinking.has(key)) {
    const lookup = client(config)
      .show({ model })
      .then(
        (info) => Boolean(info.capabilities?.includes("thinking")),
        () => (thinking.delete(key), false),
      );
    thinking.set(key, lookup);
  }
  return thinking.get(key);
}

export async function listModels({ config }) {
  const { models } = await client(config).list();
  return models.map((m) => m.name);
}

// Whether a model can run the agent (chat and tools), from its capabilities; null when the
// server does not report them.
export async function canChat({ model, config }) {
  const capabilities = (await client(config).show({ model }).catch(() => null))?.capabilities;
  return capabilities ? capabilities.includes("completion") && capabilities.includes("tools") : null;
}

export async function turn({ model, config, system, tools, messages, signal, onText, onThinking }) {
  const ollama = client(config);
  const stream = await ollama.chat({
    model,
    stream: true,
    messages: toMessages(system, messages),
    tools: tools.map(({ name, description, input_schema }) => ({
      type: "function",
      function: { name, description, parameters: input_schema },
    })),
    options: { num_ctx: config.ollamaContext },
    ...((await canThink(config, model)) && { think: Boolean(config.thinking) }),
  });
  const onAbort = () => stream.abort();
  signal.addEventListener("abort", onAbort);

  let text = "";
  let doneReason = null;
  let usage = null;
  const calls = [];
  try {
    for await (const chunk of stream) {
      if (chunk.message?.thinking) onThinking(chunk.message.thinking);
      if (chunk.message?.content) {
        text += chunk.message.content;
        onText(chunk.message.content);
      }
      calls.push(...(chunk.message?.tool_calls || []));
      if (chunk.done) {
        doneReason = chunk.done_reason;
        usage = { input: chunk.prompt_eval_count ?? 0, cachedInput: 0, output: chunk.eval_count ?? 0 };
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }

  const content = [];
  if (text) content.push({ type: "text", text });
  calls.forEach((c, i) =>
    content.push({ type: "tool_call", id: `ollama_${Date.now()}_${i}`, name: c.function.name, input: c.function.arguments || {} }),
  );
  const stop = doneReason === "length" ? "max_tokens" : calls.length ? "tool_use" : "end";
  return { content, raw: null, stop, usage };
}

// The connection test's one real request: the chosen model, one output token. A POST, so
// it meets the origin check that listing models (a GET) does not.
export async function ping({ model, config }) {
  await client(config).chat({ model, stream: false, messages: [{ role: "user", content: "Hi" }], options: { num_predict: 1 } });
}

export function describeError(err) {
  // Node says "fetch failed"; the browser, where the extension runs, says "Failed to fetch".
  if (err?.cause?.code === "ECONNREFUSED" || /fetch failed|failed to fetch/i.test(err?.message)) {
    return "Could not reach Ollama. Is it running (ollama serve)?";
  }
  // Ollama answers 403 to requests from origins it does not allow, and a browser extension
  // is not one of its defaults. Listing models is a GET without an Origin check, which is
  // why the connection test also sends one chat request.
  if (err?.name === "ResponseError" && err.status_code === 403) {
    return "Ollama refused the request from this extension (403). Quit Ollama and start it with OLLAMA_ORIGINS=chrome-extension://* ollama serve.";
  }
  if (err?.name === "ResponseError" && err.status_code === 404 && /model .* not found/i.test(err.message)) {
    return `Ollama error: ${err.message}. Pull it with ollama pull, or pick another model in Settings > Models.`;
  }
  if (err?.name === "ResponseError") return `Ollama error: ${err.message}`;
  return null;
}

// One-shot structured JSON call used by the safety checks. `images` are data blocks.
export async function classify({ model, config, system, text, images = [], schema, onUsage }) {
  const res = await client(config).chat({
    model,
    stream: false,
    format: schema,
    messages: [
      { role: "system", content: system },
      { role: "user", content: text, ...(images.length && { images: images.map((b) => b.data) }) },
    ],
    options: { num_ctx: config.ollamaContext },
    ...((await canThink(config, model)) && { think: false }),
  });
  onUsage?.((res.prompt_eval_count ?? 0) + (res.eval_count ?? 0));
  return JSON.parse(res.message.content);
}
