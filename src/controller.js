import { Agent } from "./agent.js";
import { providers } from "./providers/index.js";
import { apiKeyFor, publicConfig, resetConfig } from "./config-core.js";
import { newSessionId, titleFor, transcriptOf } from "./session-format.js";
import { today } from "./limits.js";

const CONNECTION_TEST_TIMEOUT_MS = 15000;

// The conversation behind every UI: runs tasks, keeps the saved session in step, applies
// Ghost mode, and answers the UI's messages. Both editions use it; the host supplies
// what differs between them:
//   env                   environment variables that may hold API keys ({} in the extension)
//   loadConfig/saveConfig settings storage (async)
//   sessions              { save, list, load, remove, removeAll } (async)
//   log(event)            activity log sink, optional; clearLog(), logBytes() with it
//   dataLocation          where data is kept, shown in Settings
//   ensureBrowser(agent)  connects agent.browser (and agent.desktop locally)
//   desktop               { status(), requestAccess() } locally, null in the extension
//   loadUsage/saveUsage   today's token count, { day, tokens }, for the daily limit
//   defaults              the edition's changes to the default settings
export function createController(host) {
  const clients = new Set();
  let pendingPermission = null;
  // The saved conversation the agent's history belongs to: { id, title, created }, or
  // null until the first request of a new conversation is saved.
  let session = null;
  // Ghost mode saves nothing: no session and no activity log entries. It is on when the
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

  const record = (event) => {
    if (!unsaved()) host.log?.(event);
  };

  // The config as the UI sees it: no keys, and the effective Ghost mode state.
  const clientConfig = (config) => ({
    ...publicConfig(config, host.env),
    ghostMode: unsaved(),
    ghostLocked: ghostLocked(),
    edition: host.edition,
  });

  const broadcast = (event) => {
    record(event);
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
    env: host.env,
    ledger,
    emit: broadcast,
    onHistory: () => persistSession(),
    askPermission: ({ text, allowAlways, origin }) =>
      new Promise((resolve) => {
        pendingPermission = { resolve, origin, text, allowAlways };
        broadcast({ type: "permission_request", text, allowAlways });
      }),
  });

  async function resolvePermission(decision) {
    if (!pendingPermission) return;
    const { resolve, origin } = pendingPermission;
    pendingPermission = null;
    record({ type: "permission_answer", decision });
    if (decision === "always" && origin) {
      const config = await host.loadConfig();
      if (!config.approvedOrigins.includes(origin)) config.approvedOrigins.push(origin);
      await host.saveConfig(config);
      broadcastConfig(config);
    }
    broadcast({ type: "permission_closed" });
    resolve(decision);
  }

  const desktopStatus = async () => (host.desktop ? host.desktop.status().catch((e) => ({ error: e.message })) : null);

  async function handle(client, msg) {
    await ready;
    const reply = (event) => client.send(event);
    switch (msg.type) {
      case "hello": {
        if (msg.incognito && !incognitoClients.has(client)) {
          incognitoClients.add(client);
          await ghostLockChanged();
        }
        reply({ type: "config", config: clientConfig(await host.loadConfig()) });
        reply({ type: "status", running: agent.running });
        if (pendingPermission) {
          reply({ type: "permission_request", text: pendingPermission.text, allowAlways: pendingPermission.allowAlways });
        }
        if (agent.messages.length) {
          reply({ type: "conversation", id: session?.id ?? null, title: session?.title ?? null, transcript: transcriptOf(agent.messages) });
        }
        if (host.desktop) reply({ type: "desktop_status", status: await desktopStatus() });
        return;
      }
      case "run": {
        if (agent.running) return reply({ type: "error", text: "A task is already running." });
        record({ type: "task", text: String(msg.text) });
        try {
          await host.ensureBrowser(agent);
          await agent.run(String(msg.text), await host.loadConfig());
        } catch (err) {
          broadcast({ type: "error", text: err.message });
        }
        return;
      }
      case "stop":
        agent.stop();
        resolvePermission("deny");
        return;
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
      case "clear_activity_log":
        await host.clearLog?.();
        reply({ type: "activity_log_cleared" });
        return;
      case "data_info":
        reply({
          type: "data_info",
          home: host.dataLocation,
          sessions: (await host.sessions.list()).length,
          activityBytes: host.logBytes ? await host.logBytes() : null,
          tokensToday: await ledger.used(),
        });
        return;
      case "reset_config": {
        const config = resetConfig(await host.loadConfig(), host.defaults);
        await host.saveConfig(config);
        broadcastConfig(config);
        reply({ type: "config_reset" });
        return;
      }
      case "test_provider": {
        // Tests the typed (unsaved) key or endpoint when given, else the saved one.
        const provider = providers[msg.provider];
        if (!provider) return;
        const config = await host.loadConfig();
        if (msg.key) config.keys[msg.provider] = String(msg.key).trim();
        if (msg.provider === "openai" && typeof msg.baseUrl === "string") config.openaiBaseUrl = msg.baseUrl.trim();
        if (msg.provider === "ollama" && msg.host) config.ollamaHost = String(msg.host).trim();
        const apiKey = apiKeyFor(config, msg.provider, host.env);
        const result = (ok, text) => reply({ type: "provider_test", provider: msg.provider, ok, text });
        if (msg.provider !== "ollama" && !apiKey) return result(false, "No key to test. Paste a key first.");
        const started = Date.now();
        try {
          const models = await Promise.race([
            provider.listModels({ apiKey, config }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("No response within 15 seconds.")), CONNECTION_TEST_TIMEOUT_MS)),
          ]);
          result(true, `Connected in ${((Date.now() - started) / 1000).toFixed(1)}s. ${models.length} model${models.length === 1 ? "" : "s"} available.`);
        } catch (err) {
          result(false, provider.describeError(err) || err.message);
        }
        return;
      }
      case "permission":
        resolvePermission(msg.decision);
        return;
      case "save_config": {
        const config = await host.loadConfig();
        // Ghost mode changes only through set_ghost, which also starts a new conversation.
        const { keys, models, ghostMode: _ghost, ...rest } = msg.patch || {};
        Object.assign(config, rest);
        if (models) Object.assign(config.models, models);
        // Empty key fields mean "unchanged"; "__clear__" removes a saved key.
        for (const [p, k] of Object.entries(keys || {})) {
          if (k === "__clear__") config.keys[p] = "";
          else if (k) config.keys[p] = k.trim();
        }
        await host.saveConfig(config);
        broadcastConfig(config);
        return;
      }
      case "list_models": {
        const config = await host.loadConfig();
        const provider = providers[msg.provider];
        const apiKey = apiKeyFor(config, msg.provider, host.env);
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
      case "desktop_status":
        if (host.desktop) reply({ type: "desktop_status", status: await desktopStatus() });
        return;
      case "request_desktop_access":
        if (!host.desktop) return;
        await host.desktop.requestAccess().catch(() => {});
        reply({ type: "desktop_status", status: await desktopStatus() });
        return;
      case "open_browser":
        try {
          await host.ensureBrowser(agent);
          await agent.browser.bringToFront();
        } catch (err) {
          reply({ type: "error", text: err.message });
        }
        return;
    }
  }

  return {
    agent,
    ensureBrowser: () => host.ensureBrowser(agent),
    // Re-reads settings that changed outside this controller and updates every UI.
    refreshConfig: async () => broadcastConfig(await host.loadConfig()),
    // client: { send(event) }. Returns the function that takes the client's messages.
    connect(client) {
      clients.add(client);
      return (msg) => handle(client, msg).catch((err) => client.send({ type: "error", text: err.message }));
    },
    disconnect(client) {
      clients.delete(client);
      if (incognitoClients.delete(client)) ghostLockChanged();
    },
  };
}
