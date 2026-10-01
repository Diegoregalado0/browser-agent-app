import { keyProblem, RECENT_MODELS_MAX } from "../src/config-core.js";

// The model switcher: the current model as a button at the top left, a menu of the models
// ready to use, and a short flow to add one (provider, key or host, connection test,
// model). A switch is saved at once and applies from the next message; a running task
// keeps the model it started with.

export const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", mark: "A", keyPage: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI", mark: "O", keyPage: "https://platform.openai.com/api-keys" },
  { id: "gemini", name: "Google Gemini", mark: "G", keyPage: "https://aistudio.google.com/apikey" },
  { id: "mistral", name: "Mistral", mark: "M", keyPage: "https://console.mistral.ai/api-keys" },
  { id: "ollama", name: "Ollama", mark: "L", local: true },
];
const providerById = (id) => PROVIDERS.find((p) => p.id === id);
// The add flow's model list shows this many before asking for a search.
const LIST_MAX = 60;
// Model id families that are the providers' small, quick tiers.
const FAST_MODEL = /(^|[-_.:/])(haiku|flash|flash-lite|mini|nano|lite|small)([-_.:/]|$)/i;

// Providers the agent can run right now: a saved key, or for Ollama a chosen model.
export function usableProviders(config) {
  return PROVIDERS.filter((p) => (p.local ? Boolean(config.models.ollama) || config.provider === "ollama" : config.keyInfo?.[p.id]?.source === "saved")).map((p) => p.id);
}

// The provider's models for the menu, the current one first.
export function shortList(config, provider) {
  return [...new Set([config.models[provider], ...(config.recentModels?.[provider] ?? [])].filter(Boolean))].slice(0, RECENT_MODELS_MAX);
}

// The settings patch that switches to a model and remembers it, and the one it replaces,
// in the provider's recent picks.
export function switchPatch(config, provider, model) {
  const recent = [...new Set([model, config.models[provider], ...(config.recentModels?.[provider] ?? [])].filter(Boolean))].slice(0, RECENT_MODELS_MAX);
  return { provider, models: { [provider]: model }, recentModels: { [provider]: recent } };
}

// Short labels for a model, only where they are known.
export function modelTags(provider, model) {
  const tags = [];
  if (providerById(provider)?.local) tags.push("Local");
  if (FAST_MODEL.test(model)) tags.push("Fast");
  return tags;
}

// Arrow keys, Home and End move focus through items; true when the key was handled.
function moveFocus(e, items) {
  const i = items.indexOf(document.activeElement);
  const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
  if (next === undefined || !items.length) return false;
  e.preventDefault();
  items[(next + items.length) % items.length].focus();
  return true;
}

