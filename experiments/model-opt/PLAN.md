# Model and runtime optimization experiments (branch exp-model-opt)

Baseline: qwen3.6-35b-a3b UD-Q4_K_M, n-cpu-moe 32. Morning run 20261002-143452 (7/10, with the
broken github task). Same-day baseline is ub512 (the server default ubatch is already 512).
`python3 step_timing.py <run-dir> --model <id>` prints per-task and per-run timing from run.log
and the llama-browsby journal; `collect.sh <id>` stores it in results/.

Pass/drop rule: keep if pass count is at least baseline and (median s/step improves 10 percent or
prompt tokens evaluated per step drop 30 percent). Pass counts vary by one task for the same
config, so timing decides.

## Router constraint

Router CLI args override preset keys (checked with a throwaway router). Keys that work per
section: ubatch-size, threads, threads-batch, cache-ram, spec-type, spec-draft-n-max, n-cpu-moe,
model, mmproj. Overridden by the unit: ctx-size, parallel, flash-attn, cache types. Presets are
read only when llama-browsby restarts. Section text is in models.ini.exp.

## Order and results

| # | Option | Section | Hypothesis | Needs | Result |
|---|--------|---------|------------|-------|--------|
| 1a | ubatch 512 (default; same-day baseline) | ub512 | repeat of baseline, measures noise | models.ini | 9/10; 14.2 s/step; 1284 prompt tok/step; gen 20.8 tok/s |
| 1b | threads 6, batch threads 12 | t6 | less memory-bound contention | models.ini | 9/10; 13.7 s/step; 1192 tok/step; gen 21.7; within noise, tentative keep |
| 1c | cache-ram 8192 | cacheram | evicted prefixes restored from RAM | models.ini | 8/10; 18.9 s/step; 1584 tok/step; drop, no cache gain |
| 1d | np 2, c 65536 | np2 | guard slot stops evicting agent slot | unit edit + restart | not run, needs user |
| 3 | ngram-mod | ngram | repeated page text drafts for free | models.ini | 9/10; 17.4 s/step; gen 17.5 (slower); drop |
| 2 | draft-mtp, n-max 3 | mtp | about 1.17x generation | downloaded | 8/10; 18.3 s/step; 1631 tok/step; gen 27.0 (+30%); draft acceptance 68% (8237/12177); fewer steps but osm-directions lost; wall ~39 min; drop as default, retest on a second run |
| 6 | REAP 48 pruned, n-cpu-moe 12 | reap48 | fewer experts on CPU | downloaded | 8/10; 18.3 s/step; 1631 tok/step; gen 27.0 (+30%); draft acceptance 68% (8237/12177); fewer steps but osm-directions lost; wall ~39 min; drop as default, retest on a second run |
| 4 | own-trace imatrix + quant mix | none | quant tuned to agent prompts | 70 GB BF16 | user approval |
| 5 | WSL memory above 44GB | none | bigger 122B quant | host .wslconfig | user action |

Option 1e (screenshot encoded once) is an extension code change, measured together with 1d.

## Same-day summary (10 tasks including the fixed github-issue)

| Id | Pass | Median s/step | Prompt tok/step | Warm-slot requests | Gen tok/s | Pass-task wall s |
|----|------|---------------|-----------------|--------------------|-----------|------------------|
| ub512 (baseline) | 9/10 | 14.2 | 1284 | 32% | 20.8 | 1851 |
| t6 | 9/10 | 13.7 | 1192 | 23% | 21.7 | 1378 |
| cacheram | 8/10 | 18.9 | 1584 | 19% | 21.7 | 1044 |
| ngram | 9/10 | 17.4 | 1456 | 27% | 17.5 | 1251 |
| Q6_K (context) | 9/10 | 26.6 | 1262 | 21% | 15.7 | 1653 |
| mtp | 8/10 | 18.3 | 1631 | 22% | 27.0 | 1326 |
| reap48 | 8/10 | 10.5 | 1446 | 21% | 30.5 | 665 |

