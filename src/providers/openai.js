import OpenAI from "openai";

// Official OpenAI uses the Responses API: current reasoning models reject function tools
// on Chat Completions unless reasoning is off, and Responses carries encrypted reasoning
// between turns. A custom base URL (OpenRouter, LM Studio, vLLM, ...) uses Chat
// Completions, the dialect OpenAI-compatible servers implement.

// Tool-call arguments, or a marker the agent reports back when they are not valid JSON.
function parseArgs(args) {
  try {
    return args ? JSON.parse(args) : {};
  } catch {
    return { __invalid_json: args };
  }
}

function textOf(blocks) {
  return blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

function imageParts(blocks) {
  return blocks
    .filter((b) => b.type === "image")
    .map((b) => ({ type: "image_url", image_url: { url: `data:${b.mediaType};base64,${b.data}` } }));
}

// Keeps only the newest `maxImages` screenshots, replacing older ones with a note.
// Some OpenAI-compatible APIs (Mistral) cap images per request.
function limitImages(messages, maxImages) {
  if (!maxImages) return messages;
  let seen = 0;
  const trim = (blocks) =>
    [...blocks].reverse().map((b) => {
      if (b.type === "image") return ++seen > maxImages ? { type: "text", text: "[earlier screenshot omitted]" } : b;
      if (b.type === "tool_result") return { ...b, content: trim(b.content) };
      return b;
    }).reverse();
  return [...messages].reverse().map((m) => (m.role === "user" ? { ...m, content: trim(m.content) } : m)).reverse();
}

function toMessages(system, messages) {
  const out = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      const toolCalls = m.content
        .filter((b) => b.type === "tool_call")
        .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } }));
      out.push({ role: "assistant", content: textOf(m.content) || null, ...(toolCalls.length && { tool_calls: toolCalls }) });
      continue;
    }
    // Tool messages only carry text, so images from tool results follow in one user message.
    const followUpImages = [];
    const userParts = [];
    for (const b of m.content) {
      if (b.type === "tool_result") {
        out.push({ role: "tool", tool_call_id: b.id, content: (b.isError ? "ERROR: " : "") + (textOf(b.content) || "(image below)") });
        followUpImages.push(...imageParts(b.content));
      } else if (b.type === "text") userParts.push({ type: "text", text: b.text });
      else userParts.push(...imageParts([b]));
    }
    if (followUpImages.length) {
      userParts.unshift({ type: "text", text: "Images returned by the tool calls above:" }, ...followUpImages);
    }
    if (userParts.length) out.push({ role: "user", content: userParts });
  }
  return out;
}

// dangerouslyAllowBrowser: in the extension edition the user's own key calls the API
// from their browser, which the SDK allows only with this opt-in.
function client({ apiKey, config }) {
  return new OpenAI({ apiKey, baseURL: config.openaiBaseUrl || undefined, dangerouslyAllowBrowser: true });
}

export async function listModels(opts) {
  const ids = [];
  for await (const m of client(opts).models.list()) ids.push(m.id);
  return ids.sort();
}

async function chatTurn({ apiKey, model, config, system, tools, messages, signal, onText, onThinking }) {
  const stream = await client({ apiKey, config }).chat.completions.create(
    {
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: toMessages(system, limitImages(messages, config.chatMaxImages)),
      tools: tools.map(({ name, description, input_schema }) => ({
        type: "function",
        function: { name, description, parameters: input_schema },
      })),
    },
    { signal },
  );

  let text = "";
  let finish = null;
  let usage = null;
  const calls = [];
  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = {
        input: chunk.usage.prompt_tokens,
        cachedInput: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
        output: chunk.usage.completion_tokens,
      };
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta || {};
    if (delta.content) {
      text += delta.content;
      onText(delta.content);
    }
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === "string" && reasoning) onThinking(reasoning);
    for (const tc of delta.tool_calls || []) {
      const call = (calls[tc.index] ||= { id: "", name: "", args: "" });
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.name += tc.function.name;
      if (tc.function?.arguments) call.args += tc.function.arguments;
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }

  const content = [];
  if (text) content.push({ type: "text", text });
  for (const [i, c] of calls.entries()) {
    if (!c) continue;
    content.push({ type: "tool_call", id: c.id || `call_${Date.now()}_${i}`, name: c.name, input: parseArgs(c.args) });
  }
  const hasCalls = content.some((b) => b.type === "tool_call");
  const stop = finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : hasCalls ? "tool_use" : "end";
  return { content, raw: null, stop, usage };
}

// Models that accept the reasoning parameter.
const REASONING_MODEL = /^(gpt-5(?!-chat)|gpt-6|o\d)/;

// The SDK's stream helper adds parsed fields that the API rejects as input.
function sanitizeItem(item) {
  const { parsed_arguments, ...rest } = item;
  if (rest.type === "message") rest.content = rest.content.map(({ parsed, ...c }) => c);
  return rest;
}

