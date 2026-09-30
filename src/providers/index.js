import { keyProblem } from "../config-core.js";

// Each provider's module (and its SDK) loads on first use, so the extension's side panel
// only parses the SDK of the provider it actually calls. Every call checks the key first:
// a saved key the browser cannot put in a request header would otherwise fail with the
// browser's own Headers error, which names neither the setting nor the fix.
function lazy(name, load) {
  let module = null;
  let loading = null;
  const get = async () => (module ??= await (loading ??= load()));
  const call = (method) => async (opts) => {
    if (opts?.apiKey && keyProblem(opts.apiKey)) {
      throw new Error(`The saved ${name} API key has spaces, line breaks or other characters a key cannot have. Paste it again in Settings > Models.`);
    }
    return (await get())[method](opts);
  };
  return {
    turn: call("turn"),
    classify: call("classify"),
    listModels: call("listModels"),
    ping: call("ping"),
    // Errors come from the calls above, so the module has loaded by the time this runs.
    describeError: (err) => module?.describeError(err) ?? null,
  };
}

export const providers = {
  anthropic: lazy("Anthropic", () => import("./anthropic.js")),
  openai: lazy("OpenAI", () => import("./openai.js")),
  gemini: lazy("Google Gemini", () => import("./gemini.js")),
  mistral: lazy("Mistral", () => import("./mistral.js")),
  ollama: lazy("Ollama", () => import("./ollama.js")),
};
