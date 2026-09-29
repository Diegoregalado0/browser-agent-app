import { keyProblem } from "../src/config-core.js";

// Settings sheet: five pages of options that save as they change. On a wide window the
// section list and the open page sit side by side; in the side panel the list is its
// own screen and a page opens over it with a back button.

const PROVIDER_NAMES = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Google Gemini", mistral: "Mistral", ollama: "Ollama" };
const KEYED_PROVIDERS = ["anthropic", "openai", "gemini", "mistral"];
const WIDE = window.matchMedia("(min-width: 640px)");

// getDebugLines(): the chat's recent debug lines, for Copy diagnostics.
export function createSettings({ $, el, icon, send, getDebugLines = () => [] }) {
  const sheet = $("settings");
  let config = null;
  let page = "general";
  let pendingToast = null;
  let toastTimer = null;

  function toast(text, kind = "ok") {
    const node = $("toast");
    node.className = `toast ${kind}`;
    node.replaceChildren(icon(kind === "ok" ? "check" : "alert"), el("span", null, text));
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (node.hidden = true), kind === "ok" ? 2200 : 5000);
  }

  // Sends a config patch; the toast shows once the server echoes the saved config.
  function save(patch, message = "Saved") {
    pendingToast = message;
    send({ type: "save_config", patch });
  }

  // Replaces a destructive button with an inline "are you sure" row.
  function confirmInline(button, { question, confirmLabel, onConfirm }) {
    const row = button.closest(".setting, .provider-card");
    if (row.querySelector(".confirm-bar")) return;
    const bar = el("div", "confirm-bar");
    const yes = el("button", "danger", confirmLabel);
    const no = el("button", null, "Cancel");
    yes.type = no.type = "button";
    const close = () => {
      bar.remove();
      button.hidden = false;
      button.focus();
    };
    yes.onclick = () => {
      bar.remove();
      button.hidden = false;
      onConfirm();
    };
    no.onclick = close;
    bar.append(el("span", null, question), yes, no);
    button.hidden = true;
    row.append(bar);
    no.focus();
  }

  // Pages

  function showPage(name) {
    page = name;
    for (const p of sheet.querySelectorAll(".settings-page")) p.hidden = p.dataset.page !== name;
    for (const b of sheet.querySelectorAll(".settings-nav button")) {
      if (b.dataset.page === name) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    sheet.classList.add("page-open");
    $("settings-title").textContent = sheet.querySelector(`.settings-page[data-page="${name}"]`).dataset.title;
    sheet.querySelector(".settings-pages").scrollTop = 0;
    if (name === "data") send({ type: "data_info" });
    if (name === "remote") send({ type: "discord_status" });
    if (name === "safety") send({ type: "data_info" });
  }

  function showNav() {
    sheet.classList.remove("page-open");
    $("settings-title").textContent = "Settings";
  }

  function layout() {
    if (WIDE.matches && !sheet.classList.contains("page-open")) showPage(page);
  }
  WIDE.addEventListener("change", layout);

  for (const button of sheet.querySelectorAll(".settings-nav button")) {
    button.append(icon("chevron"));
    button.onclick = () => showPage(button.dataset.page);
  }
  // Where the back button goes: the menu when a page was opened from it, else the list.
  let onBack = null;
  $("settings-back").onclick = () => (onBack ? onBack() : showNav());

  // Simple options: every [data-setting] control saves itself on change.

  // A setting's key may name a field of a nested object, as in "limits.taskTokens".
  const readSetting = (key) => key.split(".").reduce((obj, k) => obj?.[k], config);
  const settingPatch = (key, value) => {
    const [top, sub] = key.split(".");
    return sub ? { [top]: { ...config[top], [sub]: value } } : { [top]: value };
  };

  for (const control of sheet.querySelectorAll("[data-setting]")) {
    control.addEventListener("change", () => {
      const key = control.dataset.setting;
      let value;
      if (control.type === "checkbox") value = control.checked;
      else if (control.dataset.kind === "int") {
        const parsed = parseInt(control.value, 10);
        value = Number.isNaN(parsed) ? readSetting(key) : Math.max(Number(control.dataset.min) || 0, parsed);
        control.value = value;
      } else value = control.tagName === "TEXTAREA" ? control.value : control.value.trim();
      save(settingPatch(key, value));
    });
  }

  $("sensitiveSites").addEventListener("change", () => {
    const sites = $("sensitiveSites").value.split("\n").map((s) => s.trim().toLowerCase()).filter(Boolean);
    save({ sensitiveSites: sites });
  });

  // Auto turns every check off, so it takes an explicit confirmation.
  for (const radio of sheet.querySelectorAll('input[name="permissionMode"]')) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      if (radio.value !== "auto") return save({ permissionMode: radio.value });
      for (const r of sheet.querySelectorAll('input[name="permissionMode"]')) r.checked = r.value === config.permissionMode;
      const group = radio.closest(".setting-group");
      if (group.querySelector(".confirm-bar")) return;
      const bar = el("div", "confirm-bar auto-confirm");
      const yes = el("button", "danger", "Turn on Auto");
      const no = el("button", null, "Cancel");
      yes.type = no.type = "button";
      yes.onclick = () => {
        bar.remove();
        save({ permissionMode: "auto" }, "Auto mode on. Safety checks are off.");
      };
      no.onclick = () => bar.remove();
      bar.append(el("span", null, "Turn off the safety checks for every task?"), yes, no);
      group.append(bar);
      no.focus();
    });
  }

  $("provider").addEventListener("change", () => {
    const provider = $("provider").value;
    save({ provider }, `Now using ${PROVIDER_NAMES[provider]}`);
    $("model-input").value = config.models[provider] || "";
    loadModels(provider);
  });
  $("model-input").addEventListener("change", () => {
    save({ models: { [$("provider").value]: $("model-input").value.trim() } }, "Model saved");
  });
  $("refresh-models").onclick = () => loadModels($("provider").value);
  $("guard-model").addEventListener("change", () => {
    save({ guardModels: { ...config.guardModels, [config.provider]: $("guard-model").value.trim() } });
  });

  function loadModels(provider) {
    $("models-hint").textContent = "Loading models…";
    send({ type: "list_models", provider });
  }

  $("ghostMode").addEventListener("change", () => {
    pendingToast = $("ghostMode").checked ? "This session will not be saved" : "Ghost mode off. Started a new session.";
    send({ type: "set_ghost", on: $("ghostMode").checked });
  });


  $("reset-settings").onclick = (e) =>
    confirmInline(e.currentTarget, {
      question: "Reset all settings?",
      confirmLabel: "Reset",
      onConfirm: () => send({ type: "reset_config" }),
    });
  $("delete-all-sessions").onclick = (e) =>
    confirmInline(e.currentTarget, {
      question: "Delete every saved session?",
      confirmLabel: "Delete all",
      onConfirm: () => {
        send({ type: "delete_all_sessions" });
        toast("Deleted all sessions");
        send({ type: "data_info" });
      },
    });
  // Provider cards: key status, replace or remove the key, endpoints, connection test.

  function field(labelText, input, note) {
    const wrap = el("div", "card-field");
    const id = `pc-${Math.random().toString(36).slice(2, 8)}`;
    input.id = id;
    const label = el("label", "card-label", labelText);
    label.htmlFor = id;
    wrap.append(label, input);
    if (note) wrap.append(el("p", "field-note", note));
    return wrap;
  }

  function buildProviderCard(p) {
    const card = el("div", "provider-card");
    card.dataset.provider = p;
    const head = el("div", "pc-head");
    head.append(el("span", "pc-name", PROVIDER_NAMES[p]), el("span", "tag pc-active", "In use"), el("span", "pc-status"));
    card.append(head);

    let keyInput = null;
    if (KEYED_PROVIDERS.includes(p)) {
      keyInput = Object.assign(el("input"), { type: "password", autocomplete: "off", spellcheck: false, placeholder: "Paste a new API key" });
      const saveKey = el("button", null, "Save");
      saveKey.type = "button";
      const commit = () => {
        const key = keyInput.value.trim();
        if (!key) return keyInput.focus();
        if (showKeyProblem(card, key)) return keyInput.focus();
        keyInput.value = "";
        save({ keys: { [p]: key } }, `${PROVIDER_NAMES[p]} key saved`);
        card.querySelector(".pc-result").textContent = "";
      };
      saveKey.onclick = commit;
      keyInput.addEventListener("keydown", (e) => e.key === "Enter" && commit());
      const row = el("div", "control-row");
      row.append(keyInput, saveKey);
      const label = el("label", "card-label", "API key");
      keyInput.id = `key-${p}`;
      label.htmlFor = keyInput.id;
      card.append(el("div", "card-field"));
      card.lastChild.append(label, row);
    }

    if (p === "openai") {
      const baseUrl = Object.assign(el("input"), { placeholder: "https://api.openai.com/v1", spellcheck: false });
      baseUrl.dataset.bind = "openaiBaseUrl";
      baseUrl.addEventListener("change", () => save({ openaiBaseUrl: baseUrl.value.trim() }));
      card.append(field("Base URL", baseUrl, "Leave blank for OpenAI. Set it to use OpenRouter, LM Studio, vLLM, or another OpenAI-compatible server."));
    }
    if (p === "ollama") {
      const host = Object.assign(el("input"), { placeholder: "http://127.0.0.1:11434", spellcheck: false });
      host.dataset.bind = "ollamaHost";
      host.addEventListener("change", () => save({ ollamaHost: host.value.trim() || "http://127.0.0.1:11434" }));
      card.append(field("Host", host, "Run ollama serve first. Use a model that supports tools, and a vision model to read screenshots."));
      const origins = el("p", "field-note", "Start Ollama with OLLAMA_ORIGINS=chrome-extension://* so the panel is allowed to reach it.");
      card.append(origins);
      const ctx = Object.assign(el("input"), { type: "number", min: 4096, step: 1024 });
      ctx.classList.add("narrow-input");
      ctx.dataset.bind = "ollamaContext";
      ctx.addEventListener("change", () => {
        const value = Math.max(4096, parseInt(ctx.value, 10) || 32768);
        ctx.value = value;
        save({ ollamaContext: value });
      });
      card.append(field("Context window (tokens)", ctx));
    }

    const actions = el("div", "pc-actions");
    const test = el("button", null, "Test connection");
    test.type = "button";
    test.onclick = () => {
      const typed = keyInput?.value.trim();
      if (typed && showKeyProblem(card, typed)) return keyInput.focus();
      const result = card.querySelector(".pc-result");
      result.className = "pc-result pending";
      result.textContent = "Testing…";
      send({
        type: "test_provider",
        provider: p,
        key: typed || undefined,
        baseUrl: p === "openai" ? card.querySelector('[data-bind="openaiBaseUrl"]').value : undefined,
        host: p === "ollama" ? card.querySelector('[data-bind="ollamaHost"]').value : undefined,
      });
    };
    actions.append(test);
    if (keyInput) {
      const remove = el("button", "link-danger pc-remove", "Remove key");
      remove.type = "button";
      remove.onclick = () =>
        confirmInline(remove, {
          question: `Remove the saved ${PROVIDER_NAMES[p]} key?`,
          confirmLabel: "Remove",
          onConfirm: () => save({ keys: { [p]: "__clear__" } }, `${PROVIDER_NAMES[p]} key removed`),
        });
      actions.append(remove);
    }
    card.append(actions, el("p", "pc-result"));
    return card;
  }

  // Shows why a typed key cannot be one under its card; true when there was a problem.
  function showKeyProblem(card, key) {
    const problem = keyProblem(key);
    if (!problem) return false;
    const result = card.querySelector(".pc-result");
    result.className = "pc-result error";
    result.replaceChildren(icon("alert"), el("span", null, problem));
    return true;
  }

  const cards = $("provider-cards");
  for (const p of Object.keys(PROVIDER_NAMES)) cards.append(buildProviderCard(p));

  function renderCards() {
    for (const card of cards.children) {
      const p = card.dataset.provider;
      card.classList.toggle("active", p === config.provider);
      const status = card.querySelector(".pc-status");
      const info = config.keyInfo?.[p];
      if (info) {
        status.className = `pc-status ${info.source}`;
        status.textContent =
          info.source === "saved" ? `Saved · ${info.mask}` : "No key";
        card.querySelector(".pc-remove").hidden = info.source !== "saved";
      } else status.textContent = "";
      for (const input of card.querySelectorAll("[data-bind]")) {
        if (document.activeElement !== input) input.value = config[input.dataset.bind] ?? "";
      }
    }
  }

  // Rendering from the saved config. Fields being edited are left alone.

  function setValue(id, value) {
    const node = $(id);
    if (document.activeElement === node) return;
    if (node.type === "checkbox") node.checked = Boolean(value);
    else node.value = value ?? "";
  }

  function render(next) {
    config = next;
    for (const control of sheet.querySelectorAll("[data-setting]")) setValue(control.id, readSetting(control.dataset.setting));
    setValue("sensitiveSites", (config.sensitiveSites || []).join("\n"));
    setValue("provider", config.provider);
    setValue("model-input", config.models[config.provider] || "");
    setValue("guard-model", config.guardModels?.[config.provider] || "");
    $("guard-model").placeholder = `Default: ${config.defaultGuardModels?.[config.provider] || "same as the main model"}`;
    setValue("ghostMode", config.ghostMode);
    $("ghostMode").disabled = Boolean(config.ghostLocked);
    $("ghost-locked-note").hidden = !config.ghostLocked;
    for (const radio of sheet.querySelectorAll('input[name="permissionMode"]')) radio.checked = radio.value === config.permissionMode;
    for (const row of sheet.querySelectorAll("[data-for-provider]")) row.hidden = !row.dataset.forProvider.split(" ").includes(config.provider);
    renderCards();
    renderOrigins();
    if (pendingToast) {
      toast(pendingToast);
      pendingToast = null;
    }
  }

  function renderOrigins() {
    const box = $("origins");
    box.replaceChildren();
    if (!config.approvedOrigins.length) {
      box.append(el("p", "setting-empty", "No sites yet."));
      return;
    }
    for (const origin of config.approvedOrigins) {
      const row = el("div", "setting");
      const text = el("div", "setting-text");
      text.append(el("span", "setting-title origin", origin));
      const remove = el("button", null, "Remove");
      remove.type = "button";
      remove.onclick = () => save({ approvedOrigins: config.approvedOrigins.filter((o) => o !== origin) }, `Removed ${origin}`);
      row.append(text, remove);
      box.append(row);
    }
  }

  // Remote (Discord) page.
  $("discord-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const token = $("discord-token").value.trim();
    if (!token) return;
    const problem = keyProblem(token, "bot token");
    if (problem) {
      $("discord-status").textContent = problem;
      return $("discord-token").focus();
    }
    $("discord-token").value = "";
    $("discord-status").textContent = "Connecting…";
    send({ type: "discord_save", token });
  });
  $("discord-unpair").onclick = () => send({ type: "discord_unpair" });
  $("discord-remove").onclick = (e) =>
    confirmInline(e.currentTarget, { question: "Remove the Discord bot from the agent?", confirmLabel: "Remove", onConfirm: () => send({ type: "discord_remove" }) });
  $("discord-code-copy").onclick = () => navigator.clipboard?.writeText($("discord-code").textContent).then(() => toast("Code copied"));

  // Debug page.
  $("run-checks").onclick = () => {
    $("check-results").replaceChildren(el("li", null, "Running…"));
    send({ type: "self_test" });
  };
  $("copy-diagnostics").onclick = () => {
    const { keyInfo, customInstructions, ...settings } = config ?? {};
    const report = {
      time: new Date().toISOString(),
      userAgent: navigator.userAgent,
      settings,
      keys: Object.fromEntries(Object.entries(keyInfo ?? {}).map(([p, k]) => [p, k.source])),
      debugLines: getDebugLines().slice(-50),
    };
    navigator.clipboard?.writeText(JSON.stringify(report, null, 2)).then(
      () => toast("Diagnostics copied"),
      () => toast("Could not copy; the browser blocked the clipboard.", "error"),
    );
  };


  return {
    // Opens the sheet, on a given page when named. options.onBack replaces going back to
    // the section list.
    open(name, options = {}) {
      onBack = options.onBack ?? null;
      $("settings-back").title = $("settings-back").ariaLabel = onBack ? "Back to the menu" : "All settings";
      sheet.hidden = false;
      if (name) showPage(name);
      else if (WIDE.matches) showPage(page);
      else showNav();
      if (config) loadModels(config.provider);
    },
    close() {
      sheet.hidden = true;
    },
    get isOpen() {
      return !sheet.hidden;
    },
    render,
    handlers: {
      models(msg) {
        if (msg.provider !== $("provider").value) return;
        $("model-list").replaceChildren(...msg.models.map((m) => Object.assign(el("option"), { value: m })));
        $("models-hint").className = `field-note${msg.error ? " error" : ""}`;
        $("models-hint").textContent = msg.error || `${msg.models.length} models available. Click the field to pick one, or type an id.`;
      },
      provider_test(msg) {
        const result = cards.querySelector(`[data-provider="${msg.provider}"] .pc-result`);
        result.className = `pc-result ${msg.ok ? "ok" : "error"}`;
        result.replaceChildren(icon(msg.ok ? "check" : "alert"), el("span", null, msg.text));
      },
      data_info(msg) {
        $("tokens-today").textContent = `Used today: ${msg.tokensToday.toLocaleString()} tokens.`;
        $("sessions-count").textContent = `${msg.sessions} saved session${msg.sessions === 1 ? "" : "s"}`;
      },
      config_reset() {
        pendingToast = null;
        toast("Settings reset to defaults");
      },
      discord_status(msg) {
        const set = !["off", "elsewhere", "incognito"].includes(msg.state);
        $("discord-form").hidden = msg.state === "elsewhere" || msg.state === "incognito";
        $("discord-status").textContent =
          msg.state === "off" ? "Not set up."
          : msg.state === "elsewhere" ? "Discord runs in the agent panel of another Chrome window. Manage it there, or close that panel to move it here."
          : msg.state === "incognito" ? "Discord does not run in incognito windows."
          : msg.state === "connecting" ? "Connecting to Discord…"
          : msg.state === "error" ? msg.error
          : msg.paired ? `Connected as ${msg.botName}, paired with ${msg.userName}. Message the bot to give it a task.`
          : `Connected as ${msg.botName}. Not paired yet.`;
        $("discord-pair").hidden = !(set && msg.pairCode);
        $("discord-code").textContent = msg.pairCode ?? "";
        $("discord-invite").hidden = !msg.inviteUrl || msg.paired;
        if (msg.inviteUrl) $("discord-invite").href = msg.inviteUrl;
        $("discord-unpair").hidden = !msg.paired;
        $("discord-remove").hidden = !set;
      },
      self_test(msg) {
        $("check-results").replaceChildren(
          ...msg.results.map((r) => {
            const item = el("li", r.ok ? "ok" : "fail");
            item.append(el("strong", null, `${r.ok ? "OK" : "Failed"}: ${r.name}`), ` ${r.text}`);
            return item;
          }),
        );
      },
    },
    toast,
  };
}
