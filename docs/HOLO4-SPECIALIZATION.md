# Making Holo4-35B-A3B a Browsby specialist (plan)

Status 2026-10-25. Nothing here has been trained. VERIFIED marks facts checked against primary
sources or measured on ai-linux; everything else is a plan or an estimate.

## Goal

A Browsby model ("Zigger 2.0") that completes more browser tasks than Zigger 1.0, faster,
without losing general skills (summaries, writing, answering questions), on the same server
(RTX 3070 8 GB, 56 GB RAM in WSL). Success means, against Zigger 1.0 on the same harness:
- fixture benchmark held-out split: higher pass rate, beyond run-to-run noise (3+ runs each);
- general-skills check: no drop beyond noise;
- seconds per task and repeated actions: no worse.

## Starting point (VERIFIED)

| | Holo4-35B-A3B | Zigger 1.0 |
|---|---|---|
| Base | Qwen/Qwen3.6-35B-A3B (model card base_model, fine-tune tag) | Qwen/Qwen3.6-35B-A3B |
| License | Apache 2.0 (card metadata, card License section, unmodified LICENSE file) | Apache 2.0 |
| Architecture | qwen3_5_moe, 35B total, about 3B active per token | same |
| Chat format | Qwen XML tool calls (`<tool_call><function=...><parameter=...>`), `enable_thinking` switch | same |
| File on ai-linux | ~/models/Holo4-35B-A3B/q4_k_m.gguf (21.3 GB) + mmproj.f16.gguf, sha256 checked | UD-Q3_K_XL (served), UD-Q4_K_XL (benchmarked) |
| Training (H Company) | 127B tokens SFT (about 3/4 successful agent runs: desktop 45%, web 14%, MCP/API 12%, mobile 3%, other 26%), then online RL on two LoRA experts merged back | none for agents |
| Published gain over the base | AutomationBench held-out 31.7% vs 13.1% (H Company's harness) | |

Same chat format and tool syntax: Browsby's tools should work unchanged. Not yet known:
- Coordinates. Browsby takes clicks in screenshot pixels. H Company does not document the
  convention Holo4 was trained on (Qwen-VL models often use a 0-1000 grid). Check the first
  Holo4 benchmark traces for clicks that land off target; if they do, either tell the model the
  convention in the tool description or rescale in the browser tool (behind a setting).
- Sampling. H Company publishes no recommended settings; the queued run uses Zigger's
  (temp 0.7, top-p 0.8, top-k 20, presence 1.5).
- Browsby picks the summary threshold by model id (agent.js SUMMARY_AT_MODEL): an unknown id
  such as holo4-35b-a3b summarizes at 24k tokens instead of Zigger's 50k. Single-task benchmark
  sessions never summarize, so the fixture results are unaffected; a catalog entry for the
  new model must set summaryAt.

## Step 0. Measure before changing anything (queued, free)

1. Fixture benchmark, all 28 tasks, Holo4 then Holo3.1 at Q4, same settings as the Zigger Q4
   run (~/browsby-holo-run.sh, after the reliability chain and the pointer run).
2. General-skills check (to build): about 15 prompts with deterministic checks (arithmetic,
   extraction, JSON output, word limits, summary with required facts, translation keywords),
   same prompts for Zigger, Holo4 and Holo3.1.
3. Repeat the fixture run 2 more times for Holo4 and Zigger if the first run is within 3 tasks.

Decision: Holo4 becomes the base only if it beats Zigger on the fixtures and holds up on the
general-skills check. Otherwise the same plan applies with Zigger as the base.

## Step 1. Adapt without training (free, days)

One change at a time, behind settings, each benchmarked:
- Tool-layer fixes already in progress (pointer, popups appearing late, stale data,
  repeated actions). They help any model.
- Prompt: the system prompt and tool descriptions were tuned on Zigger. Holo4 was trained on
  H Company's harness; try describing actions the way a computer-use model expects (screenshot
  first, then act) and the marks experiment (numbered labels on the screenshot), which suits a
  vision-trained model.
- Sampling sweep: temperature 0.3 / 0.7, presence penalty 0 / 1.5.
- Thinking on vs off (H Company's harness reasons before acting; Browsby runs with it off for
  speed).
- Quantization: if Holo4 wins at Q4, make a 3-bit file from H Company's BF16 weights with their
  published importance matrix and compare speed and accuracy (needs a 69.4 GB download).

## Step 2. Data (free, weeks)

Teach Browsby's own habits, not general computer use (Holo4 already has that):
- using refs from the page outline instead of guessing coordinates;
- asking the user (ask_user) for passwords, codes and choices instead of guessing;
- stopping before payment or irreversible steps when the task says so;
- checking the page after an action instead of trusting the change report;
- not repeating a failed action the same way; using notes for long tasks; handling tabs.

Sources, by rights and fit:

