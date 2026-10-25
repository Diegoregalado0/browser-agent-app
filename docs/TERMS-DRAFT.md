# Browsby Terms of Use (draft)

> **Draft for review, not yet in effect.** Written 2026-10-25 to replace legal/TERMS.md once
> reviewed. It is not legal advice; have a lawyer check it before it is published. Open
> decisions are listed in "Review notes" at the end, which is not part of the terms.

Effective date: [EFFECTIVE DATE]

These terms apply to your use of Browsby: the Chrome extension, its settings and features,
and, if I have given you an access key, the Browsby GPU server (section 6). Browsby is
published by [PUBLISHER NAME] (called "I" or "me" here). By installing or using Browsby, you
agree to these terms and to the Privacy Policy. If you do not agree, do not use it.

## 1. What Browsby is

Browsby is a browser agent. You describe a task, and an AI model operates web pages in your
Chrome browser to do it: it opens pages, reads them, clicks, types, fills in forms, and can
use connected services such as Outlook and a Discord bot you set up. The model is one you
choose: through your own account with an AI provider, a model running on your own computer
or server, or, by invitation, the Browsby GPU server.

## 2. Who can use Browsby

You must be at least 18 years old, or the age of majority where you live if that is higher,
and able to agree to these terms. If you use Browsby for an organization, you confirm that
you may accept these terms for it, and "you" includes that organization.

## 3. The agent acts with your access

The agent works in your browser, with your cookies, sign-ins, and accounts. What it does, it
does as you.

- **You are responsible for what the agent does on your behalf**, including messages it
  sends, forms it submits, purchases, bookings, posts, deletions, and changes to accounts,
  whether you approved each step or let it proceed under the safety mode you chose.
- **AI models make mistakes.** The agent can misread a page, click the wrong thing, enter
  wrong information, report that a task worked when it did not, or be misled by text that a
  website or message places in front of it (prompt injection). The safety checks, prompts
  and limits in Browsby reduce these risks; they do not remove them. Auto mode turns most
  checks off.
- **Stay in control of what matters.** Watch important tasks, keep a guarded safety mode on,
  read what the agent asks you to approve before you approve it, and press Stop if it goes
  the wrong way. Do not give the agent a task you would not be willing to have done wrongly,
  or to undo yourself.
- **Money and irreversible actions.** Check the item, amount, recipient and account before
  you approve a payment, purchase, transfer, or anything that cannot be undone. You are
  responsible for charges and commitments the agent makes for you.
- **Passwords, codes and payment details.** Browsby is built never to ask you for a password,
  sign-in code, or payment details, to ask you to sign in yourself when a site needs it, and to
  ask before it enters passwords or payment details you did not explicitly ask it to enter.
  Anything you put in a task can reach the model you use: avoid putting passwords, codes, or
  card numbers in tasks.

## 4. What the agent tells you

Answers, summaries, figures and drafts the agent produces can be wrong, incomplete, or out of
date. They are not professional advice of any kind (legal, medical, financial, tax, or
other). Check anything important against its source before you rely on it, and do not use
Browsby as the only basis for decisions about people's health, safety, employment, credit,
housing, education, or legal rights.

## 5. Your AI provider, your costs

- With a provider (Anthropic, OpenAI, Google, Mistral, or another service you configure), you
  need your own account and API key. You pay your provider directly for everything the agent
  and its safety checks use, at the provider's rates, including web searches the provider
  bills for. Browsby's usage limits help contain costs but are not a spending cap. Set a
  spending limit with your provider.
- Your use of each provider is governed by that provider's terms and usage policies, which
  you are responsible for following.
- With a local model (Ollama or another server on your own computer or network), you are
  responsible for that model, its license, and the machine it runs on.

## 6. The Browsby GPU server

I run a GPU server that offers Browsby models (currently Zigger 1.0) to people I give an
access key to. It is a free, best-effort service that I offer at my discretion.

- **Your key is personal.** Keep it secret, do not share, publish, sell, or lend it, and tell
  me if you think someone else has it. You are responsible for use made with your key.
- **Limits.** Each key has limits, which I can change at any time. By default: one request at
  a time, 30 requests a minute, and 2,000,000 tokens a day. Do not try to get around them,
  for example by using several keys.
- **No guarantee of availability.** The server can be slow, paused, or offline at any time,
  including while I use the machine myself, for maintenance, or because of my internet or
  power. I can change, add, or remove models, change or end the service, and change or revoke
  any key, at any time and without notice. Keys can expire.
- **Only for Browsby.** Use the server only through Browsby and only for tasks these terms
  allow. Do not probe, scan, load-test, or try to reach anything other than what your key
  opens, and do not use it to generate content in bulk or to build a competing service.
