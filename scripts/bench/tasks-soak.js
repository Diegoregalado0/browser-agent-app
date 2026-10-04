// The endurance soak: a mixed cycle of short and medium tasks, repeated for hours in one
// browser and one run (run.js --runs N --max-hours H), to catch what only shows over time:
// memory leaks, a model server slowing down, Chrome dying, steps getting slower.
// Eight of the ten standard tasks, eleven lower rungs of the limits ladder, and two stress
// tasks. Left out: httpbin-form submits a form and checkout-stop-at-payment can create a
// shop account, and the soak sends nothing to any site.

import { TASKS as ALL_STANDARD } from "./tasks.js";
import { TASKS as LIMITS } from "./tasks-limits.js";
import { TASKS as STRESS } from "./tasks-stress.js";

const LADDER = [
  "horizon-quotes-3",
  "horizon-stock-travel",
  "horizon-catalogue-10",
  "breadth-categories-4",
  "memory-upc-gap10",
  "memory-turns-5",
  "precision-form-7",
  "precision-countries-18",
  "recovery-dynamic-2",
  "recovery-deadlink-2",
  "recovery-ajax-2",
];
const STANDARD = ALL_STANDARD.filter((t) => !["httpbin-form", "checkout-stop-at-payment"].includes(t.id));
const pick = (list, ids) => ids.map((id) => list.find((t) => t.id === id));

// Interleaved so a slow task is never followed by another of its kind.
const ladder = pick(LIMITS, LADDER);
const mixed = [];
for (let i = 0; i < Math.max(STANDARD.length, ladder.length); i++) mixed.push(STANDARD[i], ladder[i]);
export const TASKS = [...mixed.filter(Boolean), ...pick(STRESS, ["quotes-pagination", "wiki-tabs-population"])].map((t) => ({ ...t, dim: t.dim || "soak", rung: t.rung ?? 0 }));
