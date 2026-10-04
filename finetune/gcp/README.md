# LoRA fine-tuning on Google Cloud

Trains a LoRA adapter for a Browsby base model on one rented GPU, then brings it back as a GGUF
adapter for `llama-server --lora`. Method and background: `experiments/finetune/RESEARCH.md`.

Project `YOUR_GCP_PROJECT` (owned by YOUR_GCP_ACCOUNT, where the GPU
quota was granted), billing account `XXXXXX-XXXXXX-XXXXXX`, budget "browsby-ft YOUR_GCP_PROJECT
300" ($300, alerts at 50, 90 and 100 percent, mailed to the billing admins). The training VM runs
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

| `BASE_MODEL` | Hugging Face id | Machine | Mode | Disk | Max hours |
|---|---|---|---|---|---|
| `qwen3.6-35b-a3b` | Qwen/Qwen3.6-35B-A3B | a2-ultragpu-1g, 1 x A100 80GB | bf16 LoRA (about 74 GB) | 300 GB | 8 |
| `qwen3.5-9b` | Qwen/Qwen3.5-9B | a2-ultragpu-1g, 1 x A100 80GB | bf16 LoRA (about 22 GB) | 150 GB | 5 |
| `qwen3.5-4b` | Qwen/Qwen3.5-4B | g2-standard-8, 1 x L4 24GB | bf16 LoRA (about 10 GB) | 100 GB | 6 |

VRAM figures are Unsloth's (https://unsloth.ai/docs/models/qwen3.5/fine-tune). `GPU=a100-80`
moves any model to the A100 shape. A100 80GB exists only in us-central1-a and -c.

## Quota

New projects start at 0 GPUs. Needed before the first launch: `NVIDIA_A100_80GB_GPUS` = 1 in
us-central1 and `GPUS_ALL_REGIONS` = 1 (Spot VMs use the regular quota when no preemptible quota
is granted). The 4B profile on L4 also needs `NVIDIA_L4_GPUS` = 1.

## Cost of one round

Prices are the official us-central1 list prices from the Cloud Billing Catalog API, fetched
2026-10-03 (SKUs EDA0-3A70-3138 and DD90-547C-2AAA for the A100 80GB, A88A-5A60-E821 and
AEC2-3D5C-61BF for the L4, plus the A2 and G2 core and RAM SKUs; same numbers as
https://cloud.google.com/compute/gpus-pricing and https://cloud.google.com/compute/vm-instance-pricing).
Spot prices can change daily.

| Machine | On-demand $/h | Spot $/h |
|---|---|---|
| a2-ultragpu-1g (12 vCPU, 170 GB, A100 80GB) | 5.03 | 3.02 |
| g2-standard-8 (8 vCPU, 32 GB, L4) | 0.85 | 0.51 |
| a3-highgpu-1g (H100 80GB, Spot only for 1 GPU) | n/a | 6.57 |

A round at 300 trajectories is about 2,600 step examples of about 5k tokens, so about 26M
training tokens for 2 epochs. Hours below are estimates (throughput not measured yet), including
about an hour of install, model download and conversion.

| Base model | Hours | Spot | On-demand |
|---|---|---|---|
| qwen3.6-35b-a3b on A100 80GB | about 5 | about $15 | about $25 |
| qwen3.5-9b on A100 80GB | about 3 | about $9 | about $15 |
| qwen3.5-4b on L4 | about 5 | about $3 | about $4 |

Disk (pd-balanced, $0.10 per GB-month) and the bucket add well under $1 per round.

## Notes

- One example per agent step, not per trajectory: Qwen chat templates drop the reasoning of
  earlier assistant turns, so each turn is trained against exactly the prompt the server renders.
- Held-out benchmark sites (`HELDOUT_SITES` in `scripts/bench/tasks-extended.js`) never reach
  training; eval sites are chosen from the rest by a stable hash of the site name.
- MoE expert LoRA support in llama.cpp's adapter loader is not confirmed; if the GGUF adapter
  fails to load, merge in bf16 and requantize (RESEARCH.md section 4).
