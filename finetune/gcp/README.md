# LoRA fine-tuning on Google Cloud

Trains a LoRA adapter for a Browsby base model on one rented GPU, then brings it back as a GGUF
adapter for `llama-server --lora`. Method and background: `experiments/finetune/RESEARCH.md`.

Project `YOUR_GCP_PROJECT` (account YOUR_GCP_ACCOUNT), billing account
`XXXXXX-XXXXXX-XXXXXX` (the $300 credit). Every script starts with `guard_gcp` from `config.sh`, which
refuses to run unless the active gcloud account, the project and its billing account are exactly those
and billing is enabled; all gcloud calls pass `--account` and `--project` explicitly. The training VM runs
as its own service account `browsby-trainer-vm`, which `launch.sh` creates with instance admin on the
project and object admin on the bucket. Every setting lives in `config.sh` and can be overridden from the
environment.

## One command

```sh
BASE_MODEL=qwen3.5-9b finetune/gcp/run.sh            # prepare, launch, wait, fetch, teardown
BASE_MODEL=qwen3.5-9b finetune/gcp/run.sh --dry-run  # same, printing every gcloud command
```

`run.sh` passes extra options to `prepare-data.mjs` (for example `--force` or `--in DIR`), and
runs `teardown.sh` on exit whatever happens.

## Steps

| Script | What it does |
|---|---|
| `prepare-data.mjs` | Runs the trajectory exporter over `~/bench-results`, drops held-out benchmark sites, splits the rest into train and eval by site, writes one example per assistant turn with the agent's tool definitions to `data/`. Exits 2 below `MIN_TRAJECTORIES` (300) unless `--force`. |
| `launch.sh` | Creates the bucket if needed, uploads data and `train.py`, creates the VM service account if missing, creates the VM (Spot by default) with `--max-run-duration`, termination action DELETE and `startup.sh`. Prints the run id. |
| `startup.sh` | On the VM: installs Unsloth, trains with a deadline, converts the adapter to GGUF, uploads adapter, GGUF, metrics and logs to `gs://BUCKET/runs/RUN_ID/`, then deletes its own VM. A watchdog powers it off at `MAX_RUN_HOURS`. |
| `train.py` | Unsloth LoRA, text only, loss on the last assistant turn of each example, router and vision frozen. |
| `fetch.sh RUN_ID` | Downloads the run into `out/RUN_ID/`; converts to GGUF locally with `~/llama.cpp/convert_lora_to_gguf.py` if the VM did not. |
| `teardown.sh [--bucket]` | Deletes every VM and disk labeled `browsby-ft=1` (and `ft-*` disks), optionally the bucket. |

## Base models

Only a single L4 (24 GB) is available to the account (A100 quota was refused), so the supported
profiles are the two small dense models, both on g2-standard-8 + 1 x L4, Spot by default with an
on-demand retry when Spot has no capacity (`SPOT_FALLBACK=1`, `SPOT=0` to start on-demand).
`qwen3.6-35b-a3b` needs an A100 80GB and stays only for when that quota exists; `GPU=a100-80`
moves any model to the A100 shape. Every value below is set in `model_profile` and can be
overridden from the environment.

| | `qwen3.5-4b` | `qwen3.5-9b` |
|---|---|---|
| Hugging Face id (post-trained, same as the local GGUF) | Qwen/Qwen3.5-4B | Qwen/Qwen3.5-9B |
| Method | bf16 LoRA | QLoRA (4-bit NF4 base via bitsandbytes) |
| max_seq_length | 12288 | 10240 |
| Batch | 1 x grad accum 16 | 1 x grad accum 16 |
| LoRA | r 32, alpha 32, attention + linear attention + MLP | same |
| lr / epochs | 1e-4 / 2 | 2e-4 / 1 |
| Eval | every 25 steps, 40 eval examples | every 50 steps, 40 eval examples |
| Gradient checkpointing | "unsloth" | "unsloth" |
| Disk / max hours | 100 GB / 14 | 150 GB / 32 |

Qwen3.5 has 32 layers of which 24 are gated DeltaNet linear attention, so the LoRA targets include
`in_proj_qkv`, `in_proj_z` and `out_proj` besides `q/k/v/o_proj` and the MLP. Override with
`LORA_TARGETS=q_proj+k_proj+...` (joined by +) if the GGUF converter rejects them.

Sequence length. Token lengths estimated from the prepared data at about 3.3 characters per token
(no tokenizer is available off the VM): median about 5k, p90 about 8k, p99 about 18k, max about 26k
tokens, with the system prompt and tool definitions (about 1.5k tokens) included. 12288 drops about
1% of examples and 10240 about 3%; 8192 would drop about 10%. Examples over the limit are dropped
rather than truncated, because the trained assistant turn is at the end; `train.py` prints the
dropped counts and the kept token percentiles. Screenshots are not in the data (text only).

VRAM estimate on the L4 (Qwen3.5 vocabulary is 248k, hidden 2560 / 4096, 32 layers):