function toResponsesInput(messages, model) {
  const input = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      // Replay native output items (encrypted reasoning included) from the same model.
      if (m.raw?.provider === "openai-responses" && m.raw.model === model) {
        input.push(...m.raw.data);
        continue;
      }
      for (const b of m.content) {
        if (b.type === "text") input.push({ role: "assistant", content: b.text });
        else input.push({ type: "function_call", call_id: b.id, name: b.name, arguments: JSON.stringify(b.input) });
      }
      continue;
    }
    const userContent = [];
    for (const b of m.content) {
      if (b.type === "tool_result") {
        const output = b.content.map((c) =>
          c.type === "image"
            ? { type: "input_image", image_url: `data:${c.mediaType};base64,${c.data}`, detail: "auto" }
            : { type: "input_text", text: c.text },
        );
        if (b.isError) output.unshift({ type: "input_text", text: "ERROR:" });
        input.push({ type: "function_call_output", call_id: b.id, output });
      } else if (b.type === "text") userContent.push({ type: "input_text", text: b.text });
      else userContent.push({ type: "input_image", image_url: `data:${b.mediaType};base64,${b.data}`, detail: "auto" });
    }
    if (userContent.length) input.push({ role: "user", content: userContent });
  }
  return input;
}

async function responsesTurn({ apiKey, model, config, system, tools, messages, signal, onText, onThinking }) {
  const params = {
    model,
    instructions: system,
    input: toResponsesInput(messages, model),
    tools: tools.map(({ name, description, input_schema }) => ({
      type: "function",
      name,
      description,
      parameters: input_schema,
      strict: false,
    })),
    store: false,
  };
  if (REASONING_MODEL.test(model) && config.openaiEffort !== "default") {
    params.reasoning = { effort: config.openaiEffort, ...(config.thinking && { summary: "auto" }) };
    params.include = ["reasoning.encrypted_content"];
  }

  const stream = client({ apiKey, config }).responses.stream(params, { signal });
  stream.on("response.output_text.delta", (e) => onText(e.delta));
  stream.on("response.reasoning_summary_text.delta", (e) => onThinking(e.delta));
  const response = await stream.finalResponse();

  const content = [];
  for (const item of response.output) {
    if (item.type === "message") {
      const text = item.content.filter((c) => c.type === "output_text").map((c) => c.text).join("");
      if (text) content.push({ type: "text", text });
    } else if (item.type === "function_call") {
      content.push({ type: "tool_call", id: item.call_id, name: item.name, input: parseArgs(item.arguments) });
    }
  }
  const reason = response.incomplete_details?.reason;
  const refused = reason === "content_filter" || response.output.some((i) => i.type === "message" && i.content.some((c) => c.type === "refusal"));
  const hasCalls = content.some((b) => b.type === "tool_call");
  const stop = refused ? "refusal" : reason === "max_output_tokens" ? "max_tokens" : hasCalls ? "tool_use" : "end";
  const usage = response.usage && {
    input: response.usage.input_tokens,
    cachedInput: response.usage.input_tokens_details?.cached_tokens ?? 0,
    output: response.usage.output_tokens,
  };
  return { content, raw: { provider: "openai-responses", model, data: response.output.map(sanitizeItem) }, stop, usage };
}

export function turn(opts) {
  return opts.config.openaiBaseUrl ? chatTurn(opts) : responsesTurn(opts);
}

export function describeError(err) {
  if (err instanceof OpenAI.AuthenticationError) return "OpenAI rejected the API key (401).";
  if (err instanceof OpenAI.NotFoundError) return `OpenAI: model or endpoint not found (404). ${err.message}`;
  if (err instanceof OpenAI.RateLimitError) {
    return err.code === "insufficient_quota" || err.type === "insufficient_quota"
      ? `OpenAI account is out of credit: ${err.message}`
      : `OpenAI rate limit hit (429): ${err.message}`;
  }
  if (err instanceof OpenAI.BadRequestError) return `OpenAI bad request (400): ${err.message}`;
  if (err instanceof OpenAI.APIConnectionError) return "Could not reach the OpenAI endpoint.";
  if (err instanceof OpenAI.APIError) return `OpenAI error ${err.status ?? ""}: ${err.message}`;
  return null;
}

// One-shot structured JSON call used by the safety checks. `images` are data blocks.
// onUsage(tokens) reports what the call used, so safety checks count toward usage limits.
export async function classify({ apiKey, model, config, system, text, images = [], schema, signal, onUsage }) {
  const openai = client({ apiKey, config });
  if (config.openaiBaseUrl) {
    const res = await openai.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: [{ type: "text", text }, ...imageParts(images)] },
        ],
        response_format: { type: "json_schema", json_schema: { name: "result", schema, strict: true } },
      },
      { signal },
    );
    onUsage?.(res.usage?.total_tokens ?? 0);
    return JSON.parse(res.choices[0].message.content);
  }
  const res = await openai.responses.create(
    {
      model,
      instructions: system,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text },
            ...images.map((b) => ({ type: "input_image", image_url: `data:${b.mediaType};base64,${b.data}`, detail: "low" })),
          ],
        },
      ],
      text: { format: { type: "json_schema", name: "result", schema, strict: true } },
      ...(REASONING_MODEL.test(model) && { reasoning: { effort: "low" } }),
      store: false,
    },
    { signal },
  );
  onUsage?.(res.usage?.total_tokens ?? 0);
  return JSON.parse(res.output_text);
}
