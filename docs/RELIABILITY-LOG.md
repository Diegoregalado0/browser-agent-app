# Reliability work: implementation log

Branch `reliability` (worktree ~/browser-agent-reliability), from main 68a8618. Model under test:
Zigger 1.0 = qwen3.6-35b-a3b (Unsloth UD-Q3_K_XL) on the llama.cpp router, reached through the
SSH tunnel at http://localhost:8081/v1 (`--provider local`). Benchmarks run on the Mac.

Rules for every comparison: same task file and benchmark version, same server preset (recorded
from the router's /models args), 15-minute task limit (`--timeout 900000`), results kept in
bench-results/ with run metadata. One significant variable per experiment. A difference of one
or two tasks on a single run is noise until repeated.

## 2026-10-24

### Harness measurement (Phase 1)
- scripts/bench/metrics.js: per-task model calls, browser actions, screenshots, tool errors,
  recovery, repeated identical calls, loop-guard notes and stops, permission prompts, safety-check
  count and time share, premature completion (ended with a reply while the checker failed);
  run metadata (commit, dirty flag, prompt hash, tool-schema hash, task-file hash, benchmark
  version, server launch args for the model). Checked by scripts/bench/metrics-check.js
  (in npm run check).
- run.js: task setup() hook before each run, --split dev|heldout, summaries by split and category.
- First finding from metrics on the 2026-10-24 Zigger rerun of checkout-stop-at-payment: 46
  actions, 23 exact repeats, 7 tool errors, 5 loop notes, no loop stop. Cause seen in the event
  log: a full-page ad (Google vignette) intercepted coordinate clicks, and each click reported
  only "No change among the controls in view"; ref clicks have a covered-element check, but
  coordinate clicks do not. Candidate for Phase 2 (recovery).

### Benchmark infrastructure fixes
- Fixture suite (scripts/bench/tasks-fixtures.js + fixtures/server.js, version 1): 28 deterministic
  tasks over 11 categories, 18 dev / 10 held-out, server-side state checkers, setup() resets.
  Built by a subagent on branch reliability-fixtures; reviewed: one task (fx-register) could
  never pass because the runner denied every password prompt; tasks may now set allowPassword
  (local fixtures only). Pages spot-checked in headless Chrome.
- A tunnel blip (dev.browsby.tunnel reconnected) ended the first core baseline after 3 tasks and
  counted as a failure. The runner now waits up to 5 min for the server, reruns a task that failed
  only because the server was unreachable, and --resume reruns such rows.
- This log was first written to docs/reliability/LOG.md, which .gitignore silently excluded
  (*.md except docs/*.md); it now lives here.

### Phase 2 experiments (branch reliability-agent; each off unless --experiments names it)
All checked in scripts/experiments-check.js (off: unchanged behavior; on: the behavior).
- clickTarget: a coordinate click names the element it landed on; an embedded frame is flagged
  as a possible ad/popup (from the vignette-ad loop above).
- staleRefs: a ref a re-render replaced is found again when exactly one control has the same
  role and name; the result says which ref was used.
- verifyDone: a final reply is checked once against the request, current page and a scanned
  page excerpt when the task changed a page and the reply claims success, or recent tool calls
  failed, or a loop check fired. At most one check per task.
  Security finding while building it: Agent.#userRequests (the safety checks' notion of what the
  user asked) counted every text block in user messages, so the page excerpt would have counted
  as the user's words (a site named only in page text would skip the safety review). Fixed by
  excluding agent-added blocks ([Agent], <page_excerpt>, [Safety notice]); a check proves the
  site is still reviewed, and fails with the filter removed.
- progress: a task state (request, step, current page, last 8 actions with outcomes, obstacles,
  notepad) appended to the newest message of every request, never stored; earlier messages are
  unchanged between requests (checked), so prompt caching keeps working. No extra model calls.
- settle: after clicks and keys, wait until 300 ms without DOM changes and no fetch/XHR younger
  than 5 s in flight, page loaded, up to 2 s; replaces the fixed 300 ms + load-state wait.
- marks: screenshots carry a numbered label per control in view (label N = ref_N), drawn just
  before the capture in a click-through layer and removed after.

### Trajectory recording (preparation for fine-tuning data; branch reliability-trajectory)
Nothing is collected or sent: recording is off by default (recordTrajectories), never in Ghost
mode, only in internal builds, and writes local sinks only.
- src/trajectory.js: per task, the exact messages, system prompt and tools each request sent,
  each reply (content, stop, usage, latency, first token), tool results with error flag and
  duration, and the end (reason, final page, outcome label "unlabeled"). Redaction before
  storage: typed passwords (secretCalls) everywhere, secret query values and fragments, emails,
  phones, Luhn-valid cards, mod-97-valid IBANs, bearer and API-key-like tokens, one-time codes.
  Steps from the first sensitive site on are dropped; screenshots are placeholders unless
  recordScreenshots; retention 30 days / 1000 records on every write.
- Sinks: extension/trajectory-store.js (IndexedDB), scripts/trajectory-file.js (JSONL, used by
  scripts/bench/run.js --record <dir>, labeled with the checker's verdict).
- scripts/export-trajectories.js: success-only by default; OpenAI chat JSONL for the Qwen3.6
  template, optional ChatML text (--chatml), review.md and a redaction report after a re-check.
  Checked by scripts/trajectory-check.js (in npm run check).
