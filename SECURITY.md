# Security policy

Browsby is a Chrome extension that operates web pages for you, holds your AI provider API keys, and can connect to Outlook and Discord. Security reports are welcome and taken seriously.

## Reporting a vulnerability

Please report privately. Do not open a public issue, pull request, or discussion for a security problem.

- Preferred: GitHub's private vulnerability reporting. Go to the repository's **Security** tab and click **Report a vulnerability**.
- Or email [SECURITY CONTACT EMAIL].

Please include:

- what the problem is and what an attacker could do with it;
- steps to reproduce, or a proof of concept (a test page, a prompt, or a short script);
- the Browsby version (in `chrome://extensions`) and Chrome version;
- your provider and safety mode, if they matter.

Do not include real API keys, tokens, passwords, or other people's data in a report.

## In scope

- Leaks of API keys, the Discord bot token, or Outlook tokens to a web page, the AI model, the UI, logs, or any address other than the service they belong to.
- Prompt injection that gets the agent to take a state-changing action without the prompt Browsby should show in Guarded mode, or to act on a sensitive site or type into a password field without asking.
- Ways a web page can reach the side panel, the extension's storage, or the debugger session, or make the agent act outside the tabs of its own window.
- The Discord remote accepting tasks or approvals from anyone other than the paired account, or approving a sensitive-site or password prompt from Discord.
- Flaws in the Outlook sign-in (PKCE, state checks, token storage).
- Any code loaded from outside the extension package.

## Out of scope

- The model making a wrong choice on an ordinary page, without a way to bypass a safety check.
- Anything that needs Auto mode, which turns safety checks off by design, except the sensitive-site and password-field prompts, which are in scope in every mode.
- Behavior of the AI providers, Microsoft, Discord, Chrome, or websites themselves. Report those to their owners.
- Attacks that need prior control of the user's computer or Chrome profile.
- The development sandbox (`bin/`, `scripts/install.sh`, the test Chrome launcher), unless the issue affects the published extension.

## What to expect

Browsby is maintained by one person, so these are goals, not guarantees:

- A reply acknowledging your report within [ACKNOWLEDGE WITHIN, e.g. 7 days].
- An assessment and, for a confirmed issue, a plan and a rough timeline.
- A fix released in a new version of the extension, then a public advisory on GitHub. You will be credited if you want to be.

Please give reasonable time to fix an issue before disclosing it publicly. Good-faith research that follows this policy, uses only your own accounts and keys, and does not harm other people's data will not lead to any complaint from me.

## Supported versions

Only the latest version published in the Chrome Web Store, and the `main` branch, receive security fixes.
