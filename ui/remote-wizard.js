import { keyProblem } from "../src/config-core.js";
import { renderSteps, trapFocus } from "./wizard.js";

// Remote control setup: a full-screen flow in the style of first-run setup, one thing per
// screen. Allow discord.com, create a Discord app, paste and check its bot token, add it to
// Discord, pair. It follows the bridge's live status (discord_status), so it can be closed at
// any step and opens where the setup stands.

const PORTAL = "https://discord.com/developers/applications";
const DISCORD_ORIGINS = { origins: ["https://discord.com/*"] };
const STEPS = ["access", "create", "token", "install", "pair"];

// A phone with a chat bubble and the lamp: drawn in the app's tokens, so it follows the theme.
const ART = `<svg viewBox="0 0 160 112" class="remote-art" aria-hidden="true">
<rect x="52" y="6" width="56" height="100" rx="12" class="art-device"/>
<path d="M72 14h16" class="art-line"/>
<rect x="60" y="30" width="34" height="16" rx="6" class="art-bubble"/>
<rect x="66" y="52" width="34" height="16" rx="6" class="art-bubble-out"/>
<path d="M71 60h16" class="art-line-out"/>
<path d="M66 38h16" class="art-line"/>
<circle cx="80" cy="86" r="7" class="art-ring"/>
<circle cx="80" cy="86" r="3" class="art-lamp"/>
<path d="M18 56h22M120 56h22M24 44l12 6M136 44l-12 6M24 68l12-6M136 68l-12-6" class="art-rays"/>
</svg>`;

