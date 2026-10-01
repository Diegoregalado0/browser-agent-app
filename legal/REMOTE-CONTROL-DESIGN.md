# Remote control from Discord: design

Status: proposal for the owner, October 2026. Branch `remote-redesign`. Not published on GitHub Pages.

## The question

The owner wants Discord users to control their Browsby sessions through a bot, with a setup that is far easier to follow than today's. Today each user creates a Discord application and bot, pastes its token into Settings > Remote, invites the bot to a server of their own, and sends a pairing code by direct message. The bridge runs in one side panel (Gateway WebSocket plus REST from the browser), only while that panel is open, as a remote client that can run, stop and answer prompts. Sensitive-site and password prompts can only be approved at the computer.

This document compares three ways to do it, recommends one, defines the command and session model, and lists what the owner has to decide.

## Short answer

**Recommendation: A, bring your own bot, made easy. Ship it now.** It keeps the promise that nothing goes through a Browsby server, needs no hosting, no Discord app review and no new legal text beyond small updates, and the new wizard turns the hard part (the developer portal) into a short guided flow with live checks. The extension now also registers slash commands, works in the bot's DMs without a shared server (user install), lists every open Browsby window as a session, edits one progress message instead of sending many, and puts approval and Stop buttons in Discord.

**B, one official Browsby bot plus a relay, is the better experience** (one click to install, no developer portal, an answer even when Chrome is closed), but it adds a Browsby server that sees task text, Discord user ids and pressed prompts. It breaks the first line of the positioning ("nothing sent through us") and the privacy policy's "no server", adds running costs and an always-on service to keep secure. It is specified below so the owner can choose it later; the extension side is shaped so that the parts B would reuse (interaction replies that need no bot token, the session directory) are already separate.

| | A. Your own bot, made easy (recommended) | B. Official bot plus relay | C1. Bridge in the service worker | C2. Telegram instead |
| --- | --- | --- | --- | --- |
| Setup the user sees | 6 short screens: allow access, create app in the portal (deep link and checklist), paste token (checked live), add to Discord (one link), pair (one command) | 2 screens: "Add Browsby to Discord" (one link), then run `/browsby link` and type the code into the panel | Same as A | 3 screens: message @BotFather, paste token, pair |
| Who can drive the browser | Only the paired Discord account, checked on every command and button | Only the Discord account linked to this device, checked by the relay and again by the extension | Same as A | Only the paired Telegram account |
| What sees task text | Discord | Discord and the relay | Discord | Telegram |
| Works with the panel closed | No: Discord shows "The application did not respond" | The relay answers "Browsby is not open on your computer" | The bot answers "open the panel" but cannot run tasks | No |
| Server to run | None | Relay (Cloudflare Workers with Durable Objects, or a small VM) | None | None |
| Privacy policy and store | Small updates (this branch) | "No Browsby server" no longer true; new data processor section; reviewer notes for a backend | Small updates; longer-lived service worker to justify | New third party; Discord work replaced |
| Size | Done on this branch | Relay about 300 lines plus deploy, secrets, monitoring; extension transport about 200 lines | About 250 lines moved and reworked | A new bridge, about 300 lines |

## Platform facts this rests on (checked September and October 2026)