Warm-slot share is the fraction of requests not on an LRU slot and with prefix similarity of at
least 0.5; per-task attribution of journal data is by cumulative duration and approximate.
No option 1 setting restored the agent cache, so -np 2 remains the real test of the eviction
hypothesis.

## Option 4 outline

Download unsloth/Qwen3.6-35B-A3B BF16 (about 70 GB), build calibration text from
`*.events.jsonl` prompts, run `llama-imatrix` on CPU, then `llama-quantize --imatrix` with
`--tensor-type` giving attention and shared experts more bits. Benchmark as a new section.

## Models on disk

MTP UD-Q4_K_XL 22853663008 bytes with its own mmproj-F16 (899283584, same size as the stock
one), REAP-48-v2 9426919520 (crucible-labs) using the stock mmproj. RangerX and the OpenMOSE 97B
were not fetched; DJLougen REAP-90pct files (1.6 and 3.6 GB) look mislabeled.

## MTP and REAP48 notes

MTP: loads with the stock-size mmproj and n-cpu-moe 32; draft acceptance 67.6 percent overall
(mean accepted length about 2.6 of 3). Generation 27.0 tok/s against 20.8, but wall per step
did not improve because prefill dominates, and osm-directions failed (23 steps).

REAP48 at n-cpu-moe 12: GPU shows 7929 of 8192 MiB used with the model loaded, so it is at the
limit and a lower n-cpu-moe will not fit; the journal does not log buffer sizes at this
verbosity. Passing tasks took fewer or equal steps (book 6 vs 12, lasagna 7 vs 24, wikipedia 3 vs
5) except dismiss-popup (8 vs 2) and hn-page2 (6 vs 5). Replies on lasagna and wikipedia name the
same facts (ricotta, mozzarella, parmesan; Python 1991 before Java 1995). It failed
checkout-stop-at-payment (47 steps) and osm-directions (38 steps) like the baseline, using more
steps within the timeout. No wrong-but-passing answers seen in the two replies compared.

## Overnight 14-run decision table (main ce14000, 10 tasks, 360 s per task, 85B at 900 s)

Method: s/step is assistant_start to the next assistant_start from the per-task event logs (model, safety check and tool time together); prompt tokens, prompt tok/s, gen tok/s and warm-slot share come from the llama-server journal for agent requests (slot prompt of 1500 tokens or more; shorter requests are safety checks). Warm slot means the chosen slot had LCP similarity of 0.8 or more. Token hit is 1 - evaluated/prompt tokens. Steps per pass is the mean over passing tasks. Run ids are the last 6 digits of the run dir (20261003-xxxxxx).

