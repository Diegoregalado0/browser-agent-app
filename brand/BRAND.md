# Browsby brand guide

## Name

- Write it **Browsby**: capital B, one word. Never "BrowsBy", "Browsby AI", or all caps in running text.
- Say it "BROWZ-bee". The first part is "browse", not "brows"; the store listing and first screen spell out what it does, which settles the reading.
- When you need to say what it is: "Browsby, a browser agent" or "the Browsby side panel".
- Meaning: browse, plus "-by", the old English and Norse ending for a village (Whitby, Derby). A small, friendly place on the web where things get done for you. The mark carries the idea; explain it rarely.
- Internal identifiers stay as they are so installs and data keep working: the `browser-agent` command, `~/.browser-agent`, `BROWSER_AGENT_*` env vars, the IndexedDB name and storage keys, and the repo name.

## Product

Browsby is a **Chrome extension**. That is the only product: every public surface (store listing, README intro, screenshots) talks about the extension. The Mac app in this repo is a test harness for development; do not market it or show it in store images.

## Positioning

**One line:** Say what you want done, and Browsby does it in your own Chrome tabs, on your own AI key, with nothing sent through us.

Three benefits, voice rules, and words to avoid are in [POSITIONING.md](POSITIONING.md).

Where it sits (September 2026):

| Product | Form | Stance |
| --- | --- | --- |
| Perplexity Comet | Full browser | Search company's browser |
| Opera Neon | Full browser, paid agent tier | "Agentic browser" |
| Dia (The Browser Company) | Full browser, macOS | Rethink the browser around AI |
| Claude for Chrome | Chrome extension, paid plans | One model vendor |
| **Browsby** | Chrome extension | Keep Chrome, any provider, your own key, no account with us |

Most brands here are abstract (gradients, orbs, sparkles). Browsby is plain and homely: a letter, a tab, a lit window.

**Taglines** (one per surface):

- Tell it the task. It does the browsing.
- Your tabs, handled.
- Your key, your browser, your call.

## Voice

Plain, calm, trustworthy: a careful colleague explaining what will happen. Short sentences, everyday words, product first. Say what it does and what it does not do. No hype words, no exclamation marks, no emojis, no em dashes (use a comma, a colon, or a new sentence). When it asks or stops, say why in one line. Full rules in POSITIONING.md.

## Logo

