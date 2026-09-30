# Browsby Privacy Policy

Effective date: [EFFECTIVE DATE]

Browsby is a Chrome extension that does tasks in your browser tabs using an AI provider you choose and your own API key. It is published by [PUBLISHER NAME], an individual developer (called "I" or "me" in this policy).

The short version: Browsby has no server, no account, and no analytics. I do not receive, see, store, or sell your data. Your data stays in your Chrome profile, except what Browsby sends, at your direction, to the AI provider you picked and to Microsoft or Discord if you connect them.

## 1. What Browsby handles and where it goes

### Your API keys and tokens

- **What:** the API key you paste for Anthropic, OpenAI, Google Gemini, or Mistral. If you connect them, a Discord bot token, and the Microsoft sign-in tokens for Outlook.
- **Where it is stored:** in this Chrome profile's local extension storage (`chrome.storage.local`) on your computer. It is not synced to your Google account or other devices.
- **Where it goes:** each API key is sent only to the provider it belongs to, as part of requests to that provider. The Discord bot token is sent only to Discord. Microsoft tokens are sent only to Microsoft. Keys and tokens are never shown to the AI model.
- **One exception you control:** in the OpenAI settings you can enter a custom base URL for an OpenAI-compatible server (such as LM Studio on your own computer). If you do, the OpenAI key you saved and your requests go to that address instead of OpenAI. Only enter an address you trust.

### Your tasks and the pages the agent works on

To do a task, the AI model has to see what you asked and what is on the page. When you run a task, Browsby sends the following to the AI provider you selected:

- what you type (your requests), your standing instructions from Settings > General, and the setting that confirms simple age prompts if you turned it on;
- the title and address of the current tab, and, when the agent lists tabs, the titles and addresses of the tabs in that browser window;
- content of the pages the agent reads: page text, the page's structure (buttons, links, form fields), and screenshots of the tab;
- what the agent types or selects on your behalf, including anything you give it to type;
- results of the agent's tools, such as network request details of a tab it is working in, and, if you turn on developer tools, results of scripts it runs in the page;
- for Outlook, the mail and calendar content it reads (see below).

Pages can contain personal information, for example your email, account details, or messages shown on screen. Whatever is on a page the agent reads can be sent to your provider.

The safety check (Guarded modes, the default) uses a model at the same provider, with the same key. It receives your requests, the current page's title and address, the proposed action, and the content the agent reads, including screenshots.

If you turn on "Let the model search the web" (Anthropic and OpenAI), your provider runs searches for the model, using its own search service.

AI provider SDKs also send standard technical details with each request, such as the SDK version and browser platform.

**With Ollama (a local model),** requests go to the Ollama address in Settings, by default `http://127.0.0.1:11434` on your own computer, so your task and page content do not leave your computer. If you change that address to another computer, the data goes there.

What each provider does with the data it receives is governed by that provider's own terms and privacy policy, not by me. Some providers retain API data for a period, and some free tiers may use it to improve their models. Check your provider's terms (links in section 3).

### Saved sessions

- **What:** your conversations with the agent: your requests, the agent's replies, and its tool calls and results (which can include page text, email text it read, and what it typed). Screenshots are never saved.
- **Where:** in this Chrome profile's IndexedDB on your computer. They are not sent anywhere.
- **Ghost mode:** when it is on, the session is not saved. It is always on in incognito windows.

### Settings and usage counter

