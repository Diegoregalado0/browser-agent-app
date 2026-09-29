// Remote control over Discord: the owner's own bot, paired to their Discord account, relays
// tasks and permission prompts. The bridge is a remote client of the controller, so it can
// only start a task, stop it and answer prompts; everything else stays on the computer.
// Only prompts, final replies, errors and stop notices are sent, since Discord can read bot
// messages. It uses only web platform APIs (WebSocket, fetch, crypto.getRandomValues), so
// the same code runs in the Mac app (Node) and in the extension's side panel.

const API = "https://discord.com/api/v10";
const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const GATEWAY_INTENTS = 1 << 12; // DIRECT_MESSAGES; message text in DMs needs no privileged intent.
const MAX_MESSAGE = 1900;
// Close codes after which reconnecting cannot help (bad token, disallowed intents).
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

const clip = (text) => (text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text);
const newPairCode = () => [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

export class DiscordBridge {
  // controller: to connect as a remote client. loadConfig/saveConfig: settings storage, where
  // config.discord = { token, userId, userName, pairCode } lives (owner-only file).
  // onChange(): the bridge's status changed. api and gateway: Discord's addresses (a local
  // stand-in in scripts/agent-check.js). place: where the agent runs, in replies ("the Mac").
  constructor({ controller, loadConfig, saveConfig, onChange = () => {}, api = API, gateway = GATEWAY, place = "the Mac" }) {
    this.api = api;
    this.place = place;
    this.gateway = gateway;
    this.controller = controller;
    this.loadConfig = loadConfig;
    this.saveConfig = saveConfig;
    this.onChange = onChange;
    this.state = "off";
    this.error = null;
    this.bot = null;
    this.ws = null;
    this.heartbeat = null;
    this.retry = 0;
    this.dmChannel = null;
    // Whether the running task was started from Discord; only those tasks report back.
    this.remoteTask = false;
    this.replied = false;
    // Whether any task is running, from the controller's status events.
    this.running = false;
    this.client = null;
    // The prompt message waiting for Allow or Deny: { id, messageId }.
    this.prompt = null;
    this.receive = null;
  }

  async start() {
    const { discord } = await this.loadConfig();
    if (!discord?.token) return this.#set("off");
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
    if (this.client) this.controller.disconnect(this.client);
    this.client = null;
  }

  // Settings > Remote: a new bot token starts over with a fresh pairing code.
  async configure(token) {
    this.stop();
    const config = await this.loadConfig();
    config.discord = { token: String(token).trim(), userId: "", userName: "", pairCode: newPairCode() };
    await this.saveConfig(config);
    this.dmChannel = null;
    this.retry = 0;
    await this.start();
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
    this.#set("off");
  }

  // What Settings shows: never the token.
  async status() {
    const { discord = {} } = await this.loadConfig();
    return {
      type: "discord_status",
      state: this.state,
      error: this.error,
      botName: this.bot?.username ?? null,
      inviteUrl: this.bot ? `https://discord.com/oauth2/authorize?client_id=${this.bot.id}&scope=bot&permissions=0` : null,
      paired: Boolean(discord.userId),
      userName: discord.userName || null,
      pairCode: discord.userId ? null : discord.pairCode || null,
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
        ws.send(JSON.stringify({ op: 2, d: { token, intents: GATEWAY_INTENTS, properties: { os: "macos", browser: "duomo", device: "duomo" } } }));
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
      if (FATAL_CLOSE.has(code)) return this.#set("error", code === 4004 ? "Discord rejected the bot token." : `Discord closed the connection (${code}).`);
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
      if (!this.client) {
        this.client = { send: (event) => this.#onEvent(token, event).catch((err) => console.error(`Discord: ${err.message}`)) };
        this.receive = this.controller.connect(this.client, { remote: true, source: "discord" });
      }
      this.#set("connected");
      return;
    }
    if (type === "MESSAGE_CREATE" && !d.guild_id && !d.author?.bot) return this.#onDirectMessage(token, d);
    if (type === "INTERACTION_CREATE" && d.type === 3) return this.#onButton(token, d);
  }

  async #onDirectMessage(token, message) {
    const config = await this.loadConfig();
    const discord = config.discord ?? {};
    const text = (message.content ?? "").trim();
    if (!discord.userId) {
      // Pairing: the code shown at the Mac, sent from the owner's account.
      if (discord.pairCode && text.toUpperCase() === discord.pairCode) {
        config.discord = { ...discord, userId: message.author.id, userName: message.author.username, pairCode: "" };
        await this.saveConfig(config);
        this.dmChannel = message.channel_id;
        this.onChange();
        await this.#say(token, "Paired. Send me a task, or `stop` to stop the one that is running.");
      }
      return;
    }
    if (message.author.id !== discord.userId) return;
    this.dmChannel = message.channel_id;
    if (/^stop$/i.test(text)) return this.receive({ type: "stop" });
    if (/^help$/i.test(text) || !text) {
      return this.#say(token, `Send a task in plain words and I will do it. Send \`stop\` to stop it. Settings stay on ${this.place}.`);
    }
    if (this.running) return this.#say(token, "A task is already running. Send `stop` to stop it first.");
    this.remoteTask = true;
    this.replied = false;
    this.receive({ type: "run", text });
  }

  async #onButton(token, interaction) {
    const { discord = {} } = await this.loadConfig();
    const user = interaction.user ?? interaction.member?.user;
    const [kind, id, decision] = String(interaction.data?.custom_id ?? "").split(":");
    const respond = (content) =>
      this.#api(token, "POST", `/interactions/${interaction.id}/${interaction.token}/callback`, { type: 7, data: { content: clip(content), components: [] } });
    if (kind !== "perm" || user?.id !== discord.userId) {
      return this.#api(token, "POST", `/interactions/${interaction.id}/${interaction.token}/callback`, { type: 4, data: { content: "Not for you.", flags: 64 } });
    }
    const original = interaction.message?.content ?? "";
    await respond(`${original}\n\n${decision === "deny" ? "Denied" : "Allowed"} from Discord.`);
    if (this.prompt?.id === id) this.prompt = null;
    this.receive({ type: "permission", id, decision });
  }

  async #say(token, content, components) {
    const { discord = {} } = await this.loadConfig();
    if (!discord.userId) return null;
    if (!this.dmChannel) this.dmChannel = (await this.#api(token, "POST", "/users/@me/channels", { recipient_id: discord.userId })).id;
    return this.#api(token, "POST", `/channels/${this.dmChannel}/messages`, { content: clip(content), ...(components && { components }) });
  }

  // Controller events, reported only for tasks started from Discord.
  async #onEvent(token, event) {
    if (event.type === "status") this.running = event.running;
    if (event.type === "status" && event.running === false && this.remoteTask) {
      this.remoteTask = false;
      if (!this.replied) await this.#say(token, "Finished.");
      return;
    }
    if (!this.remoteTask) return;
    if (event.type === "permission_request") {
      const atMacOnly = event.kind === "sensitive" || event.kind === "password";
      const buttons = [
        ...(atMacOnly ? [] : [{ type: 2, style: 3, label: "Allow", custom_id: `perm:${event.id}:once` }]),
        { type: 2, style: 4, label: "Deny", custom_id: `perm:${event.id}:deny` },
      ];
      const note = atMacOnly ? `\n\nThis one can only be approved at ${this.place}.` : "";
      const sent = await this.#say(token, `**Approval needed**\n${event.text}${note}`, [{ type: 1, components: buttons }]);
      this.prompt = sent && { id: event.id, messageId: sent.id };
    } else if (event.type === "permission_closed" && this.prompt) {
      const { messageId } = this.prompt;
      this.prompt = null;
      await this.#api(token, "PATCH", `/channels/${this.dmChannel}/messages/${messageId}`, { components: [] }).catch(() => {});
    } else if (event.type === "reply") {
      this.replied = true;
      await this.#say(token, event.text);
    } else if (event.type === "error") {
      await this.#say(token, `Error: ${event.text}`);
    } else if (event.type === "notice" && /^Stopped/.test(event.text)) {
      await this.#say(token, event.text);
    }
  }
}
