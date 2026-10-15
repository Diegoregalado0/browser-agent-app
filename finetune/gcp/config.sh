# shellcheck shell=bash disable=SC2034
# Settings for the Google Cloud LoRA pipeline, sourced by every script in this directory.
# Any variable can be overridden from the environment, for example BASE_MODEL=qwen3.5-4b.

# The only account, project and billing account the pipeline may ever use, plus the bucket, come from
# config.local.sh next to this file (not committed; copy config.example.sh). They are constants, not
# environment overridable; guard_gcp refuses to run anything else.
if [ ! -f "$HERE/config.local.sh" ]; then
  echo "config: missing $HERE/config.local.sh, copy config.example.sh and fill it in." >&2
  exit 1
fi
# shellcheck source=finetune/gcp/config.example.sh
. "$HERE/config.local.sh"
readonly ALLOWED_ACCOUNT ALLOWED_PROJECT ALLOWED_BILLING

PROJECT="${PROJECT:-$ALLOWED_PROJECT}"
REGION="${REGION:-us-central1}"
BUCKET="${BUCKET:-$LOCAL_BUCKET}"
GCP_ACCOUNT="${GCP_ACCOUNT:-$ALLOWED_ACCOUNT}"
export CLOUDSDK_CORE_ACCOUNT="$GCP_ACCOUNT" CLOUDSDK_CORE_PROJECT="$PROJECT"

# Every gcloud call in the pipeline goes through this, so the account and project are explicit and a
# changed gcloud default cannot redirect it.
gcp() {
  command gcloud --account "$GCP_ACCOUNT" --project "$PROJECT" "$@"
}

# Fails unless the active account, the target project and its billing account are the allowed ones
# and billing is enabled. Runs read-only gcloud calls only. GUARD_SIMULATE=account|billing corrupts
# the observed value to prove the refusal; it can only make the guard stricter.
guard_gcp() {
  local active billing enabled
  active=$(env -u CLOUDSDK_CORE_ACCOUNT gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n 1)
  [ "${GUARD_SIMULATE:-}" = "account" ] && active="${active}.simulated"
  if [ "$active" != "$ALLOWED_ACCOUNT" ] || [ "$GCP_ACCOUNT" != "$ALLOWED_ACCOUNT" ]; then
    echo "guard: refusing to run. Active gcloud account '${active}' and pipeline account '${GCP_ACCOUNT}' must both be exactly ${ALLOWED_ACCOUNT}." >&2
    exit 1
  fi
  if [ "$PROJECT" != "$ALLOWED_PROJECT" ]; then
    echo "guard: refusing to run. Project '${PROJECT}' is not ${ALLOWED_PROJECT}." >&2
    exit 1
  fi
  billing=$(gcp billing projects describe "$PROJECT" --format='value(billingAccountName)' 2>/dev/null || true)
  enabled=$(gcp billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || true)
  [ "${GUARD_SIMULATE:-}" = "billing" ] && billing="${billing}-simulated"
  if [ "$billing" != "$ALLOWED_BILLING" ]; then
    echo "guard: refusing to run. Billing account of ${PROJECT} is '${billing}', must be exactly ${ALLOWED_BILLING}." >&2
    exit 1
  fi
  if [ "$enabled" != "True" ]; then
    echo "guard: refusing to run. Billing is not enabled on ${PROJECT}." >&2
    exit 1
  fi
}

# Identity of the training VM: writes to BUCKET and deletes its own VM. launch.sh creates it and
# grants those two roles when it is missing, so the project's default compute account stays as it is.
VM_SA_NAME="${VM_SA_NAME:-${LOCAL_VM_SA_NAME:-browsby-trainer-vm}}"
VM_SERVICE_ACCOUNT="${VM_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

# Base model key, see model_profile below.
BASE_MODEL="${BASE_MODEL:-qwen3.5-9b}"

# 1 runs the VM as Spot (cheaper, can be preempted), 0 as on-demand. With SPOT_FALLBACK=1 a Spot
# create that fails (no capacity) is retried once as on-demand.
SPOT="${SPOT:-1}"
SPOT_FALLBACK="${SPOT_FALLBACK:-1}"

# Training refuses to start below this many successful trajectories unless --force is given.
MIN_TRAJECTORIES="${MIN_TRAJECTORIES:-300}"

# Deep Learning VM image with the NVIDIA driver and CUDA preinstalled.
IMAGE_PROJECT="${IMAGE_PROJECT:-deeplearning-platform-release}"
IMAGE_FAMILY="${IMAGE_FAMILY:-common-cu129-ubuntu-2204-nvidia-580}"

# Stops training after this many optimizer steps when above 0 (smoke runs); 0 trains all epochs.
MAX_STEPS="${MAX_STEPS:-0}"
UNSLOTH_SPEC="${UNSLOTH_SPEC:-unsloth unsloth_zoo bitsandbytes}"

# Labels put on every resource the pipeline creates, so teardown can find them.
LABEL_KEY="browsby-ft"
LABEL_VALUE="1"

