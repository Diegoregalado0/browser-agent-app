import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mergeConfig } from "./config-core.js";

export const HOME_DIR = process.env.BROWSER_AGENT_HOME || join(homedir(), ".browser-agent");
export const CONFIG_PATH = join(HOME_DIR, "config.json");
export const PROFILE_DIR = join(HOME_DIR, "chrome-profile");
export const BIN_DIR = join(HOME_DIR, "bin");

export function loadConfig() {
  mkdirSync(HOME_DIR, { recursive: true });
  let stored = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      stored = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    } catch {
      console.warn(`Ignoring unreadable config at ${CONFIG_PATH}`);
    }
  }
  return mergeConfig(stored);
}

export function saveConfig(config) {
  mkdirSync(HOME_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  chmodSync(CONFIG_PATH, 0o600);
}
