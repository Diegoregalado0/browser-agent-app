// Remote control over Discord: the owner's own bot, paired to their Discord account, takes
// tasks for the open Browsby windows (remote-sessions.js) through the /browsby slash command,
// buttons, or plain direct messages. Each window takes them as a remote client, so a command
// can only start a task, stop it and answer prompts; everything else stays on the computer.
// Discord can read bot messages, so only prompts, final replies, errors, stop notices and
// progress lines that name the kind of step are sent. It uses only web platform APIs
// (WebSocket, fetch, crypto.getRandomValues), so it runs in the extension's side panel and in
// the Node offline checks.

import { keyProblem } from "./config-core.js";
import { LOCAL_ONLY_PROMPTS } from "./controller.js";

const API = "https://discord.com/api/v10";
const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const GATEWAY_INTENTS = 1 << 12; // DIRECT_MESSAGES; message text in DMs needs no privileged intent.
const MAX_MESSAGE = 1900;
// Close codes after which reconnecting cannot help (bad token, disallowed intents).
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
// Interaction tokens last 15 minutes; after this, messages go to the channel as the bot.
const INTERACTION_TTL_MS = 14 * 60 * 1000;
// Discord allows 5 followups per interaction for an app that is not in the server.
const MAX_FOLLOWUPS = 5;
// The progress message is edited at most this often.
const PROGRESS_EVERY_MS = 2500;
const EPHEMERAL = 64;
// Interaction contexts: 1 is the bot's own DM, where replies need not be private.
const BOT_DM = 1;

// The one command, installable to a server or to a user, usable in servers and DMs.
export const COMMAND = {
  name: "browsby",
  type: 1,
  description: "Control Browsby in your Chrome",
  integration_types: [0, 1],
  contexts: [0, 1, 2],
  options: [
    { type: 1, name: "run", description: "Give Browsby a task", options: [{ type: 3, name: "task", description: "What should it do?", required: true, max_length: 2000 }] },
    { type: 1, name: "stop", description: "Stop the task in the selected window" },
    { type: 1, name: "status", description: "What each Browsby window is doing" },
    { type: 1, name: "sessions", description: "Choose the window that runs your tasks" },
    { type: 1, name: "pair", description: "Pair your account with the code shown in Browsby", options: [{ type: 3, name: "code", description: "The code from Settings > Remote", required: true, max_length: 20 }] },
  ],
};

// What progress lines say about a step: its kind only, never its address or text.
const ACTION_WORDS = {
  screenshot: "Looking at the page", left_click: "Clicking", right_click: "Clicking", double_click: "Clicking",
  triple_click: "Selecting text", hover: "Pointing", type: "Typing", key: "Pressing a key", scroll: "Scrolling",
  left_click_drag: "Dragging", wait: "Waiting",
};
const TOOL_WORDS = {
  navigate: "Opening a page", find: "Reading the page", read_page: "Reading the page", get_page_text: "Reading the page",
  form_input: "Filling in a form", tabs: "Switching tabs", network_requests: "Checking the page's requests",
};
const stepWord = ({ name, action }) =>
  name === "browser" ? ACTION_WORDS[action] ?? "Working" : String(name).startsWith("mcp__") ? "Using Outlook" : TOOL_WORDS[name] ?? "Working";