- **Bot tokens and the Gateway.** A bot connects to the Gateway over a WebSocket, identifies with its token, keeps a heartbeat, and receives `INTERACTION_CREATE` for slash commands and button presses without any intent; plain DM text needs the `DIRECT_MESSAGES` intent, and message content in DMs needs no privileged intent. https://docs.discord.com/developers/events/gateway
- **Interactions by Gateway or HTTP.** An app receives interactions either through the Gateway event or through an outgoing webhook (Interactions Endpoint URL); the two are alternatives. The first response must come within 3 seconds, the interaction token is valid for 15 minutes, `PATCH /webhooks/{app}/{token}/messages/@original` edits the first reply, followups are `POST /webhooks/{app}/{token}`, and apps that are not installed in the server are limited to 5 followups per interaction. Ephemeral flag is `64`. Response types: 4 message, 5 deferred message, 6 deferred update, 7 update message, 8 autocomplete result. https://docs.discord.com/developers/interactions/receiving-and-responding
- **Interaction replies need no bot token.** The webhook endpoints above are authorized by the interaction token in the address. This is what makes B possible without the relay ever seeing replies.
- **Slash commands, user install and contexts.** Commands carry `integration_types` (0 server install, 1 user install) and `contexts` (0 server, 1 the bot's DM, 2 group DMs and other DMs). Global commands are set with `PUT /applications/{id}/commands` (bulk overwrite); there is a limit of 200 command creates per day. Names match `^[-_\p{L}\p{N}]{1,32}$` (plus some scripts). https://docs.discord.com/developers/interactions/application-commands
- **Configuring an app from its bot token.** `PATCH /applications/@me` accepts `integration_types_config` (default install scopes per context) and `install_params`; `GET /applications/@me` returns the app id, name, owner and `integration_types_config`. The wizard uses these to turn on user install for the user. https://docs.discord.com/developers/resources/application
- **User-installable apps.** An app with User Install on can be added to a person's account with the `applications.commands` scope, and its commands then work in the app's DM, in the user's servers and in other DMs, without the bot sharing a server. https://docs.discord.com/developers/tutorials/developing-a-user-installable-app
- **OAuth2 install links.** `https://discord.com/oauth2/authorize?client_id=…&integration_type=1&scope=applications.commands` adds an app to the user's account; `integration_type=0` with `scope=bot applications.commands` adds it to a server. The `bot` scope applies to server installs only. https://docs.discord.com/developers/topics/oauth2
- **Rate limits.** 50 requests per second per bot, per-route buckets announced in headers, and 10,000 invalid requests (401, 403, 429) per 10 minutes before a temporary Cloudflare ban. Interaction endpoints are not counted against the global limit. https://docs.discord.com/developers/topics/rate-limits
- **Developer Policy.** Apps need a privacy policy that says what is collected, how it is used and how to delete it; API data may be used only to provide the app's stated function; message content may not be used to train AI models without Discord's permission. https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy and https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service. Browsby relays only the owner's own tasks and the agent's answers to them, stores nothing on Discord's side, and never trains on anything, so both A and B fit; B's relay would need its own privacy section.
- **What a Chrome extension can do on its own.** Extension pages may open WebSockets (the Gateway needs no host permission) and call `https://discord.com/api` with a host permission. Since Chrome 116 WebSocket traffic keeps a service worker alive if a message passes at least every 30 seconds (Chrome suggests every 20). Optional host permissions are granted with `chrome.permissions.request` from a user gesture, can be removed by the user at any time, and removal fires `chrome.permissions.onRemoved`. https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets, https://developer.chrome.com/docs/extensions/reference/api/permissions
- **What can never run purely client side.** A shared bot token cannot ship in the extension: the package is public, so anyone could take the token, read every user's commands and impersonate the bot. Any single official bot therefore needs a server that holds the token (B). Receiving interactions over HTTP also needs a public HTTPS endpoint, which an extension cannot be.

Not verified against a live Discord account from here (no Discord app was created, per the brief): whether a user-installed bot with no shared server can post ordinary channel messages into its DM after the 15 minute interaction window; whether `PATCH /applications/@me` with `integration_types_config` alone turns on User Install for a new app, as the wizard tries (it falls back to a portal instruction when Discord refuses or ignores it).

## Option A: your own bot, made easy (built on this branch)

### Setup the user sees

Settings > Remote (Discord) > "Set up remote control" opens a full-screen flow in the style of first-run setup: one thing per screen, a step counter, plain words, and live checks.

1. **Control Browsby from your phone.** What it does (run, stop, approve from Discord) and what it never does (no screenshots or page contents, sensitive-site and password prompts stay at the computer). "Get started".
2. **Let Browsby reach Discord.** Explains the one permission and asks Chrome for it (`https://discord.com/*`, now optional). Shows "Access granted" or why not.
3. **Create your Discord app.** A button opens the Developer Portal; a short checklist: New Application, name it Browsby, open Bot, Reset Token, Copy. "I copied the token".
4. **Paste the token.** The token is checked before it is saved: Discord must accept it. A live checklist then shows: token accepted (bot name), slash commands added, ready to add to your account (or one portal instruction if Discord would not turn on User Install).
5. **Add it to your Discord.** "Add to my Discord account" (user install, works in DMs without a server) and "Add to a server instead". "Next".
6. **Pair your account.** Shows `/browsby pair code: 7F3A9C21E4` with Copy, and waits. The screen updates by itself to "Paired with @name". Sending the code as a plain DM still works.
7. **You're all set.** Three example commands. "Done".

The wizard can be closed at any step and picks up where the state is (permission, token, pairing) when reopened. Settings > Remote keeps a compact status card (state, bot, paired account, sessions) with Unpair, Remove bot and, when Chrome's permission was removed, "Allow access again".

### Security

- **Who can drive the browser:** only the Discord account that sent the pairing code from this computer. Every command and every button press is checked against that user id; anyone else gets a private "This bot belongs to someone else" and nothing reaches the agent. Pairing codes are 10 random hex characters from `crypto.getRandomValues`, valid until used or the bot is removed.
- **What a remote command can do:** unchanged. The bridge connects to each window's controller as a remote client, so only `run`, `stop` and `permission` pass (`REMOTE_MESSAGES`); `always` becomes `once`; sensitive-site and password prompts get only a Deny button and the controller refuses a remote approval anyway (`LOCAL_ONLY_PROMPTS`). Settings, keys, Ghost mode and sessions change only at the computer.
- **Revocation:** Unpair (new code), Remove bot (token deleted), removing Chrome's Discord permission (the bridge stops at once and says so), or resetting the token in the portal.
- **Multiple devices:** each Chrome profile with its own bot is independent. Two profiles can share one bot only one at a time: Discord sends each event to one Gateway session, so the second connection would steal events. The wizard says to use one bot per computer.
- **What Discord sees:** the tasks the owner sends, approval prompts (page address and a short preview of typed text, never for password fields), the agent's final answers, errors, and progress lines that name only the kind of step (for example "Clicking", "Opening a page"), never addresses, page text or screenshots.
- **The token:** stays in `chrome.storage.local`, never synced, never sent to the UI, logs or anywhere but Discord, as before.

### Implementation

- `src/remote-discord.js`: the bridge. Validates the token (`GET /applications/@me`), tries to turn on User Install (`PATCH /applications/@me`), registers the `/browsby` command (`PUT /applications/{id}/commands`), keeps the Gateway session, answers interactions within 3 seconds (deferred reply), and talks to sessions through the directory below. Replies use the interaction token while it is valid (14 minutes), then fall back to posting in the DM channel with the bot token.
- `src/remote-sessions.js`: the session directory. Each open, non-incognito Browsby panel shares its controller on a `BroadcastChannel` (same extension origin only) as one session; the panel that holds the `discord-bridge` lock lists them and routes commands. Nothing new crosses the extension boundary.
- `extension/sidepanel-main.js`: shares every panel as a session, starts the bridge in the lock holder, and checks the optional host permission (start, `onAdded`, `onRemoved`).
- `ui/remote-wizard.js`, `ui/index.html`, `ui/style.css`, `ui/settings.js`: the new flow and the status card.

## Option B: one official Browsby bot plus a relay (specified, not built)

### Setup the user sees

1. Settings > Remote > "Add Browsby to Discord" opens Discord's install page for the official app (user install, `applications.commands`). One click.
2. In Discord, the user runs `/browsby link`. The relay answers privately with an 8-character code valid for 10 minutes.
3. The user types the code into the panel. The extension opens a WebSocket to the relay with the code; the relay binds this device to that Discord user and returns a device secret, stored like the bot token. Done.

### How it works

- The relay owns the official app's bot token and its Interactions Endpoint URL (HTTP, so no Gateway connection to keep). It verifies Discord's Ed25519 signature on each request and answers within 3 seconds with a deferred reply.
- It looks up the devices linked to the Discord user id and forwards `{ interaction id, interaction token, application id, command, options }` over the device's WebSocket. If no device is connected it edits the reply to "Browsby is not open on your computer".
- The extension then talks to Discord directly: interaction webhooks need only the interaction token, so progress edits, approval followups and the final answer go from the extension to `discord.com`, not through the relay. Button presses come back through the relay the same way.
- Tasks longer than 15 minutes cannot be reported through the original interaction token. The extension says so in the last edit ("Still working. Run /browsby status for updates"); `/browsby status` gives a fresh token. The relay never posts on its own.
- Sessions, safety rules and remote-client limits are exactly as in A; the extension side swaps the Gateway connection for the relay connection.

### What the relay can see

The relay sees in memory, and must not store: the Discord user id, task text in `/browsby run`, which button was pressed, and, because Discord includes the message in component interactions, the text of a prompt whose button was pressed. It stores only the link table (Discord user id, device id, hash of the device secret, created time). It never sees answers, progress, page content or API keys.

End-to-end encryption between the extension and Discord is not possible: Discord itself delivers the plaintext command to the relay. Between the relay and the extension the WebSocket is TLS; encrypting the forwarded payload again adds nothing, since the relay already had the plaintext. What can be reduced is retention (none), logs (ids only, no content), and the relay's code (open source, reproducible deploy).

### Hosting and operations

- Cloudflare Workers with Durable Objects (WebSocket hibernation), about USD 5 per month on the paid plan for a small user base; or a USD 5 to 10 per month VM with a process manager and TLS. A domain is needed for the endpoint.
- Secrets: the bot token and public key in the platform's secret store; rotation runbook; alerting on the endpoint's error rate. Discord disables an endpoint that stops answering, which breaks every user at once.
- Discord requires verification for apps in 100 or more servers; user installs count differently, and reaching many users still means a verified app and a support contact.
- Abuse: rate limit `/browsby link` and code attempts per user, cap devices per user, drop a device after 30 days without contact.

### Privacy, store review and positioning

- README, Positioning and the store listing say "no Browsby server". With B they would have to say "an optional relay run by the publisher forwards your Discord commands to your browser; it keeps no content". The privacy policy gains the relay as a processor, its retention, its location and a deletion path (`/browsby unlink`, and deleting the link table row).
- The Chrome Web Store would review a backend connection (host permission for the relay's domain) and the data it receives; it is not remote code. The data disclosure gains "Personal communications" through the publisher.
- Discord's Developer Policy then applies to the publisher directly (privacy policy, data use, deletion requests), rather than to each user's own app.

### Size

Relay: about 300 lines (signature check, command routing, link table, WebSocket hub) plus deploy configuration, secrets and monitoring. Extension: a `RelayTransport` beside the Gateway one, about 200 lines, reusing the session directory and the interaction reply code from A. Not built on this branch: it needs a Discord app, a domain and hosting, which the brief rules out, and it is larger than a small reference.

## Option C: other routes

- **C1. Run the bridge in the service worker.** The Gateway would stay connected whenever Chrome is open, so the bot could answer "Open the Browsby panel to run tasks" instead of timing out, and the one-panel lock would go away. It cannot run tasks with the panel closed, because the agent and its debugger work live in the panel by design (closing the panel ends the task, a safety property kept here). It needs a 20-second keepalive and a store justification for an always-running worker. Worth doing after A if users miss the offline answer; not needed to ship.
- **C2. Telegram instead of, or beside, Discord.** Creating a Telegram bot is one chat with @BotFather, and Telegram's Bot API works over plain HTTPS long polling from the browser. It would make "your own bot" far easier than Discord's portal. It is a different product decision, so it is listed for the owner only.
- **Not viable:** a Discord webhook alone (cannot receive commands); shipping a shared token (public); OAuth2 `identify` alone (proves who the user is but carries no commands).

## Command and session model

One top-level command, `/browsby`, installable to servers and to a user, usable in servers, the bot's DM and other DMs. Replies outside the bot's DM are ephemeral, so nobody else in a channel sees them.

| Command | What it does |
| --- | --- |
| `/browsby run task:<text>` | Starts the task in the selected session (a follow-up when that session already has a conversation). Replies at once with one progress message that is edited as the task runs, with a Stop button. |
| `/browsby stop` | Stops the selected session's task. |
| `/browsby status` | Lists open sessions and what each is doing. |
| `/browsby sessions` | The same list, with a button per session to choose where the next task runs. |
| `/browsby pair code:<code>` | Pairs this Discord account using the code shown at the computer. Only before pairing. |

Plain DM text to the bot still works as before: text runs a task, `stop` stops it, `help` explains.

**Sessions.** Each Chrome window with an open, non-incognito Browsby panel is one session, named "Window 1", "Window 2" in the order they opened, plus the title of its current conversation (the user's own first request) when it is not a Ghost session. The selected session is the last one picked with `/browsby sessions`, or the first open window. If the selected window closes, the next task goes to the first open one and the reply says so. Tasks can run in several windows at once; each has its own progress message.

**Progress.** The first reply is edited at most every 2.5 seconds: `Working in Window 1 · 6 steps · 0:42 · Clicking`, with a Stop button. When the task ends it becomes `Done in Window 1 · 9 steps · 1:10` (or `Stopped`, or `Error`) without buttons. Only the kind of step is named.

**Approvals.** Each prompt is a new message (so the phone notifies) with Allow and Deny, or only Deny and "Approve this one at the computer" for sensitive-site and password prompts. A press updates that message to "Allowed from Discord" or "Denied from Discord". A prompt answered at the computer loses its buttons in Discord.

**Final answer.** A new message with the agent's reply, clipped to Discord's limit. Errors and stop notices the same way.

**Limits.** Discord allows 5 followups per interaction for apps that are not in the server; when that runs out, approvals and answers go into the progress message instead. After 14 minutes the interaction token is not used and messages go to the DM channel with the bot token.

## Owner decisions

1. **A now, B later?** This branch ships A. Choose B only if a one-click install is worth running a relay and changing "nothing sent through us" in every public text.
2. **Should progress lines include page addresses?** They do not now (only the kind of step). Addresses would make progress more useful and would count as browsing history sent to Discord; that would need a setting, off by default, and a privacy update.
3. **A setting to send screenshots or page text to Discord?** Not built. The brief allows it only as an explicit owner setting; the recommendation is not to add it.
4. **C1 (offline answer from the service worker):** worth a follow-up if users report "The application did not respond".
5. **Public bot:** Discord creates new apps as public, so anyone with the install link can add the user's bot; they only ever get "This bot belongs to someone else". Should the wizard also tell users to turn off Public Bot in the portal? It is one more step; left out for now.
