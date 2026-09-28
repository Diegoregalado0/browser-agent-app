# Browser Agent

Say what you want done, and Browser Agent does it in your own Chrome tabs. It opens pages, clicks, types, fills in forms, and tells you when it is finished.

It runs on your own AI key, with the provider you choose, and nothing is sent through us.

## Why it is different

- **Your key, your provider.** Use a key from Anthropic, OpenAI, Google Gemini, or Mistral, or run a local model with Ollama. The key stays on your computer and is sent only to that provider, which bills you directly.
- **No account, no middleman.** There is no Browser Agent account and no Browser Agent server. Your tasks, pages, and history never pass through us.
- **Keep Chrome.** Use it as an extension in the Chrome you already have, or as a Mac app that runs in its own Chrome window.
- **It asks before it matters.** A safety check compares each action with what you asked for. On banks, payment sites, password managers, and password fields, it always asks first. You can press Stop at any time.

## What you can ask it

- "Find a well-reviewed lasagna recipe and open it."
- "Compare the price of AirPods Pro at three stores."
- "Check my email for the verification code and enter it here."
- "Play the latest episode of this show on YouTube."
- "What's on my calendar tomorrow?" (with Outlook connected, Mac app)
- "Summarize my unread email from today." (with Outlook connected, Mac app)

It aims for the end result, not a list of links. If you ask for a video, it opens it and checks that it is playing. If a choice is low stakes, it picks one and tells you which. If a wrong choice would be costly, it asks.

## Install

There are two editions. They share the same agent, safety checks, and panel.

| | Chrome extension | Mac app |
| --- | --- | --- |
| Runs in | Your own Chrome, in a side panel | Its own Chrome window and profile |
| Platforms | Mac, Windows, Linux | macOS |
| Outlook, other MCP connections | No | Yes |
| Discord remote control | No | Yes |
| Mouse and keyboard outside the page | No | Yes, optional |