| run | config | pass | med s/step | p90 | prompt tok/step | prompt tok/s | warm slot % | token hit % | gen tok/s | steps/pass | wall min | waits |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 163310 | q3.5-reap-97b-a10b | 1/10 | 87.7 | 121.7 | 1599 | 85 | 10 | 62 | 5.1 | 5.0 | 66 | 8 (wd 8) |
| 180853 | q3.6-35b-a3b | 8/10 | 12.7 | 30.9 | 1018 | 156 | 28 | 84 | 20.8 | 6.1 | 34 | 0 (wd 0) |
| 180856 | q3.6-35b-a3b-np2 | 8/10 | 13.1 | 26.4 | 793 | 143 | 60 | 88 | 20.9 | 7.0 | 33 | 1 (wd 0) |
| 180859 | q3.6-35b-a3b-ub2048 | 7/10 | 12.7 | 22.6 | 1089 | 262 | 25 | 84 | 19.9 | 6.3 | 30 | 1 (wd 0) |
| 180902 | q3.6-35b-a3b-ub2048-nommap | 8/10 | 10.6 | 22.9 | 789 | 222 | 41 | 88 | 19.9 | 7.8 | 32 | 1 (wd 0) |
| 180906 | q3.6-35b-a3b-reap48-ub2048 | 7/10 | 8.8 | 14.5 | 783 | 407 | 30 | 90 | 23.3 | 8.4 | 33 | 1 (wd 0) |
| 180909 | q3.6-35b-a3b-iq4xs | 9/10 | 14.3 | 23.1 | 926 | 272 | 28 | 85 | 14.9 | 6.7 | 28 | 0 (wd 0) |
| 180912 | q3.6-35b-a3b-iq4xs | 8/10 | 13.8 | 23.4 | 903 | 278 | 34 | 87 | 15.0 | 8.0 | 32 | 0 (wd 0) |
| 180915 | q3.6-35b-a3b-q3kxl | 10/10 | 13.3 | 21.1 | 1282 | 368 | 21 | 79 | 18.7 | 8.2 | 26 | 0 (wd 0) |
| 180918 | q3.6-35b-a3b-q3kxl | 9/10 | 11.7 | 20.3 | 1172 | 357 | 36 | 83 | 18.7 | 8.9 | 29 | 0 (wd 0) |
| 180921 | q3.5-4b | 6/10 | 7.9 | 12.4 | 981 | 815 | 64 | 89 | 17.4 | 5.5 | 36 | 1 (wd 0) |
| 180924 | q3.5-4b | 5/10 | 6.6 | 11.1 | 619 | 672 | 70 | 93 | 17.8 | 4.6 | 34 | 2 (wd 0) |
| 180927 | q3.5-9b | 6/10 | 9.8 | 15.5 | 873 | 491 | 67 | 87 | 13.3 | 4.7 | 27 | 2 (wd 0) |
| 180930 | q3.5-9b | 6/10 | 10.5 | 19.4 | 1031 | 504 | 66 | 86 | 12.4 | 5.8 | 32 | 3 (wd 0) |

Per-config averages over repeats:

| config | runs | pass | med s/step | p90 | prompt tok/step | prompt tok/s | warm % | hit % | gen tok/s | steps/pass | wall min |
|---|---|---|---|---|---|---|---|---|---|---|---|
| q3.5-reap-97b-a10b | 1 | 1.0 | 87.7 | 121.7 | 1599 | 85 | 10 | 62 | 5.1 | 5.0 | 66 |
| q3.6-35b-a3b | 1 | 8.0 | 12.7 | 30.9 | 1018 | 156 | 28 | 84 | 20.8 | 6.1 | 34 |
| q3.6-35b-a3b-np2 | 1 | 8.0 | 13.1 | 26.4 | 793 | 143 | 60 | 88 | 20.9 | 7.0 | 33 |
| q3.6-35b-a3b-ub2048 | 1 | 7.0 | 12.7 | 22.6 | 1089 | 262 | 25 | 84 | 19.9 | 6.3 | 30 |
| q3.6-35b-a3b-ub2048-nommap | 1 | 8.0 | 10.6 | 22.9 | 789 | 222 | 41 | 88 | 19.9 | 7.8 | 32 |
| q3.6-35b-a3b-reap48-ub2048 | 1 | 7.0 | 8.8 | 14.5 | 783 | 407 | 30 | 90 | 23.3 | 8.4 | 33 |
| q3.6-35b-a3b-iq4xs | 2 | 8.5 | 14.0 | 23.2 | 914 | 275 | 31 | 86 | 14.9 | 7.3 | 30 |
| q3.6-35b-a3b-q3kxl | 2 | 9.5 | 12.5 | 20.7 | 1227 | 362 | 29 | 81 | 18.7 | 8.5 | 28 |
| q3.5-4b | 2 | 5.5 | 7.3 | 11.7 | 800 | 743 | 67 | 91 | 17.6 | 5.0 | 35 |
| q3.5-9b | 2 | 6.0 | 10.1 | 17.5 | 952 | 497 | 66 | 87 | 12.9 | 5.2 | 30 |

Wall time per step splits as agent request (median 6 to 7 s on 35B, 3.3 s on 4B), safety check (3 to 5 s on 35B, about 3 s on small models; 60 to 80 percent of tool calls are checked) and tool time (median 0.3 s; navigates about 10 s).