| | 4B bf16 | 9B QLoRA |
|---|---|---|
| Base weights | about 9 GB (4.5B params x 2 bytes, vision tower included) | about 9 GB (about 7.5B x 0.5 byte, plus embeddings and head in 16-bit about 4 GB, vision) |
| LoRA weights, grads, 8-bit Adam (r 32, about 100M params) | 0.6 GB | 0.9 GB |
| Saved layer inputs with Unsloth checkpointing (seq x hidden x 2 bytes x 32 layers) | 12288 x 2560 x 2 x 32 = 2.0 GB | 10240 x 4096 x 2 x 32 = 2.7 GB |
| One layer recomputed (MLP intermediate, attention) | about 1.2 GB | about 1.6 GB |
| Loss over the 248k vocabulary (Unsloth chunked cross entropy) | about 1.5 GB | about 1.5 GB |
| CUDA context, allocator slack | about 1.5 GB | about 1.5 GB |
| Peak | about 16 GB | about 18 GB |

Both stay under 22 GB. Biggest uncertainty: if the loss is not chunked, the fp32 logits at
12288 tokens would be 12 GB; the first run should read `nvidia-smi` and lower `MAX_SEQ_LEN` if the
peak passes 21 GB.

## Export

`startup.sh` runs `convert_lora_to_gguf.py --base-model-id HF_MODEL` on the VM; `fetch.sh` repeats
it locally when the GGUF is missing. The converter reads only the adapter tensors (LoRA A and B,
saved in 16-bit by PEFT) and the base model's config, never the base weights, so an adapter trained
on the 4-bit base converts exactly like a bf16 one and is applied by llama.cpp on top of the
bf16-derived GGUF: `llama-server -m Qwen3.5-9B-IQ4_XS.gguf --mmproj ... --lora adapter.gguf`. The
adapter was trained against the quantization noise of NF4, so on the IQ4_XS or Q8_0 base it sees a
slightly different base than in training (the usual QLoRA behaviour; a small quality loss at worst).

Fallback: run with `MERGE_16BIT=1`. `train.py` then also saves the merged 16-bit model on the VM
(`save_pretrained_merged`), `startup.sh` uploads it, and when `convert_lora_to_gguf.py` rejects the
adapter `fetch.sh` converts the merge with `convert_hf_to_gguf.py` to a bf16 GGUF for
`llama-quantize`. Cost of the merge: 4B about 8 GB and 5 minutes; 9B about 19 GB, loaded on the CPU
(32 GB RAM is enough), 15 to 20 minutes, and 19 GB more disk plus upload (disk sizes above cover it).
The merge of a QLoRA model is made against the dequantized base, so it is the less faithful route.

## Quota

New projects start at 0 GPUs. Needed before the first launch: `NVIDIA_L4_GPUS` = 1 in us-central1
(granted) and `GPUS_ALL_REGIONS` = 1. Spot VMs use the preemptible L4 quota (1, granted).

## Cost of one round

Prices are the official us-central1 list prices from the Cloud Billing Catalog API, fetched
2026-10-03 (SKUs A88A-5A60-E821 and AEC2-3D5C-61BF for the L4, plus the G2 core and RAM SKUs; same
numbers as https://cloud.google.com/compute/gpus-pricing). Spot prices can change daily.

| Machine | On-demand $/h | Spot $/h |
|---|---|---|
| g2-standard-8 (8 vCPU, 32 GB, L4) | 0.85 | 0.51 |

Estimate (throughput is not measured yet, expect plus or minus 50%). A trajectory gives about 8
step examples of about 6k tokens, so 300 trajectories are about 2,400 examples, 14M tokens per
epoch. LoRA with checkpointing costs about 6 x parameters FLOPs per token; at about 35 TFLOPs
effective on an L4 that is about 1,450 tokens/s for the 4B and, with 4-bit dequantization, about
460 tokens/s for the 9B. Setup (driver, install, model download) and export add about 1 hour for the
4B and 1.2 hours for the 9B.

| Profile | Trajectories | Epochs | Hours | Spot | On-demand |
|---|---|---|---|---|---|
| qwen3.5-4b | 300 | 2 | 6.5 | $3.3 | $5.5 |
| qwen3.5-4b | 1000 | 1 | 10.2 | $5.2 | $8.7 |
| qwen3.5-9b | 300 | 1 | 9.9 | $5.0 | $8.4 |
| qwen3.5-9b | 1000 | 1 | 30.2 | $15.4 | $25.7 |

Hours scale as 14M tokens per 300 trajectories per epoch divided by the tokens/s above. At 1000
trajectories a second epoch doubles the training part (4B 19 h, 9B 59 h), so keep it at one.
Spot runs over about 10 hours are likely to be preempted, and the VM is deleted on preemption
(checkpoints are lost): use `SPOT=0` for the 9B at 1000 trajectories. Disk and bucket add well under
$1 per round.

## Notes

- One example per agent step, not per trajectory: Qwen chat templates drop the reasoning of
  earlier assistant turns, so each turn is trained against exactly the prompt the server renders.
- Held-out benchmark sites (`HELDOUT_SITES` in `scripts/bench/tasks-extended.js`) never reach
  training; eval sites are chosen from the rest by a stable hash of the site name.
- MoE expert LoRA support in llama.cpp's adapter loader is not confirmed; if the GGUF adapter
  fails to load, merge in bf16 and requantize (RESEARCH.md section 4).
