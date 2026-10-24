import { accessKeyParts, keyProblem, MODEL_HISTORY_MAX, GPU_BASE_URL } from "../src/config-core.js";

// Models, in two places. The quick selector: the current model as a button at the top
// left, opening a menu of the models already used, to switch between them. The main menu
// (Settings > Models): every provider with its key or host, a connection test, and its
// full model list. A switch is saved at once and applies from the next message; a running
// task keeps the model it started with.

export const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", mark: "A", keyPage: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI", mark: "O", keyPage: "https://platform.openai.com/api-keys" },
  { id: "gemini", name: "Google Gemini", mark: "G", keyPage: "https://aistudio.google.com/apikey" },
  { id: "mistral", name: "Mistral", mark: "M", keyPage: "https://console.mistral.ai/api-keys" },
  { id: "ollama", name: "Local", mark: "L", local: true },
];
// The kinds of Local connection (LOCAL_KINDS), as the Local card and first-run setup offer them.
export const LOCAL_KINDS = [
  { id: "gpu", name: "Browsby GPU server", label: "The Browsby GPU server, through its tunnel on this computer" },
  { id: "server", name: "OpenAI-compatible server", label: "An OpenAI-compatible server: llama.cpp, LM Studio, vLLM and similar" },
  { id: "ollama", name: "Ollama", label: "Ollama on this computer or your network" },
];
export const OLLAMA_COMMAND = "OLLAMA_ORIGINS=chrome-extension://* ollama serve";
const providerById = (id) => PROVIDERS.find((p) => p.id === id);
// A provider's model list shows this many before asking for a search.
const LIST_MAX = 60;
// Model id families that are the providers' small, quick tiers.
const FAST_MODEL = /(^|[-_.:/])(haiku|flash|flash-lite|mini|nano|lite|small)([-_.:/]|$)/i;
const MODEL_ID = /^[\w.:/@+-]{1,200}$/;
const same = (a, b) => a.provider === b.provider && a.model === b.model && a.kind === b.kind;
// A history entry; a Local one carries its kind of connection (the current one by default).
const entry = (config, provider, model, kind = config.localKind) => ({ provider, model, ...(provider === "ollama" && { kind }) });
const kindName = (id) => LOCAL_KINDS.find((k) => k.id === id).name;

// Whether the agent can run on a provider: a saved key, or for Local an address, which
// only an OpenAI-compatible server can lack.
export function usable(config, provider, kind = config.localKind) {
  if (providerById(provider)?.local) return kind !== "server" || Boolean(config.serverBaseUrl);
  return config.keyInfo?.[provider]?.source === "saved";
}

// The address a Local connection of this kind reaches.
export const localEndpoint = (config, kind = config.localKind) => ({ gpu: config.gpuBaseUrl, server: config.serverBaseUrl, ollama: config.ollamaHost })[kind];

// The models already used whose provider can still run, newest first. The current model
// leads even before it is in the history (set by first-run setup or an earlier version).
export function usedModels(config) {
  const current = entry(config, config.provider, config.models[config.provider]);
  const all = [...(current.model ? [current] : []), ...(config.modelHistory ?? [])];
  return all.filter((m, i) => usable(config, m.provider, m.kind) && all.findIndex((n) => same(m, n)) === i);
}

// Whether a history entry is the model in use.
export const isCurrent = (config, m) => same(m, entry(config, config.provider, config.models[config.provider]));

// The settings patch that switches to a model and puts it, and the one it replaces, at
// the front of the history. A Local model of another kind switches the connection too.
export function switchPatch(config, provider, model, kind = config.localKind) {
  const previous = entry(config, config.provider, config.models[config.provider]);
  const all = [entry(config, provider, model, kind), ...(previous.model ? [previous] : []), ...(config.modelHistory ?? [])];
  const modelHistory = all.filter((m, i) => all.findIndex((n) => same(m, n)) === i).slice(0, MODEL_HISTORY_MAX);
  return { provider, models: { [provider]: model }, modelHistory, ...(provider === "ollama" && kind !== config.localKind && { localKind: kind }) };
}

