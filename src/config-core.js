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

// Why a pasted API key or bot token (already trimmed) cannot be one, or null when it can.
// Keys are printable ASCII without spaces, which is also all a request header accepts.
// The message never repeats the value.
// noun: what the value is, in the message ("key", "bot token").
export function keyProblem(key, noun = "key") {
  if (typeof key !== "string" || !key) return `Paste a ${noun} first.`;
  const again = `Copy only the ${noun} and paste it again.`;
  if (/\s/.test(key)) return `That does not look like a ${noun}: it has spaces or line breaks in it. ${again}`;
  if (!/^[\x21-\x7e]+$/.test(key)) return `That does not look like a ${noun}: it has characters a ${noun} never has. ${again}`;
  return null;
}

// Allowed values and bounds for settings, checked by cleanSetting.
const CHOICES = {
  provider: Object.keys(DEFAULTS.models),
  permissionMode: ["guarded", "ask", "auto"],
  effort: ["default", "low", "medium", "high", "xhigh", "max"],
  openaiEffort: ["default", "none", "low", "medium", "high", "xhigh", "max"],
};
// [min, max, name in messages]
const NUMBER_RANGES = {
  maxSteps: [1, 1000, "Max steps"],
  ollamaContext: [4096, 1048576, "The context window"],
  requestsPerMinute: [0, 10000],
  actionsPerMinute: [0, 10000],
  taskTokens: [0, 1e10],
  dailyTokens: [0, 1e11],
};
export const CUSTOM_INSTRUCTIONS_MAX = 10000;
const LIST_MAX = 1000;
// Model ids as providers write them: "gpt-6-sol", "anthropic/claude-opus-5", "qwen3:8b".
const MODEL_ID = /^[\w.:/@+-]{0,200}$/;
const HOSTNAME = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/;

function httpUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a full address, like http://127.0.0.1:11434.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must start with http:// or https:// and have no user name or password in it.`);
  }
  return value;
}

// A setting's value checked against its expected type and bounds. Returns the value to
// store, or throws an Error whose message says what is wrong. Nested objects (models,
// limits, guardModels) are checked field by field.
export function cleanSetting(key, value) {
  const fail = (text) => {
    throw new Error(text);
  };
  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!Object.hasOwn(DEFAULTS, key) || ["keys", "discord"].includes(key)) fail(`Unknown setting ${String(key).slice(0, 40)}.`);
  if (CHOICES[key]) return CHOICES[key].includes(value) ? value : fail(`Unknown ${key} value.`);
  if (NUMBER_RANGES[key]) {
    const [min, max, name] = NUMBER_RANGES[key];
    return Number.isInteger(value) && value >= min && value <= max ? value : fail(`${name} must be a whole number from ${min} to ${max}.`);
  }
  if (key === "limits") {
    if (!isObject(value)) fail("Usage limits must be numbers.");
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        if (!Object.hasOwn(DEFAULTS.limits, k)) fail("Unknown usage limit.");
        const [min, max] = NUMBER_RANGES[k];
        return Number.isInteger(v) && v >= min && v <= max ? [k, v] : fail(`Each usage limit must be a whole number from ${min} to ${max.toLocaleString("en-US")}.`);
      }),
    );
  }
  if (key === "models" || key === "guardModels") {
    if (!isObject(value)) fail("Model ids must be text.");
    for (const [p, id] of Object.entries(value)) {
      if (!CHOICES.provider.includes(p)) fail("Unknown provider.");
      if (typeof id !== "string" || !MODEL_ID.test(id)) fail("A model id has only letters, digits and . : / @ + - _ (no spaces), up to 200 characters.");
    }
    return value;
  }
  if (key === "openaiBaseUrl") return value === "" ? value : httpUrl(value, "The base URL");
  if (key === "ollamaHost") return httpUrl(value, "The Ollama host");
  if (key === "customInstructions") {
    if (typeof value !== "string") fail("Custom instructions must be text.");
    return value.length <= CUSTOM_INSTRUCTIONS_MAX ? value : fail(`Custom instructions can be up to ${CUSTOM_INSTRUCTIONS_MAX.toLocaleString("en-US")} characters.`);
  }
  if (key === "sensitiveSites") {
    if (!Array.isArray(value) || value.length > LIST_MAX) fail(`Sensitive sites must be a list of up to ${LIST_MAX} sites.`);
    return value.map((entry) => {
      // A pasted address counts as its hostname.
      let site = typeof entry === "string" ? entry.trim().toLowerCase() : "";
      try {
        if (site.includes("/")) site = new URL(site.includes("://") ? site : `https://${site}`).hostname;
      } catch {}
      return site.length <= 253 && HOSTNAME.test(site) ? site : fail("Enter sensitive sites as hostnames like mybank.example, one per line.");
    });
  }
  if (key === "approvedOrigins") {
    if (!Array.isArray(value) || value.length > LIST_MAX) fail("Approved sites must be a list.");
    for (const origin of value) {
      let ok = false;
      try {
        const url = new URL(origin);
        ok = /^https?:$/.test(url.protocol) && url.origin === origin;
      } catch {}
      if (!ok) fail("An approved site must be an origin like https://example.com.");
    }
    return value;
  }
  if (typeof DEFAULTS[key] === "boolean") return typeof value === "boolean" ? value : fail(`${key} must be on or off.`);
  return fail(`Unknown setting ${key}.`);
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
// objects merged. A stored value that fails cleanSetting (from an older version, or edited
// outside the app) falls back to its default rather than being trusted.
export function mergeConfig(stored = {}, overrides = {}) {
  const defaults = { ...structuredClone(DEFAULTS), ...structuredClone(overrides) };
  const config = { ...defaults, keys: { ...defaults.keys, ...stored.keys } };
  if (stored.discord) config.discord = stored.discord;
  if (typeof stored.ghostMode === "boolean") config.ghostMode = stored.ghostMode;
  for (const [key, value] of Object.entries(stored)) {
    if (!Object.hasOwn(DEFAULTS, key) || ["keys", "discord", "ghostMode"].includes(key)) continue;
    let merged = ["models", "limits", "guardModels"].includes(key) ? { ...defaults[key], ...value } : value;
    // In a list, only the entries that fail are dropped.
    if (Array.isArray(value)) {
      merged = value.filter((entry) => {
        try {
          cleanSetting(key, [entry]);
          return true;
        } catch {
          return false;
        }
      });
    }
    try {
      config[key] = cleanSetting(key, merged);
    } catch {}
  }
  return config;
}
