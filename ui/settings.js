import { keyProblem } from "../src/config-core.js";

// Settings sheet: five pages of options that save as they change. On a wide window the
// section list and the open page sit side by side; in the side panel the list is its
// own screen and a page opens over it with a back button.

const WIDE = window.matchMedia("(min-width: 640px)");

// getDebugLines(): the chat's recent debug lines, for Copy diagnostics. onPage(name): a
// page was shown. openRemoteSetup(): opens the remote control setup flow.
export function createSettings({ $, el, icon, send, setInertBehind, getDebugLines = () => [], onPage = () => {}, openRemoteSetup = () => {} }) {
  const sheet = $("settings");
  // Where focus goes back to when the sheet closes.
  let opener = null;
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
      button.focus();
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
    onPage(name);
    // In the side panel the section list is gone now, and focus with it.
    if (!WIDE.matches) $("settings-title").focus();
  }

  function showNav() {
    sheet.classList.remove("page-open");
    $("settings-title").textContent = "Settings";
    sheet.querySelector(`.settings-nav [data-page="${page}"]`).focus();
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

  // Each setting's description is read with its control.
  for (const label of sheet.querySelectorAll(".setting-text > label.setting-title[for]")) {
    const desc = label.parentElement.querySelector(".setting-desc");
    const control = $(label.htmlFor);
    if (!desc || !control) continue;
    desc.id ||= `${label.htmlFor}-desc`;
    control.setAttribute("aria-describedby", [desc.id, control.getAttribute("aria-describedby")].filter(Boolean).join(" "));
  }

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
        radio.focus();
        save({ permissionMode: "auto" }, "Auto mode on. Safety checks are off.");
      };
      no.onclick = () => {
        bar.remove();
        sheet.querySelector('input[name="permissionMode"]:checked')?.focus();
      };
      bar.append(el("span", null, "Turn off the safety checks for every task?"), yes, no);
      group.append(bar);
      no.focus();
    });
  }

  $("guard-model").addEventListener("change", () => {
    save({ guardModels: { ...config.guardModels, [config.provider]: $("guard-model").value.trim() } });
  });

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
    setValue("guard-model", config.guardModels?.[config.provider] || "");
    $("guard-model").placeholder = `Default: ${config.defaultGuardModels?.[config.provider] || "same as the main model"}`;
    setValue("ghostMode", config.ghostMode);
    $("ghostMode").disabled = Boolean(config.ghostLocked);
    $("ghost-locked-note").hidden = !config.ghostLocked;
    for (const radio of sheet.querySelectorAll('input[name="permissionMode"]')) radio.checked = radio.value === config.permissionMode;
    for (const row of sheet.querySelectorAll("[data-for-provider]")) row.hidden = !row.dataset.forProvider.split(" ").includes(config.provider);
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

  // Remote (Discord) page: a status card; setup runs in its own full-screen flow.
  $("discord-setup").onclick = () => openRemoteSetup();
  $("discord-unpair").onclick = () => send({ type: "discord_unpair" });
  $("discord-remove").onclick = (e) =>
    confirmInline(e.currentTarget, { question: "Remove the Discord bot from Browsby?", confirmLabel: "Remove", onConfirm: () => send({ type: "discord_remove" }) });

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
      if (sheet.hidden) opener = document.activeElement;
      sheet.hidden = false;
      setInertBehind(sheet, true);
      if (name) showPage(name);
      else if (WIDE.matches) showPage(page);
      else showNav();
      $("settings-title").focus();
    },
    close() {
      if (sheet.hidden) return;
      const hadFocus = sheet.contains(document.activeElement) || document.activeElement === document.body;
      sheet.hidden = true;
      setInertBehind(sheet, false);
      if (hadFocus) (opener?.isConnected && opener.offsetParent ? opener : $("input")).focus();
    },
    get isOpen() {
      return !sheet.hidden;
    },
    render,
    handlers: {
      data_info(msg) {
        $("tokens-today").textContent = `Used today: ${msg.tokensToday.toLocaleString()} tokens.`;
        $("sessions-count").textContent = `${msg.sessions} saved session${msg.sessions === 1 ? "" : "s"}`;
      },
      config_reset() {
        pendingToast = null;
        toast("Settings reset to defaults");
      },
      discord_status(msg) {
        const away = msg.state === "elsewhere" || msg.state === "incognito";
        const set = !["off", "elsewhere", "incognito"].includes(msg.state);
        const ready = msg.state === "connected" && msg.paired;
        const [headline, text] =
          msg.state === "off" ? ["Not set up", "Use your own Discord bot. Setup takes about five minutes."]
          : msg.state === "elsewhere" ? ["Runs in another window", "Remote control runs in the Browsby panel of another Chrome window. Manage it there, or close that panel to move it here."]
          : msg.state === "incognito" ? ["Not in incognito", "Remote control does not run in incognito windows."]
          : msg.state === "no-access" ? ["Needs access to Discord", "Chrome no longer lets Browsby reach discord.com. Allow it again to reconnect."]
          : msg.state === "connecting" ? ["Connecting…", "Connecting to Discord."]
          : msg.state === "error" ? ["Could not connect", msg.error]
          : msg.paired ? ["On", `${msg.botName} takes tasks from ${msg.userName} in Discord.`]
          : ["Almost done", `${msg.botName} is connected. Pair your Discord account to finish.`];
        $("discord-headline").textContent = headline;
        $("discord-status").textContent = text;
        $("discord-dot").className = `dot ${ready ? "idle" : msg.state === "error" || msg.state === "no-access" ? "no-key" : ""}`;
        const sessions = msg.sessions ?? [];
        $("discord-sessions").hidden = !ready || !sessions.length;
        $("discord-sessions").textContent = `Open windows Discord can use: ${sessions.map((s) => `${s.name}${s.running ? " (running)" : ""}`).join(", ")}.`;
        $("discord-setup").hidden = away;
        $("discord-setup").textContent = msg.state === "off" ? "Set up remote control" : msg.state === "no-access" ? "Allow access" : ready ? "Run setup again" : "Continue setup";
        $("discord-setup").className = ready ? "" : "primary";
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
    confirmInline,
  };
}
