// Each provider's module (and its SDK) loads on first use, so the extension's side panel
// only parses the SDK of the provider it actually calls.
function lazy(load) {
  let module = null;
  let loading = null;
  const get = async () => (module ??= await (loading ??= load()));
  return {
    turn: async (opts) => (await get()).turn(opts),
    classify: async (opts) => (await get()).classify(opts),
    listModels: async (opts) => (await get()).listModels(opts),
    // Errors come from the calls above, so the module has loaded by the time this runs.
    describeError: (err) => module?.describeError(err) ?? null,
  };
}

export const providers = {
  anthropic: lazy(() => import("./anthropic.js")),
  openai: lazy(() => import("./openai.js")),
  gemini: lazy(() => import("./gemini.js")),
  mistral: lazy(() => import("./mistral.js")),
  ollama: lazy(() => import("./ollama.js")),
};
