import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

// MCP servers configured in Settings > MCP (local edition). Each enabled server runs as a
// child process over stdio; its tools are offered to the model as mcp__<server>__<tool>.

const CONNECT_TIMEOUT_MS = 60000;
const CALL_TIMEOUT_MS = 120000;
const LOG_LINES = 200;
const RESULT_MAX_CHARS = 30000;

// Settings > MCP presets. Versions are pinned so a server only changes when this list does.
export const MCP_PRESETS = {
  microsoft365: {
    name: "Microsoft 365",
    command: "npx",
    // Mail and calendar through discovery: three small tools (search, get schema, execute)
    // instead of 75 whose definitions (about 117,000 tokens) would ride on every request.
    args: ["-y", "@softeria/ms-365-mcp-server@0.156.2", "--preset", "mail,calendar", "--discovery"],
    env: {},
    // Sign-in runs from Settings (device code); the model never starts or ends a session.
    hiddenTools: ["login", "logout", "verify-login", "list-accounts", "select-account", "remove-account"],
  },
};

// Tool names must match ^[a-zA-Z0-9_-]{1,64}$ for every provider.
const slug = (text) => text.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 20);

// Apps opened from Finder get a minimal PATH, so npx and node are taken from the Node
// install running this server when the configured command is one of them.
function resolveCommand(command) {
  if (!["npx", "node", "npm"].includes(command)) return command;
  const sibling = join(dirname(process.execPath), command);
  return existsSync(sibling) ? sibling : command;
}

function toBlocks(result) {
  const blocks = [];
  for (const c of result.content ?? []) {
    if (c.type === "text") blocks.push({ type: "text", text: c.text });
    else if (c.type === "image") blocks.push({ type: "image", mediaType: c.mimeType, data: c.data });
    else if (c.type === "resource") blocks.push({ type: "text", text: c.resource?.text ?? `[resource ${c.resource?.uri ?? ""}]` });
    else if (c.type === "resource_link") blocks.push({ type: "text", text: `[resource ${c.uri}] ${c.name ?? ""}` });
  }
  if (!blocks.length && result.structuredContent) blocks.push({ type: "text", text: JSON.stringify(result.structuredContent) });
  for (const b of blocks) {
    if (b.type === "text" && b.text.length > RESULT_MAX_CHARS) b.text = `${b.text.slice(0, RESULT_MAX_CHARS)}\n[truncated]`;
  }
  return blocks.length ? blocks : [{ type: "text", text: "(no content)" }];
}

