import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HOME_DIR } from "./config.js";
import { SESSION_ID_PATTERN, metaOf, sessionRecord } from "./session-format.js";

// Each conversation is saved as sessions/<id>.json with its provider-neutral history.
// sessions/index.json holds titles and times so the history list does not parse every
// conversation; it is rebuilt from the files when missing or unreadable.
const SESSIONS_DIR = join(HOME_DIR, "sessions");
const INDEX_PATH = join(SESSIONS_DIR, "index.json");

function pathFor(id) {
  if (!SESSION_ID_PATTERN.test(String(id))) throw new Error("Invalid session id");
  return join(SESSIONS_DIR, `${id}.json`);
}

function writeAtomic(path, data) {
  mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, path);
}

function readIndex() {
  try {
    return JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  } catch {
    return rebuildIndex();
  }
}

function rebuildIndex() {
  const index = {};
  if (!existsSync(SESSIONS_DIR)) return index;
  for (const file of readdirSync(SESSIONS_DIR)) {
    const id = file.replace(/\.json$/, "");
    if (!SESSION_ID_PATTERN.test(id)) continue;
    try {
      index[id] = metaOf(JSON.parse(readFileSync(join(SESSIONS_DIR, file), "utf8")));
    } catch {}
  }
  writeAtomic(INDEX_PATH, JSON.stringify(index));
  return index;
}

export function save(conversation) {
  const session = sessionRecord(conversation);
  writeAtomic(pathFor(session.id), JSON.stringify(session));
  const index = readIndex();
  index[session.id] = metaOf(session);
  writeAtomic(INDEX_PATH, JSON.stringify(index));
}

// Newest first.
export function list() {
  return Object.values(readIndex()).sort((a, b) => b.updated.localeCompare(a.updated));
}

export function load(id) {
  return JSON.parse(readFileSync(pathFor(id), "utf8"));
}

export function remove(id) {
  rmSync(pathFor(id), { force: true });
  const index = readIndex();
  delete index[id];
  writeAtomic(INDEX_PATH, JSON.stringify(index));
}

export function removeAll() {
  rmSync(SESSIONS_DIR, { recursive: true, force: true });
}

