import { openTabNear, moveAgentGroup } from "../src/tab-helpers.js";

// Pages Chrome does not let extensions attach to or script.
const RESTRICTED_URL = /^(chrome|chrome-extension|chrome-untrusted|devtools|edge|view-source):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/;

// Page transport for the extension edition: chrome.debugger for DevTools commands and
// chrome.tabs for tab management. The agent works only in the tabs of the window its side
// panel belongs to, so an incognito window's agent never sees normal tabs and the reverse.
// Tab ids are chrome.tabs ids as strings. See CdpTransport for the interface.
export class DebuggerTransport {
  constructor({ windowId }) {
    this.windowId = windowId;
    this.attached = new Set();
    this.onAttach = async () => {};
    this.onEvent = () => {};
    this.onDetach = () => {};
    // Called when the user closes Chrome's debugging banner, which detaches the agent.
    this.onCanceled = () => {};
    chrome.debugger.onEvent.addListener((source, method, params) => {
      const id = String(source.tabId);
      if (this.attached.has(id)) this.onEvent(id, method, params);
    });
    chrome.debugger.onDetach.addListener((source, reason) => {
      const id = String(source.tabId);
      if (!this.attached.delete(id)) return;
      this.onDetach(id);
      if (reason === "canceled_by_user") this.onCanceled();
    });
  }

  // The agent may open only web pages. Browser pages, local files, extension pages and
  // script URLs stay out of reach.
  checkUrl(url) {
    if (url === "about:blank" || /^https?:\/\//i.test(url)) return;
    throw new Error("The agent can open only web pages (http or https addresses).");
  }

  async pages() {
    const own = chrome.runtime.getURL("");
    const tabs = (await chrome.tabs.query({ windowId: this.windowId })).filter((t) => !(t.url || t.pendingUrl || "").startsWith(own));
    return tabs.map((t) => ({ id: String(t.id), title: t.title || "", url: t.url || t.pendingUrl || "" }));
  }

  async createBlank() {
    const tab = await chrome.tabs.create({ windowId: this.windowId, url: "about:blank", active: true });
    return String(tab.id);
  }

  async activeId() {
    const [tab] = await chrome.tabs.query({ windowId: this.windowId, active: true });
    return tab ? String(tab.id) : null;
  }

  async send(id, method, params = {}) {
    const target = { tabId: Number(id) };
    if (!this.attached.has(id)) {
      const tab = await chrome.tabs.get(target.tabId);
      if (RESTRICTED_URL.test(tab.url || tab.pendingUrl || "")) {
        throw new Error("This is a browser page (such as chrome:// or the Chrome Web Store) that extensions cannot control. Navigate to a website first.");
      }
      try {
        await chrome.debugger.attach(target, "1.3");
      } catch (err) {
        if (!/already attached/i.test(err.message)) throw new Error(`Could not control this tab: ${err.message}`);
      }
      this.attached.add(id);
      await this.onAttach(id);
    }
    return chrome.debugger.sendCommand(target, method, params);
  }

  // Browser pages cannot be attached to, so leaving one goes through the tabs API.
  async navigate(id, url) {
    const tab = await chrome.tabs.get(Number(id));
    if (!this.attached.has(id) && (RESTRICTED_URL.test(tab.url || "") || !tab.url)) {
      await chrome.tabs.update(Number(id), { url });
      return null;
    }
    const res = await this.send(id, "Page.navigate", { url });
    return res.errorText || null;
  }

  async openTab({ openerId, url = "about:blank" }) {
    return String(await openTabNear(openerId ? Number(openerId) : null, url, this.windowId));
  }

  async activate(id) {
    await chrome.tabs.update(Number(id), { active: true });
  }

  async close(id) {
    await chrome.tabs.remove(Number(id));
  }

  async highlight(id) {
    await moveAgentGroup(id ? Number(id) : null, `window-${this.windowId}`);
  }

  // Detaches from every tab, which removes Chrome's debugging banner.
  async release() {
    const ids = [...this.attached];
    this.attached.clear();
    for (const id of ids) {
      this.onDetach(id);
      await chrome.debugger.detach({ tabId: Number(id) }).catch(() => {});
    }
  }
}
