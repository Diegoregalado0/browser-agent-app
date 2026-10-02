import { keyProblem, MODEL_HISTORY_MAX } from "../src/config-core.js";

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
  { id: "ollama", name: "Ollama", mark: "L", local: true },
];
const providerById = (id) => PROVIDERS.find((p) => p.id === id);
// A provider's model list shows this many before asking for a search.
const LIST_MAX = 60;
// Model id families that are the providers' small, quick tiers.
const FAST_MODEL = /(^|[-_.:/])(haiku|flash|flash-lite|mini|nano|lite|small)([-_.:/]|$)/i;
const MODEL_ID = /^[\w.:/@+-]{1,200}$/;
const same = (a, b) => a.provider === b.provider && a.model === b.model;

// Whether the agent can run on a provider: a saved key, or for Ollama its host, which
// always has a value.
export function usable(config, provider) {
  return providerById(provider)?.local ? true : config.keyInfo?.[provider]?.source === "saved";
}

// The models already used whose provider can still run, newest first. The current model
// leads even before it is in the history (set by first-run setup or an earlier version).
export function usedModels(config) {
  const current = { provider: config.provider, model: config.models[config.provider] };
  const all = [...(current.model ? [current] : []), ...(config.modelHistory ?? [])];
  return all.filter((m, i) => usable(config, m.provider) && all.findIndex((n) => same(m, n)) === i);
}

// The settings patch that switches to a model and puts it, and the one it replaces, at
// the front of the history.
export function switchPatch(config, provider, model) {
  const previous = { provider: config.provider, model: config.models[config.provider] };
  const all = [{ provider, model }, ...(previous.model ? [previous] : []), ...(config.modelHistory ?? [])];
  const modelHistory = all.filter((m, i) => all.findIndex((n) => same(m, n)) === i).slice(0, MODEL_HISTORY_MAX);
  return { provider, models: { [provider]: model }, modelHistory };
}

