// Connections panel: integrations, connected through a short guided flow. Outlook runs on
// Microsoft Graph with a browser sign-in (outlook_status).

// Outlook's mark drawn in the app's own style: an "O" tile over a mail envelope, in the
// accent color, so it follows the light and dark themes. Microsoft's official Outlook
// icon is not used: its Trademark and Brand Guidelines
// (https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks) require an
// express license for app and product icons, and its Microsoft 365 icon set is licensed
// only for architectural diagrams, training materials and documentation.
export const OUTLOOK_LOGO = `<svg class="logo" viewBox="0 0 40 40" aria-hidden="true">
<rect x="1" y="1" width="38" height="38" rx="10" class="logo-bg"/>
<rect x="15" y="12" width="17" height="16" rx="2.5" class="logo-line"/>
<path d="M15.5 13.5 23.5 20l8-6.5" class="logo-line"/>
<rect x="7" y="10" width="14" height="20" rx="3.5" class="logo-tile"/>
<ellipse cx="14" cy="20" rx="3.4" ry="4.4" class="logo-o"/>
</svg>`;

export function createMcpPanel({ $, el, send, setInertBehind, toast }) {
  const panel = $("mcp-panel");
  const flow = $("connect-flow");
  // Outlook's sign-in: null until outlook_status arrives, then { signedIn, account }.
  let outlook = null;
  // The connect flow's current step, or null when it is closed.
  let step = null;
  // Called with whether Outlook is signed in when the flow closes (first-run setup).
  let onFlowClosed = null;
  // The last outlook_status ({ configured, signedIn, account }).
  let graph = null;
  const signedIn = () => Boolean(graph?.signedIn);
  // Where focus goes back to when the panel closes.
  let opener = null;

  // Integrations list.

  function renderGraphCard() {
    const card = el("div", "setting integration");
    const logo = el("span", "integration-logo");
    logo.innerHTML = OUTLOOK_LOGO;
    const text = el("div", "setting-text");
    const line =
      !graph ? "Checking sign-in…"
      : !graph.configured ? "Not available in this version yet."
      : graph.signedIn ? `Connected${graph.account ? ` as ${graph.account}` : ""}`
      : "Read, search and draft email, and see your calendar.";
    text.append(el("span", "setting-title", "Microsoft Outlook"), el("p", "setting-desc", line));
    const action = el("button", graph?.signedIn ? null : "primary", graph?.signedIn ? "Manage" : "Connect");
    action.type = "button";
    action.disabled = !graph?.configured;
    action.onclick = startOutlook;
    card.append(logo, text, action);
    $("mcp-integrations").replaceChildren(card);
  }

  // Connect flow for Outlook: intro, sign-in, done; and manage once connected.

  const steps = () => ["intro", "signin", "done"];

  function showStep(name, { title, body, primary, secondary, cancel = "Cancel" }) {
    step = name;
    const index = steps().indexOf(name === "browser" ? "signin" : name);
    $("connect-step").textContent = index >= 0 ? `Step ${index + 1} of ${steps().length}` : "";
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
    // A modal dialog: the page behind is inert, and focus returns to the opener on close.
    if (!flow.open) flow.showModal();
    $("connect-primary").hidden || $("connect-primary").disabled ? $("connect-cancel").focus() : $("connect-primary").focus();
  }

  function closeFlow() {
    flow.close();
  }
  // Runs however the flow closes: its buttons, or Escape (the dialog's own cancel).
  flow.addEventListener("close", () => {
    step = null;
    const done = onFlowClosed;
    onFlowClosed = null;
    done?.(signedIn());
  });
  $("connect-cancel").onclick = closeFlow;
  // Escape closes only the flow, not the panel under it.
  flow.addEventListener("keydown", (e) => e.key === "Escape" && e.stopPropagation());

  // The flow step that fits Outlook's current state.
  function startOutlook() {
    if (graph?.configured) openFlow(graph.signedIn ? "manage" : "intro");
  }

  function openFlow(name) {
    $("connect-logo").innerHTML = OUTLOOK_LOGO;
    if (name === "intro") return introStep();
    if (name === "manage") return manageStep();
  }

  function introStep() {
    const list = el("ul", "connect-list");
    for (const item of ["Read and search your email", "Draft replies and new messages", "See and add calendar events"]) list.append(el("li", null, item));
    showStep("intro", {
      title: "Connect Microsoft Outlook",
      body: [
        el("p", null, "Find emails, draft replies and check your calendar. Browsby asks before sending anything."),
        list,
        el("p", "field-note", "You sign in on Microsoft's own page, and you can disconnect here at any time."),
      ],
      primary: { label: "Continue", onClick: () => graphSignInStep() },
    });
  }

  // Microsoft's page opens in a Chrome window (chrome.identity).
  function graphSignInStep(note = "") {
    const body = [el("p", null, "Microsoft's sign-in page opens in a new window. Sign in with your Microsoft account and accept.")];
    if (note) body.push(Object.assign(el("p", "field-note error", note), { role: "alert" }));
    showStep("signin", {
      title: "Sign in to Microsoft",
      body,
      primary: {
        label: "Sign in",
        onClick: () => {
          showStep("browser", {
            title: "Sign in to Microsoft",
            body: [el("p", null, "Finish signing in in the Microsoft window. This updates when you are done."), el("div", "progress")],
          });
          send({ type: "outlook_sign_in" });
        },
      },
    });
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
    showStep("manage", {
      title: "Microsoft Outlook",
      body: [
        el("p", null, `Connected${outlook?.account ? ` as ${outlook.account}` : ""}.`),
        el("p", "field-note", "Signing out ends the agent's access to your mail and calendar until you sign in again."),
      ],
      primary: { label: "Close", onClick: closeFlow },
      secondary: { label: "Sign out", onClick: () => send({ type: "outlook_sign_out" }) },
      cancel: "",
    });
  }

  function render() {
    renderGraphCard();
  }

  return {
    open() {
      if (panel.hidden) opener = document.activeElement;
      panel.hidden = false;
      setInertBehind(panel, true);
      $("mcp-title").focus();
      send({ type: "outlook_status" });
    },
    close() {
      closeFlow();
      if (panel.hidden) return;
      const hadFocus = panel.contains(document.activeElement) || document.activeElement === document.body;
      panel.hidden = true;
      setInertBehind(panel, false);
      if (hadFocus) (opener?.isConnected && opener.offsetParent ? opener : $("input")).focus();
    },
    get isOpen() {
      return !panel.hidden;
    },
    // Whether Outlook can be connected in this build (its app registration is set).
    get outlookAvailable() {
      return Boolean(graph?.configured);
    },
    // Outlook's sign-in, or null when not signed in or not checked yet.
    get outlook() {
      return graph?.signedIn ? outlook : null;
    },
    // Runs the Outlook connect flow on its own, over whatever is on screen; onClosed(signedIn)
    // runs when the user finishes or leaves it.
    connectOutlook(onClosed) {
      onFlowClosed = onClosed;
      startOutlook();
    },
    render,
    handlers: {
      outlook_status(msg) {
        graph = msg;
        outlook = { signedIn: msg.signedIn, account: msg.account };
        render();
        if (step === "browser") msg.signedIn ? doneStep() : graphSignInStep(msg.error || "Sign-in did not finish.");
        else if (step === "manage" && !msg.signedIn) {
          closeFlow();
          toast("Signed out of Outlook");
        }
      },
    },
  };
}
