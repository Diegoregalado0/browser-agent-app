# Browser Agent

Version 1.0.0

A browser that runs your own AI browsing agent.

Open the side panel, say what you want done, and the agent does it in your tabs: it opens
pages, clicks, types, fills in forms, and tells you when it is finished. It works with your
own API key from Anthropic, OpenAI, Google Gemini, or Mistral, or with a local model through
Ollama. There is no account and no server in between.

## Install

### Chrome extension (Mac, Windows, Linux)

1. Get the code and build the extension (needs [Node.js](https://nodejs.org) 22 or newer):

   ```sh
   git clone https://github.com/Diegoregalado0/browser-agent-app.git
   cd browser-agent-app
   npm install
   npm run build:extension
   ```

2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click
   **Load unpacked**, and select the `dist/extension` folder.
3. Click the Browser Agent icon in the toolbar (or press Cmd+Shift+Y, Ctrl+Shift+Y on
   Windows and Linux) and add your API key when asked.

### Mac app

Runs the agent in its own Chrome window with a separate profile, and can also use the mouse
and keyboard outside the page (menus, dialogs, other apps).

Needs Node.js 22 or newer and Google Chrome in /Applications. Using the mouse and keyboard
outside the page also needs Apple's command line tools (`xcode-select --install`) and, on
first use, Accessibility and Screen Recording permission for Browser Agent in System
Settings > Privacy & Security.

```sh
git clone https://github.com/Diegoregalado0/browser-agent-app.git
cd browser-agent-app
npm install
./scripts/install.sh
```

Then open **Browser Agent** from Spotlight. Add your API key in the menu under Models.

## Use it

- Type a task, for example "find a well-reviewed lasagna recipe and open it" or "check my
  email for the verification code and enter it here". Press Enter.
- The agent works in its own tabs and marks the one it is using with an "Agent" tab group.
  It never takes over tabs you opened.
- **Show the agent's actions** (Menu > Browser, off by default): a pointer glides to each
  button, link, and field before the agent clicks, and typing appears one character at a
  time, so you can follow along.
- **Menu** (top right): settings on top, your past sessions below. Reopen a session to pick
  up where you left off.
- **Ghost mode** (the ghost button): the session is not saved. It is always on in incognito
  windows.
- Press **Stop** at any time.

## Your API key

The key stays on your computer and is sent only to the provider it belongs to. That provider
bills you for what the agent uses. To keep costs in check, the agent has limits you can
change in Settings: 20 model requests and 60 browser actions per minute, 2 million tokens per
task, and 10 million per day.

## Safety

- By default a small model checks each action against what you asked for and watches pages
  for text that tries to take over the agent. If something looks wrong, it asks you.
- On banks, payment sites, password managers, and account security pages, it always asks
  before clicking or typing. It never types into a password field without asking.
- The extension can only open regular web pages.

## Publish to the Chrome Web Store

1. Build the package: `npm run build:extension` creates `dist/browser-agent-extension.zip`.
   Raise `version` in `package.json` for every update.
2. Register at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   (one-time US$5 fee), and verify your contact email.
3. Click **Add new item** and upload the zip.
4. **Store listing**: name, description, category, the 128 px icon, and at least one
   1280x800 screenshot.
5. **Privacy**: state the single purpose ("an AI agent that carries out tasks in the user's
   tabs with their own API key"), explain each permission (`debugger`, `tabs`, `tabGroups`,
   `sidePanel`, `storage`, and the provider API hosts), declare that page content is sent only
   to the provider the user chooses, and link a privacy policy.
6. **Distribution**: free, and public or unlisted.
7. **Test instructions**: reviewers need a key to try it. Give them a key with a low spending
   limit, or explain that they should paste their own.
8. Click **Submit for review**. Extensions that use `debugger` get a closer review, so
   expect it to take longer. You can choose to publish manually after approval (within 30
   days).

## For developers

```sh
npm run check              # syntax check
npm run build:extension    # build dist/extension and the store zip
browser-agent serve        # run the Mac app's server in the foreground
```

The Mac app and the extension share the same agent, tools, and interface. `src/` holds the
agent, `extension/` the extension-specific parts, `ui/` the panel, and `bin/` the Mac app's
command line (`browser-agent status`, `stop`, `logs`, `activity`). Set `BROWSER_AGENT_HOME`
to keep test data out of your real profile.