- **What the server handles.** To answer a request, the server receives what Browsby sends
  to a model: your request, the page content the agent read, and screenshots. Traffic passes
  through Cloudflare, which carries it to the server. I do not keep the content of requests
  after they are answered. For security, abuse prevention and capacity, the server records,
  for each request, the key's name, your IP address, the model, the result status, the
  number of tokens, and the time taken; and, per key and day, the number of requests and
  tokens, kept for 31 days. Repeated wrong keys from one address block that address for 30
  minutes. The Privacy Policy describes this in full.
- **Models.** The models on the server are third-party open models with their own licenses
  (for example, Zigger 1.0 is based on Qwen3.6-35B-A3B by Alibaba Cloud, Apache License 2.0).
  Their output is subject to section 4.
- I can suspend or revoke a key at once if I believe it is being misused, shared, or used in
  breach of these terms, or to protect the server or other users.

## 7. Websites and other services

- When the agent uses a website, Outlook (Microsoft), Discord, or any other service for you,
  that service's terms apply to you. Many websites limit or prohibit automated access, bots,
  scraping, or bulk actions. It is your responsibility to check and follow the rules of the
  sites and services you ask the agent to use.
- **No circumvention.** Do not use Browsby to solve, bypass, or evade CAPTCHAs, bot checks,
  rate limits, paywalls, sign-in requirements, or other access or anti-automation controls,
  and do not modify it or direct it to disguise automated activity as a person's. When a site
  presents a check, Browsby is built to stop and hand the task back to you.
- Websites can block, limit, or suspend accounts that they find automated. That risk is
  yours; I cannot prevent or reverse it.
- I am not responsible for third-party websites or services, their content, their
  availability, their decisions about your account, or what they do with your data.

## 8. Acceptable use

You agree not to use Browsby, or the GPU server, to:

- break any law or regulation, or infringe anyone's rights, including privacy, publicity, and
  intellectual property rights;
- access accounts, systems, or data you are not authorized to access, or get around security
  or access controls;
- send spam or unsolicited bulk messages, post automated content where it is not allowed,
  create accounts in bulk, or manipulate reviews, ratings, votes, polls, or rankings;
- buy up limited goods or tickets in bulk, or otherwise use automation to get an unfair
  advantage over people where the seller does not allow it;
- collect, scrape, or compile personal data about other people without a lawful basis, or
  scrape non-public data in bulk;
- commit fraud, impersonate anyone, or mislead people about who is acting or that a message
  was written by an AI agent where that matters;
- harass, threaten, exploit, or harm anyone, including minors;
- create or spread malware, or attack, interfere with, or overload any website, service, or
  the GPU server;
- violate export control or sanctions laws.

## 9. Your content and data

- Your tasks, settings, notes, and saved sessions are yours. Browsby stores them in your
  browser on your computer; Ghost mode does not save the session. What reaches your AI
  provider, local model, or the GPU server is described in the Privacy Policy.
- If you send me feedback or suggestions, I may use them without any obligation to you.

## 10. The software

- Browsby is provided for your personal use under these terms. Its source code is published
  at https://github.com/Diegoregalado0/browser-agent-app so it can be read, but all rights are
  reserved: the LICENSE file in the repository grants no right to copy, modify, or
  redistribute it. Third-party components in Browsby are licensed under their own terms,
  listed in THIRD_PARTY_NOTICES.txt in the extension package.
- Do not remove notices from Browsby, present it as your own, or offer it to others as a
  service.

## 11. No affiliation, trademarks

Browsby is an independent project. It is not affiliated with, endorsed by, or sponsored by
Anthropic, OpenAI, Google, Microsoft, Discord, Mistral AI, Ollama, Alibaba Cloud, Cloudflare,
or any website the agent visits. Their names and marks belong to their owners and are used
only to describe what Browsby works with.

## 12. Provided as is, with no warranty

Browsby and the GPU server are free and provided "as is" and "as available", without
warranties of any kind, express or implied, including warranties of merchantability, fitness
for a particular purpose, title, accuracy, and non-infringement. I do not warrant that they
will be error-free, uninterrupted, secure, or available, that the agent's actions or answers
will be correct, or that its safety features will catch every mistake or attack. Features
that depend on AI providers, models, websites, Microsoft, Discord, Cloudflare, or Chrome can
stop working when those change.

## 13. Limitation of liability

To the fullest extent the law allows:

- I am not liable for any indirect, incidental, special, consequential, exemplary, or
  punitive damages, or for any loss of data, money, profits, goodwill, or accounts, arising
  from or related to Browsby or the GPU server, including actions the agent takes or fails to
  take, charges from your AI provider, purchases or commitments made for you, decisions or
  sanctions by third-party websites or services (such as a blocked or suspended account), and
  the server being unavailable, slow, or changed;
