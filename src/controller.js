import { Agent } from "./agent.js";
import { providers } from "./providers/index.js";
import { apiKeyFor, cleanSetting, keyProblem, publicConfig, resetConfig } from "./config-core.js";
import { newSessionId, titleFor, transcriptOf } from "./session-format.js";
import { today } from "./limits.js";

const CONNECTION_TEST_TIMEOUT_MS = 15000;
// A local model may first have to load into memory.
const MODEL_TEST_TIMEOUT_MS = 60000;
// The longest task request accepted, from the prompt box or a remote client.
const PROMPT_MAX_CHARS = 50000;
const hasProvider = (id) => typeof id === "string" && Object.hasOwn(providers, id);

// Rejects with `message` when the promise has not settled within ms.
function within(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Lists the provider's models, then sends one tiny real request with the chosen model (or
// the first listed), so an account without credit or an Ollama server that refuses the
// extension fails here rather than on the first task. Returns the success text; throws
// with the provider's own explanation.
async function testConnection(id, apiKey, config) {
  const provider = providers[id];
  const started = Date.now();
  try {
    const models = await within(provider.listModels({ apiKey, config }), CONNECTION_TEST_TIMEOUT_MS, "No response within 15 seconds.");
    const model = config.models[id] || models[0];
    if (!model) {
      if (id === "ollama") throw new Error("Ollama is running but has no models yet. Pull one that supports tools with ollama pull <model>, then test again.");
      throw new Error("The provider lists no models for this key.");
    }
    await within(provider.ping({ apiKey, model, config }), MODEL_TEST_TIMEOUT_MS, `${model} did not answer within 60 seconds.`);
    const count = `${models.length} model${models.length === 1 ? "" : "s"} available`;
    return `Connected in ${((Date.now() - started) / 1000).toFixed(1)}s. ${count}; ${model} answered.`;
  } catch (err) {
    throw new Error(provider.describeError(err) || err.message);
  }
}

// What a remote client (a chat bridge such as Discord) may send: start a task, stop it, and
// answer a permission prompt. Settings, keys and data change only at the computer.
const REMOTE_MESSAGES = new Set(["run", "stop", "permission"]);
// Prompts only the person at the computer can approve.
const LOCAL_ONLY_PROMPTS = new Set(["sensitive", "password"]);


// The conversation behind every UI: runs tasks, keeps the saved session in step, applies
// Ghost mode, and answers the UI's messages. The host (extension/sidepanel-main.js, or a
// test) supplies:
//   loadConfig/saveConfig settings storage (async)
//   sessions              { save, list, load, remove, removeAll } (async)
//   ensureBrowser(agent)  connects agent.browser
//   loadUsage/saveUsage   today's token count, { day, tokens }, for the daily limit
//   outlook               Outlook on Microsoft Graph (extension; see outlook-graph.js), optional
export function createController(host) {
  const clients = new Set();
  let pendingPermission = null;
  let permissionCount = 0;
  // Per client: { remote } from connect(); local UIs are not remote.
  const clientInfo = new WeakMap();
  // The saved conversation the agent's history belongs to: { id, title, created }, or
  // null until the first request of a new conversation is saved.
  let session = null;
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

  const broadcast = (event) => {
    for (const client of clients) client.send(event);
  };

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
    if (created) session = { id: newSessionId(), title: titleFor(agent.messages), created: new Date().toISOString() };
    try {
      await host.sessions.save({ ...session, messages: agent.messages, usage: agent.usage });
    } catch (err) {
      console.error(`Could not save the session: ${err.message}`);
      return;
    }
    if (created) broadcast({ type: "session", id: session.id, title: session.title });
  }

  // Starts a new, empty conversation in every open UI.
  function clearConversation() {
    agent.reset();
    resolvePermission("deny");
    session = null;
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
        reply({ type: "config", config: clientConfig(await host.loadConfig()) });
        reply({ type: "status", running: agent.running });
        if (pendingPermission) reply(permissionRequest());
        if (host.outlook) reply(await host.outlook.status());
        if (agent.messages.length) {
          reply({ type: "conversation", id: session?.id ?? null, title: session?.title ?? null, transcript: transcriptOf(agent.messages) });
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
          await host.ensureBrowser(agent);
          await agent.run(text, await host.loadConfig());
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
        if (problem) return reply({ type: "error", text: problem });
        await host.discord.configure(token);
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
      case "list_sessions":
        reply({ type: "sessions", sessions: await host.sessions.list(), current: session?.id ?? null });
        return;
      case "open_session": {
        if (agent.running) return reply({ type: "error", text: "Stop the running task before opening another session." });
        const saved = await host.sessions.load(msg.id);
        agent.restore(saved);
        resolvePermission("deny");
        session = { id: saved.id, title: saved.title, created: saved.created };
        conversationGhost = ghostActive();
        broadcast({ type: "conversation", id: saved.id, title: saved.title, transcript: transcriptOf(saved.messages) });
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
            config.keys[msg.provider] = key;
          }
          if (msg.provider === "openai" && typeof msg.baseUrl === "string") config.openaiBaseUrl = cleanSetting("openaiBaseUrl", msg.baseUrl.trim());
          if (msg.provider === "ollama" && msg.host) config.ollamaHost = cleanSetting("ollamaHost", String(msg.host).trim());
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
        try {
          const models = await provider.listModels({ apiKey, config });
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
