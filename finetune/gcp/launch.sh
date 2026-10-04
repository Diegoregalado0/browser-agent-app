#!/bin/bash
# Starts one training run: uploads the prepared data and train.py to the project bucket, then
# creates a GPU VM sized for BASE_MODEL whose startup script trains and deletes the VM when done.
# The VM is capped three ways: the in-VM watchdog, --max-run-duration with termination action
# DELETE, and the training deadline. This spends money; --dry-run prints the commands instead.
#
# Usage: finetune/gcp/launch.sh [--dry-run] [--run-id ID] [--data-dir DIR]
# Prints the run id on the last line of output.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=finetune/gcp/config.sh
. "$HERE/config.sh"
guard_gcp

DATA_DIR="$HERE/data"
RUN_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --run-id) RUN_ID=$2; shift ;;
    --data-dir) DATA_DIR=$2; shift ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
  shift
done

model_profile "$BASE_MODEL"
RUN_ID=${RUN_ID:-$(date -u +%Y%m%d-%H%M%S)-$BASE_MODEL}
RUN_ID=${RUN_ID//./-}
VM="ft-${RUN_ID}"
VM=${VM:0:62}
DEST="$BUCKET/runs/$RUN_ID"

for f in train.jsonl eval.jsonl manifest.json; do
  [ -f "$DATA_DIR/$f" ] || { echo "missing $DATA_DIR/$f; run prepare-data.mjs first" >&2; exit 1; }
done

echo "run $RUN_ID: $BASE_MODEL ($HF_MODEL) on $MACHINE_TYPE, $GPU_DESC, $ZONE, spot=$SPOT, disk ${DISK_GB}GB, max ${MAX_RUN_HOURS}h, 4bit=$LOAD_4BIT, seq $MAX_SEQ_LEN, rank $LORA_RANK, epochs $EPOCHS"

if [ "${DRY_RUN:-0}" = "1" ] || ! gcp storage buckets describe "$BUCKET" >/dev/null 2>&1; then
  run gcp storage buckets create "$BUCKET" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention
fi
if [ "${DRY_RUN:-0}" = "1" ] || ! gcp iam service-accounts describe "$VM_SERVICE_ACCOUNT" >/dev/null 2>&1; then
  run gcp iam service-accounts create "$VM_SA_NAME" --display-name "Browsby fine-tune VM"
  run gcp projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$VM_SERVICE_ACCOUNT" \
    --role roles/compute.instanceAdmin.v1 --condition None --quiet --format none
fi
if [ "${DRY_RUN:-0}" = "1" ] || ! gcp storage buckets get-iam-policy "$BUCKET" --format json | grep -q "serviceAccount:$VM_SERVICE_ACCOUNT"; then
  run gcp storage buckets add-iam-policy-binding "$BUCKET" --member "serviceAccount:$VM_SERVICE_ACCOUNT" \
    --role roles/storage.objectAdmin --format none
fi
run gcp storage cp "$DATA_DIR/train.jsonl" "$DATA_DIR/eval.jsonl" "$DATA_DIR/manifest.json" "$DEST/data/"
run gcp storage cp "$HERE/train.py" "$DEST/train.py"

TRAIN_ARGS="--rank $LORA_RANK --alpha $LORA_ALPHA --targets $LORA_TARGETS --lr $LEARNING_RATE --epochs $EPOCHS --max-seq-len $MAX_SEQ_LEN --grad-accum $GRAD_ACCUM --eval-steps $EVAL_STEPS --max-eval $MAX_EVAL --max-steps $MAX_STEPS"
[ "$MERGE_16BIT" = "1" ] && TRAIN_ARGS="$TRAIN_ARGS --merge-16bit"
create_vm() {
  local provisioning=$1
  run gcp compute instances create "$VM" \
    --zone "$ZONE" \
    --machine-type "$MACHINE_TYPE" \
    "$provisioning" \
    --maintenance-policy=TERMINATE \
    --instance-termination-action=DELETE \
    --max-run-duration="${MAX_RUN_HOURS}h" \
    --image-project "$IMAGE_PROJECT" --image-family "$IMAGE_FAMILY" \
    --boot-disk-size "${DISK_GB}GB" --boot-disk-type pd-balanced --boot-disk-auto-delete \
    --service-account "$VM_SERVICE_ACCOUNT" --scopes cloud-platform \
    --labels "$LABEL_KEY=$LABEL_VALUE,run=${RUN_ID:0:63}" \
    --metadata "install-nvidia-driver=True,bucket=$BUCKET,run_id=$RUN_ID,hf_model=$HF_MODEL,loader=$LOADER,load_4bit=$LOAD_4BIT,max_hours=$MAX_RUN_HOURS,unsloth_spec=$UNSLOTH_SPEC,train_args=$TRAIN_ARGS" \
    --metadata-from-file startup-script="$HERE/startup.sh"
}
if [ "$SPOT" = "1" ]; then
  create_vm --provisioning-model=SPOT || {
    [ "$SPOT_FALLBACK" = "1" ] || exit 1
    echo "Spot create failed; retrying as on-demand" >&2
    create_vm --provisioning-model=STANDARD
  }
else
  create_vm --provisioning-model=STANDARD
fi

echo "$RUN_ID"