The mark is a lowercase **b**. Its stem is a browser tab standing upright (rounded top, the tab's curved foot at the bottom left). Its bowl is a round window with a lit lamp in the middle: someone is home and working.

| File | Use |
| --- | --- |
| `logo-mark.svg` | Full color on light backgrounds (Ink b, Lamp center). 24 px and up |
| `logo-mark-reverse.svg` | Full color on dark backgrounds (Paper b, Lamp center) |
| `logo-mark-mono.svg` | One color via `currentColor`; the lamp stays as a dot inside the ring |
| `toolbar-16.svg` | Drawn on the 16 px grid: Paper b on an Ink tile. Chrome toolbar at 16 and 32 px, favicons |
| `app-icon.svg` | Store and extension icon: Ink tile, 96 px inside a 128 px canvas (Chrome Web Store spec) |
| `logo-wordmark.svg` | Mark plus "Browsby" in the system font stack, weight 600, live text. Outline it before print |

Renders in `png/`: every mark at 16, 32, 48, 128, 512; `toolbar-16/32/48.png`; `app-icon-1024.png`; the wordmark at 32 to 256 px tall.

Extension icon mapping: toolbar 16 and 32 use `png/toolbar-16.png` and `png/toolbar-32.png`; 48 (chrome://extensions) uses `png/toolbar-48.png`; 128 (store, install dialog) uses `png/app-icon-128.png`. The tile keeps the icon visible on both light and dark toolbars: Ink alone is 1.40:1 on Chrome's dark toolbar `#202124`, Paper on Ink is 10.2:1.

### Clear space and sizes

- Clear space around the mark: the width of the stem on every side. For the wordmark, the same.
- Full color mark: 24 px and up. Below that, use `toolbar-16.svg`.
- App icon tile: 32 px and up. At 16 px use `toolbar-16.svg`.
- Wordmark: 96 px wide and up.

### Do and don't

- Do use `logo-mark.svg` on Paper, white, and light gray; `logo-mark-reverse.svg` or the app icon on Ink, dark gray, and near black.
- Do keep the lamp amber in color versions. It is the only warm spot.
- Don't put `logo-mark.svg` (Ink) on dark backgrounds, or the Lamp on Paper as a large shape (1.98:1).
- Don't rotate, stretch, outline, or add shadows or gradients to the mark.
- Don't set "Browsby" in a decorative or script face, or replace the lowercase b with a capital.

## Palette

| Name | Hex | Role |
| --- | --- | --- |
| Ink | `#1F3A5F` | Primary. Logo, app icon tile, headings on light. 11.48:1 on white, 10.2:1 on Paper |
| Paper | `#F6F1E7` | Light surfaces; the b on dark |
| Lamp | `#E0A23B` | The lamp dot and tiny accents only. Never text on light (1.98:1 on Paper); 5.14:1 on Ink |
| Night | `#121822` | Dark surfaces |

### UI tokens (`ui/style.css`)

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--bg` | `#F6F1E7` | `#121822` | Page background |
| `--fg` | `#1B2433` | `#ECE6DA` | Body text |
| `--muted` | `#5F6470` | `#A29C90` | Secondary text |
| `--panel` | `#FFFFFF` | `#1B2330` | Cards, composer |
| `--border` | `#E2DACB` | `#313B4B` | Dividers (decorative) |
| `--field-border` | `#7F838D` | `#87847D` | Edges of inputs and switch tracks: `--muted` mixed 80% with `--panel`. 3.80 on panel, 3.37 on bg (light); 4.23 / 4.77 (dark) |
| `--accent` | `#24507F` | `#8DB4E2` | Buttons, links, focus ring |
| `--accent-fg` | `#FFFFFF` | `#0E1622` | Text on accent |
| `--user` | `#E4ECF5` | `#22324A` | User message bubble |
| `--error` | `#B3261E` | `#F2B8B5` | Errors |
| `--ok` | `#2E7D32` | `#81C784` | Idle/ok dot |
| `--hover` | `rgba(27, 36, 51, 0.06)` | `rgba(255, 255, 255, 0.07)` | Hover wash |
| `--ghost-bg` | `#F3E6C8` | `#3A2F1A` | Ghost mode chip (lamp light) |
| `--ghost-fg` | `#6A4A0C` | `#EBCB8B` | Ghost mode chip text |
| `--danger` | `#B42318` | `#F28B7D` | Destructive actions |

### Contrast (WCAG 2.x, `python3 brand/contrast.py`)

AA needs 4.5:1 for text and 3:1 for UI parts such as the focus ring. All pairs pass.

| Pair | Light | Dark |
| --- | --- | --- |
| fg on bg / panel / user | 13.85 / 15.59 / 13.08 | 14.33 / 12.71 / 10.41 |
| muted on bg / panel | 5.26 / 5.93 | 6.52 / 5.79 |
| accent on bg / panel | 7.38 / 8.30 | 8.27 / 7.34 |
| accent-fg on accent | 8.30 | 8.44 |
| error on bg / panel | 5.81 / 6.54 | 10.43 / 9.25 |
| ok on bg / panel | 4.55 / 5.13 | 8.85 / 7.85 |
| danger on bg / panel | 5.84 / 6.57 | 7.43 / 6.59 |
| ghost-fg on ghost-bg | 6.53 | 8.40 |

`--border` is decorative; do not make it the only edge of a control that needs 3:1.

## Chrome Web Store listing draft

**Name** (75 character limit): Browsby: AI browser agent

**Short description** (limit 132; this is 118):
Browsby does tasks in your Chrome tabs. Ask in plain words; it runs on your own AI key and nothing is sent through us.

**Category:** Productivity (Workflow and planning).

**Long description:**

> Browsby is an AI agent that works in your Chrome tabs. Open the side panel, say what you want done, and it opens pages, clicks, types, fills in forms, and tells you when it is finished.
>
> Use it for errands like "find a well-reviewed lasagna recipe and open it" or "check my email for the verification code and enter it here". It works in its own tab group and never takes over the tabs you opened.
>
> It runs on the AI provider you choose, with your own API key: Anthropic, OpenAI, Google Gemini, Mistral, or a local model through Ollama. The key stays in your browser and is sent only to that provider, which bills you directly. There is no Browsby account and no Browsby server: your tasks, pages, and history never pass through us.
>
> A safety check compares each action with what you asked for and watches pages for text that tries to take over the agent. When something looks off, Browsby asks you first. On banks, payment sites, password managers, and password fields it always asks. Press Stop at any time.
>
> Ghost mode keeps a session from being saved, and is always on in incognito windows.

**Single purpose:** An AI agent that carries out tasks in the user's tabs with their own API key.

**Images:** icon `png/app-icon-128.png`. Small promo tile 440 x 280 and marquee 1400 x 560: Ink background, `logo-mark-reverse.svg` large and centered, no text. Screenshots 1280 x 800 of the side panel on a real task, in light theme.

## Name check (not legal advice)

Searches in September 2026 (web searches of Justia USPTO records, App Store search API, GitHub, Chrome Web Store, domain RDAP):

- No BROWSBY trademark or software product found. `browsby.app` was unregistered; `browsby.com` is listed for sale on Atom (https://www.atom.com/name/BrowsBy).
- Nearby: Browsely, an AI Chrome extension (https://chromewebstore.google.com/detail/browsely-ai-productivity/hgppdobcpkfkmiegekaglonjajeojmdd); Quora's BROWSELY mark for software is abandoned (https://trademarks.justia.com/886/60/browsely-88660794.html). "Browsy" is used by small browser apps.
- "Brows by" reads as eyebrows in beauty marks such as BROWSBYKAT (https://trademarks.justia.com/974/06/browsbykat-97406002.html); different goods, but a first-sight reading to counter with a clear descriptor ("AI browser agent") in listings.
- The USPTO search itself could not be run from here. **Before filing or launching, have a trademark attorney run a clearance search (USPTO, EUIPO, WIPO Global Brand Database) for BROWSBY in classes 9 and 42.** Register the domain you plan to use.

## Sources

- Chrome Web Store image guidelines: https://developer.chrome.com/docs/webstore/images
- Agentic browser landscape: https://www.searchviu.com/en/ai-browsers-2026-compared/, https://nohacks.co/blog/agentic-browser-landscape-2026
