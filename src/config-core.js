// Settings shape, defaults, and key handling. No file or environment access here.

// Small models used for safety checks when none is set for the provider. Empty means
// the main model is used.
export const DEFAULT_GUARD_MODELS = {
  openai: "gpt-6-luna",
  anthropic: "claude-haiku-4-5",
  gemini: "",
  mistral: "mistral-small-latest",
  ollama: "",
};

export const DEFAULTS = {
  provider: "openai",
  models: { anthropic: "claude-opus-5", openai: "gpt-6-sol", gemini: "", mistral: "mistral-medium-latest", ollama: "" },
  keys: { anthropic: "", openai: "", gemini: "", mistral: "" },
  openaiBaseUrl: "",
  ollamaHost: "http://127.0.0.1:11434",
  ollamaContext: 32768,
  effort: "high",
  openaiEffort: "medium",
  thinking: true,
  // Provider-native web search (Anthropic, OpenAI); each search is billed by the provider.
  webSearch: true,
  maxSteps: 80,
  permissionMode: "guarded",
  guardModels: {},
  skipYoutubeAds: true,
  highlightTab: true,
  // A visible pointer that glides to each target, and typing shown character by character.
  showActions: false,
  customInstructions: "",
  autoConfirmAge: false,
  approvedOrigins: [],
  ghostMode: false,
  // Usage limits; 0 turns a limit off.
  limits: { requestsPerMinute: 20, actionsPerMinute: 60, taskTokens: 2000000, dailyTokens: 10000000 },
  // Ask before any state-changing action on banks, payments, password managers, account
  // security pages and the like, in every safety mode. sensitiveSites adds the user's own.
  confirmSensitiveSites: true,
  sensitiveSites: [],
  // javascript_exec and edit_html: powerful on pages where the user is signed in.
  developerTools: true,
  // Extra detail in the chat (tokens and timing per request) and in Settings.
  debugMode: false,
  // Set when the first-run setup has been finished or skipped.
  setupDone: false,
  // Remote control over the owner's Discord bot. The token never leaves settings storage;
  // the UI sees only the bridge's status.
  discord: { token: "", userId: "", userName: "", pairCode: "" },
};

// Settings back to their defaults. API keys, the Discord bot, Ghost mode and finished
// setup are kept: keys and the bot are connections rather than preferences, and Ghost
// mode belongs to the conversation.
export function resetConfig(config, overrides = {}) {
  return {
    ...structuredClone(DEFAULTS),
    ...structuredClone(overrides),
    keys: config.keys,
    ghostMode: config.ghostMode,
    setupDone: config.setupDone,
    discord: config.discord,
  };
}

export function apiKeyFor(config, provider) {
  return config.keys[provider] || "";
}

// Enough of a key to recognize it: the first three and last four characters.
function maskKey(key) {
  return key.length > 12 ? `${key.slice(0, 3)}…${key.slice(-4)}` : "••••";
}

// The config as the UI sees it: keys are never sent back, only whether one is saved and
// a masked form.
export function publicConfig(config) {
  const keyInfo = {};
  for (const p of Object.keys(DEFAULTS.keys)) {
    const key = config.keys[p] || "";
    keyInfo[p] = { source: key ? "saved" : "none", mask: key ? maskKey(key) : "" };
  }
  const { keys, discord: _discord, ...rest } = config;
  return { ...rest, keyInfo, defaultGuardModels: DEFAULT_GUARD_MODELS };
}

// Stored settings over the defaults (adjusted by an edition's overrides), with nested
// objects merged.
export function mergeConfig(stored = {}, overrides = {}) {
  const defaults = { ...structuredClone(DEFAULTS), ...structuredClone(overrides) };
  return {
    ...defaults,
    ...stored,
    models: { ...defaults.models, ...stored.models },
    keys: { ...defaults.keys, ...stored.keys },
    limits: { ...defaults.limits, ...stored.limits },
  };
}
