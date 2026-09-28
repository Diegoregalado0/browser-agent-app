# Applying the Duomo rebrand

Checklist for the maintainer, written against `main` at 489e6ad (Outlook browser sign-in, setup wizard, MCP panel, Remote (Discord)). Nothing here has been applied. Line numbers are from that commit; search for the quoted string if they have moved.

Decide first: **user-visible name only**, or **also the internal identifiers** (command, data folder, env vars, IndexedDB). Section 1 is the user-visible rename and is safe. Section 3 changes identifiers that existing installs depend on and needs a migration.

## 1. User-visible strings: "Browser Agent" to "Duomo"

| File | Line | Now | Change to |
| --- | --- | --- | --- |
| `scripts/build-extension.js` | 28 | `name: "Browser Agent"` | `name: "Duomo"` (or `"Duomo: browser agent"`, 75 character limit) |
| `scripts/build-extension.js` | 30 | `description: "An AI agent that does tasks in your browser tabs, using your own API key."` | Short description from BRAND.md: `"Duomo does tasks in your browser tabs for you. Ask in plain words; it runs on your own AI key and nothing is sent to us."` |
| `scripts/build-extension.js` | 36 | `action: { default_title: "Browser Agent", ... }` | `default_title: "Duomo"` |
| `src/sidebar.js` | 86 | `name: "Browser Agent"` | `name: "Duomo"` |
| `src/sidebar.js` | 88 | `description: "Side panel for the local browser agent."` | `"Side panel for Duomo."` |
| `src/sidebar.js` | 92 | `default_title: "Browser Agent (⌘⇧Y)"` | `"Duomo (⌘⇧Y)"` |
| `src/sidebar.js` | 110 | `<title>Browser Agent</title>` | `<title>Duomo</title>` |
| `ui/index.html` | 6 | `<title>Browser Agent</title>` | `<title>Duomo</title>` |
| `ui/index.html` | 521 (setup wizard, provider step) | `Browser Agent runs on the AI provider you choose...` | `Duomo runs on the AI provider you choose...` |
| `ui/index.html` | 424 (Remote (Discord) page) | `name it (for example Duomo)` | Already says Duomo; keep |
| `ui/app.js` | 93 | `"Welcome to Browser Agent"` | `"Welcome to Duomo"` |
| `bin/browser-agent.js` | 136 | `click the Browser Agent icon in its toolbar` | `click the Duomo icon in its toolbar` |
| `scripts/install.sh` | 2 | comment `a "Browser Agent" app` | `a "Duomo" app` |
| `scripts/install.sh` | 7 | `APP="$HOME/Applications/Browser Agent.app"` | `APP="$HOME/Applications/Duomo.app"`, and add `rm -rf "$HOME/Applications/Browser Agent.app"` before creating it so upgrades do not leave two apps |
| `scripts/install.sh` | 11 | `Browser Agent needs Node.js 22...` | `Duomo needs Node.js 22...` |
| `scripts/install.sh` | 36-37 | `CFBundleName` / `CFBundleDisplayName` `Browser Agent` | `Duomo` |
| `README.md` | 1, 27, 37, 47 | `# Browser Agent`, `Click the Browser Agent icon`, `permission for Browser Agent`, `open **Browser Agent** from Spotlight` | `Duomo` in each; line 5 intro can become the one-line positioning from BRAND.md |

Strings that already fit and need no change: the MCP panel (`ui/mcp.js`: "Microsoft Outlook", "tools available to the agent", "Connect Microsoft Outlook", "Sign in to Microsoft"), the setup wizard steps (`ui/wizard.js`, `data-title` values "Choose your AI model", "Connect Microsoft Outlook", "You're all set"), the "Remote (Discord)" settings page title, and "the agent" / "agent browser" wording in general. These describe what it is, not the brand. Settings text naming the command (`browser-agent activity` in `ui/index.html` 385, `~/.browser-agent/config.json` in 198, `ui/settings.js` 441, `src/desktop-tools.js` 82) follows section 3.

## 2. Icons

Replace the source images, and stop deriving small sizes from the 128 px tile (the tile turns to mush at 16 px; the store icon and the toolbar icon should differ).

