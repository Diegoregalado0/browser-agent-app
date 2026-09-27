import WebSocket from "ws";
import { EventEmitter } from "node:events";

// Minimal Chrome DevTools Protocol client over one browser-level WebSocket, using
// flattened sessions (one sessionId per attached page).
export class CDP extends EventEmitter {
  #ws;
  #nextId = 1;
  #pending = new Map();

  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
      ws.once("open", () => resolve(new CDP(ws)));
      ws.once("error", reject);
    });
  }

  constructor(ws) {
    super();
    this.#ws = ws;
    ws.on("message", (data) => this.#onMessage(JSON.parse(data.toString())));
    ws.on("close", () => {
      for (const { reject } of this.#pending.values()) reject(new Error("Browser connection closed"));
      this.#pending.clear();
      this.emit("disconnected");
    });
  }

  get connected() {
    return this.#ws.readyState === WebSocket.OPEN;
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      this.#ws.send(JSON.stringify(message));
    });
  }

  close() {
    this.#ws.close();
  }

  #onMessage(msg) {
    if (msg.id !== undefined) {
      const pending = this.#pending.get(msg.id);
      if (!pending) return;
      this.#pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(`${pending.method}: ${msg.error.message}`));
      else pending.resolve(msg.result);
      return;
    }
    this.emit(msg.method, msg.params, msg.sessionId);
    this.emit("event", msg.method, msg.params, msg.sessionId);
  }
}