| Source | License (checked 2026-10-25) | Use |
|---|---|---|
| Our fixture runs, verified by the checkers (dev split only) | Ours | Main source. Run Holo4 and Zigger several times per task with varied sampling, keep passing runs with no premature claim and few repeats (docs/TEACHER-PIPELINE.md) |
| New synthetic fixture sites (an LLM writes site + checker, reviewed) | Ours | Scale the above: 200-500 sites across the failure categories; a separately styled set stays held out as "unfamiliar sites" |
| Hcompany/trajectories (7,366 Holo4 runs on OSWorld, OSWorld 2, AndroidWorld) | Apache 2.0 (dataset card) | Little value for Holo4 itself (its own outputs, desktop and Android, not Browsby's tools); possible use for Zigger |
| Mind2Web (human web tasks) | CC BY 4.0 per the paper; the dataset card adds "solely for research purposes" | Hold until the research-only note is resolved |
| AgentNet (OpenCUA) | MIT, but the README says research and education only | Hold, same reason |
| MolmoWebMix (Ai2, 30k human web tasks), WebLINX | Not confirmed | Check the dataset cards before use |
| General replay set (Holo4's own answers to general prompts, kept when they pass a check) | Ours (Apache 2.0 model output) | 20-30% of the mix, so the adapter does not erode general skills |
| Commercial API outputs (OpenAI, Anthropic, ...) | Terms restrict training competing models | Excluded |

Rate on ai-linux: about 290 fixture tasks a day, roughly 4-5M tokens of passing runs. A first
dataset of 10-50M tokens takes 1-2 weeks of overnight runs. Real-user data stays out until a
consent and redaction process exists (the trajectory recorder is off by default).

Export with scripts/export-trajectories.js (branch reliability-trajectory): Qwen ChatML with
XML tool calls, checked against the model's own template (golden test). Screenshots: keep the
last 1-2 per run at most; they dominate sequence length.

## Step 3. Train (rented GPU; needs approval for each paid run)

- LoRA in bf16 on the language model only: attention (q/k/v/o_proj), linear attention
  (in_proj_qkv/z/a/b, out_proj), shared expert (gate/up/down_proj). Router and routed experts
  frozen: llama.cpp cannot load expert LoRA, and it is the shape the pilot verified
  (docs/FINETUNE-READINESS.md).
- Rank 16-32, sequences 8-16k, loss on assistant turns only, 1-2 epochs, mix about 70% Browsby
  runs / 30% general replay.
- Hardware: one 96 GB GPU (RunPod RTX PRO 6000 $1.69-2.49/h, 2026-10-08 prices).
- Cost estimate: smoke test (50 examples) about $5-15; first real round (10-50M tokens) roughly
  2-10 GPU hours, about $5-40. Throughput for this model is unmeasured, so these are guesses
  until the smoke test.
- Serve: convert with convert_lora_to_gguf.py at the router's llama.cpp commit, load with
  --lora on the Q4 (or 3-bit) base in a separate preset; per-request scale allows an A/B
  without reloading. Not yet verified: a bf16 adapter keeping its effect on a quantized base
  of the real model (pilot step 2 measures it).

## Step 4. Evaluate

- Fixtures: dev and held-out, 3 runs each, against Zigger 1.0 and untuned Holo4; the held-out
  split and the unfamiliar-sites split are never trained on.
- Live suites (core and stress) once, for real-site behavior.
- General-skills check.
- Tool-format errors and repeats must not rise.
Ship only if it beats untuned Holo4 on held-out tasks; otherwise keep the untuned model.

## Step 5. Iterate

Each round: run the improved model on new and failed tasks, keep verified successes, retrain.
Online RL (what H Company did) needs many parallel browser environments and is out of scope
for now.

## Naming and attribution

The base model change makes it Zigger 2.0; adapter rounds are 2.1, 2.2. Apache 2.0 requires
keeping the license and notices and stating changes; it grants no right to the "Holo" name.
The catalog entry keeps the real model id and base.

## Risks

- Holo4 may underperform in Browsby's harness despite its published scores (tool or
  coordinate mismatch): Step 0 measures it before anything is built on it.
- General skills may already be weaker than Zigger's: the general-skills check decides.
- Our data is narrow (fixture sites): the unfamiliar-sites split and live suites guard against
  learning our sites instead of the skill.
- Dependence on H Company's releases: every candidate goes through the same benchmark, so the
  base can change at each release.

## Holo4 sizes (H Company's harness, published 2026-09-28)

| Benchmark | Holo4-27B (dense, Qwen3.8-27B) | Holo4-35B-A3B (MoE, Qwen3.6-35B-A3B) |
|---|---|---|
| OSWorld | 85.2% | 80.8% |
| OSWorld 2.0 (long workflows) | 61.7% (41.5% fully solved) | 30.9% (12.3% fully solved) |
| ALE-CLI | 44.1% | 30.9% |
| AutomationBench / held-out | 45.4% / 49.3% | 34.5% / 31.7% |
| AndroidWorld | 85.1% | 77.6% |
| Internal web tasks (47 apps) | 80.2% | 70.8% |
| License | CC BY-NC 4.0 (card metadata): no commercial use | Apache 2.0 |
| On ai-linux | Its base ran at about 1.5 tok/s (2026-10-23) | Zigger's speed class |

The 27B is out for Browsby: non-commercial license and too slow on this hardware.
