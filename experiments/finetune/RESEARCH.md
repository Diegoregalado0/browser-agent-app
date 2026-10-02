# Option 7: LoRA fine-tuning / distillation of Qwen3.6-35B-A3B for the Browsby agent

Research only, written 2026-10-02. Nothing was provisioned, downloaded or spent. Items marked UNVERIFIED rest on third-party or secondary sources and must be rechecked before spending.

## 1. Recommendation

Conditional NO-GO on renting GPUs now; GO on a $0 data milestone (section 6).

Reasons:
- Current failures are long tasks hitting time limits (too many steps). Fine-tuning can reduce steps, but the cheaper levers (prompt, step budget, tool design, early-stop logic) have not been exhausted.
- 9 benchmark tasks cannot detect a real improvement. A fine-tune cannot be judged until the eval set is about 40 to 60 tasks.
- Training data (500 to 2000 filtered trajectories) does not exist yet. Data generation, not GPU rental, is the dominant cost and effort.
- GPU rental itself is affordable inside the credit if the account is upgraded (section 2), so money is not the blocker.

## 2. Google Cloud credit facts

Sources:
- Free trial page: https://docs.cloud.google.com/free/docs/free-cloud-features
- Billing during free trial: https://support.google.com/cloud/answer/7006543
- Signup FAQ: https://cloud.google.com/signup-faqs
- Community report of the trap: https://discuss.google.dev/t/300-free-trial-is-useless-without-gpu-quota-my-trial-period-is-wasting-away/290091

