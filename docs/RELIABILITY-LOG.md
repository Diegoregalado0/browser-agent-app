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

### Baselines (main code, no experiments, 15-minute task limit)
- Stress suite (12 live-site tasks): 9/12; 1 premature completion (quotes-pagination: 28 calls,
  13 repeated identical calls, reported done without the author); checkout-stop-two-products
  timed out (34 calls, 13 repeats); herokuapp-form-retry cannot pass under the runner's
  password-deny policy (the agent rightly asked the user, in text rather than with ask_user).
- Premature rule refined: a final reply that hands the task back to the user ("Could you sign in
  yourself?") is not a premature claim. rescore.js recomputes saved runs with the current rule.

### Phase 6: LoRA compatibility pilot (approved installs, ~/finetune-pilot on ai-linux)
- The PEFT -> GGUF adapter path works for qwen35moe at the router's llama.cpp commit: a tiny
  random model from the real config, LoRA on attention / linear attention / shared expert,
  converted with convert_lora_to_gguf.py, gives llama-server outputs identical to Hugging Face
  with the adapter off and on (top-5 equal, log-probs within 0.0003). The adapter also loads and
  acts on Q4_K_M / Q3_K_M bases (fidelity needs the real model). Details: docs/FINETUNE-READINESS.md.

### Phase 4: trajectory recorder (branch reliability-trajectory, subagent; reviewed)
- Recorder, redaction, IndexedDB and JSONL sinks, bench --record, exporter, checks. Off by
  default, internal builds only, never in Ghost mode; hooks in agent.js are optional no-ops.
- Review: redaction checked on my own strings (password, URL token and fragment, email, phone,
  card, OTP, bearer token, IBAN hidden; order numbers, prices, counts kept). The exporter's
  ChatML did not match the model's real template (compared with llama.cpp /apply-template):
  one instruction line differed and booleans were written false instead of the template's
  False. Fixed, with a golden file from /apply-template in the checks.

### Phase 5: data rights
- Anthropic's and OpenAI's terms restrict using their outputs to train competing models without
  permission; teacher data comes from Zigger's own verified runs, permissively licensed open
  models, or humans (docs/TEACHER-PIPELINE.md).

### Fixture screens on ai-linux (2026-10-25; dev split, one run each unless noted)
- Benchmark bug: fx-sales-sum's checker (and its self-check) expected 40,375; the West Q3 total
  is 40,425, which Zigger answered every time. Fixed (computed from SALES) and every saved run
  re-verdicted with rescore.js --recheck fx-sales-sum (backup: ~/bench-results-backup-2026-10-25.tgz).
- After the fix: baseline dev 14/18 and 16/18 (two runs), held-out 7/10 and 8/10. Experiments:
  progress 16, settle 15, staleRefs 15, marks 15, clickTarget 14, verifyDone 13; Q4 15 (385 s
  per task vs about 306 s); presence_penalty 0.75: 15. Run-to-run spread of the baseline is two
  tasks, so none of these is a measured improvement. verifyDone is the only one below both
  baseline runs (more repeats and timeouts): kept off. clickTarget used fewer tokens (68k vs
  about 88k per task) and less time (250 s vs about 306 s) at equal accuracy: an efficiency
  candidate to repeat.
- fx-div-controls failed or timed out in every configuration: its switches are plain divs with
  a pointer cursor and a script-set click handler, so the outline listed nothing and the agent
  clicked blind. New experiment pointer lists such elements (outermost pointer element holding
  no other control; an unnamed one takes the preceding text as its name). Verified in headless
  Chrome: the prefs page lists the 3 switches and Save under their names and clicking their
  boxes saves; the other 13 fixture pages and 5 public sites (HN, Wikipedia, books.toscrape,
  GitHub, BBC News) produce identical outlines with it on, and outline time is unchanged
  (1-4 ms). Benchmark run queued after the chain.
- Phase 3 results (dev split, one run each, fx-sales-sum re-verdicted): presence_penalty 0:
  15/18 (304 s per task); thinking on: 12/18, the lowest of all runs (400 s per task vs about
  306 s, 4 timeouts, 92 repeated calls). Thinking stays off. Neither sampling change moved
  accuracy beyond the baseline's spread (14 and 16).
- pointer (dev, one run): 16/18, and fx-div-controls passed for the first time in 15 runs
  (saved all three settings in 404 s; every earlier configuration failed or timed out). Failures:
  fx-directory-page7 (outline unchanged by the flag; also failed under settle) and fx-http500
  (timeout). 333 s per task, 95k tokens. The flag changed the outline of only 2 of 37 fixture
  pages checked (prefs; stock, whose headers sort the table on click) and none of 5 public sites.
  Candidate to enable by default after a repeat run.
- Holo4 (plain, first 8 tasks before the restart): tool syntax works (refs, form_input,
  read_page); fx-sitemap-phone failed because it passed ref 'link "Offices"' (the outline line)
  and the tool's "not found; call read_page again" advice sent it in a loop. New experiments:
  refNames (accept a unique outline line as the ref; clearer error otherwise) and
  continueIntent (a reply that only announces its next step is told to take it, at most twice;
  about 4 of 20 non-timeout failures across all runs ended that way, Zigger and Holo4 alike).
- On request, the Holo runs were restarted with pointer, refNames and continueIntent on, with
  Zigger run under the same three flags in between for a like-for-like comparison.
- Benchmark bug 2 (fixtures v2): finishing the wizard redirected its result page back to step
  1, so an agent that checked its work saw the wizard restart. Holo4 (with fixes) redid it and
  timed out with 26 repeated calls; Zigger had passed by not checking. Fixed and asserted in
  fixtures-check; FIXTURES_VERSION 2. The Holo4 run in progress keeps v1 (loaded at start); its
  fx-wizard is rerun on v2 afterwards. Zigger and Holo3.1 with fixes run on v2.
- fx-newsletter-modal (fails for Zigger and Holo4): the popup opens 1.5 s after load, after the
  view the change report compares with. Closing it (verified in Chrome: the click hides it)
  matched that old view, so the report said "No change"; Holo4 clicked Close five times and
  never retried the wishlist. New experiment freshBase: read_page and screenshots refresh the
  comparison base. Also: Holo4 answered fx-directory-page7 with the decoy on page 1 (Priya
  Abbott's extension) from two screenshots, without reading the text or paging: a model error.
- Follow-up queued with pointer, refNames, continueIntent, freshBase: Holo4 reruns wizard,
  sitemap-phone, newsletter-modal; Zigger reruns newsletter-modal. The main Holo4 / Zigger /
  Holo3.1 runs keep the same three flags, so they stay comparable.
- Correction, benchmark bug 3 (fixtures v3): fx-newsletter-modal could never pass. .overlay set
  display:flex, which overrides the hidden attribute, so the popup showed from the first paint
  and Close changed nothing on screen; every Close click in every run (Zigger and Holo4)
  correctly reported no change. My earlier reading (a delayed popup and a stale change-report
  base) was wrong: I had checked the attribute in Chrome, not what was displayed. freshBase
  stays an unproven experiment; this task was not evidence for it. Fixed and asserted in
  fixtures-check; Holo4 reruns the task on v3.
- rowContext (fx-stale-list, both models): identical "Archive" buttons gain their list item's
  text when their name repeats. A first version that added row text to every control grew
  Hacker News's outline 80% and truncated Wikipedia sooner; the kept version (repeated names
  only, list item or table cell text) changes 3 of 6 public pages (+9% books.toscrape, +21% HN,
  Wikipedia sort buttons name their column) and the others not at all.
- Holo4 + pointer, refNames, continueIntent (no coordinate fix, fixtures v1/v2): 14/28
  (dev 11/18, held-out 3/10) vs Zigger's baseline 22-24/28. Model errors seen: answers from a
  screenshot of the wrong tab or page (directory decoy twice, previous task's page once),
  invented refs (link_2, req_N, oCVj5a), stops before "Load more".
- llama-server hit "CUDA error: an illegal memory access" once (17:53, Holo4, the request right
  after a page load); the router restarted the model in 18 s. First in more than a day of runs;
  fx-delayed-report, in flight, is rerun.
- Generality: each fix targets a mechanism, not a task, but four came from held-out failures
  (sitemap, newsletter, stale-list, wizard), so the held-out split no longer judges them
  independently. A fresh set of sites written without sight of the fixes, plus the live-site
  suites, is needed before any fix becomes a default.
