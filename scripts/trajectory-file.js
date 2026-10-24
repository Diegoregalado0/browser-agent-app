// The benchmark's trajectory sink: records (src/trajectory.js) in <dir>/trajectories.jsonl,
// one per line, local files only. Kept screenshots (recordScreenshots) are moved out of the
// records into content-addressed files, <dir>/screenshots/<sha256>.<ext>, which each record
// then names. Retention (RETENTION) is applied on every write, and screenshots no kept record
// names are removed.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RETENTION, retain } from "../src/trajectory.js";

export const TRAJECTORY_FILE = "trajectories.jsonl";

export function readTrajectories(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

// Adds records to dir's file and returns how many it keeps.
// ponytail: rewrites the whole file per write; append-only with a periodic trim if runs get large.
export function appendTrajectories(dir, records, { retention = RETENTION, now = Date.now() } = {}) {
  mkdirSync(dir, { recursive: true });
  const shots = join(dir, "screenshots");
  const stored = records.map((record) =>
    JSON.parse(JSON.stringify(record), (key, value) => {
      if (value?.type !== "image" || typeof value.data !== "string") return value;
      const bytes = Buffer.from(value.data, "base64");
      const file = `screenshots/${createHash("sha256").update(bytes).digest("hex")}.${/png/.test(value.mediaType) ? "png" : "jpg"}`;
      mkdirSync(shots, { recursive: true });
      if (!existsSync(join(dir, file))) writeFileSync(join(dir, file), bytes);
      return { type: "image", mediaType: value.mediaType, file };
    }),
  );
  const path = join(dir, TRAJECTORY_FILE);
  const kept = retain([...readTrajectories(path), ...stored], retention, now);
  writeFileSync(path, kept.map((r) => `${JSON.stringify(r)}\n`).join(""));
  if (existsSync(shots)) {
    const named = new Set();
    JSON.stringify(kept, (key, value) => (key === "file" && typeof value === "string" && named.add(value), value));
    for (const name of readdirSync(shots)) if (!named.has(`screenshots/${name}`)) rmSync(join(shots, name));
  }
  return kept.length;
}