- my total liability for all claims related to Browsby and the GPU server, taken together, is
  limited to [CAP: USD $50].

These limits apply whatever the legal theory (contract, tort including negligence, or
otherwise), even if I was told the damage was possible. Some places do not allow some of these
exclusions or limits, for example for death or personal injury caused by negligence, or for
fraud. There, they apply only as far as the law allows, and nothing in these terms limits
rights you have as a consumer that cannot be waived.

## 14. Indemnity

To the extent the law allows, you agree to cover any claims, losses, and costs (including
reasonable legal fees) brought against me by others that arise from your use of Browsby or the
GPU server in breach of these terms or of the law, from the terms of a website or service you
had the agent use, or from actions the agent took on your behalf.

## 15. Ending use

You can stop using Browsby at any time by uninstalling it. I may stop offering, change, or
remove Browsby or the GPU server, or remove Browsby from the Chrome Web Store, at any time.
I may end or suspend your access to the GPU server if you breach these terms. Sections 3, 4,
7, 10 to 14, 17 and 18 continue to apply after you stop using Browsby.

## 16. Changes to these terms

I may update these terms. I will change the effective date above and describe material
changes in the release notes, and in Browsby where practical. If you keep using Browsby after
a change, the new terms apply. If you do not agree, stop using it and uninstall it.

## 17. Disputes and governing law

These terms are governed by the laws of the State of California, United States, excluding its
conflict-of-law rules. Before bringing a claim, contact me (section 19) and give me 30 days to
try to resolve it informally. Disputes will be handled in the state and federal courts located
in California, or in small claims court where it applies, unless the law of the place where
you live gives you the right to bring a claim there. Consumer protections that the law of the
place where you live makes mandatory still apply to you.

## 18. General

- These terms and the Privacy Policy are the whole agreement between you and me about
  Browsby, and replace any earlier version.
- If a part of these terms cannot be enforced, the rest still applies, and that part is
  enforced as far as the law allows.
- If I do not enforce a part of these terms, I have not given up the right to enforce it
  later.
- You may not transfer your rights under these terms, including a GPU server key, to anyone.
  I may transfer mine to whoever takes over Browsby.
- I am not responsible for delays or failures caused by events outside my reasonable control,
  such as outages of providers, networks, power, or Cloudflare.
- These terms are written in English; a translation, if any, is for convenience only.

## 19. Contact

[PUBLISHER NAME]
Email: [CONTACT EMAIL]

---

## Review notes (not part of the terms)

Decisions and checks before this replaces legal/TERMS.md:

1. **Liability cap.** The current terms cap liability at USD $0. A zero cap is more likely to
   be refused by a court or consumer authority than a small one; this draft uses a placeholder
   of USD $50 (HoloTab's terms use EUR 100 a year). Pick the amount with the lawyer.
2. **Publisher.** As an individual, the publisher is personally exposed. Ask the lawyer whether
   to publish through an LLC, and fill [PUBLISHER NAME] accordingly (also in LICENSE, README,
   PRIVACY, SECURITY).
3. **Privacy Policy is out of date for the GPU server.** legal/PRIVACY.md and the in-app
   disclosure (legal/IN-APP.md: "Nothing is sent to us") predate the GPU server. Section 6
   here states what the server receives and records (verified against ~/browsby/public.py on
   2026-10-25: per-request log line with key name, Cloudflare client IP, model, status, tokens,
   duration; per-key daily counts kept 31 days). The policy needs the same, plus Cloudflare as
   a processor and how long the system journal keeps those lines (no limit is configured in
   journald.conf today, only its default size cap; set a retention such as 30 days).
4. **Age.** Draft requires 18+, which suits an agent that can make purchases and act in
   accounts. The current terms set no age.
5. **Arbitration and class-action waiver.** Not included. Common in US consumer terms but
   unenforceable in some places and heavy for a free project; decide with the lawyer.
6. **Sensitive sites.** Browsby allows banking and similar sites behind its safety checks,
   where HoloTab switches itself off on 150+ such domains. Sections 3 and 7 put the
   responsibility on the user; confirm that is the product decision.
7. **Human-like input.** Internal builds include a human-like mouse option (src/human-input.js),
   excluded from the store build. Section 7 forbids disguising automation; keep that option out
   of every build given to users, or this section and that feature conflict.
8. **GPU limits and models** in section 6 match the server defaults on 2026-10-25
   (DEFAULT_LIMITS in public.py, catalog with Zigger 1.0 only). Update the text if they change,
   or move the numbers to a page the terms link to.
9. Publish by moving this file to legal/TERMS.md (the published path) and filling the
   placeholders; docs/ is excluded from GitHub Pages.
