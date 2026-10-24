// Settings shape, defaults, and key handling. No file or environment access here.

// Small models used for safety checks when none is set for the provider. Empty means
// the main model is used, as for Local, where a second model would compete for memory or
// is not served at all. Mistral enables models per account; when the account cannot use a
// default here, the checks fall back to the main model (see Guard).
export const DEFAULT_GUARD_MODELS = {
  openai: "gpt-6-luna",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-3.5-flash-lite",
  mistral: "mistral-small-latest",
  ollama: "",
};

// The Local provider (id "ollama", from when Ollama was its only kind) reaches one of:
//   gpu     the Browsby GPU server, reached with an access key (keys.gpu) that holds its address
//   server  any OpenAI-compatible server (llama.cpp, LM Studio, vLLM) at serverBaseUrl,
//           with keys.ollama when it wants one
//   ollama  Ollama's native API at ollamaHost
export const LOCAL_KINDS = ["gpu", "server", "ollama"];

export const DEFAULTS = {
  provider: "openai",
  models: { anthropic: "claude-opus-5", openai: "gpt-6-sol", gemini: "", mistral: "mistral-medium-latest", ollama: "" },
  // gpu: an access key for a shared Browsby GPU server (accessKeyParts).
  keys: { anthropic: "", openai: "", gemini: "", mistral: "", ollama: "", gpu: "" },
  // The models picked so far, newest first, for quick switching: [{ provider, model }],
  // with kind (LOCAL_KINDS) on Local entries, so picking one also picks its connection.
  modelHistory: [],
  localKind: "ollama",
  serverBaseUrl: "",
  ollamaHost: "http://127.0.0.1:11434",
  ollamaContext: 32768,
  effort: "high",
  openaiEffort: "medium",
  // Reasoning before each answer. Local has its own, off: a local model thinking first can
  // take minutes per step, and its server already defaults to off.
  thinking: true,
  localThinking: false,
  // Provider-native web search (Anthropic, OpenAI); each search is billed by the provider.
  webSearch: true,
  // The read-only canvas tool, on Canvas LMS sites.
  canvasTool: true,
  maxSteps: 80,
  permissionMode: "guarded",
  guardModels: {},
  highlightTab: true,
  // A visible pointer that glides to each target, and typing shown character by character.
  showActions: false,
  // Only internal builds offer it (src/human-input.js).
  humanInput: false,
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
  // Extra detail in the chat (tokens and timing per request) and in Settings.
  debugMode: false,
  // Set when the first-run setup has been finished or skipped.
  setupDone: false,
  // Remote control over the owner's Discord bot. The token never leaves settings storage;
  // the UI sees only the bridge's status.
  discord: { token: "", userId: "", userName: "", pairCode: "" },
  // An anonymous id for this install, sent only to a Local server (X-Browsby-Client), so
  // the Browsby gate can tell this install's requests from other users'. Set once on load
  // (mergeConfig), never shown in the UI and never changed by a settings patch.
  clientId: "",
};
const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Settings back to their defaults. API keys, the Discord bot, Ghost mode and finished
// setup are kept: keys and the bot are connections rather than preferences, and Ghost
// mode belongs to the conversation.
export function resetConfig(config) {
  return {
    ...structuredClone(DEFAULTS),
    keys: config.keys,
    ghostMode: config.ghostMode,
    setupDone: config.setupDone,
    discord: config.discord,
    clientId: config.clientId,
  };
}

// Local sends a key only to an OpenAI-compatible server the user gave one for.
export function apiKeyFor(config, provider) {
  if (provider === "ollama" && config.localKind !== "server") return "";
  return config.keys[provider] || "";
}

// A Browsby GPU server access key (made on the server with `keys create`): bzk1_ and base64url
// JSON with the server address and three credentials. Returns { origin, headers }, or null for
// anything else. The headers go only to that origin (gpuHeaders).
const ACCESS_KEY = /^bzk1_[A-Za-z0-9_-]{40,1200}$/;
export function accessKeyParts(key) {
  if (!ACCESS_KEY.test(key ?? "")) return null;
  try {
    const raw = atob(key.slice(5).replace(/-/g, "+").replace(/_/g, "/"));
    const { u, cid, cs, k } = JSON.parse(raw);
    const url = new URL(u);
    // https, or http to this computer (a gate under test).
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !local) || url.username || url.password) return null;
    if (![cid, cs, k].every((v) => typeof v === "string" && /^[\x21-\x7e]{8,200}$/.test(v)) || !/^bgk_[a-z2-7]{8}_[A-Za-z0-9_-]{43}$/.test(k)) return null;
    return { origin: url.origin, headers: { "CF-Access-Client-Id": cid, "CF-Access-Client-Secret": cs, "X-Browsby-Key": k } };
  } catch {
    return null;
  }
}

// The Browsby GPU server's OpenAI-compatible base URL, from the access key, or "" without one.
export function gpuBase(config) {
  const access = accessKeyParts(config.keys?.gpu);
  return access ? `${access.origin}/v1` : "";
}