Both need [Node.js](https://nodejs.org) 22 or newer to build.

### Chrome extension

```sh
git clone https://github.com/Diegoregalado0/browser-agent-app.git
cd browser-agent-app
npm install
npm run build:extension
```

1. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist/extension` folder.
3. Click the Browser Agent icon in the toolbar, or press Cmd+Shift+Y (Ctrl+Shift+Y on Windows and Linux).

The extension needs Chrome 120 or newer. It can only work in regular web pages, not in Chrome's own pages.

### Mac app

Needs Google Chrome in `/Applications`.

```sh
git clone https://github.com/Diegoregalado0/browser-agent-app.git
cd browser-agent-app
npm install
./scripts/install.sh
```

This puts **Browser Agent** in `~/Applications`. Open it from Spotlight or drag it to the Dock. It also adds a `browser-agent` terminal command when it can (see [For developers](#for-developers)).

**No admin rights for Node?** Install Node 22 into a conda environment, then run the same commands from inside it:

```sh
conda create -n node22 -c conda-forge nodejs=22
conda activate node22
```

The installer records which Node it ran with, so the app keeps working outside the environment. Run `./scripts/install.sh` again if you move the project folder or change your Node install.

**Mouse and keyboard outside the page** (optional): to let the agent reach browser menus, extension popups, permission prompts, and native dialogs, install Apple's command line tools (`xcode-select --install`). On first use, allow Browser Agent under Accessibility and Screen Recording in System Settings > Privacy & Security.

## First run

A short setup opens the first time:

1. **Provider and key.** Pick a provider, paste your key (there is a link to each provider's key page), and the setup tests the connection. With Ollama, no key is needed.
2. **Outlook** (Mac app, optional). Connect your Outlook mail and calendar, or skip.
3. **Try it.** Pick an example task to start, or type your own.

You can run setup again from Settings > General.

## Features

### Watch it work, or not

- The agent works in its own tabs and never takes over a tab you opened. The tab it is working in is marked with an "Agent" tab group.
- **Show the agent's actions** (Settings > Browser, off by default): a pointer glides to each target before a click, and typing appears one character at a time.
- **Stop** ends the task at once.

### Safety checks

Choose a mode in Settings > Permissions and safety:

- **Guarded** (default). A small, fast model checks each action that changes something against your requests, and scans what the agent reads for text that tries to take it over. If an action looks off, you are asked. If it clearly serves another goal, it is blocked. If the check itself fails, you are asked.
- **Guarded, and ask for each new site.** Also asks before the agent acts on a site for the first time.
- **Auto.** No safety checks or site prompts. Faster, but nothing stops the agent from following instructions planted in a page.

In every mode, including Auto:

- On sensitive sites (banks, payments, crypto exchanges, password managers, account security, some government sites) it asks before any click or typing. You can add your own sites.
- It asks before typing into a password field.
- It is told to ask before purchases, payments, sending messages, posting, deleting data, or changing account settings you did not request, and not to solve CAPTCHAs for you.

### Usage limits

Your provider bills you, so the agent has limits you can change in Settings > Permissions and safety. Set any of them to 0 to turn it off.

| Limit | Default | What happens |
| --- | --- | --- |
| Model requests per minute | 20 | The agent pauses until the minute passes |
| Browser actions per minute | 60 | The agent pauses until the minute passes |
| Tokens per task | 2 million | The task stops |
| Tokens per day | 10 million | New tasks wait until tomorrow |
| Steps per task | 80 | The task stops (Settings > General) |

Safety checks count toward the token limits too. When a provider rate-limits a request, the agent waits and retries, and says so in the chat.

### Sessions and Ghost mode

- Past sessions are listed in the menu. Reopen one to pick up where you left off. You can switch provider in the middle of a session.
- **Ghost mode** (the ghost button): the session is not saved and nothing goes to the activity log. It is always on in incognito windows. Chrome still keeps its own history.
- Screenshots are never saved with sessions.

### Standing instructions

Settings > General holds instructions sent with every task, for facts and preferences such as "My city is Austin, TX." You can also let the agent confirm simple "Are you 18?" prompts for you. It never submits ID or payment details for age checks.

### Outlook and other MCP connections (Mac app)

- **Outlook.** Connect Microsoft Outlook mail and calendar from the plug button or during setup. You sign in on Microsoft's own page. The sign-in tokens are kept in an encrypted file whose key is in the macOS Keychain; Browser Agent never sees them.
- **Your own servers.** Add any MCP server that runs as a local command, with its arguments and environment. Environment values are hidden in Settings once saved.
- Tools a server does not mark as read-only go through the safety check like any other action. What the agent reads from them, such as emails, is scanned like web pages.

### Discord remote control (Mac app)

Send tasks from Discord on your phone to the agent on your Mac.

- You create your own Discord bot, paste its token in Settings > Remote (Discord), and pair your account by sending the bot a code. The token stays in the settings file on your Mac.
- From Discord you can start a task, send `stop`, and answer Allow or Deny on the agent's questions. Prompts for sensitive sites and password fields can only be approved at the Mac.
- Discord can read bot messages, so only prompts, final answers, errors, and stop notices are sent. Never screenshots or page contents.

### Developer tools

When turned on, the agent can run JavaScript in a page and edit its HTML, which helps with debugging pages. Code runs with your signed-in access to the page. This is off by default in the extension and on in the Mac app; change it in Settings > Permissions and safety.

## Privacy and security

- **Your key** is stored on your computer: in the extension, in this Chrome profile's local storage, never synced; in the Mac app, in `~/.browser-agent/config.json`, readable only by you. It is sent only to the provider it belongs to.
- **Page content** the agent reads, including screenshots, is sent to your chosen provider so the model can act on it. With Ollama, it stays on your computer.
- **Nothing is sent to us.** There is no Browser Agent server, account, or analytics.
- **Stored on your device:** saved sessions (without screenshots), and in the Mac app an activity log of tasks, actions, and safety decisions. Delete them in Settings > Data and privacy.
- **The Mac app** keeps its data, including its own Chrome profile, in `~/.browser-agent`.

## FAQ

**What does it cost?**
Browser Agent is free. Your provider bills you for what the agent uses, at its normal API rates. Local models through Ollama have no API cost. The usage limits above keep a runaway task from spending much.

**Which models can I use?**
Any model your key can use at Anthropic, OpenAI, Google Gemini, or Mistral, or a local model through Ollama. Settings > Models can load the list for your key. For best results, pick a model that supports tool use and can read images. In the Mac app, the OpenAI option also takes a base URL for OpenAI-compatible servers such as LM Studio, vLLM, or OpenRouter. The Chrome extension can only reach the four providers above and servers on your own computer, so hosted services such as OpenRouter work only in the Mac app.

**Why does it pause, or say it is rate limited?**
Either you hit one of your own limits, or your provider asked it to slow down. It waits and continues. Raise the limits in Settings if they are too tight for you.

**Why does the Mac app use a separate Chrome profile?**
So the agent works in its own window with its own cookies and sign-ins, apart from your everyday browsing. Sign in there only to the sites you want the agent to use. The extension, by contrast, works in your normal profile, in its own tabs.

**Can it make mistakes?**
Yes. Watch important tasks, keep Guarded mode on, and use Stop if it goes the wrong way.

## For developers

```sh
npm run check              # syntax check and offline agent checks
npm run build:extension    # builds dist/extension and dist/browser-agent-extension.zip
browser-agent serve        # runs the Mac app's server in the foreground
```

Layout:

- `src/` the agent, browser tools, safety checks (`guard.js`), limits, providers, MCP, and Discord bridge, shared by both editions
- `ui/` the panel, settings, setup, and MCP screens
- `extension/` extension-only parts: storage and the Chrome debugger transport
- `bin/` the Mac app's command line: `browser-agent status`, `stop`, `logs`, `activity`
- `native/` the macOS helper for mouse and keyboard control, compiled on first use
- `scripts/` the installer, the extension build, and the offline checks

Test on a throwaway profile, not your real one:

- **Mac app:** set `BROWSER_AGENT_HOME` to a scratch folder, for example `BROWSER_AGENT_HOME=/tmp/ba-test browser-agent serve`. Settings, sessions, and the agent's Chrome profile all go there.
- **Extension:** load `dist/extension` into a separate Chrome profile, and use a key with a low spending limit.

The extension build is not minified, so Chrome Web Store reviewers can read it. Raise `version` in `package.json` before each store upload.
