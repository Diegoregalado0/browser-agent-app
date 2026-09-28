// MCP connections panel (local edition): integrations, connected through a short guided
// flow, and custom MCP servers. config.mcpServers is the saved list; `status` is what the
// running servers report (mcp_status).

const OUTLOOK_ID = "microsoft365";

// Outlook's mark drawn in the app's own style: an "O" tile over a mail envelope, in the
// accent color, so it follows the light and dark themes.
const OUTLOOK_LOGO = `<svg class="logo" viewBox="0 0 40 40" aria-hidden="true">
<rect x="1" y="1" width="38" height="38" rx="10" class="logo-bg"/>
<rect x="15" y="12" width="17" height="16" rx="2.5" class="logo-line"/>
<path d="M15.5 13.5 23.5 20l8-6.5" class="logo-line"/>
<rect x="7" y="10" width="14" height="20" rx="3.5" class="logo-tile"/>
<ellipse cx="14" cy="20" rx="3.4" ry="4.4" class="logo-o"/>
</svg>`;

// The sign-in link and code in the Outlook server's device-code message.
function parseDeviceCode(text) {
  const url = /https:\/\/[^\s"',]+/.exec(text)?.[0];
  const code = /\bcode\s+([A-Z0-9-]{6,})/i.exec(text)?.[1];
  return url && code ? { url, code } : null;
}

// The Outlook server's sign-in check: { signedIn, account, message }.
function parseVerify(text) {
  try {
    const data = JSON.parse(text);
    const user = data.userData ?? {};
    return { signedIn: data.success === true, account: user.userPrincipalName || user.mail || user.displayName || "", message: data.message ?? "" };
  } catch {
    return { signedIn: false, account: "", message: text };
  }
}

export function createMcpPanel({ $, el, send, toast }) {
  const panel = $("mcp-panel");
  const flow = $("connect-flow");
  let config = null;
  let status = [];
  // Outlook's last sign-in check: null until checked, then { signedIn, account }.
  let outlook = null;
  let checking = false;
  // The connect flow's current step, or null when it is closed.
  let step = null;

  const outlookServer = () => config?.mcpServers?.find((s) => s.id === OUTLOOK_ID);
  const statusOf = (id) => status.find((s) => s.id === id);
  function outlookState() {
    const server = outlookServer();
    if (!server) return "absent";
    if (!server.enabled) return "off";
    return statusOf(OUTLOOK_ID)?.status ?? "starting";
  }
  const account = (action) => send({ type: "mcp_account", id: OUTLOOK_ID, action });
  function checkSignIn() {
    checking = true;
    account("verify-login");
  }

  // Integrations list.

  function renderIntegrations() {
    const state = outlookState();
    const card = el("div", "setting integration");
    const logo = el("span", "integration-logo");
    logo.innerHTML = OUTLOOK_LOGO;
    const text = el("div", "setting-text");
    const line =
      state === "absent" ? "Read, search and draft email, and see your calendar."
      : state === "off" ? "Turned off."
      : state === "starting" ? "Setting up…"
      : state === "error" ? `Could not start: ${statusOf(OUTLOOK_ID)?.error ?? "unknown error"}`
      : state === "stopped" ? "Stopped."
      : outlook === null ? "Checking sign-in…"
      : outlook.signedIn ? `Connected${outlook.account ? ` as ${outlook.account}` : ""}`
      : "Sign-in needed.";
    text.append(el("span", "setting-title", "Microsoft Outlook"), el("p", "setting-desc", line));
    const connected = state === "connected" && outlook?.signedIn;
    const action = el("button", connected ? null : "primary", connected ? "Manage" : state === "connected" ? "Sign in" : state === "off" ? "Turn on" : state === "error" || state === "stopped" ? "Try again" : "Connect");
    action.type = "button";
    action.disabled = state === "starting";
    action.onclick = () => openFlow(connected ? "manage" : state === "connected" ? "signin" : state === "absent" ? "intro" : "setup");
    card.append(logo, text, action);
    if (config.debugMode && statusOf(OUTLOOK_ID)) card.append(debugDetail(statusOf(OUTLOOK_ID)));
    $("mcp-integrations").replaceChildren(card);
  }

  function debugDetail(s) {
    const more = el("details", "mcp-detail");
    more.append(el("summary", null, "Tools and log"), el("pre", null, `Tools: ${s.tools.join(", ") || "none"}\n\n${s.log.join("\n")}`));
    return more;
  }

  // Custom servers.

  function renderServers() {
    const list = $("mcp-list");
    list.replaceChildren();
    const servers = (config.mcpServers ?? []).filter((s) => s.id !== OUTLOOK_ID);
    if (!servers.length) {
      list.append(el("p", "setting-empty", "No custom servers."));
      return;
    }
    for (const server of servers) {
      const s = server.enabled ? statusOf(server.id) : null;
      const state = server.enabled ? s?.status ?? "starting" : "off";
      const row = el("div", "setting stack mcp-server");
      const head = el("div", "mcp-head");
      head.append(el("span", "mcp-name", server.name), el("span", `badge-status ${state}`, state));
      const toggle = Object.assign(el("input"), { type: "checkbox", role: "switch", className: "switch", checked: server.enabled });
      toggle.setAttribute("aria-label", `Use ${server.name}`);
      toggle.onchange = () => send({ type: "mcp_toggle", id: server.id, enabled: toggle.checked });
      head.append(toggle);
      const detail =
        state === "connected" ? `${s.tools.length} tool${s.tools.length === 1 ? "" : "s"} available to the agent.`
        : state === "error" ? s.error
        : `${server.command} ${(server.args ?? []).join(" ")}`;
      row.append(head, el("p", "setting-desc", detail));
      if (server.envKeys?.length) row.append(el("p", "field-note", `Environment: ${server.envKeys.join(", ")} (values hidden)`));
      const actions = el("div", "row");
      const restart = el("button", null, "Restart");
      restart.type = "button";
      restart.disabled = !server.enabled;
      restart.onclick = () => send({ type: "mcp_restart", id: server.id });
      const remove = el("button", "link-danger", "Remove");
      remove.type = "button";
      remove.onclick = () => {
        if (remove.dataset.confirm) return send({ type: "mcp_remove", id: server.id });
        remove.dataset.confirm = "1";
        remove.textContent = `Remove ${server.name}?`;
      };
      actions.append(restart, remove);
      row.append(actions);
      if (config.debugMode && s) row.append(debugDetail(s));
      list.append(row);
    }
  }

  $("mcp-add").addEventListener("submit", (e) => {
    e.preventDefault();
    const env = {};
    for (const line of $("mcp-env").value.split("\n")) {
      const at = line.indexOf("=");
      if (at > 0) env[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    send({ type: "mcp_save", server: { name: $("mcp-name").value, command: $("mcp-command").value, args: $("mcp-args").value, env } });
    for (const id of ["mcp-name", "mcp-command", "mcp-args", "mcp-env"]) $(id).value = "";
    toast("Server added");
  });

  // Connect flow for Outlook: intro, setup, sign-in code, done; and manage once connected.

  const STEPS = ["intro", "setup", "signin", "done"];

  function showStep(name, { title, body, primary, secondary, cancel = "Cancel" }) {
    step = name;
    const index = STEPS.indexOf(name);
    $("connect-step").textContent = index >= 0 ? `Step ${index + 1} of ${STEPS.length}` : "";
    $("connect-title").textContent = title;
    $("connect-body").replaceChildren(...body);
    const setButton = (button, spec) => {
      button.hidden = !spec;
      if (!spec) return;
      button.textContent = spec.label;
      button.disabled = Boolean(spec.disabled);
      button.onclick = spec.onClick;
    };
    setButton($("connect-primary"), primary);
    setButton($("connect-secondary"), secondary);
    $("connect-cancel").textContent = cancel;
    $("connect-cancel").hidden = !cancel;
    flow.hidden = false;
    $("connect-primary").hidden || $("connect-primary").disabled ? $("connect-cancel").focus() : $("connect-primary").focus();
  }

  function closeFlow() {
    flow.hidden = true;
    step = null;
  }
  $("connect-cancel").onclick = closeFlow;

  function openFlow(name) {
    $("connect-logo").innerHTML = OUTLOOK_LOGO;
    if (name === "intro") return introStep();
    if (name === "setup") return setupStep();
    if (name === "signin") return requestCode();
    if (name === "manage") return manageStep();
  }

  function introStep() {
    const list = el("ul", "connect-list");
    for (const item of ["Read and search your email", "Draft replies and new messages", "See and add calendar events"]) list.append(el("li", null, item));
    showStep("intro", {
      title: "Connect Microsoft Outlook",
      body: [
        el("p", null, "Let the agent work with your Outlook mail and calendar."),
        list,
        el("p", "field-note", "It asks you before sending, deleting or changing anything. You sign in on Microsoft's own page, and you can disconnect here at any time."),
      ],
      primary: { label: "Continue", onClick: () => setupStep() },
    });
  }

  function setupStep(problem = "") {
    const state = outlookState();
    if (!problem) {
      if (state === "absent") send({ type: "mcp_add_preset", preset: OUTLOOK_ID });
      else if (state === "off") send({ type: "mcp_toggle", id: OUTLOOK_ID, enabled: true });
      else if (state === "error" || state === "stopped") send({ type: "mcp_restart", id: OUTLOOK_ID });
      else if (state === "connected") checkSignIn();
    }
    showStep("setup", {
      title: "Setting up",
      body: problem
        ? [el("p", "field-note error", problem)]
        : [el("p", null, "Starting the Outlook connection. The first time downloads it, which can take about a minute."), el("div", "progress")],
      primary: problem ? { label: "Try again", onClick: () => setupStep() } : { label: "Continue", disabled: true },
    });
  }

  function requestCode() {
    showStep("signin", {
      title: "Sign in to Microsoft",
      body: [el("p", null, "Getting a sign-in code…"), el("div", "progress")],
      primary: { label: "I've signed in", disabled: true },
    });
    account("login");
  }

  function signinStep(device, note = "") {
    const steps = el("ol", "connect-steps");
    const open = Object.assign(el("a", "button-link", "Open Microsoft sign-in"), { href: device.url, target: "_blank", rel: "noopener noreferrer" });
    const first = el("li");
    first.append(el("span", null, "Open Microsoft's sign-in page: "), open);
    const second = el("li");
    const code = el("code", "big-code", device.code);
    const copy = el("button", null, "Copy");
    copy.type = "button";
    copy.onclick = () => navigator.clipboard?.writeText(device.code).then(() => toast("Code copied"));
    const codeRow = el("div", "code-row");
    codeRow.append(code, copy);
    second.append(el("span", null, "Enter this code:"), codeRow);
    steps.append(first, second, el("li", null, "Sign in with your Microsoft account (your UC Merced email) and accept."));
    const body = [steps];
    if (note) body.push(el("p", "field-note error", note));
    showStep("signin", {
      title: "Sign in to Microsoft",
      body,
      primary: {
        label: "I've signed in",
        onClick: () => {
          $("connect-primary").disabled = true;
          $("connect-primary").textContent = "Checking…";
          checkSignIn();
        },
      },
      secondary: { label: "New code", onClick: requestCode },
    });
    signinStep.device = device;
  }

  function doneStep() {
    const tips = el("ul", "connect-list");
    for (const tip of ["What's on my calendar tomorrow?", "Summarize my unread email from today.", "Draft a reply to the last email from my professor."]) tips.append(el("li", null, tip));
    showStep("done", {
      title: "Outlook is connected",
      body: [el("p", null, `Signed in${outlook?.account ? ` as ${outlook.account}` : ""}.`), el("p", "field-note", "Try asking the agent:"), tips],
      primary: { label: "Done", onClick: closeFlow },
      cancel: "Close",
    });
  }

  function manageStep() {
    const remove = el("button", "link-danger", "Remove connection");
    remove.type = "button";
    remove.onclick = () => {
      if (!remove.dataset.confirm) {
        remove.dataset.confirm = "1";
        remove.textContent = "Remove Outlook from the agent?";
        return;
      }
      send({ type: "mcp_remove", id: OUTLOOK_ID });
      outlook = null;
      closeFlow();
      toast("Outlook removed");
    };
    showStep("manage", {
      title: "Microsoft Outlook",
      body: [el("p", null, `Connected${outlook?.account ? ` as ${outlook.account}` : ""}.`), el("p", "field-note", "Signing out ends the agent's access to your mail and calendar until you sign in again."), remove],
      primary: { label: "Close", onClick: closeFlow },
      secondary: { label: "Sign out", onClick: () => account("logout") },
      cancel: "",
    });
  }

  function render(next) {
    config = next;
    if (config.edition !== "local") return;
    renderIntegrations();
    renderServers();
  }

  return {
    open() {
      panel.hidden = false;
      send({ type: "mcp_status" });
      if (outlookState() === "connected" && !checking) checkSignIn();
    },
    close() {
      closeFlow();
      panel.hidden = true;
    },
    get isOpen() {
      return !panel.hidden;
    },
    get status() {
      return status;
    },
    render,
    handlers: {
      mcp_status(msg) {
        status = msg.servers;
        const state = outlookState();
        if (state !== "connected") outlook = null;
        else if (outlook === null && !checking) checkSignIn();
        if (step === "setup") {
          if (state === "error") setupStep(`The Outlook connection could not start: ${statusOf(OUTLOOK_ID)?.error ?? "unknown error"}`);
        }
        if (config) render(config);
      },
      mcp_account(msg) {
        if (msg.id !== OUTLOOK_ID) return;
        if (msg.action === "verify-login") {
          checking = false;
          outlook = parseVerify(msg.text);
          if (config) render(config);
          if (step === "setup") outlook.signedIn ? doneStep() : requestCode();
          else if (step === "signin" && signinStep.device) {
            outlook.signedIn ? doneStep() : signinStep(signinStep.device, "Not signed in yet. Finish on Microsoft's page, then click I've signed in.");
          }
          return;
        }
        if (msg.action === "login" && step === "signin") {
          const device = parseDeviceCode(msg.text);
          if (device) signinStep(device);
          else if (/already|signed in|logged in/i.test(msg.text)) checkSignIn();
          else showStep("signin", { title: "Sign in to Microsoft", body: [el("p", "field-note error", msg.text)], primary: { label: "Try again", onClick: requestCode } });
          return;
        }
        if (msg.action === "logout") {
          outlook = { signedIn: false, account: "" };
          if (config) render(config);
          if (step === "manage") closeFlow();
          toast("Signed out of Outlook");
        }
      },
    },
  };
}