### Stalls
- Not one of the 13 local-model runs hit the 120 s watchdog. The "stalls" counted per run are the bench's post-Stop wait ("waiting for the model server to finish the stalled request"). They occur only after a task timed out (checkout, osm, lasagna, youtube) while /slots still reported a request in flight. The journal shows the slot released 0 to 13 s after Stop (median about 5 s) and a Connection handling canceled line each time, so Stop does close the connection and the server is not wedged. Counts of 1 to 3 on the np2, small-model and ub2048 runs track their timeout counts. Harmless; could be reworded in the bench log.
- Longest gap between events in any non-85B task was 62 s (35B baseline and 9b); step p90 is 14 to 31 s. 120 s is not too short for these configs; a 15k-token cold prefill at 150 tok/s is 100 s, so it is close for the 35B with a cold cache.
- 85B REAP-30 IQ2_XS (26 GB file, no n-cpu-moe, mmap, 44 GB WSL RAM, 8 GB VRAM): real watchdog stalls, 8 tasks (lasagna through osm-directions all steps=0). Cause was one request that began after 16:43:40 and ran 40 min: prompt eval 135 tokens in 1366 s (0.10 tok/s), eval 44 tokens in 1055 s (0.04 tok/s) against 85 to 105 tok/s and 5 tok/s before and after. The queued requests of the 8 stalled tasks were cancelled at 17:24:09 to 17:24:40 and the server returned to normal speed at 17:24:50 with no restart. systemd-journald logged "Under memory pressure" 18 times in the 16h window (at most 2 per hour afterwards), and journald hit its 3 min watchdog and aborted at 16:47:27, so the whole VM was starved: memory thrash of the mmap-ed weights, not a wedged server or Chrome. Not measured directly (no free or swap samples were logged during the run; swap peak now 586 MB of 8 GB). Even when healthy it is too slow: 33 s model time and 88 s per step median, 5 tok/s gen, 62 percent token hit, so 900 s buys about 10 steps. Verdict drop.

### np2 slot evidence
Two slots (np2, 64k): agent and guard requests do land on separate slots within a task (journal example: slot 1 holds the 9k-token agent prompt with f_keep 1.0, slot 0 the 400-token guard prompt), but roles swap between tasks and nothing pins them. Agent requests: 91 of 122 went to the slot of the previous agent request (baseline single-slot: 48 of 114 by chance of the guard interleave); warm-slot share 60 percent vs 28 to 41 percent; token hit 88 vs 84 percent; prompt tokens evaluated per step 793 vs 1018. The single-slot configs still recover most cold slots from the host prompt cache. Effect on speed and score: median s/step 13.1 vs 12.7, pass 8 vs 8, wall 33 vs 34. Gain is real in cache terms but does not show up in wall time (one run). On 4b and 9b, which run with parallel 2 as well, hit was 87 to 93 percent.

### Small models (4b Q8_0, 9b IQ4_XS, parallel 2, 32k per slot)
- Speed: 7.3 s/step (4b) and 10.1 s/step (9b) against the predicted 2 to 5. Prefill is fast (743 and 497 tok/s, about 1 s per step at 800 prompt tokens, vision included) and the cache hit is 87 to 91 percent, so prefill and parallel 2 are not the cost. The cost is generation at 17.6 tok/s (4b) and 12.9 tok/s (9b), about the same as the partly CPU-offloaded 35B-A3B (20.8), which is unexpected for a 4B model fully on the GPU (not diagnosed), plus the safety check, which uses the same model and adds about 3 s per checked call. Agent request 3.3 s plus check 3 s plus overhead is the floor near 7 s.
- 4b failures: identical-call loops with no loop breaker. book-product-page run 1: 50 steps, 44 repeats of the same left_click at (200,271), guard blocked 41 of them ("clicking Mystery, not Travel") and the model kept resending it; run 2 youtube 32 repeats, checkout 44 repeats of one call; lasagna 35 steps of 34 distinct allrecipes.com URLs guessed by number (hallucinated URLs, never reads a page). Also wrong-tool errors (form_input on a link, "ref_4 is not a form field"), 39 to 44 error-ish results per run. Guard blocks 67 and 13 per run.
- 9b failures: hn-page2 navigates to /?page=2 (wrong, HN uses ?p=2) and declares success after 1 or 2 steps; wikipedia-compare died on "400 request (33250 tokens) exceeds the available context size (32768)" because a slot is 32k; lasagna run 2 scrolls 19 identical times; checkout and osm run out the clock with 6 to 11 guard blocks each. No malformed tool-call JSON seen in either model.
- Both pass the one-step tasks (github-issue, httpbin, wikipedia, dismiss-popup mostly) and fail anything needing more than about 15 consistent steps.

