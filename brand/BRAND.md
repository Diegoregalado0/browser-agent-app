# Duomo brand guide

## Name

- Write it **Duomo**: capital D, one word, never all caps in running text, never "DuoMo" or "the Duomo".
- Say "Duomo" for the product. When you need to say what it is, write "Duomo, a browser agent" or "the Duomo side panel".
- The command line tool and file paths can stay lowercase (`duomo`, `~/.duomo`).
- The name comes from Brunelleschi's dome in Florence: a structure built without scaffolding, by working out each step in order. That is how the agent works too. Say this sparingly, if at all; the mark carries it.

## Positioning

**One line:** Duomo is a browser agent that does tasks in your tabs for you, on your own AI key, with nothing sent to us.

Where it sits among agentic browsers (September 2026):

| Product | Form | Brand stance |
| --- | --- | --- |
| Perplexity Comet | Full browser, free | Search company's browser; distribution play |
| ChatGPT Atlas | Full browser (reported retired August 2026) | ChatGPT inside a browser |
| Opera Neon | Full browser, paid agent tier | "Agentic browser" with Chat, Do and Make agents |
| Dia (The Browser Company) | Full browser, macOS | Rethink the browser around AI |
| Claude for Chrome | Chrome extension, paid plans | One model vendor, inside the browser you already use |
| **Duomo** | Chrome extension plus a local Mac app | Any provider, your own key, no account with us, runs locally |

Most competitors ask you to switch browsers or to subscribe to one model vendor. Duomo's difference is plain: keep Chrome, bring your own key, choose your provider, and nothing goes through our servers. Brands in this space are mostly abstract (gradients, orbs, sparkles). A warm, architectural, hand-built mark stands apart from that.

**Taglines** (pick one per surface):

- Tell it the task. It does the browsing.
- Your browser, handled.
- Your key, your browser, your call.

## Voice

Plain, calm, trustworthy. Write like a careful colleague explaining what will happen.

- Say what it does and what it does not do. "The key stays on this device and is sent only to your provider."
- Short sentences. Everyday words. Product first, then detail.
- No hype: no "revolutionary", "supercharge", "magic", "10x", no exclamation marks.
- No em dashes; use a comma, a colon, or a new sentence.
- No emojis in product copy.
- When it asks for permission or stops, say why in one line.

## Palette

Taken from the reference photo of the dome at sunset: terracotta tiles, white marble ribs, sandstone drum, gilded ball, dusk sky.

### Brand colors (logo and marketing)

| Name | Hex | Role |
| --- | --- | --- |
| Terracotta | `#C8552B` | Primary brand color; the dome. Logo and large shapes only (4.38:1 on white, so not for body text) |
| Terracotta deep | `#7A2E15` | Logo outline |
| Marble | `#F7F3EC` | Ribs, lantern, light surfaces |
| Sandstone | `#D9C4A0` | Drum band, secondary warm neutral |
| Gold | `#D4A62A` | Lantern ball; tiny accents only, never text on light backgrounds |
| Dusk | `#2E4166` to `#172036` | App icon background gradient; dark surfaces |
| Ink | `#1E2433` | Text on light, logo details (oculus, lantern openings) |

### UI themes (proposal for `ui/style.css`)

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--bg` | `#F7F3EC` marble | `#151A24` dusk ink | Page background |
| `--fg` | `#1E2433` ink | `#EDE7DC` marble | Body text |
| `--muted` | `#6B6558` stone | `#A39B8C` stone | Secondary text |
| `--panel` | `#FFFFFF` | `#1E2431` | Cards, composer |
| `--border` | `#E4DBCC` | `#343C4D` | Dividers (decorative) |
| `--accent` | `#B8471F` terracotta, text-safe | `#E8876A` terracotta light | Buttons, links, focus ring |
| `--accent-fg` | `#FFFFFF` | `#1A1210` | Text on accent |
| `--user` | `#F4E4D9` | `#3A2B25` | User message bubble |
| `--error` | `#B3261E` | `#F2B8B5` | Error text (unchanged) |
| `--ok` | `#2E7D32` | `#81C784` | Idle/ok state (unchanged) |
| `--hover` | `rgba(30, 36, 51, 0.06)` | `rgba(255, 255, 255, 0.07)` | Hover wash |
| `--ghost-bg` | `#E3E8F1` | `#26334A` | Ghost mode chip (dusk blue replaces lavender) |
| `--ghost-fg` | `#3D5478` | `#B9C9E6` | Ghost mode chip text |
| `--danger` | `#B42318` | `#F28B7D` | Destructive actions |

### Contrast (WCAG 2.x, computed by `brand/contrast.py`)

AA needs 4.5:1 for normal text and 3:1 for large text and UI parts such as the focus ring.

| Pair | Light | Dark |
| --- | --- | --- |
| fg on bg | 14.01 | 14.16 |
| fg on panel | 15.49 | 12.62 |
| fg on user bubble | 12.50 | 10.99 |
| muted on bg | 5.23 | 6.33 |
| muted on panel | 5.79 | 5.64 |
| accent (links, focus ring) on bg | 4.80 | 6.73 |
| accent on panel | 5.30 | 6.00 |
| accent-fg on accent (buttons) | 5.30 | 7.12 |
| error on bg / panel | 5.91 / 6.54 | 10.21 / 9.10 |
| ok on bg / panel | 4.64 / 5.13 | 8.66 / 7.72 |
| danger on bg / panel | 5.94 / 6.57 | 7.27 / 6.48 |
| ghost-fg on ghost-bg | 6.24 | 7.59 |