# Sets HF_MODEL, LOADER, LOAD_4BIT, MACHINE_TYPE, GPU_DESC, ZONE, DISK_GB, MAX_RUN_HOURS and the
# training hyperparameters (LORA_RANK, LORA_ALPHA, LORA_TARGETS, LEARNING_RATE, EPOCHS, MAX_SEQ_LEN,
# GRAD_ACCUM, EVAL_STEPS, MAX_EVAL, MERGE_16BIT) for a base model key. Each can be overridden from the environment.
# The micro batch is always 1; GRAD_ACCUM sets the effective batch. Every machine type here comes with its GPU attached, so no --accelerator flag is
# needed. GPU=a100-80 moves any model onto the A100 80GB shape (the quota that was requested);
# the L4 shape needs its own NVIDIA_L4_GPUS quota.
model_profile() {
  case "$1" in
    qwen3.6-35b-a3b)
      HF_MODEL="${HF_MODEL:-Qwen/Qwen3.6-35B-A3B}"
      LOADER=moe LOAD_4BIT=0              # bf16 LoRA, about 74 GB VRAM per Unsloth
      MACHINE_TYPE=a2-ultragpu-1g GPU_DESC="1 x A100 80GB" ZONE="${ZONE:-us-central1-a}"
      DISK_GB="${DISK_GB:-300}" MAX_RUN_HOURS="${MAX_RUN_HOURS:-8}"
      LORA_RANK="${LORA_RANK:-16}" LORA_ALPHA="${LORA_ALPHA:-16}" LEARNING_RATE="${LEARNING_RATE:-1e-4}"
      EPOCHS="${EPOCHS:-2}" MAX_SEQ_LEN="${MAX_SEQ_LEN:-16384}" GRAD_ACCUM="${GRAD_ACCUM:-8}"
      EVAL_STEPS="${EVAL_STEPS:-0}" MAX_EVAL="${MAX_EVAL:-0}" MERGE_16BIT="${MERGE_16BIT:-0}"
      ;;
    qwen3.5-9b)
      # Post-trained Qwen3.5-9B, the checkpoint behind /home/dreg3/models/Qwen3.5-9B (IQ4_XS).
      # QLoRA: 4-bit NF4 base (about 9 GB with the 16-bit embeddings and head), peak about 17 GB.
      HF_MODEL="${HF_MODEL:-Qwen/Qwen3.5-9B}"
      LOADER=dense LOAD_4BIT=1
      MACHINE_TYPE=g2-standard-8 GPU_DESC="1 x L4 24GB" ZONE="${ZONE:-us-central1-a}"
      DISK_GB="${DISK_GB:-150}" MAX_RUN_HOURS="${MAX_RUN_HOURS:-32}"
      LORA_RANK="${LORA_RANK:-32}" LORA_ALPHA="${LORA_ALPHA:-32}" LEARNING_RATE="${LEARNING_RATE:-2e-4}"
      EPOCHS="${EPOCHS:-1}" MAX_SEQ_LEN="${MAX_SEQ_LEN:-10240}" GRAD_ACCUM="${GRAD_ACCUM:-16}"
      EVAL_STEPS="${EVAL_STEPS:-50}" MAX_EVAL="${MAX_EVAL:-40}" MERGE_16BIT="${MERGE_16BIT:-0}"
      ;;
    qwen3.5-4b)
      # Post-trained Qwen3.5-4B, the checkpoint behind /home/dreg3/models/Qwen3.5-4B (Q8_0).
      # bf16 LoRA: about 9 GB of weights, peak about 15 GB.
      HF_MODEL="${HF_MODEL:-Qwen/Qwen3.5-4B}"
      LOADER=dense LOAD_4BIT=0
      MACHINE_TYPE=g2-standard-8 GPU_DESC="1 x L4 24GB" ZONE="${ZONE:-us-central1-a}"
      DISK_GB="${DISK_GB:-100}" MAX_RUN_HOURS="${MAX_RUN_HOURS:-14}"
      LORA_RANK="${LORA_RANK:-32}" LORA_ALPHA="${LORA_ALPHA:-32}" LEARNING_RATE="${LEARNING_RATE:-1e-4}"
      EPOCHS="${EPOCHS:-2}" MAX_SEQ_LEN="${MAX_SEQ_LEN:-12288}" GRAD_ACCUM="${GRAD_ACCUM:-16}"
      EVAL_STEPS="${EVAL_STEPS:-25}" MAX_EVAL="${MAX_EVAL:-40}" MERGE_16BIT="${MERGE_16BIT:-0}"
      ;;
    *)
      echo "unknown BASE_MODEL '$1' (qwen3.6-35b-a3b, qwen3.5-9b, qwen3.5-4b)" >&2
      return 1
      ;;
  esac
  # Attention, linear-attention (Qwen3.5 gated DeltaNet) and MLP projections, joined by + for instance metadata.
  LORA_TARGETS="${LORA_TARGETS:-q_proj+k_proj+v_proj+o_proj+in_proj_qkv+in_proj_z+out_proj+gate_proj+up_proj+down_proj}"
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