export class McpServers {
  // onChange(): called whenever a server's status or tools change.
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    // id -> { config, client, status, error, tools, log }
    this.servers = new Map();
    // Model-facing tool name -> { id, tool }
    this.byName = new Map();
  }

  // Starts, stops or restarts servers so they match the configured list.
  async sync(configs = []) {
    const wanted = new Map(configs.filter((c) => c.enabled).map((c) => [c.id, c]));
    for (const [id, s] of this.servers) {
      if (!wanted.has(id) || JSON.stringify(wanted.get(id)) !== JSON.stringify(s.config)) await this.#stop(id);
    }
    await Promise.all([...wanted.values()].filter((c) => !this.servers.has(c.id)).map((c) => this.#start(c)));
  }

  async restart(config) {
    await this.#stop(config.id);
    if (config.enabled) await this.#start(config);
  }

  async #start(config) {
    const s = { config, client: null, transport: null, status: "starting", error: null, tools: [], log: [] };
    this.servers.set(config.id, s);
    this.onChange();
    const log = (line) => {
      s.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
      if (s.log.length > LOG_LINES) s.log.shift();
    };
    try {
      const bin = dirname(process.execPath);
      const env = getDefaultEnvironment();
      const transport = new StdioClientTransport({
        command: resolveCommand(config.command),
        args: config.args ?? [],
        env: { ...env, PATH: `${bin}:${env.PATH ?? "/usr/bin:/bin"}`, ...config.env },
        stderr: "pipe",
      });
      s.transport = transport;
      let partial = "";
      transport.stderr?.on("data", (chunk) => {
        const lines = (partial + chunk).split("\n");
        partial = lines.pop();
        for (const line of lines) if (line.trim()) log(line);
      });
      const client = new Client({ name: "browser-agent", version: "1.0.0" });
      client.onclose = () => {
        if (this.servers.get(config.id) !== s) return;
        s.status = "stopped";
        log("connection closed");
        this.#index();
        this.onChange();
      };
      log(`starting: ${config.command} ${(config.args ?? []).join(" ")}`);
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
      s.client = client;
      const hidden = new Set(config.hiddenTools ?? []);
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { timeout: CONNECT_TIMEOUT_MS });
        s.tools.push(...page.tools.filter((t) => !hidden.has(t.name)));
        cursor = page.nextCursor;
      } while (cursor);
      s.status = "connected";
      log(`connected, ${s.tools.length} tools`);
    } catch (err) {
      s.status = "error";
      s.error = err.message;
      log(`error: ${err.message}`);
    }
    this.#index();
    this.onChange();
  }

  async #stop(id) {
    const s = this.servers.get(id);
    if (!s) return;
    this.servers.delete(id);
    await s.client?.close().catch(() => {});
    this.#index();
    this.onChange();
  }

  stopAll() {
    return Promise.all([...this.servers.keys()].map((id) => this.#stop(id)));
  }

  // For process exit, when there is no time to close sessions: ends every server process
  // so none outlives the app.
  killAll() {
    for (const s of this.servers.values()) {
      const pid = s.transport?.pid;
      if (pid) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      }
    }
  }

  // Rebuilds the model-facing names; a server's tools keep their names while it runs.
  #index() {
    this.byName.clear();
    for (const [id, s] of this.servers) {
      if (s.status !== "connected") continue;
      for (const tool of s.tools) {
        let name = `mcp__${slug(s.config.name || id)}__${tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 64);
        for (let n = 2; this.byName.has(name); n++) name = `${name.slice(0, 60)}_${n}`;
        this.byName.set(name, { id, tool });
      }
    }
  }

  // Tool definitions for the model.
  toolDefs() {
    return [...this.byName].map(([name, { id, tool }]) => ({
      name,
      description: `[${this.servers.get(id).config.name}] ${tool.description ?? tool.name}`.slice(0, 1024),
      input_schema: tool.inputSchema?.type === "object" ? tool.inputSchema : { type: "object", properties: {} },
    }));
  }

  has(name) {
    return this.byName.has(name);
  }

  // Whether the server marks the tool as read-only; unmarked tools count as actions.
  isReadOnly(name) {
    return this.byName.get(name)?.tool.annotations?.readOnlyHint === true;
  }

  // Calls a tool by its model-facing name; `raw` is the server's own tool name, for tools
  // hidden from the model (sign-in). Returns text/image blocks; throws on tool errors.
  async call(name, args = {}, { signal, raw = false, serverId } = {}) {
    const entry = raw ? { id: serverId, tool: { name } } : this.byName.get(name);
    const s = entry && this.servers.get(entry.id);
    if (!s?.client) throw new Error(`MCP tool ${name} is not available; check Settings > MCP.`);
    const result = await s.client.callTool({ name: entry.tool.name, arguments: args }, undefined, { signal, timeout: CALL_TIMEOUT_MS });
    const blocks = toBlocks(result);
    if (result.isError) throw new Error(blocks.map((b) => b.text ?? "").join("\n") || "The MCP tool reported an error.");
    return blocks;
  }

  // What Settings shows: no environment values, which may hold tokens.
  status() {
    return [...this.servers].map(([id, s]) => ({
      id,
      name: s.config.name,
      status: s.status,
      error: s.error,
      tools: s.tools.map((t) => t.name),
      log: s.log.slice(-60),
    }));
  }
}