- Your settings (provider, model choices, safety mode, limits, sensitive sites, approved sites, standing instructions) are stored in `chrome.storage.local` on your computer.
- A usage counter (today's date and the number of tokens used today) is stored locally to enforce your daily limit. It never leaves your computer.

### Outlook (optional)

If you connect Outlook, you sign in on Microsoft's own page. Browsby asks Microsoft Graph for these delegated permissions: `openid`, `profile`, `offline_access`, `User.Read`, `Mail.ReadWrite`, `Mail.Send`, and `Calendars.ReadWrite`. They let the agent read your profile name and address, search and read mail, save drafts and replies, send mail, and list or create calendar events, but only when a task calls for it.

- The sign-in tokens and your account name are stored in `chrome.storage.local` on your computer, not synced, and are never shown to the model.
- Mail and calendar content the agent reads (senders, subjects, previews, message bodies, event details) is sent to your AI provider as part of the task, like page content.
- Your time zone is sent to Microsoft when listing or creating events, so times are correct.
- Sign out in the Connections panel to delete the stored tokens. You can also remove Browsby's access in your Microsoft account settings.

### Discord remote control (optional)

If you set up remote control in Settings > Remote (Discord), Browsby connects to your own Discord bot while its panel is open. Through Discord:

- Browsby receives the tasks and approval answers you send from your paired Discord account.
- Browsby sends the pairing reply, approval prompts, the agent's final answers, error messages, and stop notices.
- Screenshots and full page contents are not sent. Approval prompts and final answers can still contain details from the task, for example a page address, a short excerpt of text the agent wants to type, or information the agent found for you.

Discord can read messages sent by bots. Discord's own privacy policy applies to these messages.

## 2. What Browsby never collects

- There is no Browsby server, account, or login.
- There is no analytics, telemetry, advertising, tracking, or crash reporting.
- I never receive your API keys, tasks, page content, screenshots, sessions, emails, or browsing history.
- I do not sell, rent, or share your data, and I do not use it for advertising, credit decisions, or any purpose other than running the features you use.

## 3. Third parties your data goes to, at your direction

Browsby sends data only to the services you choose and set up:

| Service | When | Privacy policy |
| --- | --- | --- |
| Anthropic | You use an Anthropic key | https://www.anthropic.com/legal/privacy |
| OpenAI | You use an OpenAI key | https://openai.com/policies/privacy-policy/ |
| Google (Gemini API) | You use a Gemini key | https://policies.google.com/privacy and https://ai.google.dev/gemini-api/terms |
| Mistral AI | You use a Mistral key | https://mistral.ai/terms |
| Ollama | You use a local model (runs on your computer) | https://ollama.com/privacy |
| Microsoft | You connect Outlook | https://privacy.microsoft.com/privacystatement |
| Discord | You set up remote control | https://discord.com/privacy |

The agent also visits the websites you ask it to use, in your browser, with your cookies and sign-ins, just as you would. Those websites see that visit under their own privacy policies.

## 4. Keeping and deleting your data

Data stays on your computer until you delete it:

- **Sessions:** delete one from the sessions menu, or all of them in Settings > Data and privacy > Delete all.
- **API keys:** remove each key in Settings > Models.
- **Outlook:** sign out in the Connections panel.
- **Discord:** remove the bot in Settings > Remote (Discord).
- **Everything:** uninstalling Browsby removes all of its local storage, including keys, tokens, settings, the usage counter, and sessions.

Data already sent to an AI provider, Microsoft, or Discord is kept according to that service's policy. Delete it with that service.

## 5. Chrome Web Store Limited Use

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

Browsby uses the data it handles only to provide its single purpose: doing the browser tasks you ask for. Data is transferred to third parties only as described above, when you direct it, to provide that purpose. It is not used or transferred for advertising, sold to data brokers, or used to determine credit-worthiness or for lending. I never see it.

## 6. Security

- Keys and tokens stay in local extension storage, are not synced, and are not shown to the model or the page.
- Requests to cloud providers, Microsoft, and Discord use HTTPS. Requests to a local model on your own computer use plain HTTP on that computer.
- Outlook sign-in uses the authorization code flow with PKCE, and no client secret is stored in the extension.
- The extension ships all of its code in the package and loads no code from the internet.

No system is perfectly secure. Anyone with access to your computer and Chrome profile may be able to read the locally stored data. Use a key with a spending limit, and keep your computer and Chrome profile protected.

## 7. Children

Browsby is not directed to children. Do not use it if you are under 13, or under the minimum age your AI provider's terms require (many require 18, or parental permission). I do not knowingly receive data from anyone, including children.

## 8. Your rights

Because I do not collect or hold your personal data, there is nothing for me to access, correct, export, or delete: it is on your computer, and you control it with the steps in section 4. For data held by an AI provider, Microsoft, or Discord, contact that service. If you have a question about this policy, write to me (section 10).

## 9. Changes to this policy

If Browsby starts handling data differently, I will update this policy and its effective date before or when the change ships, and describe material changes in the release notes. If a change would use data in a new way, the extension will ask for your consent first.

## 10. Contact

[PUBLISHER NAME]
Email: [CONTACT EMAIL]
Source code: https://github.com/Diegoregalado0/browser-agent-app
