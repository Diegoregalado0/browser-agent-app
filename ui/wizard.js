import { OUTLOOK_LOGO } from "./mcp.js";

// First-run setup: the model provider and its key, Outlook (local edition), then a few
// example tasks. It opens once while config.setupDone is false, and again from Settings >
// General. Finishing or skipping it saves setupDone.

const KEY_PAGES = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
  mistral: "https://console.mistral.ai/api-keys",
};

// mcp: the MCP panel, whose Outlook connect flow the Outlook step runs. useExample(text)
// puts an example task in the composer; openModels() opens Settings > Models.
export function createWizard({ $, el, icon, send, mcp, useExample, openModels }) {
  const root = $("wizard");
  let config = null;
  let step = null;
  // Opened automatically at most once per page load.
  let autoOpened = false;
  // The provider whose connection test is running.
  let testing = null;
  let returnFocus = null;

  const steps = () => (config.edition === "local" ? ["provider", "outlook", "done"] : ["provider", "done"]);

  function setButton(id, label, onClick) {
    const button = $(id);
    button.hidden = !label;
    button.disabled = false;
    if (!label) return;
    button.textContent = label;
    button.onclick = onClick;
  }

  function show(name) {
    step = name;
    const list = steps();
    for (const section of root.querySelectorAll("[data-step]")) section.hidden = section.dataset.step !== name;
    $("wizard-step").textContent = `Step ${list.indexOf(name) + 1} of ${list.length}`;
    $("wizard-title").textContent = root.querySelector(`[data-step="${name}"]`).dataset.title;
    setButton("wizard-back", name === "provider" ? "" : "Back", () => show(list[list.indexOf(name) - 1]));
    ({ provider: renderProvider, outlook: renderOutlook, done: renderDone })[name]();
    root.hidden = false;
    (name === "provider" ? $("wizard-provider") : $("wizard-next")).focus();
  }

  function result(kind, text) {
    const node = $("wizard-result");
    node.className = `pc-result ${kind}`;
    node.replaceChildren();
    if (kind !== "pending") node.append(icon(kind === "ok" ? "check" : "alert"));
    node.append(el("span", null, text));
  }

  // Step 1: provider and key.

  function renderProvider() {
    const p = $("wizard-provider").value;
    const info = config.keyInfo?.[p];
    const keyed = p !== "ollama";
    $("wizard-key-field").hidden = !keyed;
    $("wizard-ollama-note").hidden = keyed;
    $("wizard-result").replaceChildren();
    if (keyed) {
      const has = info && info.source !== "none";
      $("wizard-key").placeholder = has ? "Leave blank to keep the current key" : "Paste your API key";
      const note = $("wizard-key-note");
      if (has) note.textContent = `Using the ${info.source === "env" ? `key from ${info.env}` : "saved key"} (${info.mask}). Paste a new key to replace it.`;
      else {
        const link = Object.assign(el("a", null, new URL(KEY_PAGES[p]).hostname), { href: KEY_PAGES[p], target: "_blank", rel: "noopener noreferrer" });
        note.replaceChildren("Create one at ", link, ".");
      }
    }
    setButton("wizard-skip", "Skip setup", finish);
    setButton("wizard-next", "Test and continue", testProvider);
  }

  function testProvider() {
    const p = $("wizard-provider").value;
    const key = $("wizard-key").value.trim();
    if (p !== "ollama" && !key && config.keyInfo?.[p]?.source === "none") {
      result("error", "Paste an API key first.");
      return $("wizard-key").focus();
    }
    testing = p;
    $("wizard-next").disabled = true;
    $("wizard-next").textContent = "Testing…";
    result("pending", "Testing the connection…");
    send({ type: "test_provider", provider: p, key: key || undefined });
  }

  $("wizard-provider").addEventListener("change", () => {
    testing = null;
    $("wizard-key").value = "";
    renderProvider();
  });
  $("wizard-key").addEventListener("keydown", (e) => e.key === "Enter" && !$("wizard-next").disabled && testProvider());

  // Step 2: Outlook, through the MCP panel's connect flow.

  function renderOutlook() {
    $("wizard-outlook-logo").innerHTML = OUTLOOK_LOGO;
    const outlook = mcp.outlook;
    $("wizard-outlook-status").textContent = outlook?.signedIn ? `Connected${outlook.account ? ` as ${outlook.account}` : ""}.` : "";
    if (outlook?.signedIn) {
      setButton("wizard-skip", "");
      setButton("wizard-next", "Continue", () => show("done"));
      return;
    }
    setButton("wizard-skip", "Skip", () => show("done"));
    setButton("wizard-next", "Connect Outlook", () => {
      root.hidden = true;
      mcp.connectOutlook((signedIn) => show(signedIn ? "done" : "outlook"));
    });
  }

  // Step 3: done, with example tasks.

  function renderDone() {
    const model = config.models[config.provider];
    $("wizard-done-text").textContent = model
      ? `The agent will use ${model}. You can change the model and every other setting from the menu.`
      : "Choose a model in Settings > Models before your first task.";
    const examples = ["Find a well-reviewed lasagna recipe and open it.", "Compare the price of AirPods Pro at three stores."];
    if (mcp.outlook?.signedIn) examples.push("What's on my calendar tomorrow?", "Summarize my unread email from today.");
    $("wizard-examples").replaceChildren(
      ...examples.map((text) => {
        const button = el("button", null, text);
        button.type = "button";
        button.onclick = () => {
          finish();
          useExample(text);
        };
        return button;
      }),
    );
    setButton("wizard-skip", "");
    setButton("wizard-next", model ? "Start" : "Choose a model", () => {
      finish();
      if (!model) openModels();
    });
  }

  function close() {
    root.hidden = true;
    step = null;
    testing = null;
    returnFocus?.focus?.();
  }

  function finish() {
    if (!config.setupDone) send({ type: "save_config", patch: { setupDone: true } });
    close();
  }

  // Escape skips; Tab stays inside the dialog.
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      return finish();
    }
    if (e.key !== "Tab") return;
    const items = [...root.querySelectorAll("button, input, select, a[href]")].filter((n) => !n.disabled && n.offsetParent);
    const edge = e.shiftKey ? items[0] : items.at(-1);
    if (document.activeElement === edge) {
      e.preventDefault();
      (e.shiftKey ? items.at(-1) : items[0]).focus();
    }
  });

  function open() {
    autoOpened = true;
    returnFocus = document.activeElement;
    $("wizard-provider").value = config.provider;
    $("wizard-key").value = "";
    show("provider");
  }

  return {
    open,
    get isOpen() {
      return !root.hidden;
    },
    render(next) {
      config = next;
      if (!config.setupDone && !autoOpened) open();
      else if (step === "done") renderDone();
    },
    handlers: {
      provider_test(msg) {
        if (msg.provider !== testing || step !== "provider") return;
        testing = null;
        setButton("wizard-next", "Test and continue", testProvider);
        if (!msg.ok) return result("error", msg.text);
        const key = $("wizard-key").value.trim();
        $("wizard-key").value = "";
        send({ type: "save_config", patch: { provider: msg.provider, ...(key && { keys: { [msg.provider]: key } }) } });
        show(steps()[1]);
      },
    },
  };
}