| Target | Source in this branch |
| --- | --- |
| `scripts/icon-128.png` | `brand/png/app-icon-128.png` |
| Extension `icon-16.png` (toolbar) | `brand/png/favicon-16-16.png` |
| Extension `icon-32.png` (toolbar at 2x, extensions menu) | `brand/png/logo-mark-32.png` |
| Extension `icon-48.png` (chrome://extensions) | `brand/png/logo-mark-48.png` |
| `scripts/AppIcon.icns` | built from `brand/app-icon.svg` (below) |
| Web Store icon 128 | `brand/png/app-icon-128.png` |
| Favicon for the UI page (optional) | `brand/favicon-16.svg`, via `<link rel="icon" href="favicon.svg">` if the server serves it |

Code changes:

- `scripts/build-extension.js` lines 70-74 copy `icon-128.png` and run `sips -z` to make 16, 32, 48. Replace with plain copies of the four files above (for example keep them as `scripts/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png` and copy each).
- `src/sidebar.js` line 96 only sets `icons: { 128: "icon-128.png" }` and line 124 copies only that file, so Chrome scales the tile down for the toolbar. Add 16 and 32 the same way and set `action.default_icon: { 16: "icon-16.png", 32: "icon-32.png" }`.
- There is no menu bar (NSStatusItem) icon in the app today (`native/oshelper.swift` has none). If one is added, use `brand/logo-mark-mono.svg` rendered black as a template image.

Build `AppIcon.icns` (needs `rsvg-convert` from Homebrew `librsvg`):

```sh
mkdir -p /tmp/Duomo.iconset
for s in 16 32 128 256 512; do
  rsvg-convert -w $s -h $s brand/app-icon.svg -o /tmp/Duomo.iconset/icon_${s}x${s}.png
  rsvg-convert -w $((s*2)) -h $((s*2)) brand/app-icon.svg -o /tmp/Duomo.iconset/icon_${s}x${s}@2x.png
done
iconutil -c icns /tmp/Duomo.iconset -o scripts/AppIcon.icns
rm -r /tmp/Duomo.iconset
```

Note: `app-icon.svg` uses the Web Store layout (96 px tile in 128 px). Apple's Big Sur grid is a little larger (824 of 1024, about 80 percent, versus 75 percent here). It looks fine in the Dock; if it reads small next to other apps, scale the tile rect and art by 1.07 around the center for the icns only.

## 3. Internal identifiers (optional, needs migration)

Renaming these breaks existing installs unless handled. Recommended: leave them for now, or rename with a fallback.

| File | Identifier | Suggested |
| --- | --- | --- |
| `package.json` 2, 8, 11, 12 | package name `browser-agent`, bin `browser-agent`, `bin/browser-agent.js` | `duomo`, bin `duomo` (keep `browser-agent` as a second bin alias for a release) |
| `package.json` 5 | description `Internal browser agent: ...` | `Duomo: a browser agent that drives a dedicated Chrome profile and the macOS desktop with any model provider.` |
| `bin/browser-agent.js` 2-9, 46, 49, 102, 145, 166 | usage text and messages `browser-agent ...`; line 49 matches the process name `/browser-agent\.js/` to find stale servers | Update text; make the regex match both names during the transition |
| `src/config.js` 6 | `BROWSER_AGENT_HOME`, `~/.browser-agent` | `DUOMO_HOME`, `~/.duomo`, falling back to the old env var and folder when present (or move the folder on first run) |
| `src/chrome-keeper.js` 14 | `BROWSER_AGENT_CHROME` | `DUOMO_CHROME`, fall back to the old name |
| `src/server.js` 25 | comment `~/.browser-agent/activity.log` | follows `src/config.js` |
| `scripts/install.sh` 17-39 | executable `browser-agent`, `CFBundleIdentifier local.browser-agent` | `duomo`, `local.duomo`. Changing the bundle id or executable resets macOS Accessibility and Screen Recording grants, so users must grant them again; say so in the release notes |
| `scripts/build-extension.js` 3, 13 | `dist/browser-agent-extension.zip` | `dist/duomo-extension.zip` (also README 81) |
| `extension/storage.js` 31 | IndexedDB name `browser-agent` | Keep. Renaming loses every user's saved chats and keys in the extension |
| `src/mcp.js` 110 | MCP client info `{ name: "browser-agent", version: "1.0.0" }` | `{ name: "duomo", ... }`; servers only use it for display and logs |
| `src/remote-discord.js` 137 | gateway identify `properties: { os: "macos", browser: "duomo", device: "duomo" }` | Already Duomo; keep |
| `src/remote-discord.js` 161 | `User-Agent: "DiscordBot (https://github.com/Diegoregalado0/browser-agent-app, 1.0)"` | Update the URL only if the repo is renamed (Discord requires the `DiscordBot (url, version)` form) |
| `scripts/agent-check.js` 305 | test fixture username `duomo-bot` | Already Duomo; keep |
| `README.md` 19-20, 41-42, 81, 104, 109 | clone URL and folder `browser-agent-app`, commands `browser-agent ...`, `BROWSER_AGENT_HOME` | Follow whatever is decided above; update the clone URL if the GitHub repo is renamed (GitHub redirects the old one) |

Leave alone: prompts that describe the role, such as `src/prompt.js` 2 ("You are a browser agent...") and `src/guard.js` 10 and 31. They describe a function to the model, not the brand.

## 4. CSS tokens (`ui/style.css`)

Replace the two token blocks at the top of the file (`:root` and the `prefers-color-scheme: dark` block). If a `[data-theme="dark"]` block is added later, give it the dark values too. Contrast figures are in BRAND.md; `python3 brand/contrast.py` rechecks them.

```css
:root {
  --bg: #f7f3ec;
  --fg: #1e2433;
  --muted: #6b6558;
  --panel: #ffffff;
  --border: #e4dbcc;
  --accent: #b8471f;
  --accent-fg: #ffffff;
  --user: #f4e4d9;
  --error: #b3261e;
  --ok: #2e7d32;
  --hover: rgba(30, 36, 51, 0.06);
  --ghost-bg: #e3e8f1;
  --ghost-fg: #3d5478;
  --danger: #b42318;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #151a24;
    --fg: #ede7dc;
    --muted: #a39b8c;
    --panel: #1e2431;
    --border: #343c4d;
    --accent: #e8876a;
    --accent-fg: #1a1210;
    --user: #3a2b25;
    --error: #f2b8b5;
    --ok: #81c784;
    --hover: rgba(255, 255, 255, 0.07);
    --ghost-bg: #26334a;
    --ghost-fg: #b9c9e6;
    --danger: #f28b7d;
    color-scheme: dark;
  }
}
```

Check after applying: the Outlook card keeps its own Microsoft mark (commit c861d1a), so it is unaffected; the danger buttons and the error text are now both red-orange next to a terracotta accent, so glance at the Reset, Delete all, Clear and Remove bot controls to confirm they still read as destructive.

## 5. Order

1. Section 4 (tokens) and section 2 (icons): no behavior change.
2. Section 1 (strings), then run `npm run check` and `npm run build:extension`, load `dist/` unpacked, and check the toolbar icon on light and dark Chrome themes.
3. Section 3 only with the fallbacks noted, in its own commit.
