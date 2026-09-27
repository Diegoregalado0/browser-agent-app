import { GoogleGenAI, ApiError } from "@google/genai";

function inline(b) {
  return { inlineData: { mimeType: b.mediaType, data: b.data } };
}

function toContents(messages, model) {
  const contents = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      // Replay native parts from the same model so thought signatures survive.
      if (m.raw?.provider === "gemini" && m.raw.model === model) {
        contents.push({ role: "model", parts: m.raw.data });
        continue;
      }
      contents.push({
        role: "model",
        parts: m.content.map((b) =>
          b.type === "tool_call" ? { functionCall: { name: b.name, args: b.input, id: b.id } } : { text: b.text },
        ),
      });
      continue;
    }
    const parts = [];
    const images = [];
    for (const b of m.content) {
      if (b.type === "tool_result") {
        const text = b.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
        const response = b.isError ? { error: text } : { output: text || "(see image)" };
        parts.push({ functionResponse: { name: b.name, ...(b.nativeId && { id: b.nativeId }), response } });
        images.push(...b.content.filter((c) => c.type === "image").map(inline));
      } else if (b.type === "text") parts.push({ text: b.text });
      else parts.push(inline(b));
    }
    contents.push({ role: "user", parts: [...parts, ...images] });
  }
  return contents;
}

export async function listModels({ apiKey }) {
  const ai = new GoogleGenAI({ apiKey });
  const ids = [];
  for await (const m of await ai.models.list()) {
    if (!m.supportedActions || m.supportedActions.includes("generateContent")) ids.push(m.name.replace(/^models\//, ""));
  }
  return ids;
}

export async function turn({ apiKey, model, config, system, tools, messages, signal, onText, onThinking }) {
  const ai = new GoogleGenAI({ apiKey });
  const stream = await ai.models.generateContentStream({
    model,
    contents: toContents(messages, model),
    config: {
      systemInstruction: system,
      tools: [
        {
          functionDeclarations: tools.map(({ name, description, input_schema }) => ({
            name,
            description,
            parametersJsonSchema: input_schema,
          })),
        },
      ],
      ...(config.thinking && { thinkingConfig: { includeThoughts: true } }),
      abortSignal: signal,
    },
  });

  const parts = [];
  let finish = null;
  let usage = null;
  for await (const chunk of stream) {
    const u = chunk.usageMetadata;
    if (u) {
      usage = {
        input: u.promptTokenCount ?? 0,
        cachedInput: u.cachedContentTokenCount ?? 0,
        output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      };
    }
    const candidate = chunk.candidates?.[0];
    if (!candidate) continue;
    for (const part of candidate.content?.parts || []) {
      parts.push(part);
      if (part.text && part.thought) onThinking(part.text);
      else if (part.text) onText(part.text);
    }
    if (candidate.finishReason) finish = candidate.finishReason;
  }

  const content = [];
  let n = 0;
  for (const part of parts) {
    if (part.text && !part.thought) {
      const last = content.at(-1);
      if (last?.type === "text") last.text += part.text;
      else content.push({ type: "text", text: part.text });
    } else if (part.functionCall) {
      const fc = part.functionCall;
      content.push({
        type: "tool_call",
        id: fc.id || `gemini_${Date.now()}_${n++}`,
        nativeId: fc.id,
        name: fc.name,
        input: fc.args || {},
      });
    }
  }
  const hasCalls = content.some((b) => b.type === "tool_call");
  const refused = ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(finish);
  const stop = refused ? "refusal" : finish === "MAX_TOKENS" ? "max_tokens" : hasCalls ? "tool_use" : "end";
  return { content, raw: { provider: "gemini", model, data: parts }, stop, usage };
}

export function describeError(err) {
  if (err instanceof ApiError) {
    if (err.status === 400 && /API key/i.test(err.message)) return "Gemini rejected the API key.";
    if (err.status === 404) return `Gemini: model not found (404). ${err.message}`;
    if (err.status === 429) return `Gemini rate limit or quota hit (429): ${err.message}`;
    return `Gemini error ${err.status}: ${err.message}`;
  }
  return null;
}

// One-shot structured JSON call used by the safety checks. `images` are data blocks.
export async function classify({ apiKey, model, system, text, images = [], schema, signal, onUsage }) {
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text }, ...images.map(inline)] }],
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      abortSignal: signal,
    },
  });
  onUsage?.(res.usageMetadata?.totalTokenCount ?? 0);
  return JSON.parse(res.text);
}