const clip = (text) => (text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text);
const newPairCode = () => [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
const elapsed = (since) => {
  const s = Math.floor((Date.now() - since) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const steps = (n) => `${n} step${n === 1 ? "" : "s"}`;
const button = (style, label, custom_id) => ({ type: 2, style, label, custom_id });
const row = (...components) => ({ type: 1, components });

export class DiscordBridge {
  // directory: the open sessions (remote-sessions.js). loadConfig/saveConfig: settings
  // storage, where config.discord = { token, userId, userName, pairCode } lives.
  // onChange(): the bridge's status changed. allowed(): whether Chrome lets the extension
  // reach discord.com. api and gateway: Discord's addresses (a local stand-in in
  // scripts/agent-check.js). place: where the agent runs, in replies.
  constructor({ directory, loadConfig, saveConfig, onChange = () => {}, allowed = async () => true, api = API, gateway = GATEWAY, place = "the computer" }) {
    this.api = api;
    this.place = place;
    this.gateway = gateway;
    this.directory = directory;
    directory.onEvent = (id, event) => this.#onEvent(id, event).catch((err) => console.error(`Discord: ${err.message}`));
    this.loadConfig = loadConfig;
    this.saveConfig = saveConfig;
    this.onChange = onChange;
    this.allowed = allowed;
    this.state = "off";
    this.error = null;
    this.token = null;
    this.bot = null;
    this.appId = null;
    this.ws = null;
    this.heartbeat = null;
    this.retry = 0;
    this.dmChannel = null;
    // The window that takes the next task, by session id; the first open one when unset.
    this.selected = null;
    // Tasks started from Discord, by session id: where their messages go and their progress.
    this.tasks = new Map();
  }

  async start() {
    const { discord } = await this.loadConfig();
    if (!discord?.token) return this.#set("off");
    if (!(await this.allowed())) return this.#set("no-access");
    // Checked before the token goes into any request header.
    if (keyProblem(discord.token)) return this.#set("error", "The saved bot token has spaces, line breaks or other characters a token cannot have. Remove the bot and paste the token again.");
    this.#connect(discord.token);
  }

  stop() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.ws) {
      this.ws.onmessage = this.ws.onclose = null;
      this.ws.onerror = () => {};
      this.ws.close();
      this.ws = null;
    }
    for (const task of this.tasks.values()) clearTimeout(task.timer);
    this.tasks.clear();
  }

  // Chrome took back the discord.com permission: disconnect and say why.
  revoke() {
    this.stop();
    this.#set("no-access");
  }

  // A new bot token, checked with Discord before it is saved: the app's details, user
  // install turned on, and the /browsby command registered. Returns the checks, for setup.
  async configure(token) {
    token = String(token).trim();
    let app;
    try {
      app = await this.#api(token, "GET", "/applications/@me");
    } catch (err) {
      const text = /\b401\b/.test(err.message) ? "Discord did not accept this token. Copy it again from Bot > Reset Token in the Developer Portal." : `Could not reach Discord: ${err.message}`;
      return { ok: false, checks: [{ id: "token", ok: false, text }] };
    }
    this.stop();
    const config = await this.loadConfig();
    config.discord = { token, userId: "", userName: "", pairCode: newPairCode() };
    await this.saveConfig(config);
    this.appId = app.id;
    this.bot = { id: app.bot?.id ?? app.id, username: app.bot?.username ?? app.name };
    const checks = [{ id: "token", ok: true, text: `Token accepted for ${this.bot.username}.` }];
    try {
      const installs = { oauth2_install_params: { scopes: ["applications.commands"], permissions: "0" } };
      const updated = await this.#api(token, "PATCH", "/applications/@me", {
        integration_types_config: { 0: { oauth2_install_params: { scopes: ["applications.commands", "bot"], permissions: "0" } }, 1: installs },
      });
      if (!updated?.integration_types_config?.[1]) throw new Error("not on");
      checks.push({ id: "install", ok: true, text: "Ready to add to your Discord account." });
    } catch {
      checks.push({ id: "install", ok: false, text: "Turn on User Install in the Developer Portal: Installation > Installation Contexts. Adding it to a server works without it." });
    }
    try {
      await this.#api(token, "PUT", `/applications/${app.id}/commands`, [COMMAND]);
      checks.push({ id: "commands", ok: true, text: "Added the /browsby command." });
    } catch (err) {
      checks.push({ id: "commands", ok: false, text: `Could not add the /browsby command: ${err.message}` });
    }
    this.dmChannel = null;
    this.retry = 0;
    await this.start();
    return { ok: true, checks };
  }

  async unpair() {
    const config = await this.loadConfig();
    if (!config.discord?.token) return;
    config.discord = { ...config.discord, userId: "", userName: "", pairCode: newPairCode() };
    await this.saveConfig(config);
    this.dmChannel = null;
    this.onChange();
  }

  async remove() {
    this.stop();
    const config = await this.loadConfig();
    config.discord = { token: "", userId: "", userName: "", pairCode: "" };
    await this.saveConfig(config);
    this.bot = null;
    this.appId = null;
    this.#set("off");
  }

  // What Settings shows: never the token.
  async status() {
    const { discord = {} } = await this.loadConfig();
    const id = this.appId;
    return {
      type: "discord_status",
      state: this.state,
      error: this.error,
      botName: this.bot?.username ?? null,
      installUrl: id ? `https://discord.com/oauth2/authorize?client_id=${id}&integration_type=1&scope=applications.commands` : null,
      serverInstallUrl: id ? `https://discord.com/oauth2/authorize?client_id=${id}&integration_type=0&scope=bot+applications.commands&permissions=0` : null,
      dmUrl: this.bot ? `https://discord.com/users/${this.bot.id}` : null,
      paired: Boolean(discord.userId),
      userName: discord.userName || null,
      pairCode: discord.userId ? null : discord.pairCode || null,
      sessions: this.directory.list().map(({ name, running }) => ({ name, running })),
    };
  }

  #set(state, error = null) {
    this.state = state;
    this.error = error;
    this.onChange();
  }

  // Gateway: identify, keep the heartbeat, and reconnect with a growing delay.
  #connect(token) {
    this.stop();
    this.token = token;
    this.#set("connecting");
    const ws = new WebSocket(this.gateway);
    this.ws = ws;
    let seq = null;
    ws.onmessage = ({ data }) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.s !== null && msg.s !== undefined) seq = msg.s;
      if (msg.op === 10) {
        const beat = () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ op: 1, d: seq }));
        this.heartbeat = setInterval(beat, msg.d.heartbeat_interval);
        ws.send(JSON.stringify({ op: 2, d: { token, intents: GATEWAY_INTENTS, properties: { os: "browser", browser: "browsby", device: "browsby" } } }));
      } else if (msg.op === 1) {
        ws.send(JSON.stringify({ op: 1, d: seq }));
      } else if (msg.op === 7 || msg.op === 9) {
        ws.close(4000);
      } else if (msg.op === 0) {
        this.#dispatch(token, msg.t, msg.d).catch((err) => console.error(`Discord: ${err.message}`));
      }
    };
    ws.onclose = ({ code }) => {
      if (this.ws !== ws) return;
      clearInterval(this.heartbeat);
      this.ws = null;
      if (FATAL_CLOSE.has(code)) return this.#set("error", code === 4004 ? "Discord rejected the bot token. Remove the bot and set it up again with a new token." : `Discord closed the connection (${code}).`);
      this.#set("connecting");
      const delay = Math.min(60000, 2000 * 2 ** this.retry++);
      setTimeout(() => this.ws === null && this.state === "connecting" && this.#connect(token), delay);
    };
    ws.onerror = () => {};
  }

  async #api(token, method, path, body) {
    const res = await fetch(`${this.api}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", "User-Agent": "DiscordBot (https://github.com/Diegoregalado0/browser-agent-app, 1.0)" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Discord API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? null : res.json();
  }

  async #dispatch(token, type, d) {
    if (type === "READY") {
      this.retry = 0;
      this.bot = { id: d.user.id, username: d.user.username };
      this.appId = d.application?.id ?? this.appId ?? d.user.id;
      this.#set("connected");
      return;
    }
    if (type === "MESSAGE_CREATE" && !d.guild_id && !d.author?.bot) return this.#onDirectMessage(token, d);
    if (type === "INTERACTION_CREATE" && d.type === 2 && d.data?.name === COMMAND.name) return this.#onCommand(token, d);
    if (type === "INTERACTION_CREATE" && d.type === 3) return this.#onButton(token, d);
  }

  // The window that takes the next task: the one picked with /browsby sessions while it is
  // open, else the first open window.
  #target() {
    const sessions = this.directory.list();
    return sessions.find((s) => s.id === this.selected) ?? sessions[0] ?? null;
  }

  #sessionsText() {
    const sessions = this.directory.list();
    if (!sessions.length) return `No Browsby window is open. Open the Browsby panel in Chrome on ${this.place}.`;
    const target = this.#target();
    const lines = sessions.map((s) => {
      const task = this.tasks.get(s.id);
      const doing = !s.running ? "idle" : task ? `running, ${steps(task.steps)}${task.prompt ? ", waiting for your approval" : ""}` : `running a task started on ${this.place}`;
      return `${s.id === target.id ? "**" : ""}${s.name}${s.id === target.id ? " (selected)**" : ""}: ${doing}${s.title ? `. ${s.title}` : ""}`;
    });
    return clip(`${lines.join("\n")}\n\nNew tasks run in ${target.name}.`);
  }

  #sessionButtons() {
    const target = this.#target();
    const buttons = this.directory
      .list()
      .slice(0, 5)
      .map((s) => button(s.id === target?.id ? 1 : 2, s.name, `use:${s.id}`));
    return buttons.length ? [row(...buttons)] : [];
  }

  async #onCommand(token, interaction) {
    const sub = interaction.data.options?.[0];
    const option = (name) => sub?.options?.find((o) => o.name === name)?.value;
    const flags = interaction.context === BOT_DM ? 0 : EPHEMERAL;
    const respond = (content, extra = {}) =>
      this.#api(token, "POST", `/interactions/${interaction.id}/${interaction.token}/callback`, { type: 4, data: { content: clip(content), flags, ...extra } });
    const config = await this.loadConfig();
    const discord = config.discord ?? {};
    const user = interaction.user ?? interaction.member?.user;
    if (sub?.name === "pair") {
      if (discord.userId) return respond(discord.userId === user?.id ? "You are already paired." : "This bot belongs to someone else.");
      if (!discord.pairCode || String(option("code") ?? "").trim().toUpperCase() !== discord.pairCode) return respond(`That code does not match. Copy the code shown in Browsby on ${this.place}.`);
      config.discord = { ...discord, userId: user.id, userName: user.username, pairCode: "" };
      await this.saveConfig(config);
      this.onChange();
      return respond("Paired. Try `/browsby run` with a task, or `/browsby sessions` to see your Browsby windows.");
    }
    if (!discord.userId) return respond(`Not paired yet. Run \`/browsby pair\` with the code shown in Browsby on ${this.place}.`);
    if (user?.id !== discord.userId) return respond("This bot belongs to someone else.", { flags: EPHEMERAL });
    if (sub?.name === "status") return respond(this.#sessionsText());
    if (sub?.name === "sessions") return respond(this.#sessionsText(), { components: this.#sessionButtons() });
    const target = this.#target();
    if (!target) return respond(this.#sessionsText());
    if (sub?.name === "stop") {
      if (!target.running) return respond(`Nothing is running in ${target.name}.`);
      this.directory.send(target.id, { type: "stop" });
      return respond(`Stopping the task in ${target.name}.`);
    }
    if (sub?.name === "run") {
      const text = String(option("task") ?? "").trim();
      if (!text) return respond("Add a task, for example `/browsby run task: find a lasagna recipe`.");
      if (target.running) return respond(`${target.name} is busy. Stop it with \`/browsby stop\`, or pick another window with \`/browsby sessions\`.`);
      // Deferred, so the 3 second limit cannot run out; the progress message replaces it.
      await this.#api(token, "POST", `/interactions/${interaction.id}/${interaction.token}/callback`, { type: 5, data: { flags } });
      const out = { appId: interaction.application_id ?? this.appId, token: interaction.token, at: Date.now(), channelId: interaction.channel_id, flags };
      this.#begin(token, target, text, out);
    }
  }

  async #onDirectMessage(token, message) {
    const config = await this.loadConfig();
    const discord = config.discord ?? {};
    const text = (message.content ?? "").trim();
    if (!discord.userId) {
      // Pairing: the code shown at the computer, sent from the owner's account.
      if (discord.pairCode && text.toUpperCase() === discord.pairCode) {
        config.discord = { ...discord, userId: message.author.id, userName: message.author.username, pairCode: "" };
        await this.saveConfig(config);
        this.dmChannel = message.channel_id;
        this.onChange();
        await this.#say(token, "Paired. Send me a task, or use `/browsby run`. Send `stop` to stop it.");
      }
      return;
    }
    if (message.author.id !== discord.userId) return;
    this.dmChannel = message.channel_id;
    const target = this.#target();
    if (/^help$/i.test(text) || !text) {
      return this.#say(token, `Send a task in plain words and I will do it. Send \`stop\` to stop it. \`/browsby sessions\` picks the window. Settings stay on ${this.place}.`);
    }
    if (!target) return this.#say(token, this.#sessionsText());
    if (/^stop$/i.test(text)) return this.directory.send(target.id, { type: "stop" });
    if (target.running) return this.#say(token, `${target.name} is busy. Send \`stop\` to stop it first.`);
    this.#begin(token, target, text, { channelId: message.channel_id, flags: 0 });
  }

  // Starts a task in a window and keeps one progress message for it.
  #begin(token, target, text, out) {
    const task = { token, session: target.id, name: target.name, out, steps: 0, verb: "Starting", started: Date.now(), followups: 0, timer: null, lastEdit: 0, chain: Promise.resolve(), progressId: null, prompt: null, replied: false, ended: null };
    this.tasks.set(target.id, task);
    this.#progress(task);
    this.directory.send(target.id, { type: "run", text });
  }

  async #onButton(token, interaction) {
    const { discord = {} } = await this.loadConfig();
    const user = interaction.user ?? interaction.member?.user;
    const [kind, session, id, decision] = String(interaction.data?.custom_id ?? "").split(":");
    const callback = (body) => this.#api(token, "POST", `/interactions/${interaction.id}/${interaction.token}/callback`, body);
    if (!discord.userId || user?.id !== discord.userId) return callback({ type: 4, data: { content: "This bot belongs to someone else.", flags: EPHEMERAL } });
    const sessionId = this.directory.list().find((s) => String(s.id) === session)?.id;
    if (kind === "use" && sessionId !== undefined) {
      this.selected = sessionId;
      return callback({ type: 7, data: { content: this.#sessionsText(), components: this.#sessionButtons() } });
    }
    if (kind === "stop" && sessionId !== undefined) {
      this.directory.send(sessionId, { type: "stop" });
      return callback({ type: 6 });
    }
    if (kind === "perm" && sessionId !== undefined && ["once", "deny"].includes(decision)) {
      const task = this.tasks.get(sessionId);
      // The window refuses it too; this keeps the message from saying it was allowed.
      if (decision !== "deny" && task?.prompt?.id === id && task.prompt.local) {
        return callback({ type: 4, data: { content: `This one can only be approved at ${this.place}.`, flags: EPHEMERAL } });
      }
      const original = interaction.message?.content ?? "";
      await callback({ type: 7, data: { content: clip(`${original}\n\n${decision === "deny" ? "Denied" : "Allowed"} from Discord.`), components: [] } });
      if (task?.prompt?.id === id) task.prompt = null;
      this.directory.send(sessionId, { type: "permission", id, decision });
      return;
    }
    return callback({ type: 7, data: { content: "That window is no longer open.", components: [] } });
  }

  async #say(token, content, components) {
    const { discord = {} } = await this.loadConfig();
    if (!discord.userId) return null;
    if (!this.dmChannel) this.dmChannel = (await this.#api(token, "POST", "/users/@me/channels", { recipient_id: discord.userId })).id;
    return this.#api(token, "POST", `/channels/${this.dmChannel}/messages`, { content: clip(content), ...(components && { components }) });
  }

  // A task's messages: through its interaction while the token is valid, else as the bot in
  // the channel the task came from.
  #fresh(task) {
    return Boolean(task.out.token) && Date.now() - task.out.at < INTERACTION_TTL_MS;
  }

  #hook(task, path = "") {
    return `/webhooks/${task.out.appId}/${task.out.token}${path}`;
  }

  // The progress message, edited in order.
  #edit(task, body) {
    task.chain = task.chain
      .then(async () => {
        if (this.#fresh(task)) return this.#api(task.token, "PATCH", this.#hook(task, "/messages/@original"), body);
        if (task.progressId) return this.#api(task.token, "PATCH", `/channels/${task.out.channelId}/messages/${task.progressId}`, body);
        task.progressId = (await this.#api(task.token, "POST", `/channels/${task.out.channelId}/messages`, body)).id;
      })
      .catch((err) => console.error(`Discord: ${err.message}`));
    return task.chain;
  }

  // A new message, so the phone notifies. Returns how to edit it later, or null.
  async #post(task, body) {
    const data = { ...body, flags: task.out.flags };
    if (this.#fresh(task) && task.followups < MAX_FOLLOWUPS) {
      try {
        task.followups++;
        const sent = await this.#api(task.token, "POST", this.#hook(task, "?wait=true"), data);
        return { path: this.#hook(task, `/messages/${sent.id}`) };
      } catch {}
    }
    try {
      const sent = await this.#api(task.token, "POST", `/channels/${task.out.channelId}/messages`, body);
      return { path: `/channels/${task.out.channelId}/messages/${sent.id}` };
    } catch {
      // Out of followups and not allowed in the channel: the progress message carries it.
      await this.#edit(task, body);
      return null;
    }
  }

  #progress(task) {
    if (task.timer || task.ended) return;
    task.timer = setTimeout(() => {
      task.timer = null;
      task.lastEdit = Date.now();
      const verb = task.prompt ? "Waiting for your approval" : task.verb;
      this.#edit(task, { content: `Working in ${task.name} · ${steps(task.steps)} · ${elapsed(task.started)} · ${verb}`, components: [row(button(4, "Stop", `stop:${task.session}`))] });
    }, Math.max(0, task.lastEdit + PROGRESS_EVERY_MS - Date.now()));
  }

  async #finish(task) {
    clearTimeout(task.timer);
    task.timer = null;
    task.ended ??= "Done";
    this.tasks.delete(task.session);
    await this.#edit(task, { content: `${task.ended} in ${task.name} · ${steps(task.steps)} · ${elapsed(task.started)}`, components: [] });
    if (!task.replied && task.ended === "Done") await this.#post(task, { content: `Finished in ${task.name}.` });
  }

  // Events from a window, reported only for tasks started from Discord.
  async #onEvent(session, event) {
    const task = this.tasks.get(session);
    if (!task) return;
    if (event.type === "status") return event.running ? (task.began = true) : this.#finish(task);
    if (event.type === "tool_call") {
      task.steps++;
      task.verb = stepWord(event);
      this.#progress(task);
    } else if (event.type === "permission_request") {
      const atComputerOnly = LOCAL_ONLY_PROMPTS.has(event.kind);
      const buttons = [
        ...(atComputerOnly ? [] : [button(3, "Allow", `perm:${session}:${event.id}:once`)]),
        button(4, "Deny", `perm:${session}:${event.id}:deny`),
      ];
      const note = atComputerOnly ? `\n\nThis one can only be approved at ${this.place}.` : "";
      const content = clip(`**Approval needed in ${task.name}**\n${event.text}${note}`);
      task.prompt = { id: event.id, local: atComputerOnly, content, edit: null };
      this.#progress(task);
      const sent = await this.#post(task, { content, components: [row(...buttons)] });
      if (task.prompt?.id === event.id) task.prompt.edit = sent;
    } else if (event.type === "permission_closed" && task.prompt) {
      const { edit, content } = task.prompt;
      task.prompt = null;
      if (edit) await this.#api(task.token, "PATCH", edit.path, { content: clip(`${content}\n\nAnswered at ${this.place}.`), components: [] }).catch(() => {});
    } else if (event.type === "reply") {
      task.replied = true;
      await this.#post(task, { content: clip(event.text) });
    } else if (event.type === "error") {
      task.ended = "Ended with an error";
      await this.#post(task, { content: clip(`Error: ${event.text}`) });
      // Refused before it began (no key, a task already running): no status follows.
      if (!task.began) await this.#finish(task);
    } else if (event.type === "notice") {
      task.ended = event.text.replace(/\.$/, "");
    }
  }
}
