# Chrome Web Store submission notes

Working notes for the Browsby listing in the Chrome Web Store Developer Dashboard. Everything here matches the manifest built by `scripts/build-extension.js` and the code as of this commit. If the manifest changes, update the permission list below.

## Before you submit

1. **Privacy policy URL** must be public before you submit. The policy pages are prepared for GitHub Pages from `main` (see "Privacy policy URL" below); fill in the placeholders in `legal/`, then turn Pages on.
2. **Outlook.** `OUTLOOK_CLIENT_ID` in `src/outlook-graph.js` is empty, so the build requests neither `identity` nor the Microsoft hosts, and the Outlook card says it is not available. If you set the client ID before submitting, the build adds `identity`, `https://login.microsoftonline.com/*`, and `https://graph.microsoft.com/*` back, and you need justifications for them.

## Single purpose

Paste into Privacy practices > Single purpose:

> Browsby is a browser agent: the user describes a task in the side panel, and an AI model the user chooses (with the user's own API key, or a local model) carries it out in the user's Chrome tabs by opening pages, reading them, clicking, and typing, asking the user before sensitive actions.

Every feature serves that purpose: the side panel is where tasks are given, the debugger operates the pages, the provider hosts run the model, and Outlook and Discord are optional places the same agent can act or take tasks from.

## Permission justifications

The manifest requests these permissions (with `OUTLOOK_CLIENT_ID` empty, as it is now). There are no optional permissions and no content scripts.

### `debugger`

> Browsby is a browser agent that operates web pages for the user. It attaches the Chrome debugger only to tabs in the side panel's own window, and only while a task the user started is running, to: capture screenshots of the tab so the model can see the page (Page.captureScreenshot); read the page's text and structure (Runtime.evaluate with scripts packaged in the extension); click, scroll, and type as the user asked (Input.dispatchMouseEvent, Input.dispatchKeyEvent, Input.insertText); navigate (Page.navigate); and list the tab's recent network requests when the model needs to diagnose a page that fails to load (Network domain). Chrome shows its debugging banner on those tabs while attached, and closing the banner stops the task. Browsby detaches when the task ends or the panel closes. It cannot attach to chrome:// pages or the Chrome Web Store. The scripting and activeTab APIs cannot deliver trusted mouse and keyboard input or screenshots of background tabs, which the agent needs to use real websites.

### `sidePanel`

> The agent's interface (task input, progress, approval prompts, settings) is a side panel next to the user's tabs, opened from the toolbar button or Ctrl/Cmd+Shift+Y.

### `tabs`

> The agent opens its own tabs for a task, switches between them, reads their title and address to know where it is, and closes tabs it opened. It only works with tabs in the side panel's window.

### `tabGroups`

> Tabs the agent is working in are placed in a tab group labeled "Agent", so the user can see which tabs the agent controls.

### `storage`

> Stores the user's settings, their AI provider API keys, the optional Discord bot token and Outlook sign-in, and a local daily usage counter, in chrome.storage.local on the user's computer (never synced). Saved conversations are kept in IndexedDB on the device.

### Host permissions

> - `https://api.anthropic.com/*`, `https://api.openai.com/*`, `https://generativelanguage.googleapis.com/*`, `https://api.mistral.ai/*`: the AI provider APIs that run the agent's model with the user's own API key. Only the provider the user selects is contacted.
> - `http://127.0.0.1/*`, `http://localhost/*`: a local model server on the user's own computer (Ollama, or an OpenAI-compatible server such as LM Studio).
> - `https://discord.com/*`: the optional Discord remote control, where the user's own bot receives tasks and sends approval prompts and results to the user.
>
> The agent does not need host permissions for the websites it operates: it reaches them through the debugger on tabs the user's task opens.

## Remote code

Answer: **No, I am not using remote code.**

Checked in this repo:

- All JavaScript is bundled by esbuild into the package (`sidepanel.js`, `background.js`, `chunks/`). Provider SDKs are bundled, not loaded from a CDN.
- The CSP is `script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`, which blocks remote scripts and `eval` in extension pages.
- The built bundle has no `eval(`, no `new Function(`, and no `import()` of an http(s) address.
- Scripts the extension runs in pages (page reading, element lookup, form filling) are functions in `src/page-scripts.js` and `src/browser-tools.js`, shipped in the package.
- The model cannot send code to run: there is no tool that evaluates model-written JavaScript or HTML, and navigation accepts only http(s) addresses.
- The bundle is not minified, so reviewers can read it. License notices for the bundled npm packages are in `THIRD_PARTY_NOTICES.txt` in the package.

## Privacy practices tab

### Data usage: what to check

The dashboard asks what user data the extension "collects", which includes data it transmits off the device. Browsby transmits data only to the services the user sets up, so declare these (conservative reading, which is safer for review):

| Category | Declare | Why |
| --- | --- | --- |
| Personally identifiable information | Yes | Pages, emails, and calendar events the agent reads can contain names, addresses, email addresses; sent to the user's AI provider. Outlook account name is read from Microsoft. |
| Health information | No | Not a feature; only incidentally on pages. |
| Financial and payment information | No, unless you want to be extra careful | The agent asks before acting on payment sites and does not handle card data as a feature. It could see such data on a page, which is covered by "Website content". |
| Authentication information | Yes | API keys, Discord bot token, Microsoft tokens are stored and sent to their own services. Passwords only if the user approves the agent typing into a password field. |
| Personal communications | Yes | Outlook mail (read and sent) and Discord messages when those are connected. |
| Location | No | No location access. The time zone is sent to Microsoft only for calendar times. |
| Web history | Yes | The current tab's title and address, and the titles and addresses of tabs in the window, are sent to the AI provider. |
| User activity | Yes | The network_requests tool records network activity of tabs the agent works in and can send it to the AI provider. The agent's own clicks and typing are sent as part of the task. |
| Website content | Yes | Page text, structure, and screenshots are sent to the AI provider. |

### Certifications (all three apply)

- I do not sell or transfer user data to third parties, outside of the approved use cases. (Transfers are to the AI provider, Microsoft, and Discord the user configured, to provide the single purpose.)
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL

https://diegoregalado0.github.io/browser-agent-app/legal/PRIVACY once GitHub Pages is on (Settings > Pages > Deploy from a branch > `main`, `/ (root)`). The Terms are at .../legal/TERMS. The policy contains the Limited Use statement the User Data Policy asks for.

## Common rejection reasons for agent and debugger extensions

| Reason | How Browsby addresses it | Still to do |
| --- | --- | --- |
| `debugger` without a clear, specific justification | Detailed justification above; attaches only to tabs in the panel's window during a user-started task; banner visible; detaches on stop or panel close | Show the debugger banner and Stop in the store screenshots or video |
| Unused permissions | Every permission maps to code; `identity` and the Microsoft hosts are requested only when Outlook is set up | None |
| Remote code | Everything bundled, strict CSP, no eval, no tool that runs model-written code | None |
| Listing does not match behavior or data use | README and privacy policy describe data flows | Mention in the description: sends page content and screenshots to your chosen AI provider; optional Outlook and Discord |
| Single purpose violations (bundled unrelated features) | Outlook and Discord are the same agent acting in other places | None |
| Missing or incomplete privacy policy | `legal/PRIVACY.md` covers each data type, third parties, deletion, Limited Use; linked from Settings > Data and privacy and the manifest's `homepage_url` | Turn on GitHub Pages and put the URL in the listing |
| Prominent disclosure and consent for personal data | Setup explains keys stay local; Settings explains where keys go | Add a one-line data disclosure to the first-run setup (text in `legal/IN-APP.md`) |
| Insecure handling of personal data | HTTPS to all cloud services; keys in local storage, not synced, not shown to the model | The OpenAI base URL and Ollama host settings accept any `http://` address, not only local ones; consider allowing plain HTTP only for localhost |
| Deceptive use of third-party names | Names used only to say which provider keys work | Do not use provider logos or "Claude"/"ChatGPT" in the name, icon, or title |
| Automating third-party sites against their terms (spam, CAPTCHA bypass) | The model is told not to solve CAPTCHAs and to ask before sending messages and posting; Terms forbid misuse | None |

## Reviewer notes (Test instructions field)

Suggested text:

> Browsby needs an AI provider API key to run tasks. The quickest way to test without a key is Ollama (https://ollama.com) with a vision-capable model on the same computer: choose "Ollama" in setup. With a key, choose the provider in setup and paste it. Open the side panel with the toolbar button, enter a task such as "Open the Wikipedia article about Chrome", and watch the agent open a tab in the "Agent" group, with Chrome's debugging banner shown while it works. Stop ends the task. Outlook and Discord are optional and not needed to review the core feature.

[OWNER: if you provide a test API key for reviewers, use a separate key with a low spending limit and revoke it after review.]
