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
