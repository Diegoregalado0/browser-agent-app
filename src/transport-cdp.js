import { openTabNear, moveAgentGroup } from "./tab-helpers.js";

// Page transport for the local edition: the browser-level DevTools connection of the
// agent's Chrome, with one flattened session per attached tab. Tab ids are CDP target
// ids. Tab APIs that CDP lacks (opening a tab in a given window, tab groups) run in the
// side panel extension's hidden bridge page (see sidebar.js).
//
// Every transport provides: pages, createBlank, activeId, send, navigate, openTab,
// activate, close, highlight, and calls the onAttach / onEvent / onDetach hooks.
export class CdpTransport {
  constructor(cdp, { hiddenUrlPrefixes = [], extensionId = null } = {}) {
    this.cdp = cdp;
    // The agent's own UI (sidebar extension, UI server) is never a target for any tool.
    this.hiddenUrlPrefixes = hiddenUrlPrefixes;
    this.extensionId = extensionId;
    this.bridgeSession = null;
    this.sessions = new Map();
    this.tabOfSession = new Map();
    this.onAttach = async () => {};
    this.onEvent = () => {};
    this.onDetach = () => {};
    cdp.on("event", (method, params, sessionId) => {
      const id = this.tabOfSession.get(sessionId);
      if (id) this.onEvent(id, method, params);
    });
    cdp.on("Target.detachedFromTarget", ({ sessionId }) => {
      if (sessionId === this.bridgeSession) this.bridgeSession = null;
      const id = this.tabOfSession.get(sessionId);
      if (!id) return;
      this.tabOfSession.delete(sessionId);
      this.sessions.delete(id);
      this.onDetach(id);
    });
  }

  async pages() {
    const { targetInfos } = await this.cdp.send("Target.getTargets");
    return targetInfos
      .filter((t) => t.type === "page" && !t.url.startsWith("devtools://") && !this.hiddenUrlPrefixes.some((p) => t.url.startsWith(p)))
      .map((t) => ({ id: t.targetId, title: t.title, url: t.url }));
  }

  async createBlank() {
    const { targetId } = await this.cdp.send("Target.createTarget", { url: "about:blank" });
    return targetId;
  }

  // The tab the user is looking at: visible, and preferably focused.
  async activeId() {
    let best = null;
    for (const page of await this.pages()) {
      try {
        const { sessionId } = await this.cdp.send("Target.attachToTarget", { targetId: page.id, flatten: true });
        const res = await this.cdp.send(
          "Runtime.evaluate",
          { expression: "({ visible: document.visibilityState === 'visible', focused: document.hasFocus() })", returnByValue: true },
          sessionId,
        );
        await this.cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {});
        const score = (res.result.value?.visible ? 1 : 0) + (res.result.value?.focused ? 2 : 0);
        if (score && (!best || score > best.score)) best = { id: page.id, score };
      } catch {}
    }
    return best?.id ?? null;
  }

  async send(id, method, params = {}) {
    let sessionId = this.sessions.get(id);
    if (!sessionId) {
      ({ sessionId } = await this.cdp.send("Target.attachToTarget", { targetId: id, flatten: true }));
      this.sessions.set(id, sessionId);
      this.tabOfSession.set(sessionId, id);
      await this.onAttach(id);
    }
    return this.cdp.send(method, params, sessionId);
  }

  // Starts loading a URL; returns an error text when the navigation fails outright.
  async navigate(id, url) {
    const res = await this.send(id, "Page.navigate", { url });
    return res.errorText || null;
  }

  async openTab({ openerId, url = "about:blank" }) {
    const id = await this.#bridge("openTab", { openerTargetId: openerId, url });
    if (id) return id;
    // Stay in the opener's browser context, so an incognito task stays incognito.
    const { targetInfos } = await this.cdp.send("Target.getTargets");
    const browserContextId = targetInfos.find((t) => t.targetId === openerId)?.browserContextId;
    const { targetId } = await this.cdp.send("Target.createTarget", { url, newWindow: false, ...(browserContextId && { browserContextId }) });
    return targetId;
  }

  async activate(id) {
    await this.cdp.send("Target.activateTarget", { targetId: id });
  }

  async close(id) {
    await this.cdp.send("Target.closeTarget", { targetId: id });
  }

  // Puts the tab in the "Agent" tab group, or removes the group when id is null.
  async highlight(id) {
    await this.#bridge("highlight", { targetId: id });
  }

  async browserPid() {
    const { processInfo } = await this.cdp.send("SystemInfo.getProcessInfo");
    return processInfo.find((p) => p.type === "browser")?.id;
  }

  // Calls agentBridge[method](arg) in the extension's bridge page. Returns undefined when
  // the bridge is unavailable (extension missing or outdated), so callers can fall back.
  async #bridge(method, arg) {
    if (!this.extensionId) return undefined;
    try {
      if (!this.bridgeSession) {
        const url = `chrome-extension://${this.extensionId}/bridge.html`;
        const { targetInfos } = await this.cdp.send("Target.getTargets");
        let targetId = targetInfos.find((t) => t.url === url)?.targetId;
        if (!targetId) ({ targetId } = await this.cdp.send("Target.createTarget", { url, hidden: true }));
        const { sessionId } = await this.cdp.send("Target.attachToTarget", { targetId, flatten: true });
        this.bridgeSession = sessionId;
      }
      const expression = `(async () => { for (let i = 0; i < 40 && !globalThis.agentBridge; i++) await new Promise((r) => setTimeout(r, 50));
        return globalThis.agentBridge?.${method} ? agentBridge.${method}(${JSON.stringify(arg)}) : undefined; })()`;
      const res = await this.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, this.bridgeSession);
      if (res.exceptionDetails) return undefined;
      return res.result.value ?? null;
    } catch {
      return undefined;
    }
  }
}

// Source of the bridge page's script: the shared tab helpers plus a mapping between CDP
// target ids and tab ids.
export const BRIDGE_SOURCE = `${openTabNear}

${moveAgentGroup}

async function tabIdFor(targetId) {
  const targets = await chrome.debugger.getTargets();
  return targets.find((t) => t.id === targetId)?.tabId ?? null;
}

async function targetIdFor(tabId) {
  for (let i = 0; i < 50; i++) {
    const target = (await chrome.debugger.getTargets()).find((t) => t.tabId === tabId);
    if (target) return target.id;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

globalThis.agentBridge = {
  openTab: async ({ openerTargetId, url }) => targetIdFor(await openTabNear(openerTargetId ? await tabIdFor(openerTargetId) : null, url)),
  highlight: async ({ targetId }) => moveAgentGroup(targetId ? await tabIdFor(targetId) : null),
};
`;
