import * as openai from "./openai.js";

// Mistral's API follows OpenAI Chat Completions, so this adapter reuses the OpenAI
// adapter's Chat Completions path pointed at Mistral's endpoint.
const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
// Mistral rejects requests carrying too many images; older screenshots are summarized.
const MAX_IMAGES = 4;

const withEndpoint = (opts) => ({
  ...opts,
  config: { ...opts.config, openaiBaseUrl: MISTRAL_BASE_URL, chatMaxImages: MAX_IMAGES },
});

export const turn = (opts) => openai.turn(withEndpoint(opts));
export const classify = (opts) => openai.classify(withEndpoint(opts));
export const listModels = (opts) => openai.listModels(withEndpoint(opts));

export function describeError(err) {
  if (err?.status === 429 && err.headers?.get?.("x-ratelimit-limit-req-minute") === "0") {
    return "This Mistral model is not enabled for your account (quota 0 requests/minute). Check Limits in console.mistral.ai or pick another model.";
  }
  return openai.describeError(err)?.replace(/OpenAI/g, "Mistral") ?? null;
}
