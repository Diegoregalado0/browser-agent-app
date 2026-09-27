#!/usr/bin/env node
// Builds the Chrome Web Store edition into dist/extension and packs it as
// dist/browser-agent-extension.zip. The bundle is not minified, so reviewers can read it.

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "extension");
const ZIP = join(ROOT, "dist", "browser-agent-extension.zip");
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

// Model provider APIs the extension calls with the user's key. Ollama runs locally.
const PROVIDER_HOSTS = [
  "https://api.anthropic.com/*",
  "https://api.openai.com/*",
  "https://generativelanguage.googleapis.com/*",
  "https://api.mistral.ai/*",
  "http://127.0.0.1/*",
  "http://localhost/*",
];

const manifest = {
  manifest_version: 3,
  name: "Browser Agent",
  version,
  description: "An AI agent that does tasks in your browser tabs, using your own API key.",
  minimum_chrome_version: "120",
  permissions: ["sidePanel", "debugger", "tabs", "tabGroups", "storage"],
  host_permissions: PROVIDER_HOSTS,
  background: { service_worker: "background.js" },
  side_panel: { default_path: "sidepanel.html" },
  action: { default_title: "Browser Agent", default_icon: { 16: "icon-16.png", 32: "icon-32.png" } },
  icons: { 16: "icon-16.png", 32: "icon-32.png", 48: "icon-48.png", 128: "icon-128.png" },
  commands: {
    _execute_action: { suggested_key: { default: "Ctrl+Shift+Y", mac: "Command+Shift+Y" }, description: "Open the agent panel" },
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  },
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: [join(ROOT, "extension", "sidepanel-main.js")],
  outfile: join(OUT, "sidepanel.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  legalComments: "none",
  logLevel: "warning",
});

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
copyFileSync(join(ROOT, "extension", "background.js"), join(OUT, "background.js"));
copyFileSync(join(ROOT, "ui", "style.css"), join(OUT, "style.css"));
const html = readFileSync(join(ROOT, "ui", "index.html"), "utf8").replace(
  '<script type="module" src="app.js"></script>',
  '<script type="module" src="sidepanel.js"></script>',
);
if (!html.includes("sidepanel.js")) throw new Error("ui/index.html no longer loads app.js the expected way");
writeFileSync(join(OUT, "sidepanel.html"), html);

const icon = join(ROOT, "scripts", "icon-128.png");
copyFileSync(icon, join(OUT, "icon-128.png"));
for (const size of [16, 32, 48]) {
  execFileSync("sips", ["-z", String(size), String(size), icon, "--out", join(OUT, `icon-${size}.png`)], { stdio: "ignore" });
}

rmSync(ZIP, { force: true });
execFileSync("zip", ["-qr", ZIP, "."], { cwd: OUT });
console.log(`Built ${OUT}\nPacked ${ZIP}`);
