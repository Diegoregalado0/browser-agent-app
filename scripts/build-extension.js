#!/usr/bin/env node
// Builds the Chrome Web Store edition into dist/extension and packs it as
// dist/browser-agent-extension.zip. The bundle is not minified, so reviewers can read it.

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OUTLOOK_CLIENT_ID } from "../src/outlook-graph.js";

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

// Microsoft sign-in and Graph, for Outlook.
const OUTLOOK_HOSTS = ["https://login.microsoftonline.com/*", "https://graph.microsoft.com/*"];

// The public key that fixes the extension id, so Outlook's sign-in redirect
// (https://<id>.chromiumapp.org/) is the same on every unpacked load. This development key
// gives id fddhceodbfeklilaakgioapmildcmgjo; its private key was discarded, since unpacked
// loads do not need it. Replace it with the Chrome Web Store item's public key once the
// store listing exists (README, "Outlook in the extension").
const EXTENSION_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA04xrUsDhyxcjdNB1VwYah9JJv2HCtjZT7dCSv5wcQM/vvLQVjehFBkLPGAuNdqry6m89saTyGm45SxYatrhuvpqqHum2RCg4y3kRyLhcR2drcuxfdsD2wxdVJHYUziouz9Tl8g0aNFn7MID7SehMg5cBnWb7s0GLGMEieXdz3MzO3EVi1ZM0jxPXwwMUHBXWVdquzgGydAoVWhZjuEU6UC6b29J/OEWZ+HxayNqglxjqc3KiHb7aF1aYdwO11MY4zbSo0+ACjmnh5XyRbGmcKoc093WAijYSXrxxnRqhLSUhpljI2y3z8A/8GpbHRacyKwdgVWnk8Sxmox1ft1JTNwIDAQAB";

const manifest = {
  manifest_version: 3,
  name: "Browsby",
  version,
  description: "An AI agent that does tasks in your browser tabs, using your own API key.",
  // The GitHub Pages site of the repository, which links the Privacy Policy and Terms of Use.
  homepage_url: "https://diegoregalado0.github.io/browser-agent-app/",
  minimum_chrome_version: "120",
  permissions: ["sidePanel", "debugger", "tabs", "tabGroups", "storage", ...(OUTLOOK_CLIENT_ID ? ["identity"] : [])],
  // Microsoft sign-in and Graph only when Outlook is set up.
  host_permissions: [...PROVIDER_HOSTS, ...(OUTLOOK_CLIENT_ID ? OUTLOOK_HOSTS : [])],
  // Discord's API for remote control, asked for only when the user sets it up (its gateway
  // is a WebSocket, which needs no permission).
  optional_host_permissions: ["https://discord.com/*"],
  background: { service_worker: "background.js" },
  side_panel: { default_path: "sidepanel.html" },
  action: { default_title: "Browsby", default_icon: { 16: "icon-16.png", 32: "icon-32.png" } },
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

const result = await build({
  // Split so each provider's SDK is its own chunk, loaded only when that provider is used.
  entryPoints: { sidepanel: join(ROOT, "extension", "sidepanel-main.js") },
  outdir: OUT,
  chunkNames: "chunks/[name]-[hash]",
  splitting: true,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});

// The bundle drops the packages' own license comments, so their notices ship in one file:
// every npm package esbuild bundled, with its LICENSE and NOTICE files as published.
const packageDirs = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const dir = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1];
  if (dir) packageDirs.add(resolve(dir));
}
const notices = [...packageDirs].sort().map((dir) => {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f)).sort();
  if (!files.some((f) => !/^notice/i.test(f))) console.warn(`No license file in ${pkg.name}; THIRD_PARTY_NOTICES.txt names its license only.`);
  const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return [
    `${pkg.name} ${pkg.version}`,
    `License: ${pkg.license}`,
    ...(repository ? [`Source: ${repository}`] : []),
    ...files.map((f) => `\n${readFileSync(join(dir, f), "utf8").trim()}`),
  ].join("\n");
});
const RULE = "=".repeat(80);
writeFileSync(
  join(OUT, "THIRD_PARTY_NOTICES.txt"),
  `Browsby includes the following third-party software. Each package is licensed under its own terms, reproduced below.\n\n${RULE}\n` +
    notices.join(`\n\n${RULE}\n`) +
    "\n",
);

// The store zip has no key (the store keeps its own); the unpacked folder gets it after packing.
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
copyFileSync(join(ROOT, "extension", "background.js"), join(OUT, "background.js"));
copyFileSync(join(ROOT, "ui", "style.css"), join(OUT, "style.css"));
const html = readFileSync(join(ROOT, "ui", "index.html"), "utf8").replace(
  '<script type="module" src="app.js"></script>',
  '<script type="module" src="sidepanel.js"></script>',
);
if (!html.includes("sidepanel.js")) throw new Error("ui/index.html no longer loads app.js the expected way");
writeFileSync(join(OUT, "sidepanel.html"), html);

// The small sizes are drawn separately (brand/toolbar-16.svg); the 128 tile blurs when shrunk.
for (const size of [16, 32, 48, 128]) {
  copyFileSync(join(ROOT, "scripts", `icon-${size}.png`), join(OUT, `icon-${size}.png`));
}

rmSync(ZIP, { force: true });
execFileSync("zip", ["-qr", ZIP, "."], { cwd: OUT });
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ ...manifest, key: EXTENSION_KEY }, null, 2));
console.log(`Built ${OUT}\nPacked ${ZIP}`);