Verified on the current official page (fetched 2026-10-02):
- The welcome credit is $300 "to spend over 90 days". Expiry is 90 days from signup, regardless of when you upgrade.
- During the Free Trial you "can't add GPUs to your VM instances", cannot use Marketplace, and cannot request a quota increase. Partner models as managed APIs (model-as-a-service) cannot use the credit either.
- Upgrading to a paid billing account unlocks GPUs. The remaining credit stays usable on covered products "but must be consumed within the original 90 days". So the credit does pay for GPUs after upgrade, until day 90.
- After upgrade GPU usage is still subject to quota. New accounts typically start with 0 GPU quota (A100/H100 especially); you request an increase in the console (IAM and Admin > Quotas, filter on the GPU metric and region, Edit quotas) and approval is not instant. Approval time and the odds for a brand-new paid account with no history are UNVERIFIED; the quota doc pages I tried returned 404 and I could not confirm them.
- Spot: the free trial page does not mention Spot at all (UNVERIFIED whether credit applies; in practice credits are billing-level and apply to Spot usage after upgrade). Spot GPUs need their own preemptible quota family in some regions (UNVERIFIED).
- Machine constraints (https://docs.cloud.google.com/compute/docs/gpus/create-gpu-vm-accelerator-optimized): A3 High with fewer than 8 GPUs can only be created as Spot or Flex-start; A2 supports all provisioning models. GPU VMs need `--maintenance-policy=TERMINATE`.
- Zones (https://docs.cloud.google.com/compute/docs/gpus/gpu-regions-zones): A100 80GB (A2 Ultra) only us-central1-a and -c; H100 80GB in us-central1 a/b/c, us-east4, us-east5-a, us-west1; RTX PRO 6000 (G4) widely; L4 widely.

Practical consequences:
1. The 90 day clock is already running if the trial is started. Check the signup date before planning.
2. Upgrade to paid (card on file) first, then request quota. Anything past the credit is billed to the card; set a budget alert and a hard shutdown on the instance.
3. Quota denial is the main risk. Fallbacks inside GCP: Vertex AI custom training jobs (same quota family, own console, markup UNVERIFIED), Colab Enterprise on Vertex (GPU runtime availability UNVERIFIED), Flex-start/Spot. Consumer Colab Pro is not Google Cloud and is paid by card, not credit. Outside GCP, specialist GPU clouds are cited as 3 to 5 times cheaper with no quota step (https://www.thundercompute.com/blog/google-cloud-gpu-instances, vendor claim).

## 3. Cost table

Hourly prices are from third-party aggregators because the official pricing page (https://cloud.google.com/compute/gpus-pricing) did not render in my fetch. All UNVERIFIED against the official page; us-central1; plus-or-minus 10 percent assumed.

| GPU (machine) | On-demand $/h | Spot $/h | Notes |
|---|---|---|---|
| A100 80GB (a2-ultragpu-1g) | about 5.03 | about 2.76 | us-central1-a/c only; fits 74 GB bf16 LoRA barely, little headroom |
| H100 80GB (a3-highgpu-1g) | about 10.98 | about 6.92 | 1-GPU shapes are Spot/Flex-start only; faster, so fewer hours |
| RTX PRO 6000 96GB (G4) | not confirmed (fractional entry from about 0.65) | not confirmed | 96 GB fits 74 GB LoRA with headroom; check g4 1-GPU price |
| L4 24GB (G2) | about 0.7 to 1 (UNVERIFIED) | lower | Too small for 35B training; useful only for eval/inference tests |

Sources: https://www.devzero.io/instances/gcp/a3-highgpu-1g, https://www.economize.cloud/resources/gcp/pricing/compute-engine/a2-ultragpu-1g/, https://www.thundercompute.com/blog/google-cloud-gpu-instances.

Plan: 3 training runs of 4 h (12 h), plus 8 h for setup, smoke tests, merge/convert/eval (20 h total), 300 GB disk for about 2 weeks.

| Scenario | GPU hours | Compute | Storage and misc | Total | Of $300 credit |
|---|---|---|---|---|---|
| A100 80GB on-demand | 20 | about 101 | about 15 | about 116 | 39% |
| A100 80GB Spot (with preemption rerun buffer 25%) | 25 | about 69 | about 15 | about 84 | 28% |
| H100 Spot, assume 2.5x faster training: 3 x 1.6 h + 4 h | 9 | about 62 | about 15 | about 77 | 26% |
| H100 on-demand 8-GPU shape | not sensible | | | over 85/h | burns credit |

Not covered by the credit: teacher-model API calls for trajectory generation (Anthropic or other third-party partner APIs are excluded; Gemini via Vertex may be covered after upgrade, UNVERIFIED). Budget this separately: 1500 trajectories x about 20 steps with screenshots is on the order of tens to a few hundred dollars depending on the teacher; compute it from benchmark token logs before committing.

Verdict: the credit comfortably covers one to two rounds of the plan IF quota is granted inside the 90 days.

## 4. Method

### Tooling (checked 2026-10-02)
- Unsloth (https://unsloth.ai/docs/models/qwen3.5/fine-tune): supports the Qwen3.5/3.6 35B-A3B MoE; bf16 LoRA about 74 GB VRAM; MoE QLoRA 4-bit "not recommended due to BitsandBytes limitations"; claims about 12x faster MoE training and over 35% less VRAM; router fine-tuning off by default for stability; vision layers, language layers, attention and MLP can be toggled independently; `save_pretrained_gguf` exists. Best fit for a single 80 GB card.
- ms-swift (https://qwen.readthedocs.io/en/latest/training/ms_swift.html, https://github.com/modelscope/ms-swift) and LLaMA-Factory (https://qwen.readthedocs.io/en/latest/training/llama_factory.html): both list Qwen3.6 support, with Megatron LoRA for MoE in ms-swift (https://github.com/modelscope/ms-swift/tree/main/examples/megatron/lora). Better for multi-GPU; I did not confirm single-GPU memory or expert-LoRA flags. UNVERIFIED.
- HF PEFT: works with attention and dense projections; expert LoRA on fused expert tensors needs `target_parameters`-style support in recent PEFT versions (UNVERIFIED for this architecture). A public community adapter exists for reference: https://huggingface.co/notanoption1/Qwen3.6-35B-A3B-LoRA-adapter (not inspected).
- Default recipe: LoRA on attention (q,k,v,o) and, if memory allows, expert MLPs; leave the router frozen. Rank 16 to 32, lr about 1e-4 to 2e-4, 2 to 3 epochs, loss on assistant turns only.

### Text-only or vision?
Start text-only on the action-selection turns while keeping vision tower and mmproj frozen and untouched. Screenshots may still be present in the training sequences only if the framework handles the image path without extra memory; otherwise train on the page-text and accessibility-tree representation plus a text description of the screenshot. Rationale: step-count failures come from policy (what to do next, when to stop), not from perception. Risk: train/serve mismatch if the agent relies on screenshots for decisions. Mitigation: a second run with images included only if the text-only run shows a gain.

### Data format
One example per agent step (not per task): messages = system prompt (as shipped), prior tool calls and results (truncated as the agent truncates them), current observation; target = the assistant turn (reasoning if used plus tool call). Use the model's own chat template and tool-call format so GGUF serving matches. Drop steps from failed runs; keep only trajectories that finished successfully and efficiently.

### Source and quantity
- Source A: our own successful local runs from benchmark event logs (branch bench-event-log, worktree wt-eventlog). Event logs record every agent event per task. This is rejection-sampling self-distillation: it teaches efficiency (shortest successful path), which targets the time-limit failures directly.
- Source B: a stronger cloud teacher run through the sandbox on the same task generator, filtered by the task verifier.
- Quantity: 500 to 2000 filtered trajectories is an unsourced estimate; start with about 300 and look at the learning curve. For agent SFT, quality and diversity of tasks matter more than count, and 500 trajectories x 15 steps is already about 7,500 step examples.
- Selection: keep success, fewest steps among samples per task, no loops, no error recoveries that waste steps (unless the recovery is the lesson).

### Evaluation
- Nine tasks is too few: one task flips the score by 11 points. Build 40 to 60 tasks: 9 current, plus about 20 templated variants on different sites and parameters, plus 20 or more held-out tasks never used for training (different sites, different task types: forms, search, multi-tab, login-free dashboards, long list navigation, file download).
- Metrics: success rate, median steps to success, timeout rate, tokens per task. Run each task 3 times, report mean and per-task variance.
- Compare base vs LoRA vs prompt-only baseline (to check that fine-tuning beats the cheap alternative). Accept only if held-out success is up by at least 8 points with step count down, and no regression on the original 9.
- Keep the training tasks and held-out tasks split by site, not just by instance, to avoid leakage.

### Export back to llama.cpp
1. Preferred: `convert_lora_to_gguf.py` on the adapter against the base HF model, then `llama-server --lora adapter.gguf` next to the existing UD-Q4_K_M and mmproj. No requantization, adapters stay swappable. Needs confirmation that the MoE expert LoRA tensors are supported by llama.cpp's LoRA loader (UNVERIFIED; attention-only LoRA is the safe case).
2. Fallback: merge in bf16 (needs about 70 GB disk plus RAM), convert to GGUF, requantize to Q4_K_M. This loses the Unsloth Dynamic quant calibration of UD-Q4_K_M; quality drift against our current quant must be re-benchmarked.
3. The existing mmproj stays as is since the vision tower is untouched.

## 5. Risks
- Quota denial or delays on a new paid account, with the 90 day clock ticking.
- 74 GB on an 80 GB card is tight; sequence length for screenshot-heavy traces may OOM. RTX PRO 6000 96GB or H100 is safer.
- MoE LoRA tooling is young; expect version pinning and a debugging day.
- Fine-tuned model may overfit the benchmark sites; held-out split is the guard.
- Local serving needs the gate to be in non-gaming mode for eval runs.

## 6. First milestone at $0
1. Check trial signup date and whether the account is already upgraded (console billing page only; no GPU action).
2. From bench-event-log, write an exporter that turns event logs of passing tasks into per-step SFT JSONL in the model's chat template. Count usable steps.
3. Add a trajectory efficiency score (steps vs the shortest known solve) and rank tasks.
4. Extend the benchmark with the 40 to 60 task set and a site-level train/held-out split; run baseline 3x locally (outside gaming mode, using ~/bench-run.sh).
5. Measure prompt-only and step-budget interventions on that set. If those fix the timeouts, stop here.
6. Estimate teacher cost from logged token counts and decide the teacher.
7. Only then, decide to upgrade billing and request A100/H100 or RTX PRO 6000 quota (a form, no GPU spend until an instance is launched).

## 7. Unverified summary
Official GPU hourly prices; quota approval behaviour for new paid accounts; whether credit covers Spot and Vertex managed training; MoE expert LoRA support in PEFT, ms-swift, LLaMA-Factory and llama.cpp LoRA loader; training time estimates (4 h per run is a guess).

## 8. Data milestone status

Built 2026-10-02, no model requests and no GPU involved.

- Exporter: `node scripts/finetune/export-trajectories.js [--in DIR[,DIR]] [--out FILE] [--min-steps N] [--max-steps N]`. It reads every `<run-id>.json` plus its `<run-id>/<task>[.runN].events.jsonl` under `--in` (default `~/bench-results` and its `runs/` subdirectories), keeps rows whose check passed and whose log has no timeout marker, dedups by (task, model, run stamp, run) and writes one chat-format record per trajectory with metadata (task, model, run stamp, steps, wall ms). Screenshots become `[screenshot omitted]`; secrets are redacted by key name and value pattern. The summary line goes to stderr.
- Task set: `scripts/bench/tasks-extended.js` has 55 tasks (the original 10 plus 45 new) across 17 named sites plus one open-web task, tagged by site and difficulty, with 42 train and 13 held-out (six whole sites held out, so the eval measures unseen sites). Run it with `run.js --taskfile tasks-extended.js`. The new tasks have not been run against a model, so each target and check still needs one validation pass.
- Current count: 33 benchmark rows found, 17 passed, 9 exported as trajectories. The other 8 passes predate the event log and have no log to export. Target is about 300.