// Headers for a request from the Local provider to url: the install id, and on the Browsby GPU
// server the saved access key's credentials when url is that key's server.
export function gpuHeaders(config, url) {
  const headers = config.clientId ? { "X-Browsby-Client": config.clientId } : {};
  const access = config.localKind === "gpu" ? accessKeyParts(config.keys?.gpu) : null;
  try {
    if (access && new URL(url).origin === access.origin) Object.assign(headers, access.headers);
  } catch {}
  return headers;
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
  localKind: LOCAL_KINDS,
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
export const MODEL_HISTORY_MAX = 12;
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
  if (!Object.hasOwn(DEFAULTS, key) || ["keys", "discord", "clientId"].includes(key)) fail(`Unknown setting ${String(key).slice(0, 40)}.`);
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
  if (key === "modelHistory") {
    if (!Array.isArray(value) || value.length > MODEL_HISTORY_MAX) fail(`The model history holds up to ${MODEL_HISTORY_MAX} models.`);
    // A Local entry without a kind is from when Local was only Ollama.
    return value.map((entry) =>
      isObject(entry) && CHOICES.provider.includes(entry.provider) && typeof entry.model === "string" && entry.model && MODEL_ID.test(entry.model) && (entry.kind === undefined || LOCAL_KINDS.includes(entry.kind))
        ? { provider: entry.provider, model: entry.model, ...(entry.provider === "ollama" && { kind: entry.kind ?? "ollama" }) }
        : fail("Each model in the history is a provider and a model id."),
    );
  }
  if (key === "serverBaseUrl") return value === "" ? value : httpUrl(value, "The base URL");
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
  const { keys, discord: _discord, clientId: _clientId, ...rest } = config;
  return { ...rest, keyInfo, defaultGuardModels: DEFAULT_GUARD_MODELS };
}

// Stored settings over the defaults, with nested objects merged. A stored value that fails
// cleanSetting (from an older version, or edited outside the app) falls back to its default
// rather than being trusted. Keys that are not settings any more are dropped.
export function mergeConfig(stored = {}) {
  stored = migrateBaseUrl(stored ?? {});
  const defaults = structuredClone(DEFAULTS);
  const config = { ...defaults, keys: { ...defaults.keys, ...stored.keys } };
  if (stored.discord) config.discord = stored.discord;
  if (typeof stored.ghostMode === "boolean") config.ghostMode = stored.ghostMode;
  config.clientId = CLIENT_ID.test(stored.clientId) ? stored.clientId : crypto.randomUUID();
  for (const [key, value] of Object.entries(stored)) {
    if (!Object.hasOwn(DEFAULTS, key) || ["keys", "discord", "ghostMode", "clientId"].includes(key)) continue;
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

// OpenAI's own model ids; any other id saved under OpenAI belonged to a custom server.
// ponytail: name pattern, misreads a custom server model named like gpt-*; such an entry
// stays under OpenAI and is picked again from Settings > Models.
const OPENAI_MODEL = /^(gpt-|chatgpt-|codex-|o\d)/i;

// Versions before the Local provider reached an OpenAI-compatible server through OpenAI's
// base URL. Such a config becomes Local (the GPU preset or a server), with the server's
// model, model history entries, safety model and key moved over. The key moves rather
// than stays, so it is never sent to api.openai.com.
function migrateBaseUrl(stored) {
  const url = stored.openaiBaseUrl;
  if (typeof url !== "string" || !url) return stored;
  try {
    httpUrl(url, "");
  } catch {
    return stored;
  }
  const { openaiBaseUrl: _url, ...next } = stored;
  const kind = /^http:\/\/(localhost|127\.0\.0\.1):8081\/v1\/?$/.test(url) ? "gpu" : "server";
  if (kind === "server") next.serverBaseUrl = url;
  const models = { ...stored.models };
  const guardModels = { ...stored.guardModels };
  const keys = { ...stored.keys };
  if (stored.provider === "openai" || !models.ollama) {
    next.localKind = kind;
    if (models.openai && !OPENAI_MODEL.test(models.openai)) models.ollama = models.openai;
  }
  if (stored.provider === "openai") next.provider = "ollama";
  if (models.openai && !OPENAI_MODEL.test(models.openai)) delete models.openai;
  if (guardModels.openai && !OPENAI_MODEL.test(guardModels.openai)) {
    guardModels.ollama ||= guardModels.openai;
    delete guardModels.openai;
  }
  if (keys.openai) {
    keys.ollama ||= keys.openai;
    keys.openai = "";
  }
  if (Array.isArray(stored.modelHistory)) {
    next.modelHistory = stored.modelHistory.map((m) => (m?.provider === "openai" && typeof m.model === "string" && !OPENAI_MODEL.test(m.model) ? { ...m, provider: "ollama", kind } : m));
  }
  return { ...next, models, guardModels, keys };
}
