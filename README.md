# Browsby

Say what you want done, and Browsby does it in your own Chrome tabs. It opens pages, clicks, types, fills in forms, and tells you when it is finished.

It runs on your own AI key, with the provider you choose, and nothing is sent through us.

## Why it is different

- **Your key, your provider.** Use a key from Anthropic, OpenAI, Google Gemini, or Mistral, or run a local model with Ollama. The key stays on your computer and is sent only to that provider, which bills you directly.
- **No account, no middleman.** There is no Browsby account and no Browsby server. Your tasks, pages, and history never pass through us.
- **Keep Chrome.** It is an extension in the Chrome you already have. It works in its own tabs, next to yours, in a side panel.
- **It asks before it matters.** A safety check compares each action with what you asked for. On banks, payment sites, password managers, and password fields, it always asks first. You can press Stop at any time.

## What you can ask it

- "Find a well-reviewed lasagna recipe and open it."
- "Compare the price of AirPods Pro at three stores."
- "Check my email for the verification code and enter it here."
- "Play the latest episode of this show on YouTube."

It aims for the end result, not a list of links. If you ask for a video, it opens it and checks that it is playing. If a choice is low stakes, it picks one and tells you which. If a wrong choice would be costly, it asks.

## Install

Browsby is a Chrome extension for Mac, Windows, and Linux. It needs Chrome 120 or newer. Until it is in the Chrome Web Store, build it from source with [Node.js](https://nodejs.org) 22 or newer:

```sh
git clone https://github.com/Diegoregalado0/browser-agent-app.git
cd browser-agent-app
npm install
npm run build:extension
```

1. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist/extension` folder.
3. Click the Browsby icon in the toolbar, or press Cmd+Shift+Y (Ctrl+Shift+Y on Windows and Linux).

It works in regular web pages, not in Chrome's own pages.

## First run

A short setup opens the first time:

1. **Provider.** Pick the provider you have a key for, or a local model.
2. **Key.** Paste your key (there is a link to the provider's key page), and the setup tests the connection. With a local model, no key is needed.
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

### Developer tools

When turned on, the agent can run JavaScript in a page and edit its HTML, which helps with debugging pages. Code runs with your signed-in access to the page. It is off by default; turn it on in Settings > Permissions and safety.

## Privacy and security

- **Your key** is stored in this Chrome profile's local storage on your computer, never synced, and sent only to the provider it belongs to.
- **Page content** the agent reads, including screenshots, is sent to your chosen provider so the model can act on it. With Ollama, it stays on your computer.
- **Nothing is sent to us.** There is no Browsby server, account, or analytics.
- **Stored on your device:** saved sessions, without screenshots. Delete them in Settings > Data and privacy.

## FAQ

**What does it cost?**
Browsby is free. Your provider bills you for what the agent uses, at its normal API rates. Local models through Ollama have no API cost. The usage limits above keep a runaway task from spending much.

**Which models can I use?**
Any model your key can use at Anthropic, OpenAI, Google Gemini, or Mistral, or a local model through Ollama. Settings > Models can load the list for your key. For best results, pick a model that supports tool use and can read images. The OpenAI option also takes a base URL for OpenAI-compatible servers running on your own computer, such as LM Studio.

**Why does it pause, or say it is rate limited?**
Either you hit one of your own limits, or your provider asked it to slow down. It waits and continues. Raise the limits in Settings if they are too tight for you.

**Can it make mistakes?**
Yes. Watch important tasks, keep Guarded mode on, and use Stop if it goes the wrong way.

## For developers

```sh
npm run check              # syntax check and offline agent checks
npm run build:extension    # builds dist/extension and dist/browser-agent-extension.zip
```

Layout:

- `src/` the agent, browser tools, safety checks (`guard.js`), limits, and providers, shared with the test app
- `ui/` the panel, settings, and setup screens
- `extension/` the extension's own parts: storage, the Chrome debugger transport, and its entry point
- `scripts/` the extension build, the test app installer, and the offline checks

Test the extension in a separate Chrome profile, not your real one, with a key that has a low spending limit.

The extension build is not minified, so Chrome Web Store reviewers can read it. Raise `version` in `package.json` before each store upload.

### The Mac test app

The repo also contains a Mac app used only for development and testing. It is not a product and is not published. It runs the same agent from a local Node server and drives its own Chrome profile over the DevTools protocol, which makes it easy to script, inspect, and test.

- Install with `./scripts/install.sh` (needs Chrome in `/Applications`), or run `browser-agent serve` in the foreground. `bin/` has `browser-agent status`, `stop`, `logs`, and `activity`.
- Test on a throwaway profile: `BROWSER_AGENT_HOME=/tmp/ba-test browser-agent serve --port=7799 --no-open`. Settings, sessions, and its Chrome profile all go there.
- It has experimental features that the extension does not: MCP connections (Outlook and custom servers, `src/mcp.js`), Discord remote control (`src/remote-discord.js`), an activity log, and mouse and keyboard control outside the page (`native/`, which needs Apple's command line tools and Accessibility and Screen Recording permission).
