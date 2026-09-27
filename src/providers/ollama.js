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

export async function listModels({ config }) {
  const { models } = await client(config).list();
  return models.map((m) => m.name);
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
    ...(config.thinking && { think: true }),
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

export function describeError(err) {
  if (err?.cause?.code === "ECONNREFUSED" || /fetch failed/i.test(err?.message)) {
    return "Could not reach Ollama. Is it running (ollama serve)?";
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
  });
  onUsage?.((res.prompt_eval_count ?? 0) + (res.eval_count ?? 0));
  return JSON.parse(res.message.content);
}