// The settings patch that takes a model out of the history.
export function forgetPatch(config, entry) {
  return { modelHistory: (config.modelHistory ?? []).filter((m) => !same(m, entry)) };
}

// The settings patch that saves a Local connection that passed its test. A new kind of
// connection drops the model chosen for the previous one, which it does not serve.
export function localPatch(config, { kind, baseUrl, host }) {
  const patch = {};
  if (kind !== config.localKind) Object.assign(patch, { localKind: kind, models: { ollama: "" } });
  if (kind === "ollama" && host && host !== config.ollamaHost) patch.ollamaHost = host;
  const setting = { gpu: "gpuBaseUrl", server: "serverBaseUrl" }[kind];
  if (setting && baseUrl && baseUrl !== config[setting]) patch[setting] = baseUrl;
  return patch;
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

// toast(text): save feedback. isRunning(): whether a task is running. openMain(): opens
// Settings > Models. confirmInline(button, options): the settings' inline confirmation.
export function createModelSwitcher({ $, el, icon, send, toast, isRunning, openMain, confirmInline }) {
  const chip = $("model");
  const menu = $("model-menu");
  const cardsRoot = $("provider-cards");
  let config = null;
  // A switch waiting for the saved config: { provider, model }.
  let pending = null;
  // The Browsby GPU server's catalog ({ models, default }) once the controller has fetched
  // it: the GPU server offers these models only, shown by name.
  let serverModels = null;
  const onServer = (provider, kind = config.localKind) => provider === "ollama" && kind === "gpu";
  const serverEntry = (provider, model, kind) => (onServer(provider, kind) ? serverModels?.models.find((m) => m.id === model) : undefined);
  const nameOf = (provider, model, kind) => serverEntry(provider, model, kind)?.name ?? model;

  function mark(id) {
    const p = providerById(id);
    const node = el("span", "pmark", p.local ? undefined : p.mark);
    node.dataset.provider = id;
    node.setAttribute("aria-hidden", "true");
    if (p.local) node.append(icon("models"));
    return node;
  }

  const tagList = (provider, model) => modelTags(provider, model).map((t) => el("span", "mtag", t));

  function renderChip() {
    const model = config.models[config.provider];
    chip.replaceChildren(mark(config.provider), el("span", "sr-only", "Model: "), el("span", "model-name", model ? nameOf(config.provider, model) : "Choose a model"), icon("down"));
    chip.classList.toggle("unset", !model);
  }

  function pick(provider, model, kind) {
    pending = { provider, model };
    send({ type: "save_config", patch: switchPatch(config, provider, model, kind) });
  }

  // Shown once the saved config confirms the switch.
  function confirmSwitch() {
    const { provider, model } = pending;
    pending = null;
    chip.classList.remove("switched");
    void chip.offsetWidth;
    chip.classList.add("switched");
    const later = isRunning() ? " The running task finishes on its current model." : "";
    toast(`Now using ${nameOf(provider, model)}.${later}`);
    $("announce").textContent = `Now using ${nameOf(provider, model)} from ${providerById(provider).name}`;
  }

  // Quick selector.

  function menuItem(role, content, onClick) {
    const item = el("button", "mm-item");
    item.type = "button";
    item.tabIndex = -1;
    item.setAttribute("role", role);
    item.append(...content);
    item.onclick = onClick;
    return item;
  }

  // The models already used, where the GPU server's are its current catalog: every model it
  // offers, and none it no longer does.
  function menuModels() {
    const used = usedModels(config);
    if (!serverModels) return used;
    const catalog = serverModels.models.map((m) => entry(config, "ollama", m.id, "gpu"));
    return [...used.filter((m) => !onServer(m.provider, m.kind) || serverEntry(m.provider, m.model, m.kind)), ...catalog].filter((m, i, all) => all.findIndex((n) => same(m, n)) === i);
  }

  function renderMenu() {
    const rows = menuModels().map((m) => {
      const current = isCurrent(config, m);
      const row = el("div", "mm-row");
      const where = m.kind ? kindName(m.kind) : providerById(m.provider).name;
      const name = nameOf(m.provider, m.model, m.kind);
      const item = menuItem("menuitemradio", [mark(m.provider), el("span", "mm-name", name), ...tagList(m.provider, m.model), icon("check")], () => {
        closeMenu();
        if (!current) pick(m.provider, m.model, m.kind);
      });
      item.setAttribute("aria-checked", String(current));
      item.setAttribute("aria-label", `${name}, ${where}`);
      item.title = serverEntry(m.provider, m.model, m.kind)?.description || where;
      row.append(item);
      // The GPU server's models stay listed while it offers them.
      if (!current && !serverEntry(m.provider, m.model, m.kind)) {
        item.setAttribute("aria-keyshortcuts", "Delete");
        const x = menuItem("menuitem", [icon("close")], () => forget(m, row));
        x.classList.add("mm-remove");
        x.setAttribute("aria-label", `Remove ${name} from this list`);
        x.title = "Remove from this list";
        row.append(x);
      }
      return row;
    });
    const add = menuItem("menuitem", [icon("plus"), el("span", null, "Add a new model")], () => {
      closeMenu();
      openMain();
    });
    add.classList.add("mm-add");
    add.setAttribute("aria-label", "Add a new model");
    const parts = rows.length ? [...rows, Object.assign(el("div", "mm-sep"), { role: "separator" })] : [el("p", "mm-empty", "Models you pick show up here for quick switching.")];
    menu.replaceChildren(...parts, add);
  }

  // Removes a model from the history; focus moves to the next row.
  function forget(entry, row) {
    const next = row.nextElementSibling?.querySelector("[role=menuitemradio]") ?? row.previousElementSibling?.querySelector("[role=menuitemradio]");
    send({ type: "save_config", patch: forgetPatch(config, entry) });
    row.remove();
    (next ?? menu.querySelector(".mm-add")).focus();
  }

  // Arrow keys move through the models and Add a new model; a model's remove button is
  // reached with ArrowRight.
  const menuItems = () => [...menu.querySelectorAll("[role=menuitemradio], .mm-add")];

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
    const active = document.activeElement;
    if (e.key === "Escape") {
      e.stopPropagation();
      return closeMenu();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      return closeMenu();
    }
    const x = active.closest(".mm-row")?.querySelector(".mm-remove");
    if (x && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      return x.click();
    }
    if (e.key === "ArrowRight" && x && active !== x) return x.focus();
    if (e.key === "ArrowLeft" && active === x) return active.previousElementSibling.focus();
    if (active === x && ["ArrowUp", "ArrowDown"].includes(e.key)) active.previousElementSibling.focus();
    moveFocus(e, menuItems());
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !chip.contains(e.target)) closeMenu(false);
  });
  addEventListener("resize", () => closeMenu(false));

  // Main menu: one card per provider. The card of a provider that can run lists its
  // models; a key, host or base URL is saved only after its connection test passes.

  // Per provider: { models, error, loadedFor }. loadedFor is the key mask and endpoint the
  // list was loaded with, so a changed key loads it again.
  const lists = {};
  // Providers whose connection test is running.
  const testing = new Set();
  const endpointOf = (p) => [config.keyInfo?.[p]?.mask, providerById(p).local ? `${config.localKind} ${localEndpoint(config)}` : ""].join(" ");

  function inputField(card, label, input, note) {
    input.id = `${card.dataset.provider}-${input.dataset.role}`;
    const wrap = el("div", "card-field");
    const l = el("label", "card-label", label);
    l.htmlFor = input.id;
    wrap.append(l, input);
    if (note) {
      const n = Object.assign(el("p", "field-note"), { id: `${input.id}-note` });
      n.append(...[note].flat());
      wrap.append(n);
      input.setAttribute("aria-describedby", `${n.id} ${card.dataset.provider}-result`);
    }
    return wrap;
  }

  function buildCard(p) {
    const card = el("section", "provider-card");
    card.dataset.provider = p.id;
    const toggle = el("button", "pc-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", `${p.id}-body`);
    toggle.append(mark(p.id), el("span", "pc-name", p.name), el("span", "pc-status"), icon("down"));
    const body = Object.assign(el("div", "pc-body"), { id: `${p.id}-body`, hidden: true });
    toggle.onclick = () => setExpanded(card, body.hidden);
    card.append(toggle, body);

    const key = Object.assign(el("input"), { type: "password", spellcheck: false, autocomplete: "off" });
    key.dataset.role = "key";
    if (p.local) {
      // One group of fields per kind of connection; the select shows the chosen kind's.
      const kind = el("select");
      kind.dataset.role = "kind";
      kind.append(...LOCAL_KINDS.map((k) => Object.assign(el("option", null, k.name), { value: k.id })));
      kind.onchange = () => showKind(card);
      body.append(inputField(card, "Connection", kind));
      const group = (id, ...fields) => {
        const node = el("div", "pc-kind");
        node.dataset.kind = id;
        node.append(...fields);
        return node;
      };
      const url = (role, placeholder) => {
        const input = Object.assign(el("input"), { type: "url", inputMode: "url", spellcheck: false, autocomplete: "off", placeholder });
        input.dataset.role = role;
        return input;
      };
      const gpuBase = url("gpu-base", GPU_BASE_URL);
      // A shared GPU server's access key; pasting one fills in its address.
      const gpuKey = Object.assign(el("input"), { type: "password", spellcheck: false, autocomplete: "off" });
      gpuKey.dataset.role = "gpu-key";
      gpuKey.addEventListener("input", () => {
        const access = accessKeyParts(gpuKey.value.trim());
        if (access) gpuBase.value = `${access.origin}/v1`;
      });
      const serverBase = url("server-base", "http://localhost:1234/v1");
      const host = Object.assign(el("input"), { spellcheck: false, placeholder: "http://127.0.0.1:11434" });
      host.dataset.role = "host";
      const ctx = Object.assign(el("input"), { type: "number", min: 4096, step: 1024, className: "narrow-input" });
      ctx.dataset.role = "context";
      ctx.addEventListener("change", () => {
        const value = Math.max(4096, parseInt(ctx.value, 10) || 32768);
        ctx.value = value;
        send({ type: "save_config", patch: { ollamaContext: value } });
      });
      body.append(
        group(
          "gpu",
          inputField(card, "Base URL", gpuBase, "The GPU server through its tunnel on this computer, or its address from an access key."),
          inputField(card, "Access key (optional)", gpuKey, "For a shared Browsby GPU server: paste the bzk1_ key its owner gave you. It goes only to that server."),
        ),
        group(
          "server",
          inputField(card, "Base URL", serverBase, "For llama.cpp, LM Studio, vLLM and similar."),
          inputField(card, "API key (optional)", key, "Only if the server asks for one. It stays on this device and goes only to this server."),
        ),
        group(
          "ollama",
          inputField(card, "Host", host, ["Start Ollama with ", el("code", null, OLLAMA_COMMAND), ". Use a model that supports tools."]),
          inputField(card, "Context window (tokens)", ctx),
        ),
      );
    } else {
      const link = Object.assign(el("a", null, new URL(p.keyPage).hostname), { href: p.keyPage, target: "_blank", rel: "noopener noreferrer" });
      body.append(inputField(card, "API key", key, ["Get one at ", link, `. It stays on this device and goes only to ${p.name}.`]));
    }
    for (const field of body.querySelectorAll('[data-role="key"], [data-role="gpu-key"], [data-role="host"], [data-role$="base"]')) {
      field.addEventListener("keydown", (e) => e.key === "Enter" && !testing.has(p.id) && test(card));
    }

    const actions = el("div", "pc-actions");
    const testButton = el("button", "pc-test", "Test and save");
    testButton.type = "button";
    testButton.onclick = () => test(card);
    actions.append(testButton);
    const remove = el("button", "link-danger pc-remove", "Remove key");
    remove.type = "button";
    remove.onclick = () =>
      confirmInline(remove, {
        question: `Remove the saved ${p.local ? (config.localKind === "gpu" ? "access" : "server") : p.name} key?`,
        confirmLabel: "Remove",
        onConfirm: () => send({ type: "save_config", patch: { keys: { [p.local && config.localKind === "gpu" ? "gpu" : p.id]: "__clear__" } } }),
      });
    actions.append(remove);
    const result = Object.assign(el("p", "pc-result"), { id: `${p.id}-result` });
    result.setAttribute("aria-live", "polite");
    body.append(actions, result);

    const models = el("div", "pc-models");
    const search = Object.assign(el("input"), { type: "search", spellcheck: false, autocomplete: "off", placeholder: "Search or type a model id" });
    search.dataset.role = "search";
    const list = Object.assign(el("div", "ml-list"), { id: `${p.id}-models` });
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", `${p.name} models`);
    search.setAttribute("aria-controls", list.id);
    const status = Object.assign(el("p", "field-note"), { id: `${p.id}-models-status` });
    status.setAttribute("aria-live", "polite");
    search.oninput = () => renderList(card);
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
    const label = el("label", "card-label", "Models");
    label.htmlFor = search.id = `${p.id}-search`;
    search.setAttribute("aria-describedby", status.id);
    models.append(label, search, status, list);
    body.append(models);
    return card;
  }

  function setExpanded(card, open) {
    card.querySelector(".pc-toggle").setAttribute("aria-expanded", String(open));
    card.querySelector(".pc-body").hidden = !open;
    if (open) loadIfNeeded(card.dataset.provider);
  }

  function result(card, kind, text) {
    const node = card.querySelector(".pc-result");
    node.className = `pc-result ${kind}`;
    node.replaceChildren(...(kind && kind !== "pending" ? [icon(kind === "ok" ? "check" : "alert")] : []), el("span", null, text));
  }

  const field = (card, role) => card.querySelector(`[data-role="${role}"]`);

  // The Local card shows the fields of the kind of connection chosen in its select.
  function showKind(card) {
    const kind = field(card, "kind").value;
    for (const group of card.querySelectorAll(".pc-kind")) group.hidden = group.dataset.kind !== kind;
    card.querySelector(".pc-remove").hidden = !(kind === "server" && config.keyInfo?.ollama?.source === "saved");
  }

  // The fields a Local test sends and, once it passes, saves: { kind, baseUrl, host }.
  function localFields(card) {
    const kind = field(card, "kind").value;
    const baseUrl = kind === "ollama" ? undefined : field(card, `${kind}-base`).value.trim();
    return { kind, baseUrl, host: kind === "ollama" ? field(card, "host").value.trim() : undefined };
  }

  // The first field of the kind shown, for focus after a failed test.
  const firstField = (card) => card.querySelector(".pc-kind:not([hidden]) input") ?? field(card, "key");

  function test(card) {
    const p = card.dataset.provider;
    const local = providerById(p).local;
    const kind = local && field(card, "kind").value;
    const key = kind === "gpu" ? field(card, "gpu-key").value.trim() : local && kind !== "server" ? "" : field(card, "key").value.trim();
    if (!local && !key && !usable(config, p)) {
      result(card, "error", "Paste an API key first.");
      return field(card, "key").focus();
    }
    const problem = key && keyProblem(key);
    if (problem) {
      result(card, "error", problem);
      return field(card, "key").focus();
    }
    testing.add(p);
    card.querySelector(".pc-test").disabled = true;
    result(card, "pending", "Testing the connection…");
    send({ type: "test_provider", provider: p, key: key || undefined, ...(local && localFields(card)) });
  }

  function loadIfNeeded(p) {
    const state = (lists[p] ??= { models: [], error: null, loadedFor: null });
    if (!usable(config, p) || state.loadedFor === endpointOf(p)) return;
    state.loadedFor = endpointOf(p);
    state.models = [];
    state.error = null;
    renderList(cardOf(p));
    send({ type: "list_models", provider: p });
  }

  const cardOf = (p) => cardsRoot.querySelector(`[data-provider="${p}"]`);

  function renderList(card) {
    const p = card.dataset.provider;
    const state = lists[p] ?? { models: [], error: null };
    const list = card.querySelector(".ml-list");
    const status = card.querySelector(`#${p}-models-status`);
    const query = field(card, "search").value.trim();
    // The GPU server offers its catalog and nothing else, so nothing can be typed in.
    const server = onServer(p);
    const used = server ? [] : usedModels(config).filter((m) => m.provider === p && m.kind === entry(config, p, "").kind).map((m) => m.model);
    const all = [...new Set([...used, ...state.models])];
    const shown = all.filter((m) => `${m} ${nameOf(p, m)}`.toLowerCase().includes(query.toLowerCase()));
    const options = shown.slice(0, LIST_MAX).map((m) => option(p, m, nameOf(p, m)));
    // A model the list does not show (a new release, a custom server) can be typed.
    if (!server && query && !all.includes(query) && MODEL_ID.test(query)) options.push(option(p, query, `Use “${query}”`));
    list.replaceChildren(...options);
    list.hidden = !options.length;
    status.className = `field-note${state.error ? " error" : ""}`;
    status.textContent =
      state.error ??
      (!state.models.length && !state.loadedFor ? ""
      : !state.models.length ? "Loading models…"
      : server && state.models.length === 1 ? ""
      : server && !query ? `${state.models.length} models on the GPU server.`
      : shown.length > LIST_MAX ? `Showing ${LIST_MAX} of ${shown.length}. Search to narrow it down.`
      : `${shown.length} model${shown.length === 1 ? "" : "s"}${query ? (shown.length === 1 ? " matches" : " match") : ""}.`);
  }

  function option(p, model, text) {
    const current = p === config.provider && model === config.models[p];
    const node = el("div", "ml-option");
    node.setAttribute("role", "option");
    node.setAttribute("aria-selected", String(current));
    node.tabIndex = -1;
    node.append(icon("check"), el("span", "mm-name", text), ...tagList(p, model));
    const description = serverEntry(p, model)?.description;
    if (description) node.title = description;
    node.onclick = () => current || pick(p, model);
    return node;
  }

  function renderCards() {
    for (const card of cardsRoot.children) {
      const p = card.dataset.provider;
      const ok = usable(config, p);
      const info = config.keyInfo?.[p];
      card.classList.toggle("active", p === config.provider);
      const status = card.querySelector(".pc-status");
      status.className = `pc-status${ok ? " saved" : ""}`;
      status.textContent = !ok ? "Not connected" : p === config.provider ? "In use" : providerById(p).local ? "" : `Key ${info.mask}`;
      const local = providerById(p).local;
      if (local && ok && p !== config.provider) status.textContent = LOCAL_KINDS.find((k) => k.id === config.localKind).name;
      const key = field(card, "key");
      const saved = info?.source === "saved";
      key.placeholder = saved ? `Paste a new key to replace ${info.mask}` : local ? "None" : "Paste your API key";
      card.querySelector(".pc-test").textContent = !local && ok && !key.value ? "Test connection" : "Test and save";
      card.querySelector(".pc-remove").hidden = !ok;
      if (local) {
        const access = config.keyInfo?.gpu;
        field(card, "gpu-key").placeholder = access?.source === "saved" ? `Paste a new key to replace ${access.mask}` : "None";
        for (const [role, value] of [["kind", config.localKind], ["gpu-base", config.gpuBaseUrl], ["server-base", config.serverBaseUrl], ["host", config.ollamaHost], ["context", config.ollamaContext]]) {
          const input = field(card, role);
          if (document.activeElement !== input) input.value = value ?? "";
        }
        showKind(card);
      }
      card.querySelector(".pc-models").hidden = !ok;
      if (!card.querySelector(".pc-body").hidden) loadIfNeeded(p);
      renderList(card);
    }
  }

  for (const p of PROVIDERS) cardsRoot.append(buildCard(p));
  for (const card of cardsRoot.children) {
    card.querySelector(".pc-toggle").addEventListener("keydown", (e) => moveFocus(e, [...cardsRoot.querySelectorAll(".pc-toggle")]));
  }

  return {
    // Settings > Models was opened: the current provider's card is open, with its list
    // loaded fresh.
    pageShown() {
      if (!config) return;
      for (const p of Object.keys(lists)) lists[p].loadedFor = null;
      setExpanded(cardOf(config.provider), true);
    },
    render(next) {
      const previous = config?.provider;
      config = next;
      renderChip();
      // The menu is drawn again with focus kept on the same item.
      if (!menu.hidden) {
        const focused = menu.contains(document.activeElement) && document.activeElement.getAttribute("aria-label");
        renderMenu();
        if (focused) (menu.querySelector(`[aria-label="${CSS.escape(focused)}"]`) ?? menuItems()[0]).focus();
      }
      renderCards();
      // A provider chosen elsewhere (first-run setup) while Settings > Models shows gets its card
      // opened in place of the previous one's.
      if (previous && previous !== config.provider && cardsRoot.offsetParent) {
        setExpanded(cardOf(previous), false);
        setExpanded(cardOf(config.provider), true);
      }
      if (pending && config.provider === pending.provider && config.models[pending.provider] === pending.model) confirmSwitch();
    },
    handlers: {
      provider_test(msg) {
        if (!testing.delete(msg.provider)) return;
        const card = cardOf(msg.provider);
        card.querySelector(".pc-test").disabled = false;
        if (!msg.ok) {
          result(card, "error", msg.text);
          return (providerById(msg.provider).local ? firstField(card) : field(card, "key")).focus();
        }
        const local = providerById(msg.provider).local;
        const kind = local && field(card, "kind").value;
        const key = kind === "gpu" ? field(card, "gpu-key").value.trim() : local && kind !== "server" ? "" : field(card, "key").value.trim();
        const patch = {};
        if (key) patch.keys = { [kind === "gpu" ? "gpu" : msg.provider]: key };
        if (local) Object.assign(patch, localPatch(config, localFields(card)));
        field(card, "key").value = "";
        if (local) field(card, "gpu-key").value = "";
        result(card, "ok", Object.keys(patch).length ? `${msg.text} Saved.` : msg.text);
        if (Object.keys(patch).length) send({ type: "save_config", patch });
        else {
          if (lists[msg.provider]) lists[msg.provider].loadedFor = null;
          loadIfNeeded(msg.provider);
        }
      },
      server_models(msg) {
        serverModels = { models: msg.models, default: msg.default };
        if (config) {
          renderChip();
          if (!menu.hidden) renderMenu();
          if (lists.ollama && cardOf("ollama")) renderList(cardOf("ollama"));
        }
      },
      models(msg) {
        const state = lists[msg.provider];
        if (!state) return;
        state.models = msg.models;
        state.error = msg.error ?? null;
        renderList(cardOf(msg.provider));
      },
    },
  };
}