export function createRemoteWizard({ $, el, icon, send, toast }) {
  const root = $("remote-setup");
  // The bridge's last status (discord_status), and the screen on show.
  let status = null;
  let screen = null;
  let opener = null;
  // The checks from the last token test, shown on the token screen.
  let checks = null;
  let checking = false;

  const permissions = () => globalThis.chrome?.permissions;
  const hasAccess = async () => (permissions() ? permissions().contains(DISCORD_ORIGINS) : true);

  function result(kind, text) {
    const node = $("remote-result");
    node.className = `pc-result ${kind}`;
    node.replaceChildren();
    if (!kind) return;
    if (kind !== "pending") node.append(icon(kind === "ok" ? "check" : "alert"));
    node.append(el("span", null, text));
  }

  function link(text, href, className = "") {
    return Object.assign(el("a", className, text), { href, target: "_blank", rel: "noopener noreferrer" });
  }

  // Shows one screen. next and alt: [label, onClick]. focus: what gets focus, else the title.
  function show(name, { title, lead = "", body = [], next, alt, art = false, focus }) {
    screen = name;
    const index = STEPS.indexOf(name) + 1;
    renderSteps($("remote-steps"), index, STEPS.length);
    root.classList.toggle("welcome", art);
    $("remote-art").hidden = !art;
    if (art) $("remote-art").innerHTML = ART;
    $("remote-title").textContent = title;
    $("remote-lead").replaceChildren(...[lead].flat());
    $("remote-body").replaceChildren(...body);
    result("");
    for (const [id, spec] of [["remote-next", next], ["remote-alt", alt]]) {
      const button = $(id);
      button.hidden = !spec;
      button.disabled = false;
      if (spec) [button.textContent, button.onclick] = spec;
    }
    $("remote-back").hidden = index <= 1;
    $("remote-back").onclick = () => go(STEPS[index - 2]);
    if (root.hidden) setOpen(true);
    (focus ?? $("remote-title")).focus();
  }

  // The rest of the page is inert while setup is open. It may open over Settings, which has
  // made its own background inert, so closing restores what was there.
  let wasInert = new Map();
  function setOpen(open) {
    root.hidden = !open;
    if (open) wasInert = new Map([...document.body.children].map((node) => [node, node.inert]));
    for (const node of document.body.children) {
      if (node !== root && node.id !== "toast") node.inert = open || Boolean(wasInert.get(node));
    }
  }

  function close() {
    if (root.hidden) return;
    setOpen(false);
    screen = null;
    (opener?.isConnected ? opener : $("input"))?.focus();
  }
  $("remote-close").onclick = close;
  trapFocus(root, close);

  function go(name) {
    ({ intro, access, create, token, install, pair, done })[name]();
  }

  function intro() {
    const can = el("ul", "onboard-list");
    for (const [glyph, text] of [
      ["check", "Start a task from your phone and follow its progress"],
      ["check", "Allow or deny the agent's questions with one tap"],
      ["check", "Stop a task from anywhere"],
    ]) {
      const item = el("li");
      item.append(icon(glyph), el("span", null, text));
      can.append(item);
    }
    show("intro", {
      title: "Control Browsby from Discord",
      lead: "Use your own Discord bot. It takes about five minutes.",
      body: [can, el("p", "field-note", "Discord never gets screenshots or page contents. Sensitive sites and password fields are still approved only at this computer.")],
      next: ["Get started", access],
      art: true,
      focus: $("remote-next"),
    });
  }

  async function access() {
    const granted = await hasAccess();
    show("access", {
      title: "Let Browsby reach Discord",
      lead: "Remote control talks to Discord from this panel. Chrome asks you once to allow discord.com.",
      body: [el("p", "field-note", "Browsby uses it only for remote control. You can take it back in Chrome's extension settings at any time.")],
      next: granted ? ["Continue", create] : ["Allow access to discord.com", requestAccess],
      focus: $("remote-next"),
    });
    if (granted) result("ok", "Access granted.");
  }

  // Runs in the button's click, which Chrome needs to show its permission prompt.
  function requestAccess() {
    if (!permissions()) return create();
    permissions()
      .request(DISCORD_ORIGINS)
      .then((granted) => {
        if (screen !== "access") return;
        if (granted) return create();
        result("error", "Chrome did not allow it. Remote control needs it to reach Discord.");
        $("remote-next").focus();
      });
  }

  function create() {
    const steps = el("ol", "onboard-checklist");
    for (const text of ["Click New Application and name it Browsby.", "Open Bot in the menu on the left.", "Click Reset Token, then Copy."]) steps.append(el("li", null, text));
    const portal = link("Open the Developer Portal", PORTAL, "button-link onboard-link");
    show("create", {
      title: "Create your Discord app",
      lead: "Discord's Developer Portal opens in a new tab. Sign in with the Discord account you use on your phone.",
      body: [portal, steps, el("p", "field-note", "The token is a password for your bot. Paste it only into Browsby.")],
      next: ["I copied the token", token],
      focus: portal,
    });
  }

  function token() {
    const field = el("div", "card-field");
    const label = Object.assign(el("label", "card-label", "Bot token"), { htmlFor: "remote-token" });
    const input = Object.assign(el("input"), { id: "remote-token", type: "password", autocomplete: "off", spellcheck: false, placeholder: "Paste the bot token" });
    input.setAttribute("aria-describedby", "remote-token-note remote-result");
    input.addEventListener("keydown", (e) => e.key === "Enter" && !checking && check());
    field.append(label, input, Object.assign(el("p", "field-note", "It stays in this Chrome profile, is never synced, and is sent only to Discord."), { id: "remote-token-note" }));
    const list = el("ul", "onboard-checks");
    list.id = "remote-checks";
    show("token", {
      title: "Paste the bot token",
      lead: "Browsby checks it with Discord and sets up the /browsby command for you.",
      body: [field, list],
      next: ["Check token", check],
      focus: input,
    });
    if (checks) renderChecks();
  }

  function check() {
    const input = $("remote-token");
    const value = input.value.trim();
    if (!value) {
      result("error", "Paste the token first.");
      return input.focus();
    }
    const problem = keyProblem(value, "bot token");
    if (problem) {
      result("error", problem);
      return input.focus();
    }
    checking = true;
    checks = null;
    $("remote-checks").replaceChildren();
    $("remote-next").disabled = true;
    $("remote-next").textContent = "Checking…";
    result("pending", "Checking with Discord…");
    send({ type: "discord_save", token: value });
  }

  function renderChecks() {
    const list = $("remote-checks");
    if (!list) return;
    list.replaceChildren(
      ...checks.checks.map((c) => {
        const item = el("li", c.ok ? "ok" : "fail");
        item.append(icon(c.ok ? "check" : "alert"), el("span", null, c.text));
        return item;
      }),
    );
  }

  function install() {
    const body = [];
    if (status?.installUrl) {
      body.push(link("Add to my Discord account", status.installUrl, "button-link onboard-link"));
      body.push(el("p", "field-note", "Works in a direct message with your bot, no server needed."));
      body.push(link("Add it to a server of mine instead", status.serverInstallUrl, "onboard-alt-link"));
    } else body.push(el("p", "field-note", "Connecting to Discord… The links appear in a moment."));
    show("install", {
      title: "Add it to your Discord",
      lead: "Discord opens in a new tab. Choose Add, then come back here.",
      body,
      next: ["Next", pair],
      focus: body[0].tagName === "A" ? body[0] : undefined,
    });
  }

  function pair() {
    if (status?.paired) return done();
    const command = `/browsby pair code: ${status?.pairCode ?? ""}`;
    const code = el("code", "pair-command", command);
    const copy = el("button", null, "Copy");
    copy.type = "button";
    copy.onclick = () => navigator.clipboard?.writeText(command).then(() => toast("Copied"));
    const row = el("div", "code-row");
    row.append(code, copy);
    const body = [row, el("p", "field-note", `Or send just the code ${status?.pairCode ?? ""} as a message.`)];
    if (status?.dmUrl) body.push(link(`Open ${status.botName ?? "your bot"} in Discord`, status.dmUrl, "onboard-alt-link"));
    const waiting = el("div", "onboard-waiting");
    waiting.append(el("div", "progress"), el("span", null, "Waiting for your message…"));
    body.push(waiting);
    show("pair", {
      title: "Pair your account",
      lead: [`In Discord, open a direct message with ${status?.botName ?? "your bot"} and send:`],
      body,
      next: null,
      focus: copy,
    });
  }

  function done() {
    const examples = el("ul", "onboard-list examples");
    for (const text of ["/browsby run task: find a lasagna recipe", "/browsby sessions", "/browsby stop"]) {
      const item = el("li");
      item.append(el("code", null, text));
      examples.append(item);
    }
    show("done", {
      title: "Remote control is on",
      lead: `Paired with ${status?.userName ?? "your account"}. Browsby takes tasks from Discord while a Browsby panel is open.`,
      body: [el("p", "field-note", "Try one of these in Discord:"), examples],
      next: ["Done", close],
      art: true,
      focus: $("remote-next"),
    });
  }

  // The panel that runs remote control is another window's, or this one is incognito.
  function away() {
    show("away", {
      title: "Set it up in another window",
      lead:
        status.state === "incognito"
          ? "Remote control does not run in incognito windows."
          : "Remote control runs in the Browsby panel of another Chrome window. Set it up there, or close that panel to move it here.",
      next: ["Close", close],
      focus: $("remote-next"),
    });
  }

  // Where to start: the first step that is not done yet.
  async function open() {
    opener = document.activeElement;
    send({ type: "discord_status" });
    if (!status || status.state === "off") return intro();
    if (["elsewhere", "incognito"].includes(status.state)) return away();
    if (status.state === "no-access" || !(await hasAccess())) return access();
    if (status.paired) return intro();
    return install();
  }

  return {
    open,
    get isOpen() {
      return !root.hidden;
    },
    handlers: {
      discord_status(msg) {
        status = msg;
        if (root.hidden) return;
        if (screen === "pair" && msg.paired) done();
        else if (screen === "install" && msg.installUrl && !$("remote-body").querySelector("a")) install();
      },
      discord_checks(msg) {
        if (screen !== "token" || !checking) return;
        checking = false;
        checks = msg;
        renderChecks();
        $("remote-next").disabled = false;
        if (!msg.ok) {
          $("remote-next").textContent = "Check token";
          result("error", msg.checks?.[0]?.text ?? "Discord did not accept the token.");
          return $("remote-token").focus();
        }
        $("remote-token").value = "";
        result("ok", "Your bot is ready.");
        [$("remote-next").textContent, $("remote-next").onclick] = ["Continue", install];
        $("remote-next").focus();
      },
    },
  };
}