// The settings patch that takes a model out of the history.
export function forgetPatch(config, entry) {
  return { modelHistory: (config.modelHistory ?? []).filter((m) => !same(m, entry)) };
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
    chip.replaceChildren(mark(config.provider), el("span", "sr-only", "Model: "), el("span", "model-name", model || "Choose a model"), icon("down"));
    chip.classList.toggle("unset", !model);
  }

  function pick(provider, model) {
    pending = { provider, model };
    send({ type: "save_config", patch: switchPatch(config, provider, model) });
  }

  // Shown once the saved config confirms the switch.
  function confirmSwitch() {
    const { provider, model } = pending;
    pending = null;
    chip.classList.remove("switched");
    void chip.offsetWidth;
    chip.classList.add("switched");
    const later = isRunning() ? " The running task finishes on its current model." : "";
    toast(`Now using ${model}.${later}`);
    $("announce").textContent = `Now using ${model} from ${providerById(provider).name}`;
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

  function renderMenu() {
    const rows = usedModels(config).map((m) => {
      const current = m.provider === config.provider && m.model === config.models[config.provider];
      const row = el("div", "mm-row");
      const item = menuItem("menuitemradio", [mark(m.provider), el("span", "mm-name", m.model), ...tagList(m.provider, m.model), icon("check")], () => {
        closeMenu();
        if (!current) pick(m.provider, m.model);
      });
      item.setAttribute("aria-checked", String(current));
      item.setAttribute("aria-label", `${m.model}, ${providerById(m.provider).name}`);
      row.append(item);
      if (!current) {
        item.setAttribute("aria-keyshortcuts", "Delete");
        const x = menuItem("menuitem", [icon("close")], () => forget(m, row));
        x.classList.add("mm-remove");
        x.setAttribute("aria-label", `Remove ${m.model} from this list`);
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
  const endpointOf = (p) => [config.keyInfo?.[p]?.mask, p === "openai" ? config.openaiBaseUrl : p === "ollama" ? config.ollamaHost : ""].join(" ");

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
    toggle.append(mark(p.id), el("span", "pc-name", p.local ? "Ollama (local)" : p.name), el("span", "pc-status"), icon("down"));
    const body = Object.assign(el("div", "pc-body"), { id: `${p.id}-body`, hidden: true });
    toggle.onclick = () => setExpanded(card, body.hidden);
    card.append(toggle, body);

    if (p.local) {
      const host = Object.assign(el("input"), { spellcheck: false, placeholder: "http://127.0.0.1:11434" });
      host.dataset.role = "host";
      body.append(inputField(card, "Host", host, ["Start Ollama with ", el("code", null, "OLLAMA_ORIGINS=chrome-extension://* ollama serve"), ". Use a model that supports tools."]));
      const ctx = Object.assign(el("input"), { type: "number", min: 4096, step: 1024, className: "narrow-input" });
      ctx.dataset.role = "context";
      ctx.addEventListener("change", () => {
        const value = Math.max(4096, parseInt(ctx.value, 10) || 32768);
        ctx.value = value;
        send({ type: "save_config", patch: { ollamaContext: value } });
      });
      body.append(inputField(card, "Context window (tokens)", ctx));
    } else {
      const key = Object.assign(el("input"), { type: "password", spellcheck: false, autocomplete: "off" });
      key.dataset.role = "key";
      const link = Object.assign(el("a", null, new URL(p.keyPage).hostname), { href: p.keyPage, target: "_blank", rel: "noopener noreferrer" });
      body.append(inputField(card, "API key", key, ["Get one at ", link, `. It stays on this device and goes only to ${p.name}.`]));
      if (p.id === "openai") {
        const more = el("details", "pc-more");
        more.append(el("summary", null, "OpenAI-compatible server"));
        const base = Object.assign(el("input"), { spellcheck: false, placeholder: "https://api.openai.com/v1" });
        base.dataset.role = "base";
        more.append(inputField(card, "Base URL", base, "For OpenRouter, LM Studio, vLLM and similar. Leave blank for OpenAI."));
        body.append(more);
      }
    }
    for (const field of body.querySelectorAll('[data-role="key"], [data-role="host"], [data-role="base"]')) {
      field.addEventListener("keydown", (e) => e.key === "Enter" && !testing.has(p.id) && test(card));
    }

    const actions = el("div", "pc-actions");
    const testButton = el("button", "pc-test", "Test and save");
    testButton.type = "button";
    testButton.onclick = () => test(card);
    actions.append(testButton);
    if (!p.local) {
      const remove = el("button", "link-danger pc-remove", "Remove key");
      remove.type = "button";
      remove.onclick = () =>
        confirmInline(remove, {
          question: `Remove the saved ${p.name} key?`,
          confirmLabel: "Remove",
          onConfirm: () => send({ type: "save_config", patch: { keys: { [p.id]: "__clear__" } } }),
        });
      actions.append(remove);
    }
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

  function test(card) {
    const p = card.dataset.provider;
    const key = field(card, "key")?.value.trim();
    if (field(card, "key") && !key && !usable(config, p)) {
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
    send({ type: "test_provider", provider: p, key: key || undefined, baseUrl: field(card, "base")?.value.trim(), host: field(card, "host")?.value.trim() });
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
    const used = usedModels(config).filter((m) => m.provider === p).map((m) => m.model);
    const all = [...new Set([...used, ...state.models])];
    const shown = all.filter((m) => m.toLowerCase().includes(query.toLowerCase()));
    const options = shown.slice(0, LIST_MAX).map((m) => option(p, m, m));
    // A model the list does not show (a new release, a custom server) can be typed.
    if (query && !all.includes(query) && MODEL_ID.test(query)) options.push(option(p, query, `Use “${query}”`));
    list.replaceChildren(...options);
    list.hidden = !options.length;
    status.className = `field-note${state.error ? " error" : ""}`;
    status.textContent =
      state.error ??
      (!state.models.length && !state.loadedFor ? ""
      : !state.models.length ? "Loading models…"
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
      const key = field(card, "key");
      if (key) key.placeholder = ok ? `Paste a new key to replace ${info.mask}` : "Paste your API key";
      card.querySelector(".pc-test").textContent = providerById(p).local || (ok && !key?.value) ? "Test connection" : "Test and save";
      card.querySelector(".pc-remove")?.toggleAttribute("hidden", !ok);
      for (const [role, value] of [["host", config.ollamaHost], ["base", config.openaiBaseUrl], ["context", config.ollamaContext]]) {
        const input = field(card, role);
        if (input && document.activeElement !== input) input.value = value ?? "";
      }
      if (p === "openai" && config.openaiBaseUrl) card.querySelector(".pc-more").open = true;
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
      config = next;
      renderChip();
      // The menu is drawn again with focus kept on the same item.
      if (!menu.hidden) {
        const focused = menu.contains(document.activeElement) && document.activeElement.getAttribute("aria-label");
        renderMenu();
        if (focused) (menu.querySelector(`[aria-label="${CSS.escape(focused)}"]`) ?? menuItems()[0]).focus();
      }
      renderCards();
      if (pending && config.provider === pending.provider && config.models[pending.provider] === pending.model) confirmSwitch();
    },
    handlers: {
      provider_test(msg) {
        if (!testing.delete(msg.provider)) return;
        const card = cardOf(msg.provider);
        card.querySelector(".pc-test").disabled = false;
        if (!msg.ok) {
          result(card, "error", msg.text);
          return (field(card, "key") ?? field(card, "host")).focus();
        }
        const key = field(card, "key")?.value.trim();
        const patch = {};
        if (key) patch.keys = { [msg.provider]: key };
        const host = field(card, "host")?.value.trim();
        if (host && host !== config.ollamaHost) patch.ollamaHost = host;
        const base = field(card, "base")?.value.trim();
        if (base !== undefined && base !== config.openaiBaseUrl) patch.openaiBaseUrl = base;
        if (field(card, "key")) field(card, "key").value = "";
        result(card, "ok", Object.keys(patch).length ? `${msg.text} Saved.` : msg.text);
        if (Object.keys(patch).length) send({ type: "save_config", patch });
        else {
          if (lists[msg.provider]) lists[msg.provider].loadedFor = null;
          loadIfNeeded(msg.provider);
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
