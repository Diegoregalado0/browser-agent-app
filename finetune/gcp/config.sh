# shellcheck shell=bash disable=SC2034
# Settings for the Google Cloud LoRA pipeline, sourced by every script in this directory.
# Any variable can be overridden from the environment, for example BASE_MODEL=qwen3.5-4b.

PROJECT="${PROJECT:-YOUR_GCP_PROJECT}"
REGION="${REGION:-us-central1}"
BUCKET="${BUCKET:-gs://YOUR_GCS_BUCKET}"

# The project belongs to this account; every gcloud call in the pipeline runs as it, billed to PROJECT.
GCP_ACCOUNT="${GCP_ACCOUNT:-YOUR_GCP_ACCOUNT}"
export CLOUDSDK_CORE_ACCOUNT="$GCP_ACCOUNT" CLOUDSDK_CORE_PROJECT="$PROJECT" CLOUDSDK_BILLING_QUOTA_PROJECT="$PROJECT"

# Identity of the training VM: writes to BUCKET and deletes its own VM. launch.sh creates it and
# grants those two roles when it is missing, so the project's default compute account stays as it is.
VM_SA_NAME="${VM_SA_NAME:-browsby-trainer-vm}"
VM_SERVICE_ACCOUNT="${VM_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

# Base model key, see model_profile below.
BASE_MODEL="${BASE_MODEL:-qwen3.5-9b}"

# 1 runs the VM as Spot (cheaper, can be preempted), 0 as on-demand.
SPOT="${SPOT:-1}"

# Training refuses to start below this many successful trajectories unless --force is given.
MIN_TRAJECTORIES="${MIN_TRAJECTORIES:-300}"

# Deep Learning VM image with the NVIDIA driver and CUDA preinstalled.
IMAGE_PROJECT="${IMAGE_PROJECT:-deeplearning-platform-release}"
IMAGE_FAMILY="${IMAGE_FAMILY:-common-cu129-ubuntu-2204-nvidia-580}"

# Training hyperparameters passed to train.py on the VM.
LORA_RANK="${LORA_RANK:-16}"
LEARNING_RATE="${LEARNING_RATE:-1e-4}"
EPOCHS="${EPOCHS:-2}"
# Stops training after this many optimizer steps when above 0 (smoke runs); 0 trains all epochs.
MAX_STEPS="${MAX_STEPS:-0}"
MAX_SEQ_LEN="${MAX_SEQ_LEN:-16384}"
UNSLOTH_SPEC="${UNSLOTH_SPEC:-unsloth unsloth_zoo}"

# Labels put on every resource the pipeline creates, so teardown can find them.
LABEL_KEY="browsby-ft"
LABEL_VALUE="1"

# Sets HF_MODEL, LOADER, LOAD_4BIT, MACHINE_TYPE, GPU_DESC, ZONE, DISK_GB and MAX_RUN_HOURS for a
# base model key. Every machine type here comes with its GPU attached, so no --accelerator flag is
# needed. GPU=a100-80 moves any model onto the A100 80GB shape (the quota that was requested);
# the L4 shape needs its own NVIDIA_L4_GPUS quota.
model_profile() {
  case "$1" in
    qwen3.6-35b-a3b)
      HF_MODEL="${HF_MODEL:-Qwen/Qwen3.6-35B-A3B}"
      LOADER=moe LOAD_4BIT=0              # bf16 LoRA, about 74 GB VRAM per Unsloth
      MACHINE_TYPE=a2-ultragpu-1g GPU_DESC="1 x A100 80GB" ZONE="${ZONE:-us-central1-a}"
      DISK_GB="${DISK_GB:-300}" MAX_RUN_HOURS="${MAX_RUN_HOURS:-8}"
      ;;
    qwen3.5-9b)
      HF_MODEL="${HF_MODEL:-Qwen/Qwen3.5-9B}"
      LOADER=dense LOAD_4BIT=0            # bf16 LoRA, about 22 GB: too tight for a 24 GB L4
      MACHINE_TYPE=a2-ultragpu-1g GPU_DESC="1 x A100 80GB" ZONE="${ZONE:-us-central1-a}"
      DISK_GB="${DISK_GB:-150}" MAX_RUN_HOURS="${MAX_RUN_HOURS:-5}"
      ;;
    qwen3.5-4b)
      HF_MODEL="${HF_MODEL:-Qwen/Qwen3.5-4B}"
      LOADER=dense LOAD_4BIT=0            # bf16 LoRA, about 10 GB
      MACHINE_TYPE=g2-standard-8 GPU_DESC="1 x L4 24GB" ZONE="${ZONE:-us-central1-a}"
      DISK_GB="${DISK_GB:-100}" MAX_RUN_HOURS="${MAX_RUN_HOURS:-6}"
      ;;
    *)
      echo "unknown BASE_MODEL '$1' (qwen3.6-35b-a3b, qwen3.5-9b, qwen3.5-4b)" >&2
      return 1
      ;;
  esac
  if [ "${GPU:-}" = "a100-80" ]; then
    MACHINE_TYPE=a2-ultragpu-1g GPU_DESC="1 x A100 80GB" LOAD_4BIT=0
    case "$ZONE" in us-central1-a|us-central1-c) ;; *) ZONE=us-central1-a ;; esac
  fi
}

# Prints a command when DRY_RUN=1, runs it otherwise.
run() {
  if [ "${DRY_RUN:-0}" = "1" ]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}
