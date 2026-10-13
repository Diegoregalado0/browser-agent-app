// The Local provider: Ollama's native API, or an OpenAI-compatible server (the Browsby GPU
// server preset, llama.cpp, LM Studio, vLLM) through the OpenAI adapter's Chat Completions
// path, which carries the thinking setting as chat_template_kwargs (Ollama: think). See
// LOCAL_KINDS.

// The OpenAI SDK requires a key; a server that needs none gets this stand-in.
const NO_KEY = "local";

// The module of the latest call, whose errors describeError explains, and whether it went
// to an OpenAI-compatible server.
let last = null;
let server = false;

// Local's own thinking setting (localThinking) stands for the shared one.
async function adapter(opts) {
  opts = { ...opts, config: { ...opts.config, thinking: opts.config.localThinking } };
  server = opts.config.localKind !== "ollama";
  if (!server) {
    last = await import("./ollama.js");
    return [last, opts];
  }
  last = await import("./openai.js");
  const { config } = opts;
  const openaiBaseUrl = config.localKind === "gpu" ? config.gpuBaseUrl : config.serverBaseUrl;
  const openaiHeaders = config.clientId ? { "X-Browsby-Client": config.clientId } : undefined;
  return [last, { ...opts, apiKey: opts.apiKey || NO_KEY, config: { ...config, openaiBaseUrl, openaiHeaders } }];
}

// Whether the Browsby gate in front of a Local server is busy with another install:
// { busy, running, freeInSeconds } from <origin>/browsby/busy, or null for Ollama, a
// server without that endpoint, or any failure.
export async function busyStatus(config) {
  if (config.localKind === "ollama" || !config.clientId) return null;
  try {
    const origin = new URL(config.localKind === "gpu" ? config.gpuBaseUrl : config.serverBaseUrl).origin;
    const res = await fetch(`${origin}/browsby/busy`, { headers: { "X-Browsby-Client": config.clientId }, signal: AbortSignal.timeout(5000) });
    const body = res.ok ? await res.json() : null;
    if (typeof body?.busy !== "boolean") return null;
    return { busy: body.busy, running: Boolean(body.running), freeInSeconds: Number(body.freeInSeconds) || 0 };
  } catch {
    return null;
  }
}

const call = (method) => async (opts) => {
  const [module, mapped] = await adapter(opts);
  return module[method](mapped);
};

export const turn = call("turn");
export const classify = call("classify");
export const listModels = call("listModels");
export const ping = call("ping");
export async function canChat(opts) {
  const [module, mapped] = await adapter(opts);
  return module.canChat?.(mapped) ?? null;
}

export function describeError(err) {
  const text = last?.describeError(err) ?? null;
  return server && text ? text.replace("the OpenAI endpoint", "the server").replace(/^OpenAI/, "The server") : text;
}
