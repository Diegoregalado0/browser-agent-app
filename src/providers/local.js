// The Local provider: Ollama's native API, or an OpenAI-compatible server (the Browsby GPU
// server preset, llama.cpp, LM Studio, vLLM) through the OpenAI adapter's Chat Completions
// path, which carries the thinking setting as chat_template_kwargs (Ollama: think). See
// LOCAL_KINDS.

import { gpuHeaders } from "../config-core.js";

// The OpenAI SDK requires a key; a server that needs none gets this stand-in.
const NO_KEY = "local";

// How long a request may wait for the server to start answering, then how many times it
// is tried again, so a dead connection fails in minutes. The first request to a model in
// this session may wait longer, untried again, since the server may load the model first
// (the Browsby gate can take minutes). Safety checks are never tried again; the Guard
// bounds them itself. A streamed reply is not cut off once it has started.
export const LOCAL_REQUEST_LIMITS = { timeoutMs: 180000, coldTimeoutMs: 300000, retries: 1 };
// Servers and models that have answered a request in this session.
const warm = new Set();

// The module of the latest call, whose errors describeError explains, and whether it went
// to an OpenAI-compatible server.
let last = null;
let server = false;
// Whether it went to the Browsby GPU server, whose gate and Cloudflare refuse access keys.
let gpu = false;

// The server a request goes to, for the warm set.
const serverOf = (config) => (config.localKind === "ollama" ? config.ollamaHost : config.localKind === "gpu" ? config.gpuBaseUrl : config.serverBaseUrl);

// Local's own thinking setting (localThinking) stands for the shared one. Returns the
// module, its options, and the warm-set key of the request.
async function adapter(opts, method) {
  const key = `${serverOf(opts.config)} ${opts.model}`;
  const cold = !warm.has(key);
  const limits = {
    requestTimeoutMs: cold ? LOCAL_REQUEST_LIMITS.coldTimeoutMs : LOCAL_REQUEST_LIMITS.timeoutMs,
    requestRetries: cold || method === "classify" ? 0 : LOCAL_REQUEST_LIMITS.retries,
  };
  opts = { ...opts, config: { ...opts.config, thinking: opts.config.localThinking, ...limits } };
  server = opts.config.localKind !== "ollama";
  gpu = opts.config.localKind === "gpu";
  if (!server) {
    last = await import("./ollama.js");
    return [last, opts, key];
  }
  last = await import("./openai.js");
  const { config } = opts;
  const openaiBaseUrl = serverOf(config);
  const openaiHeaders = gpuHeaders(config, openaiBaseUrl);
  return [last, { ...opts, apiKey: opts.apiKey || NO_KEY, config: { ...config, openaiBaseUrl, openaiHeaders } }, key];
}

// Whether the Browsby gate in front of a Local server is busy with another install:
// { busy, running, freeInSeconds } from <origin>/browsby/busy, or null for Ollama, a
// server without that endpoint, or any failure.
export async function busyStatus(config) {
  if (config.localKind === "ollama" || !config.clientId) return null;
  try {
    const origin = new URL(config.localKind === "gpu" ? config.gpuBaseUrl : config.serverBaseUrl).origin;
    const res = await fetch(`${origin}/browsby/busy`, { headers: gpuHeaders(config, origin), signal: AbortSignal.timeout(5000) });
    const body = res.ok ? await res.json() : null;
    if (typeof body?.busy !== "boolean") return null;
    return { busy: body.busy, running: Boolean(body.running), freeInSeconds: Number(body.freeInSeconds) || 0 };
  } catch {
    return null;
  }
}

// The Browsby GPU server's catalog, from the gate's /browsby/models (edited on the server
// with ~/browsby/models): the models it offers Browsby, in order, and its default. The GPU
// server kind offers exactly these, so models come and go on the server without an
// extension update. Entries are checked, since they come over the network. Throws when the
// server cannot be reached or sends no catalog.
const CATALOG_ID = /^[\w.:/@+-]{1,200}$/;
export async function serverCatalog(config) {
  const origin = new URL(config.gpuBaseUrl).origin;
  const res = await fetch(`${origin}/browsby/models`, { headers: gpuHeaders(config, origin), signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(accessProblem(res.status) ?? `The GPU server sent no model list (${res.status}).`);
  const body = await res.json();
  if (!Array.isArray(body?.models)) throw new Error("The GPU server sent no model list.");
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const models = body.models
    .filter((m) => CATALOG_ID.test(m?.id))
    .map((m) => ({
      id: m.id,
      name: text(m.name, 60) || m.id,
      description: text(m.description, 200),
      backend: text(m.backend, 200),
      aliases: Array.isArray(m.aliases) ? m.aliases.filter((a) => CATALOG_ID.test(a)) : [],
      ...(Number.isInteger(m.summaryAt) && m.summaryAt >= 4000 && { summaryAt: m.summaryAt }),
    }))
    .filter((m, i, all) => all.findIndex((n) => n.id === m.id) === i);
  const fallback = models.find((m) => m.id === body.default) ?? models[0] ?? null;
  return { models, default: fallback?.id ?? null };
}

// The catalog entry to use for the model now chosen: the same one, one it was renamed from
// on the server (aliases), or the one serving it as a backend model (picked before the
// catalog), else the default. Null for an empty catalog.
export function pickServerModel(catalog, current) {
  const { models } = catalog;
  return (
    models.find((m) => m.id === current) ??
    models.find((m) => m.aliases.includes(current)) ??
    models.find((m) => m.backend && m.backend === current) ??
    models.find((m) => m.id === catalog.default) ??
    null
  );
}

const call = (method) => async (opts) => {
  const [module, mapped, key] = await adapter(opts, method);
  const result = await module[method](mapped);
  if (method !== "listModels") warm.add(key);
  return result;
};

export const turn = call("turn");
export const classify = call("classify");
export const listModels = call("listModels");
export const ping = call("ping");
export async function canChat(opts) {
  const [module, mapped] = await adapter(opts, "canChat");
  return module.canChat?.(mapped) ?? null;
}

// What a refusal from a shared GPU server (its gate or Cloudflare Access) means, or null.
function accessProblem(status) {
  if (status === 401) return "The GPU server did not accept the access key. Check it in Settings > Models, or ask the server's owner for a new one.";
  if (status === 403) return "The GPU server's front door (Cloudflare) refused the access key. It may have expired or been revoked; ask the server's owner for a new one.";
  return null;
}

export function describeError(err) {
  if (gpu && (err?.status === 401 || err?.status === 403)) return accessProblem(err.status);
  if (gpu && err?.status === 429 && err?.error?.message) return `The GPU server's limit for this access key: ${err.error.message}. Try again later.`;
  const text = last?.describeError(err) ?? null;
  return server && text ? text.replace("the OpenAI endpoint", "the server").replace(/^OpenAI/, "The server") : text;
}
