import { Agent } from "./agent.js";
import { providers } from "./providers/index.js";
import { NO_ACCESS_KEY, busyStatus, pickServerModel, serverCatalog } from "./providers/local.js";
import { DEFAULTS, accessKeyParts, apiKeyFor, gpuBase, cleanSetting, keyProblem, publicConfig, resetConfig } from "./config-core.js";
import { newSessionId, titleFor, transcriptOf } from "./session-format.js";
import { TITLE_ATTEMPTS } from "./title.js";
import { today } from "./limits.js";

const CONNECTION_TEST_TIMEOUT_MS = 15000;
// A local model may first have to load into memory.
const MODEL_TEST_TIMEOUT_MS = 60000;
// The longest task request accepted, from the prompt box or a remote client.
const PROMPT_MAX_CHARS = 50000;
// The events an internal build's debug log keeps (see logEvent), and how much of each text.
const LOGGED_EVENTS = new Set(["request", "status", "notice", "error", "debug", "tool_call", "tool_result", "reply", "speed", "usage", "task_stats", "permission_request", "permission_closed", "notes", "question", "session", "session_title"]);
const LOG_TEXT_MAX_CHARS = 4000;
const hasProvider = (id) => typeof id === "string" && Object.hasOwn(providers, id);

// Rejects with `message` when the promise has not settled within ms.
function within(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Model names that cannot run the agent (embedding, moderation, OCR, speech), for models
// whose provider does not report capabilities.
const NON_CHAT_MODEL = /embed|moderation|transcri|^(babbage|davinci)-|dall-e|gpt-image|sora|(^|[^a-z])(ocr|tts|whisper)([^a-z]|$)/i;

// The first listed model that can chat with tools, or null.
async function firstChatModel(provider, models, apiKey, config) {
  for (const model of models) {
    if (!NON_CHAT_MODEL.test(model) && (await provider.canChat?.({ apiKey, model, config })) !== false) return model;
  }
  return null;
}

// Lists the provider's models, then sends one tiny real request with the chosen model (or
// the first listed chat model), so an account without credit or an Ollama server that refuses the
// extension fails here rather than on the first task. Returns the success text; throws
// with the provider's own explanation.
async function testConnection(id, apiKey, config) {
  const provider = providers[id];
  const started = Date.now();
  try {
    // The GPU server is tested with the model of its catalog that a task would use.
    const gpu = id === "ollama" && config.localKind === "gpu";
    const catalog = gpu ? await within(serverCatalog(config), CONNECTION_TEST_TIMEOUT_MS, "No response within 15 seconds.") : null;
    if (catalog && !catalog.models.length) throw new Error("The GPU server answered but offers no models. Add one on the server with: models add, then test again.");
    const models = catalog ? catalog.models.map((m) => m.id) : await within(provider.listModels({ apiKey, config }), CONNECTION_TEST_TIMEOUT_MS, "No response within 15 seconds.");
    // The built-in default model is skipped when the endpoint does not list it; a model the
    // user chose is always the one tested.
    const unlistedDefault = config.models[id] === DEFAULTS.models[id] && models.length && !models.includes(config.models[id]);
    const saved = catalog ? pickServerModel(catalog, config.models[id]).id : unlistedDefault ? "" : config.models[id];
    const model = saved || (await within(firstChatModel(provider, models, apiKey, config), CONNECTION_TEST_TIMEOUT_MS, "No response within 15 seconds."));
    if (!model) {
      const ollama = id === "ollama" && config.localKind === "ollama";
      const fix = ollama ? "Pull one that supports tools with ollama pull <model>" : "Pick a chat model in Settings > Models";
      if (!models.length) {
        if (ollama) throw new Error(`Ollama is running but has no models yet. ${fix}, then test again.`);
        if (id === "ollama") throw new Error("The server answered but lists no models. Load one on the server, then test again.");
        throw new Error("The provider lists no models for this key.");
      }
      throw new Error(`None of the ${models.length} listed models can chat with tools; they look like embedding, speech or other special-purpose models. ${fix}, then test again.`);
    }
    const count = `${models.length} model${models.length === 1 ? "" : "s"} available`;
    const slow = `${model} did not answer within 60 seconds.`;
    try {
      await within(provider.ping({ apiKey, model, config }), MODEL_TEST_TIMEOUT_MS, slow);
    } catch (err) {
      // An OpenAI-compatible server can take minutes to load a model into memory; it answered the listing.
      if (err.message !== slow || !(id === "ollama" && config.localKind !== "ollama")) throw err;
      return `Connected. ${count}; ${model} is still loading, so its first answer can take a few minutes.`;
    }
    return `Connected in ${((Date.now() - started) / 1000).toFixed(1)}s. ${count}; ${model} answered.`;
  } catch (err) {
    throw new Error(provider.describeError(err) || err.message);
  }
}

// What a remote client (a chat bridge such as Discord) may send: start a task, stop it, and
// answer a permission prompt. Settings, keys and data change only at the computer.
const REMOTE_MESSAGES = new Set(["run", "stop", "permission"]);
// Prompts only the person at the computer can approve.
export const LOCAL_ONLY_PROMPTS = new Set(["sensitive", "password"]);


// The conversation behind every UI: runs tasks, keeps the saved session in step, applies
// Ghost mode, and answers the UI's messages. The host (extension/sidepanel-main.js, or a
// test) supplies:
//   loadConfig/saveConfig settings storage (async)
//   sessions              { save, list, load, remove, removeAll } (async)
//   ensureBrowser(agent)  connects agent.browser
//   loadUsage/saveUsage   today's token count, { day, tokens }, for the daily limit
//   outlook               Outlook on Microsoft Graph (extension; see outlook-graph.js), optional
//   debugLog              { append(sessionId, lines) }, internal builds only (extension/debug-log.js)
export function createController(host) {
  const clients = new Set();
  let pendingPermission = null;
  let permissionCount = 0;
  // Per client: { remote } from connect(); local UIs are not remote.
  const clientInfo = new WeakMap();
  // The saved conversation the agent's history belongs to: { id, title, created }, or
  // null until the first request of a new conversation is saved.
  let session = null;
  // Counts conversation switches (new, opened), so a title written for one is never given to
  // another. early: titling done before the conversation's first save, for the session.
  let conversationEpoch = 0;
  let early = { title: null, attempts: 0 };
  let naming = false;
  // Ghost mode saves nothing: no session. It is on when the
  // user switches it on, and forced on while any incognito client is connected. A
  // conversation that starts as a ghost stays one until a new conversation begins, so it
  // is never saved later, even after the lock lifts.
  let savedGhost = false;
  const incognitoClients = new Set();
  const ghostLocked = () => incognitoClients.size > 0;
  const ghostActive = () => savedGhost || ghostLocked();
  let conversationGhost = false;
  const unsaved = () => conversationGhost || ghostActive();
  const ready = host.loadConfig().then((config) => {
    savedGhost = config.ghostMode;
    conversationGhost = ghostActive();
  });

  // The config as the UI sees it: no keys, and the effective Ghost mode state.
  const clientConfig = (config) => ({
    ...publicConfig(config),
    ghostMode: unsaved(),
    ghostLocked: ghostLocked(),
  });

  // Internal builds (host.debugLog): every event of a saved conversation, for `browser-agent
  // session-logs`. Streamed text is left out (replies arrive whole), images become a marker and
  // long text is cut. Events before the conversation's first save wait in pendingLog.
  let pendingLog = [];
  const forLog = (blocks) =>
    blocks?.map((b) => (b.type === "image" ? { type: "image" } : b.type === "text" && b.text.length > LOG_TEXT_MAX_CHARS ? { ...b, text: `${b.text.slice(0, LOG_TEXT_MAX_CHARS)} [cut]` } : b));
  function logEvent(event) {
    if (!host.debugLog || !LOGGED_EVENTS.has(event.type) || unsaved()) return;
    pendingLog.push({ ts: new Date().toISOString(), ...event, ...(event.content ? { content: forLog(event.content) } : {}) });
    if (session) host.debugLog.append(session.id, pendingLog.splice(0)).catch(() => {});
  }

  const broadcast = (event) => {
    logEvent(event);
    for (const client of clients) client.send(event);
  };

  // Tells every UI whether the gate in front of a Local server is busy with another
  // install; a null status hides the notice.
  // On the Browsby GPU server: fetches its catalog for every UI and moves a model the server
  // no longer offers to its new id or the server's default, saving the switch. Returns the
  // config to run with and the catalog entry, or null off the GPU server, or when the
  // server cannot be reached (the request then shows why). The entry is null for an empty
  // catalog.
  async function syncServerModels(config) {
    if (config.provider !== "ollama" || config.localKind !== "gpu" || !gpuBase(config)) return null;
    let catalog;
    try {
      catalog = await serverCatalog(config);
    } catch (err) {
      if (config.debugMode) broadcast({ type: "debug", text: `Could not load the GPU server's models: ${err.message}` });
      return null;
    }
    broadcast({ type: "server_models", ...catalog });
    const current = config.models.ollama;
    const entry = pickServerModel(catalog, current);
    if (entry && entry.id !== current) {
      config = { ...config, models: { ...config.models, ollama: entry.id } };
      await host.saveConfig(config);
      broadcastConfig(config);
      if (current) {
        const renamed = entry.aliases.includes(current) || entry.backend === current;
        broadcast({ type: "notice", text: renamed ? `${current} is now ${entry.name} on the GPU server.` : `${current} is no longer on the GPU server, so Browsby switched to ${entry.name}.` });
      }
    }
    return { config, entry };
  }

  const checkBusy = async (config) => broadcast({ type: "busy", kind: config.localKind, status: await busyStatus(config) });

  const broadcastConfig = (config) => {
    savedGhost = config.ghostMode;
    broadcast({ type: "config", config: clientConfig(config) });
  };

  // Called when an incognito client connects or disconnects. When the lock starts, an
  // idle conversation is replaced by a ghost one; a running task continues but from then
  // on nothing more of it is saved or logged.
  async function ghostLockChanged() {
    if (ghostLocked() && !conversationGhost) {
      if (!agent.running && agent.messages.length) clearConversation();
      else conversationGhost = true;
    }
    broadcastConfig(await host.loadConfig());
  }

  async function persistSession() {
    if (unsaved() || agent.messages.length === 0) return;
    const created = !session;
    if (created) {
      session = { id: newSessionId(), title: early.title ?? titleFor(agent.messages), titleSource: early.title ? "model" : "request", titleAttempts: early.attempts, created: new Date().toISOString() };
      early = { title: null, attempts: 0 };
    }
    try {
      await host.sessions.save({ ...session, messages: agent.shownMessages(), usage: agent.usage, notes: agent.notes });
    } catch (err) {
      console.error(`Could not save the session: ${err.message}`);
      return;
    }
    if (created) broadcast({ type: "session", id: session.id, title: session.title });
  }

  // Names a conversation the model has not named yet, alongside the task that request
  // starts. A failed attempt leaves the request's opening words and is tried again with the
  // next request, up to TITLE_ATTEMPTS. A title the user set is never replaced.
  async function nameSession(config, request) {
    if (naming || unsaved()) return;
    const { titleSource, titleAttempts } = session ?? { titleSource: early.title ? "model" : "request", titleAttempts: early.attempts };
    if (titleSource !== "request" || titleAttempts >= TITLE_ATTEMPTS) return;
    naming = true;
    const epoch = conversationEpoch;
    let title = null;
    try {
      title = await agent.title(config, request);
    } catch (err) {
      if (config.debugMode) broadcast({ type: "debug", text: `Could not title the conversation: ${err.message}` });
    } finally {
      naming = false;
    }
    if (epoch !== conversationEpoch || unsaved()) return;
    if (!session) {
      early = { title, attempts: early.attempts + 1 };
      return;
    }
    session.titleAttempts += 1;
    if (title) Object.assign(session, { title, titleSource: "model" });
    await persistSession();
    if (title) broadcast({ type: "session_title", id: session.id, title });
  }

  // Starts a new, empty conversation in every open UI.
  function clearConversation() {
    agent.reset();
    resolvePermission("deny");
    session = null;
    conversationEpoch++;
    early = { title: null, attempts: 0 };
    pendingLog = [];
    conversationGhost = ghostActive();
    broadcast({ type: "cleared" });
  }

  // Tokens used today across tasks. Counted in Ghost mode too, since it holds no content.
  const ledger = {
    async used() {
      const usage = await host.loadUsage();
      return usage?.day === today() ? usage.tokens : 0;
    },
    async add(tokens) {
      await host.saveUsage({ day: today(), tokens: (await ledger.used()) + tokens });
    },
  };

  const agent = new Agent({
    ledger,
    emit: broadcast,
    onHistory: () => persistSession(),
    // Each prompt has an id, and an answer counts only for the prompt it was given for, so
    // a late answer (an old notification, a second window) cannot approve a newer prompt.
    askPermission: ({ text, allowAlways, origin, kind = "safety" }) =>
      new Promise((resolve) => {
        pendingPermission = { id: `p${++permissionCount}`, resolve, origin, text, allowAlways, kind };
        broadcast(permissionRequest());
      }),
  });
  // Outlook's tools (outlook-graph.js), under mcp__ names.
  agent.mcp = host.outlook ?? null;

  const permissionRequest = () => ({
    type: "permission_request",
    id: pendingPermission.id,
    text: pendingPermission.text,
    allowAlways: pendingPermission.allowAlways,
    kind: pendingPermission.kind,
  });

  async function resolvePermission(decision) {
    if (!pendingPermission) return;
    const { resolve, origin } = pendingPermission;
    pendingPermission = null;
    if (decision === "always" && origin) {
      const config = await host.loadConfig();
      if (!config.approvedOrigins.includes(origin)) config.approvedOrigins.push(origin);
      await host.saveConfig(config);
      broadcastConfig(config);
    }
    broadcast({ type: "permission_closed" });
    resolve(decision);
  }

  async function handle(client, msg) {
    await ready;
    const reply = (event) => client.send(event);
    const { remote = false } = clientInfo.get(client) ?? {};
    if (!msg || typeof msg !== "object") return;
    if (remote && !REMOTE_MESSAGES.has(msg.type)) return;
    switch (msg.type) {
      case "hello": {
        if (msg.incognito && !incognitoClients.has(client)) {
          incognitoClients.add(client);
          await ghostLockChanged();
        }
        const config = await host.loadConfig();
        reply({ type: "config", config: clientConfig(config) });
        reply({ type: "status", running: agent.running });
        syncServerModels(config).catch(() => {});
        if (pendingPermission) reply(permissionRequest());
        if (host.outlook) reply(await host.outlook.status());
        if (agent.messages.length) {
          reply({ type: "conversation", id: session?.id ?? null, title: session?.title ?? null, transcript: transcriptOf(agent.shownMessages()), notes: agent.notes });
        }
        return;
      }
      case "run": {
        if (agent.running) return reply({ type: "error", text: "A task is already running." });
        const text = typeof msg.text === "string" ? msg.text.trim() : "";
        if (!text) return;
        if (text.length > PROMPT_MAX_CHARS) {
          return reply({ type: "error", text: `That request is too long. Keep it under ${PROMPT_MAX_CHARS.toLocaleString("en-US")} characters.` });
        }
        try {
          let config = await host.loadConfig();
          if (config.provider === "ollama" && config.localKind === "gpu" && !gpuBase(config)) throw new Error(NO_ACCESS_KEY);
          const synced = await syncServerModels(config);
          if (synced && !synced.entry) throw new Error("The GPU server offers no models right now. Add one on the server with: models add");
          if (synced) config = { ...synced.config, summaryAt: synced.entry.summaryAt };
          logEvent({ type: "request", text, provider: config.provider, model: config.models[config.provider], localKind: config.localKind, permissionMode: config.permissionMode });
          if (config.provider === "ollama") checkBusy(config);
          nameSession(config, text);
          await host.ensureBrowser(agent);
          await agent.run(text, config);
        } catch (err) {
          broadcast({ type: "error", text: err.message });
        }
        return;
      }
      case "stop":
        agent.stop();
        resolvePermission("deny");
        return;
      case "outlook_status":
        if (host.outlook) reply(await host.outlook.status());
        return;
      case "outlook_sign_in":
      case "outlook_sign_out": {
        if (!host.outlook) return;
        let error = null;
        try {
          if (msg.type === "outlook_sign_in") await host.outlook.signIn();
          else await host.outlook.signOut();
        } catch (err) {
          error = err.message;
        }
        broadcast({ ...(await host.outlook.status()), error });
        return;
      }
      case "discord_status":
        if (host.discord) reply(await host.discord.status());
        return;
      case "discord_save": {
        const token = typeof msg.token === "string" ? msg.token.trim() : "";
        if (!host.discord || !token) return;
        const problem = keyProblem(token, "bot token");
        if (problem) return reply({ type: "discord_checks", ok: false, checks: [{ id: "token", ok: false, text: problem }] });
        // The checks Discord ran on the token (accepted, install, commands), for setup.
        reply({ type: "discord_checks", ...(await host.discord.configure(token)) });
        return;
      }
      case "discord_unpair":
        await host.discord?.unpair();
        return;
      case "discord_remove":
        await host.discord?.remove();
        return;
      case "self_test": {
        const results = [];
        const check = async (name, run) => {
          try {
            results.push({ name, ok: true, text: await run() });
          } catch (err) {
            results.push({ name, ok: false, text: err.message });
          }
        };
        const config = await host.loadConfig();
        await check(`Model provider (${config.provider})`, async () => {
          const apiKey = apiKeyFor(config, config.provider);
          if (config.provider !== "ollama" && !apiKey) throw new Error("No API key. Add one in Settings > Models.");
          return testConnection(config.provider, apiKey, config);
        });
        await check("Agent browser", async () => {
          await host.ensureBrowser(agent);
          return `connected; current tab ${(await agent.browser.currentPage()).url.slice(0, 80)}`;
        });
        reply({ type: "self_test", results });
        return;
      }
      case "reset":
        clearConversation();
        return;
      case "busy_check": {
        const config = await host.loadConfig();
        if (config.provider === "ollama") await checkBusy(config);
        return;
      }
      case "list_sessions":
        reply({ type: "sessions", sessions: await host.sessions.list(), current: session?.id ?? null });
        return;
      case "open_session": {
        if (agent.running) return reply({ type: "error", text: "Stop the running task before opening another session." });
        const saved = await host.sessions.load(msg.id);
        agent.restore(saved);
        resolvePermission("deny");
        // Sessions saved before titleSource have titled (true once the model named them).
        session = {
          id: saved.id,
          title: saved.title,
          titleSource: saved.titleSource ?? (saved.titled ? "model" : "request"),
          titleAttempts: saved.titleAttempts ?? 0,
          created: saved.created,
        };
        conversationEpoch++;
        early = { title: null, attempts: 0 };
        conversationGhost = ghostActive();
        broadcast({ type: "conversation", id: saved.id, title: saved.title, transcript: transcriptOf(saved.messages), notes: agent.notes });
        return;
      }
      case "delete_session":
        if (msg.id === session?.id) {
          if (agent.running) return reply({ type: "error", text: "Stop the running task before deleting this session." });
          clearConversation();
        }
        await host.sessions.remove(msg.id);
        broadcast({ type: "sessions", sessions: await host.sessions.list(), current: session?.id ?? null });
        return;
      case "delete_all_sessions":
        if (agent.running) return reply({ type: "error", text: "Stop the running task before deleting sessions." });
        await host.sessions.removeAll();
        if (session) clearConversation();
        broadcast({ type: "sessions", sessions: [], current: null });
        return;
      case "set_ghost": {
        if (agent.running) return reply({ type: "error", text: "Stop the running task before switching Ghost mode." });
        if (!msg.on && ghostLocked()) {
          return reply({ type: "error", text: "Ghost mode is on during incognito mode" });
        }
        const config = await host.loadConfig();
        config.ghostMode = Boolean(msg.on);
        await host.saveConfig(config);
        broadcastConfig(config);
        // Ghost mode applies to whole conversations, so switching starts a new one.
        clearConversation();
        return;
      }
      case "data_info":
        reply({
          type: "data_info",
          sessions: (await host.sessions.list()).length,
          tokensToday: await ledger.used(),
        });
        return;
      case "reset_config": {
        const config = resetConfig(await host.loadConfig());
        await host.saveConfig(config);
        broadcastConfig(config);
        reply({ type: "config_reset" });
        return;
      }
      case "test_provider": {
        // Tests the typed (unsaved) key or endpoint when given, else the saved one.
        if (!hasProvider(msg.provider)) return;
        const config = await host.loadConfig();
        const result = (ok, text) => reply({ type: "provider_test", provider: msg.provider, ok, text });
        try {
          if (msg.key) {
            const key = String(msg.key).trim();
            const problem = keyProblem(key);
            if (problem) return result(false, problem);
            // On the Browsby GPU server the key is an access key, kept apart from a server's API key.
            if (msg.provider === "ollama" && msg.kind === "gpu") {
              if (!accessKeyParts(key)) return result(false, "That is not a Browsby access key. Copy the whole key, starting with bzk1_, and paste it again.");
              config.keys.gpu = key;
            } else config.keys[msg.provider] = key;
          }
          if (msg.provider === "ollama") {
            // The model chosen for another kind of connection is not tested on this one.
            if (msg.kind !== undefined && msg.kind !== config.localKind) {
              config.localKind = cleanSetting("localKind", msg.kind);
              config.models.ollama = "";
            }
            if (msg.host) config.ollamaHost = cleanSetting("ollamaHost", String(msg.host).trim());
            if (typeof msg.baseUrl === "string" && config.localKind === "server") config.serverBaseUrl = cleanSetting("serverBaseUrl", msg.baseUrl.trim());
            if (config.localKind === "gpu" && !gpuBase(config)) return result(false, "Paste the access key you were given (it starts with bzk1_).");
            if (config.localKind === "server" && !config.serverBaseUrl) return result(false, "Enter the server's base URL first.");
          }
        } catch (err) {
          return result(false, err.message);
        }
        const apiKey = apiKeyFor(config, msg.provider);
        if (msg.provider !== "ollama" && !apiKey) return result(false, "No key to test. Paste a key first.");
        try {
          result(true, await testConnection(msg.provider, apiKey, config));
        } catch (err) {
          result(false, err.message);
        }
        return;
      }
      case "permission": {
        if (!pendingPermission || msg.id !== pendingPermission.id) return reply({ type: "permission_stale" });
        if (!["once", "always", "deny"].includes(msg.decision)) return;
        if (remote && msg.decision !== "deny" && LOCAL_ONLY_PROMPTS.has(pendingPermission.kind)) {
          return reply({ type: "error", text: "This one can only be approved at the computer." });
        }
        // "Always" changes settings, which only the computer does.
        resolvePermission(remote && msg.decision === "always" ? "once" : msg.decision);
        return;
      }
      case "save_config": {
        const config = await host.loadConfig();
        const patch = msg.patch && typeof msg.patch === "object" ? msg.patch : {};
        // Ghost mode changes only through set_ghost, which also starts a new conversation,
        // and the Discord bot only through the discord_* messages. Other names that are not
        // settings are ignored; every value is checked before anything is saved.
        const { keys, ghostMode: _ghost, discord: _discord, ...rest } = patch;
        const changes = {};
        for (const [key, value] of Object.entries(rest)) {
          if (!Object.hasOwn(config, key) || key === "keys") continue;
          const merged = ["models", "limits", "guardModels"].includes(key) && value && typeof value === "object" ? { ...config[key], ...value } : value;
          changes[key] = cleanSetting(key, merged);
        }
        // Empty key fields mean "unchanged"; "__clear__" removes a saved key.
        const keyChanges = {};
        for (const [p, k] of Object.entries(keys && typeof keys === "object" ? keys : {})) {
          if (!Object.hasOwn(config.keys, p) || !k) continue;
          if (k === "__clear__") keyChanges[p] = "";
          else {
            const key = String(k).trim();
            const problem = keyProblem(key);
            if (problem) throw new Error(problem);
            keyChanges[p] = key;
          }
        }
        Object.assign(config, changes);
        Object.assign(config.keys, keyChanges);
        await host.saveConfig(config);
        broadcastConfig(config);
        return;
      }
      case "list_models": {
        if (!hasProvider(msg.provider)) return;
        const config = await host.loadConfig();
        const provider = providers[msg.provider];
        const apiKey = apiKeyFor(config, msg.provider);
        if (msg.provider !== "ollama" && !apiKey) {
          reply({ type: "models", provider: msg.provider, models: [], error: `Save a ${msg.provider} API key to load its models.` });
          return;
        }
        // The GPU server offers its catalog only (syncServerModels also tells every UI).
        if (msg.provider === "ollama" && config.localKind === "gpu") {
          // Nobody sees the server's models without a key it accepts.
          if (!gpuBase(config)) return reply({ type: "models", provider: msg.provider, models: [], error: "Paste your access key to see the server's models." });
          try {
            reply({ type: "models", provider: msg.provider, models: (await serverCatalog(config)).models.map((m) => m.id) });
            await syncServerModels(config);
          } catch (err) {
            const text = /failed to fetch|network|timed out|aborted/i.test(err.message) ? "Could not reach the GPU server. Check your internet connection." : err.message;
            reply({ type: "models", provider: msg.provider, models: [], error: text });
          }
          return;
        }
        try {
          const models = (await provider.listModels({ apiKey, config })).filter((m) => !NON_CHAT_MODEL.test(m));
          reply({ type: "models", provider: msg.provider, models });
        } catch (err) {
          reply({ type: "models", provider: msg.provider, models: [], error: provider.describeError(err) || err.message });
        }
        return;
      }
    }
  }

  return {
    agent,
    ensureBrowser: () => host.ensureBrowser(agent),
    // Re-reads settings that changed outside this controller and updates every UI.
    refreshConfig: async () => broadcastConfig(await host.loadConfig()),
    // Tells every UI that Outlook was signed in or out elsewhere.
    outlookChanged: async () => host.outlook && broadcast(await host.outlook.status()),
    // Tells every UI that the Discord bridge's status changed.
    discordChanged: async () => host.discord && broadcast(await host.discord.status()),
    // client: { send(event) }. Returns the function that takes the client's messages.
    // options.remote: a bridge that may only send REMOTE_MESSAGES.
    connect(client, { remote = false } = {}) {
      clients.add(client);
      clientInfo.set(client, { remote });
      return (msg) => handle(client, msg).catch((err) => client.send({ type: "error", text: err.message }));
    },
    disconnect(client) {
      clients.delete(client);
      if (incognitoClients.delete(client)) ghostLockChanged();
    },
  };
}
