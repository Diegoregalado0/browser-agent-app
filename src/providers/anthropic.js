import Anthropic from "@anthropic-ai/sdk";

// Models that accept adaptive thinking and output_config.effort.
const THINKING_MODEL = /^claude-(opus-(4-[678]|5)|sonnet-(4-6|5)|fable|mythos)/;
// Models the "default" server-side refusal fallback is documented for.
const FALLBACK_MODEL = /^claude-(opus-5$|fable-5-1)/;

// In the extension edition the user's own key calls the API from their browser, which
// the SDK allows only with this opt-in.
function createClient({ apiKey }) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

function toBlocks(content) {
  return content.map((b) =>
    b.type === "image"
      ? { type: "image", source: { type: "base64", media_type: b.mediaType, data: b.data } }
      : { type: "text", text: b.text },
  );
}

function toMessages(messages, model) {
  return messages.map((m) => {
    if (m.role === "assistant") {
      // Replay native content (thinking blocks included) when it came from this same model.
      if (m.raw?.provider === "anthropic" && m.raw.model === model) return { role: "assistant", content: m.raw.data };
      return {
        role: "assistant",
        content: m.content.map((b) =>
          b.type === "tool_call" ? { type: "tool_use", id: b.id, name: b.name, input: b.input } : { type: "text", text: b.text },
        ),
      };
    }
    return {
      role: "user",
      content: m.content.map((b) =>
        b.type === "tool_result"
          ? { type: "tool_result", tool_use_id: b.id, is_error: b.isError || undefined, content: toBlocks(b.content) }
          : toBlocks([b])[0],
      ),
    };
  });
}

export async function listModels({ apiKey }) {
  const client = createClient({ apiKey });
  const ids = [];
  for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
  return ids;
}

export async function turn({ apiKey, model, config, system, tools, messages, signal, onText, onThinking }) {
  const client = createClient({ apiKey });
  const params = {
    model,
    max_tokens: 32000,
    system,
    tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
    messages: toMessages(messages, model),
    cache_control: { type: "ephemeral" },
  };
  if (config.thinking && THINKING_MODEL.test(model)) {
    params.thinking = { type: "adaptive", display: "summarized" };
    if (config.effort !== "default") params.output_config = { effort: config.effort };
  }
  const useFallback = FALLBACK_MODEL.test(model);
  if (useFallback) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }

  const stream = useFallback ? client.beta.messages.stream(params, { signal }) : client.messages.stream(params, { signal });
  stream.on("text", onText);
  stream.on("thinking", onThinking);
  const message = await stream.finalMessage();

  const content = [];
  for (const b of message.content) {
    if (b.type === "text") content.push({ type: "text", text: b.text });
    else if (b.type === "tool_use") content.push({ type: "tool_call", id: b.id, name: b.name, input: b.input });
  }
  const stop = { tool_use: "tool_use", end_turn: "end", max_tokens: "max_tokens", refusal: "refusal", pause_turn: "pause" }[
    message.stop_reason
  ];
  const u = message.usage;
  const usage = {
    input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    cachedInput: u.cache_read_input_tokens ?? 0,
    output: u.output_tokens,
  };
  return { content, raw: { provider: "anthropic", model, data: message.content }, stop: stop || "end", usage };
}

export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic rejected the API key (401).";
  if (err instanceof Anthropic.NotFoundError) return `Anthropic: model not found (404). ${err.message}`;
  if (err instanceof Anthropic.RateLimitError) return `Anthropic rate limit hit (429): ${err.message}`;
  if (err instanceof Anthropic.BadRequestError) return `Anthropic bad request (400): ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API.";
  if (err instanceof Anthropic.APIError) return `Anthropic error ${err.status ?? ""}: ${err.message}`;
  return null;
}

// One-shot structured JSON call used by the safety checks. `images` are data blocks.
export async function classify({ apiKey, model, system, text, images = [], schema, signal, onUsage }) {
  const client = createClient({ apiKey });
  const message = await client.messages.create(
    {
      model,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: [...toBlocks(images), { type: "text", text }] }],
      output_config: { format: { type: "json_schema", schema } },
    },
    { signal },
  );
  onUsage?.((message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0));
  return JSON.parse(message.content.find((b) => b.type === "text").text);
}