### Timeouts dominate the score
checkout-stop-at-payment fails in 13 of 14 runs (21 to 45 steps, 360 s limit; the single pass was q3kxl at 341 s and 29 steps). osm-directions fails 0 of 5 on the Q4 family (21 to 34 steps, timeout) but passes 3 of 4 on iq4xs and q3kxl (14 to 20 steps). Scores in 7 to 10 therefore mostly track step count against 360 s, and one-task differences are noise: Q4 variants 7, 8, 8, 8, 7 and the repeats 9/8 (iq4xs), 10/9 (q3kxl), 6/5 (4b), 6/6 (9b) show a spread of 1 within a config.

### Verdicts
| config | verdict | reason |
|---|---|---|
| q3.6-35b-a3b Q4 baseline | drop as default | 8/10, 12.7 s/step, 20.8 tok/s; slowest prefill (156 tok/s) at ubatch 512 |
| np2 | drop (optional) | warm slots 60 vs 28 percent, but no change in step time or score; costs a 64k context; revisit with a pinned role per slot |
| ub2048 (Q4_K_M, n-cpu-moe 34) | keep the ubatch setting | prefill 156 to 262 tok/s; 7/10 is within noise of 8/10 (borderline checkout, hn-page2 URL guess) |
| ub2048-nommap | keep load-mode none | 10.6 s/step vs 12.7 and 8/10; one run, so treat as probable not proven |
| reap48-ub2048 (n-cpu-moe 17) | keep as fast tier | 8.8 s/step, p90 14.5, 407 tok/s prefill, 23 tok/s gen; 7/10 with weaker guard behavior (20 blocks, lasagna 37 steps) |
| iq4xs | drop | 8.5/10 but gen 14.9 tok/s, slowest 35B per step (14.0 s) and no better than q3kxl |
| q3kxl (n-cpu-moe 31) | keep as default | 10 and 9 of 10, shortest wall (26 and 29 min), 18.7 tok/s, prefill 362 tok/s, osm passed twice. Gap to Q4 family (7 to 8) is suggestive (osm 2 of 2 vs 0 of 5, one-sided p about 0.05 against the whole Q4 family) but two runs are not proof |
| 4b, 9b | drop | 5.5 and 6 of 10, 7 to 10 s/step, loops and 32k slot overflow; speed prediction not met |
| 85B REAP-30 IQ2_XS | drop | 1/10, 88 s/step, memory thrash |

### Recommended local config
Default: Qwen3.6-35B-A3B UD-Q3_K_XL, n-cpu-moe 31, ubatch-size 2048, batch-size 2048, load-mode none (the nommap run was only measured on Q4_K_M; verify with the first q3kxl run that it still fits and loads), parallel 1, ctx-size 32768, q8_0 KV, reasoning off. Fast tier: the REAP48 v2 file with n-cpu-moe 17, ubatch and batch 2048 (reap48-ub2048). Open points before locking the default: a third q3kxl repeat and one q3kxl run with load-mode none; a bench log rewording of the post-Stop wait; a repeated-identical-call limit in the agent loop (would turn 4b and 9b loops into early failures and help every tier); Q4 ub512 (old main, 9/10, 14.2 s/step) vs q3kxl now (12.5 s/step) used different main commits so the speed gain is indicative only.