// toast(text): save feedback. isRunning(): whether a task is running.
// openKeys(): opens Settings > Models, where keys and endpoints are managed.
export function createModelSwitcher({ $, el, icon, send, toast, isRunning, openKeys }) {
  const chip = $("model");
  const menu = $("model-menu");
  const flow = $("model-flow");
  let config = null;
  // A switch waiting for the saved config: { provider, model, done }.
  let pending = null;

  function mark(id) {
    const p = providerById(id);
    const node = el("span", "pmark", p.local ? undefined : p.mark);
    node.dataset.provider = id;
    node.setAttribute("aria-hidden", "true");
    if (p.local) node.append(icon("models"));
    return node;
  }

  function tagList(provider, model) {
    return modelTags(provider, model).map((t) => el("span", "mtag", t));
  }

  function renderChip() {
    const model = config.models[config.provider];
    const name = el("span", "model-name", model || "Choose a model");
    chip.replaceChildren(mark(config.provider), el("span", "sr-only", "Model: "), name, icon("down"));
    chip.classList.toggle("unset", !model);
  }

  function pick(provider, model, done) {
    pending = { provider, model, done };
    send({ type: "save_config", patch: switchPatch(config, provider, model) });
  }

  // Shown once the saved config confirms the switch.
  function confirmSwitch() {
    const { provider, model, done } = pending;
    pending = null;
    chip.classList.remove("switched");
    void chip.offsetWidth;
    chip.classList.add("switched");
    const later = isRunning() ? " The running task finishes on its current model." : "";
    if (done) return done(later);
    toast(`Now using ${model}.${later}`);
    $("announce").textContent = `Now using ${model} from ${providerById(provider).name}`;
  }

  // Menu.

  function menuItem(role, content, onClick) {
    const item = el("button", `mm-item ${role === "menuitem" ? "mm-action" : ""}`.trim());
    item.type = "button";
    item.tabIndex = -1;
    item.setAttribute("role", role);
    item.append(...content);
    item.onclick = onClick;
    return item;
  }

  function renderMenu() {
    const usable = usableProviders(config);
    const parts = [];
    for (const id of usable) {
      const p = providerById(id);
      const group = el("div", "mm-group");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", p.name);
      const head = el("div", "mm-head");
      head.setAttribute("aria-hidden", "true");
      head.append(mark(id), el("span", null, p.name));
      group.append(head);
      for (const model of shortList(config, id)) {
        const current = id === config.provider && model === config.models[id];
        const item = menuItem("menuitemradio", [icon("check"), el("span", "mm-name", model), ...tagList(id, model)], () => {
          closeMenu();
          if (!current) pick(id, model);
        });
        item.setAttribute("aria-checked", String(current));
        group.append(item);
      }
      group.append(menuItem("menuitem", [icon("search"), el("span", null, shortList(config, id).length ? `More ${p.name} models` : `Choose a ${p.name} model`)], () => openFlow(id)));
      parts.push(group);
    }
    if (!usable.length) {
      const empty = el("div", "mm-empty");
      empty.append(el("strong", null, "No models yet"), el("span", null, "Connect a provider or a local model to start."));
      parts.push(empty);
    }
    const sep = el("div", "mm-sep");
    sep.setAttribute("role", "separator");
    parts.push(
      sep,
      menuItem("menuitem", [icon("plus"), el("span", null, "Add a model")], () => openFlow()),
      menuItem("menuitem", [icon("settings"), el("span", null, "Keys and endpoints")], () => {
        closeMenu(false);
        openKeys();
      }),
    );
    menu.replaceChildren(...parts);
  }

  const menuItems = () => [...menu.querySelectorAll("[role^=menuitem]")];

  function openMenu() {
    if (!config) return;
    renderMenu();
    const r = chip.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.max(8, r.left)}px`;
    menu.hidden = false;
    chip.setAttribute("aria-expanded", "true");
    (menu.querySelector('[aria-checked="true"]') ?? menuItems()[0]).focus();
  }

  function closeMenu(restoreFocus = true) {
    if (menu.hidden) return;
    menu.hidden = true;
    chip.setAttribute("aria-expanded", "false");
    if (restoreFocus) chip.focus();
  }

  chip.onclick = () => (menu.hidden ? openMenu() : closeMenu());
  chip.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openMenu();
      if (e.key === "ArrowUp") menuItems().at(-1).focus();
    }
  });
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      return closeMenu();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      return closeMenu();
    }
    moveFocus(e, menuItems());
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !chip.contains(e.target)) closeMenu(false);
  });
  addEventListener("resize", () => closeMenu(false));

  // Add flow: provider, then key or host with a connection test, then model, then done.
  // A provider that already works skips to its models.

  let provider = null;
  let testing = false;
  let models = [];
  let modelsError = null;
  // Set after a successful test: the model list loads once the saved config arrives.
  let loadAfterSave = false;
  // Set by first-run setup: the flow opens for the chosen provider once it is saved.
  let openAfterSave = false;
  // Where focus goes when the flow closes.
  let returnTo = null;

  function screen({ step, title, lead, body = [], primary, back }) {
    $("mf-steps").replaceChildren();
    if (step) {
      const bar = el("span", "mf-bar");
      bar.setAttribute("aria-hidden", "true");
      for (let i = 1; i <= 3; i++) bar.append(el("span", i < step ? "done" : i === step ? "current" : null));
      $("mf-steps").append(el("span", null, `Step ${step} of 3`), bar);
    }
    $("mf-title").textContent = title;
    $("mf-lead").textContent = lead ?? "";
    $("mf-lead").hidden = !lead;
    $("mf-body").replaceChildren(...body);
    $("mf-back").hidden = !back;
    $("mf-back").onclick = back;
    $("mf-primary").hidden = !primary;
    if (primary) {
      $("mf-primary").textContent = primary[0];
      $("mf-primary").onclick = primary[1];
      $("mf-primary").disabled = false;
    }
    if (!flow.open) flow.showModal();
  }

  function result(kind, text) {
    const node = $("mf-result");
    node.className = `pc-result ${kind}`;
    node.replaceChildren(...(kind && kind !== "pending" ? [icon(kind === "ok" ? "check" : "alert")] : []), el("span", null, text));
  }

  function resultNode() {
    const node = Object.assign(el("p", "pc-result"), { id: "mf-result" });
    node.setAttribute("aria-live", "polite");
    return node;
  }

  function field(label, input, note) {
    const wrap = el("div", "card-field");
    const l = el("label", "card-label", label);
    l.htmlFor = input.id;
    wrap.append(l, input);
    if (note) {
      const n = Object.assign(el("p", "field-note"), { id: `${input.id}-note` });
      n.append(...[note].flat());
      input.setAttribute("aria-describedby", `${n.id} mf-result`);
      wrap.append(n);
    }
    return wrap;
  }

  function pickProvider() {
    const usable = usableProviders(config);
    const list = el("div", "mf-providers");
    for (const p of PROVIDERS) {
      const button = el("button", "mf-provider");
      button.type = "button";
      button.append(mark(p.id), el("span", "mf-pname", p.local ? "Local model (Ollama)" : p.name));
      if (usable.includes(p.id)) button.append(el("span", "mtag ok", "Connected"));
      button.onclick = () => (usable.includes(p.id) ? chooseModel(p.id) : connect(p.id));
      list.append(button);
    }
    list.addEventListener("keydown", (e) => moveFocus(e, [...list.children]));
    screen({ step: 1, title: "Add a model", lead: "Pick where it runs.", body: [list] });
    list.firstChild.focus();
  }

  function connect(id) {
    provider = providerById(id);
    const body = [];
    let focus;
    if (provider.local) {
      const host = Object.assign(el("input"), { id: "mf-host", value: config.ollamaHost, spellcheck: false, placeholder: "http://127.0.0.1:11434" });
      body.push(field("Ollama address", host, ["Start Ollama with ", el("code", null, "OLLAMA_ORIGINS=chrome-extension://* ollama serve"), "."]));
      focus = host;
    } else {
      const info = config.keyInfo?.[id];
      const has = info?.source === "saved";
      const key = Object.assign(el("input"), { id: "mf-key", type: "password", autocomplete: "off", spellcheck: false, placeholder: has ? "Leave blank to keep the saved key" : "Paste your API key" });
      const link = Object.assign(el("a", null, new URL(provider.keyPage).hostname), { href: provider.keyPage, target: "_blank", rel: "noopener noreferrer" });
      body.push(field("API key", key, [...(has ? [`Saved key: ${info.mask}. `] : []), "Get one at ", link, ". It stays on this device and goes only to ", provider.name, "."]));
      focus = key;
      if (id === "openai") {
        const more = el("details", "mf-more");
        more.append(el("summary", null, "Use an OpenAI-compatible server"));
        const base = Object.assign(el("input"), { id: "mf-base", value: config.openaiBaseUrl, spellcheck: false, placeholder: "https://api.openai.com/v1" });
        more.append(field("Base URL", base, "For OpenRouter, LM Studio, vLLM and similar. Leave blank for OpenAI."));
        more.open = Boolean(config.openaiBaseUrl);
        body.push(more);
      }
    }
    body.push(resultNode());
    for (const input of body.flatMap((n) => [...n.querySelectorAll?.("input") ?? []])) {
      input.addEventListener("keydown", (e) => e.key === "Enter" && !testing && test());
    }
    screen({ step: 2, title: provider.local ? "Connect a local model" : `Connect ${provider.name}`, body, primary: ["Test connection", test], back: pickProvider });
    focus.focus();
  }

  function test() {
    const key = $("mf-key")?.value.trim();
    const typedKeyProblem = key && keyProblem(key);
    if (!provider.local && !key && config.keyInfo?.[provider.id]?.source !== "saved") {
      result("error", "Paste an API key first.");
      return $("mf-key").focus();
    }
    if (typedKeyProblem) {
      result("error", typedKeyProblem);
      return $("mf-key").focus();
    }
    testing = true;
    $("mf-primary").disabled = true;
    $("mf-primary").textContent = "Testing…";
    result("pending", "Testing the connection…");
    send({ type: "test_provider", provider: provider.id, key: key || undefined, baseUrl: $("mf-base")?.value.trim(), host: $("mf-host")?.value.trim() });
  }

  function chooseModel(id) {
    provider = providerById(id);
    models = [];
    modelsError = null;
    const search = Object.assign(el("input"), { id: "mf-search", type: "search", autocomplete: "off", spellcheck: false, placeholder: "Search or type a model id" });
    search.setAttribute("aria-controls", "mf-list");
    const list = Object.assign(el("div", "mf-list"), { id: "mf-list" });
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", `${provider.name} models`);
    const status = Object.assign(el("p", "field-note"), { id: "mf-list-status" });
    status.setAttribute("aria-live", "polite");
    search.setAttribute("aria-describedby", status.id);
    search.oninput = renderModelList;
    search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        list.querySelector("[role=option]")?.focus();
      } else if (e.key === "Enter") list.querySelector("[role=option]")?.click();
    });
    list.addEventListener("keydown", (e) => {
      const options = [...list.querySelectorAll("[role=option]")];
      if (e.key === "ArrowUp" && document.activeElement === options[0]) {
        e.preventDefault();
        return search.focus();
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        return document.activeElement.click();
      }
      moveFocus(e, options);
    });
    const label = el("label", "card-label", "Find a model");
    label.htmlFor = search.id;
    screen({ step: 3, title: "Pick a model", lead: `From ${provider.name}.`, body: [label, search, status, list], back: pickProvider });
    renderModelList();
    send({ type: "list_models", provider: id });
    search.focus();
  }

  function renderModelList() {
    const list = $("mf-list");
    const status = $("mf-list-status");
    if (!list) return;
    const query = $("mf-search").value.trim();
    const known = shortList(config, provider.id);
    const all = [...new Set([...known, ...models])];
    const shown = all.filter((m) => m.toLowerCase().includes(query.toLowerCase()));
    const options = shown.slice(0, LIST_MAX).map((m) => modelOption(m, m));
    // A model the list does not show (a new release, a custom server) can be typed.
    if (query && !all.includes(query) && /^[\w.:/@+-]{1,200}$/.test(query)) options.push(modelOption(query, `Use “${query}”`));
    list.replaceChildren(...options);
    list.hidden = !options.length;
    status.className = `field-note${modelsError ? " error" : ""}`;
    status.replaceChildren(
            modelsError ??
        (!models.length ? "Loading models…"
        : shown.length > LIST_MAX ? `Showing ${LIST_MAX} of ${shown.length}. Search to narrow it down.`
        : `${shown.length} model${shown.length === 1 ? "" : "s"}${query ? (shown.length === 1 ? " matches" : " match") : ""}.`),
    );
    if (modelsError && !provider.local) {
      const fix = el("button", "link", "Update the key");
      fix.type = "button";
      fix.onclick = () => connect(provider.id);
      status.append(" ", fix);
    }
  }

  function modelOption(model, text) {
    const current = provider.id === config.provider && model === config.models[provider.id];
    const option = el("div", "mf-option");
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(current));
    option.tabIndex = -1;
    option.append(icon("check"), el("span", "mm-name", text), ...tagList(provider.id, model));
    option.onclick = () => pick(provider.id, model, (later) => doneScreen(model, later));
    return option;
  }

  function doneScreen(model, later) {
    const badge = el("div", "mf-done");
    badge.append(icon("check"));
    screen({ title: "You're all set", lead: `Now using ${model} from ${provider.name}.${later}`, body: [badge], primary: ["Done", () => flow.close()] });
    $("mf-primary").focus();
  }

  function openFlow(id) {
    if (!flow.open) returnTo = menu.hidden ? document.activeElement : chip;
    closeMenu(false);
    if (id && usableProviders(config).includes(id)) chooseModel(id);
    else if (id) connect(id);
    else pickProvider();
  }

  $("mf-close").onclick = () => flow.close();
  // Escape closes the dialog only, not the sheet behind it.
  flow.addEventListener("keydown", (e) => e.key === "Escape" && e.stopPropagation());
  flow.addEventListener("close", () => {
    testing = false;
    loadAfterSave = false;
    (returnTo?.isConnected && returnTo.offsetParent && !returnTo.closest("[inert]") ? returnTo : $("input")).focus();
  });

  return {
    openFlow,
    openFlowAfterSave: () => (openAfterSave = true),
    render(next) {
      config = next;
      renderChip();
      if (!menu.hidden) renderMenu();
      if (openAfterSave) {
        openAfterSave = false;
        openFlow(config.provider);
      }
      // A list that failed before the key was saved is asked for again.
      else if (flow.open && $("mf-list") && modelsError) send({ type: "list_models", provider: provider.id });
      if (pending && config.provider === pending.provider && config.models[pending.provider] === pending.model) confirmSwitch();
      if (loadAfterSave) {
        loadAfterSave = false;
        chooseModel(provider.id);
      }
    },
    handlers: {
      provider_test(msg) {
        if (!testing || msg.provider !== provider?.id) return;
        testing = false;
        if (!msg.ok) {
          $("mf-primary").disabled = false;
          $("mf-primary").textContent = "Test connection";
          result("error", msg.text);
          return ($("mf-key") ?? $("mf-host")).focus();
        }
        result("ok", msg.text);
        const key = $("mf-key")?.value.trim();
        const patch = {};
        if (key) patch.keys = { [provider.id]: key };
        if ($("mf-host")) patch.ollamaHost = $("mf-host").value.trim();
        if ($("mf-base") && $("mf-base").value.trim() !== config.openaiBaseUrl) patch.openaiBaseUrl = $("mf-base").value.trim();
        if ($("mf-key")) $("mf-key").value = "";
        if (!Object.keys(patch).length) return chooseModel(provider.id);
        loadAfterSave = true;
        send({ type: "save_config", patch });
      },
      models(msg) {
        if (!flow.open || msg.provider !== provider?.id || !$("mf-list")) return;
        models = msg.models;
        modelsError = msg.error ?? null;
        renderModelList();
      },
    },
  };
}