All text pairs pass AA. `--border` is decorative (1.37 light, 1.41 dark, like the current theme's 1.3); do not use it as the only boundary of an input or control that needs 3:1, add a fill or use `--muted` for that edge.

Logo colors against common backgrounds: terracotta `#C8552B` is 4.38:1 on white, 3.67:1 on Chrome's dark toolbar `#202124`, 3.97:1 on `#151A24`, so the dome shape clears 3:1 for graphics everywhere. The deep outline keeps the marble parts visible on white.

## Logo

Files in `brand/`:

| File | Use |
| --- | --- |
| `logo-mark.svg` | Full color mark, transparent background. 24 px and up |
| `logo-mark-mono.svg` | One color, uses `currentColor`. Ribs, lantern openings and oculus are knocked out |
| `favicon-16.svg` | Simplified mark drawn on a 16 px grid: dome, two ribs, drum, lantern, ball. For 16 to 20 px |
| `app-icon.svg` | 128 x 128, dusk rounded square with 16 px transparent padding (Chrome Web Store spec: 96 px artwork in a 128 px canvas). Mac app and store icon |
| `logo-wordmark.svg` | Mark plus "Duomo" set in the system font stack (`-apple-system`, SF Pro Display, Segoe UI, Helvetica Neue, Arial), weight 600. The text is live text, not outlines, so it follows the platform font; convert to outlines in a vector editor before sending it to print |

Rendered PNGs are in `brand/png/` (16, 32, 48, 128, 512 for each mark, `app-icon-1024.png`, and the wordmark at 32 to 256 px tall).

The mark: the dome seen from the front, an octagonal terracotta shell with four marble ribs (two inner, two on the silhouette), a sandstone and marble drum with one round oculus, a white lantern with two openings, and a gold ball on top. The cross is left out on purpose.

### Clear space

Keep empty space around the mark equal to the lantern's height (from the dome's top to the top of the ball, about one fifth of the mark's height). For the wordmark, the same space on all sides.

### Minimum sizes

- Full color mark: 24 px tall on screen. Below that, use `favicon-16.svg`.
- App icon: 32 px. At 16 px use `favicon-16.svg` instead of the tile.
- Wordmark: 80 px wide.

### Do

- Use the full color mark on marble, white, Chrome gray, dusk, and near black backgrounds.
- Use the mono mark for single color contexts (menu bar templates, embossing, one color print), colored ink or marble.
- Keep the proportions and the gold ball.

### Don't

- Don't add a cross, a halo, or other religious symbols.
- Don't recolor the dome (no blue or green domes), add gradients to it, or add drop shadows.
- Don't stretch, rotate, or tilt it; the mark always faces forward.
- Don't place the full color mark on terracotta or orange backgrounds.
- Don't set "Duomo" in a decorative or script typeface.

## Chrome Web Store listing draft

**Name:** Duomo: browser agent

**Short description** (120 characters, limit 132):
Duomo does tasks in your browser tabs for you. Ask in plain words; it runs on your own AI key and nothing is sent to us.

**Long description, first lines:**

> Duomo is an AI agent that works in your browser tabs. Open the side panel, say what you want done, and it opens pages, clicks, types, fills in forms, and tells you when it is finished.
>
> It runs on the AI provider you choose, with your own API key. The key stays in your browser and is sent only to that provider, which bills you directly. There is no Duomo account and no Duomo server: your tasks, pages, and history never pass through us.
>
> A safety check reviews each action against your request and scans pages for instructions aimed at the agent. When something looks off, Duomo asks you before it continues, and it always asks on sensitive sites and password fields. You can stop it at any time.

**Store images:** 128 px icon from `png/app-icon-128.png`. Small promo tile 440 x 280 and marquee 1400 x 560: dusk background, the mark large and centered, no text (the store guidance asks for no text and a filled region).

## Name check (not legal advice)

- **Duomo: Bible & Daily Devotions** (Jufinil Limited, Cyprus) is an AI assisted Christian app with a USPTO application for DUOMO, serial 98880116, filed December 2024, covering downloadable software (class 9) and SaaS (class 42) for religious content. It markets an "AI companion" and reports 750k+ downloads. Different goods, but the same software classes and both involve AI, so there is some risk of an opposition or confusion claim, and it will compete for the name in app stores and search. It also strengthens a religious association the brand wants to avoid.
  - https://trademarks.justia.com/988/80/duomo-98880116.html
  - https://uspto.report/TM/98880116
  - https://duomoapp.com/ and https://we.goduomo.com/
  - https://play.google.com/store/apps/details?id=com.goduomo&hl=en_US
  - https://dev.ua/en/news/coo-genesis-pokynuv-posadu-1744878103
- No browser, agent, or developer tool named Duomo turned up, and no Chrome extension by that name.
- "Duomo" is a common Italian word (cathedral), used widely by hotels, restaurants, and places. That weakens exclusivity but also means few software claims beyond the one above.
- Suggested next step: a proper clearance search (USPTO, EUIPO, WIPO Global Brand Database) by a trademark attorney before filing, and consider a descriptor in store listings ("Duomo: browser agent") to separate it from the Bible app.

## Sources

- Chrome Web Store image guidelines: https://developer.chrome.com/docs/webstore/images
- Agentic browser landscape: https://www.searchviu.com/en/ai-browsers-2026-compared/, https://nohacks.co/blog/agentic-browser-landscape-2026, https://www.firecrawl.dev/blog/best-browser-agents, https://presenc.ai/research/agentic-browser-wars-2026
