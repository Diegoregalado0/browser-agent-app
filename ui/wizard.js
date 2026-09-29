import { OUTLOOK_LOGO } from "./mcp.js";

// First-run setup, full screen over the app: welcome, provider, its key (or a local server
// check), then Outlook in the local edition. It opens once while config.setupDone is false,
// and again from Settings > General. The first run cannot be skipped until a provider
// works; setupDone is saved only after that (and after the Outlook screen is answered).

// The product name on the welcome screen. It changes with the rebrand.
const PRODUCT_NAME = "Browsby";

// Provider buttons, in order. Each shows the provider's name as a wordmark in the app's own
// type: the providers' trademark rules do not allow their logos without written permission
// (https://www.anthropic.com/legal/trademark-guidelines, https://openai.com/brand).
// glyph: an app icon shown before the name.
const PROVIDERS = [
  { id: "openai", name: "OpenAI", keyPage: "https://platform.openai.com/api-keys" },
  { id: "anthropic", name: "Anthropic", keyPage: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", name: "Google Gemini", keyPage: "https://aistudio.google.com/apikey" },
  { id: "mistral", name: "Mistral", keyPage: "https://console.mistral.ai/api-keys" },
  { id: "ollama", name: "Local", label: "Local models on this computer, with Ollama", glyph: "models" },
];

// mcp: the MCP panel, whose Outlook connect flow the Outlook screen runs. openModels()
// opens Settings > Models, for a provider that has no model chosen yet.
export function createWizard({ $, el, icon, send, mcp, openModels }) {
  const root = $("wizard");
  let config = null;
  let screen = null;
  // Opened automatically at most once per page load.
  let autoOpened = false;
  // Reopened after setup was finished, so it may be closed without finishing.
  let closable = false;
  let provider = null;
  // The provider whose connection test is running.
  let testing = null;

  function setButton(id, label, onClick) {
    const button = $(id);
    button.hidden = !label;
    button.disabled = false;
    if (!label) return;
    button.textContent = label;
    button.onclick = onClick;
  }

  function result(kind, text) {
    const node = $("wizard-result");
    node.className = `pc-result ${kind}`;
    node.replaceChildren();
    if (!kind) return;
    if (kind !== "pending") node.append(icon(kind === "ok" ? "check" : "alert"));
    node.append(el("span", null, text));
  }

  // Shows one screen: its title, lead text, which parts are visible, and its buttons.
  function show(name, { title, lead = "", parts = [], next, skip, back, focus }) {
    screen = name;
    testing = null;
    root.classList.toggle("welcome", name === "welcome");
    $("wizard-title").textContent = title;
    $("wizard-lead").replaceChildren(...[lead].flat());
    for (const id of ["wizard-providers", "wizard-key-field", "wizard-outlook-logo"]) $(id).hidden = !parts.includes(id);
    result("");
    setButton("wizard-next", next?.[0], next?.[1]);
    setButton("wizard-skip", skip?.[0] ?? (closable ? "Close" : ""), skip?.[1] ?? close);
    $("wizard-back").hidden = !back;
    $("wizard-back").onclick = back;
    setOpen(true);
    (focus ?? $("wizard-title")).focus();
  }

  function welcome() {
    show("welcome", {
      title: PRODUCT_NAME,
      lead: "Tell it the task. It does the browsing.",
      next: ["Get started", pickProvider],
      focus: $("wizard-next"),
    });
  }

  function pickProvider() {
    $("wizard-providers").replaceChildren(
      ...PROVIDERS.map((p) => {
        const button = el("button");
        button.type = "button";
        if (p.glyph) button.append(icon(p.glyph));
        button.append(el("span", null, p.name));
        button.setAttribute("aria-label", p.label ?? p.name);
        button.onclick = () => enterKey(p);
        return button;
      }),
    );
    show("provider", {
      title: "Pick your provider",
      lead: "The agent runs on the AI provider you choose, with your own account.",
      parts: ["wizard-providers"],
      back: welcome,
      focus: $("wizard-providers").querySelector(`button:nth-child(${Math.max(1, PROVIDERS.findIndex((p) => p.id === config.provider) + 1)})`),
    });
  }

  // The key screen, or for Ollama a check that the local server answers.
  function enterKey(p) {
    provider = p;
    $("wizard-key").value = "";
    if (p.id === "ollama") {
      const cmd = el("code", null, "ollama serve");
      return show("key", {
        title: "Use a local model",
        lead: ["Ollama runs models on this computer, so no key is needed. Start it with ", cmd, ", then test the connection."],
        next: ["Test connection", test],
        back: pickProvider,
        focus: $("wizard-next"),
      });
    }
    const info = config.keyInfo?.[p.id];
    const has = info && info.source !== "none";
    $("wizard-key").placeholder = has ? "Leave blank to keep the current key" : "Paste your API key";
    const link = Object.assign(el("a", null, new URL(p.keyPage).hostname), { href: p.keyPage, target: "_blank", rel: "noopener noreferrer" });
    $("wizard-key-note").replaceChildren(
      ...(has ? [`Using the ${info.source === "env" ? `key from ${info.env}` : "saved key"} (${info.mask}). Paste a new one to replace it. `] : []),
      "Get a key at ",
      link,
      ".",
    );
    show("key", {
      title: `Add your ${p.name} key`,
      lead: "The key stays on this device and is sent only to the provider, which bills you for what the agent uses.",
      parts: ["wizard-key-field"],
      next: ["Test and continue", test],
      back: pickProvider,
      focus: $("wizard-key"),
    });
  }

  function test() {
    const key = $("wizard-key").value.trim();
    if (provider.id !== "ollama" && !key && config.keyInfo?.[provider.id]?.source === "none") {
      result("error", "Paste an API key first.");
      return $("wizard-key").focus();
    }
    testing = provider.id;
    $("wizard-next").disabled = true;
    $("wizard-next").textContent = "Testing…";
    result("pending", "Testing the connection…");
    send({ type: "test_provider", provider: provider.id, key: key || undefined });
  }

  $("wizard-key").addEventListener("keydown", (e) => e.key === "Enter" && !$("wizard-next").disabled && test());

  function outlookScreen() {
    $("wizard-outlook-logo").innerHTML = OUTLOOK_LOGO;
    const outlook = mcp.outlook;
    if (outlook?.signedIn) {
      return show("outlook", {
        title: "Outlook is connected",
        lead: `Signed in${outlook.account ? ` as ${outlook.account}` : ""}. The agent can use your mail and calendar when a task needs them.`,
        parts: ["wizard-outlook-logo"],
        next: ["Continue", () => finish()],
        skip: [""],
        focus: $("wizard-next"),
      });
    }
    show("outlook", {
      title: "Connect your Outlook",
      lead: "With Outlook connected, the agent can find emails, draft replies and check your calendar as part of a task. It asks you before sending anything.",
      parts: ["wizard-outlook-logo"],
      next: ["Connect Outlook", () => mcp.connectOutlook(outlookScreen)],
      skip: ["Skip for now", () => finish()],
      focus: $("wizard-next"),
    });
  }

  // The rest of the page is inert while setup is open, so neither focus nor a screen
  // reader reaches it. The connect flow and toasts stay live above it.
  function setOpen(open) {
    root.hidden = !open;
    for (const node of document.body.children) {
      if (node !== root && node.id !== "connect-flow" && node.id !== "toast") node.inert = open;
    }
  }

  function close() {
    setOpen(false);
    screen = null;
    testing = null;
    $("input")?.focus();
  }

  // patch: settings still to save. It goes out with setupDone in one message, since two
  // saves in a row can race and the second can overwrite the first.
  function finish(patch = {}) {
    if (!config.setupDone) patch.setupDone = true;
    if (Object.keys(patch).length) send({ type: "save_config", patch });
    close();
    if (!config.models[config.provider]) openModels();
  }

  // Tab stays inside setup. Escape closes it only when it was reopened after setup.
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (closable) close();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...root.querySelectorAll("button, input, a[href]")].filter((n) => !n.disabled && n.offsetParent);
    const edge = e.shiftKey ? items[0] : items.at(-1);
    if (document.activeElement === edge) {
      e.preventDefault();
      (e.shiftKey ? items.at(-1) : items[0])?.focus();
    }
  });

  function open() {
    autoOpened = true;
    closable = Boolean(config.setupDone);
    welcome();
  }

  return {
    open,
    get isOpen() {
      return !root.hidden;
    },
    render(next) {
      config = next;
      if (!config.setupDone && !autoOpened) open();
    },
    handlers: {
      provider_test(msg) {
        if (msg.provider !== testing || screen !== "key") return;
        testing = null;
        setButton("wizard-next", provider.id === "ollama" ? "Test connection" : "Test and continue", test);
        if (!msg.ok) {
          result("error", msg.text);
          return (provider.id === "ollama" ? $("wizard-next") : $("wizard-key")).focus();
        }
        const key = $("wizard-key").value.trim();
        $("wizard-key").value = "";
        const patch = { provider: msg.provider, ...(key && { keys: { [msg.provider]: key } }) };
        // The saved config arrives after this; finish() reads the chosen provider from it.
        config = { ...config, provider: msg.provider };
        if (config.edition !== "local") return finish(patch);
        send({ type: "save_config", patch });
        outlookScreen();
      },
    },
  };
}
