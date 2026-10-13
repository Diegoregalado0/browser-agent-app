// The Local provider: Ollama's native API, or an OpenAI-compatible server (the Browsby GPU
// server preset, llama.cpp, LM Studio, vLLM) through the OpenAI adapter's Chat Completions
// path, which carries the thinking setting as chat_template_kwargs. See LOCAL_KINDS.

// The OpenAI SDK requires a key; a server that needs none gets this stand-in.
const NO_KEY = "local";

// The module of the latest call, whose errors describeError explains, and whether it went
// to an OpenAI-compatible server.
let last = null;
let server = false;

async function adapter(opts) {
  server = opts.config.localKind !== "ollama";
  if (!server) {
    last = await import("./ollama.js");
    return [last, opts];
  }
  last = await import("./openai.js");
  const { config } = opts;
  const openaiBaseUrl = config.localKind === "gpu" ? config.gpuBaseUrl : config.serverBaseUrl;
  return [last, { ...opts, apiKey: opts.apiKey || NO_KEY, config: { ...config, openaiBaseUrl } }];
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
