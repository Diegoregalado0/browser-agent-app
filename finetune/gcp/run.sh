#!/bin/bash
# One command for a whole round: prepare the data, launch the VM, wait for it to finish and
# delete itself, fetch the adapter, and tear down anything left. Extra options go to
# prepare-data.mjs (for example --force or --in DIR).
#
# Usage: BASE_MODEL=qwen3.5-9b finetune/gcp/run.sh [--dry-run] [prepare-data options]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
# shellcheck source=finetune/gcp/config.sh
. "$HERE/config.sh"
guard_gcp

DRY=()
PREP_ARGS=()
for a in "$@"; do
  if [ "$a" = "--dry-run" ]; then DRY=(--dry-run); DRY_RUN=1; else PREP_ARGS+=("$a"); fi
done
model_profile "$BASE_MODEL"

node "$ROOT/finetune/gcp/prepare-data.mjs" --min "$MIN_TRAJECTORIES" "${PREP_ARGS[@]}"

RUN_ID=$(DRY_RUN="${DRY_RUN:-0}" "$HERE/launch.sh" "${DRY[@]}" | tee /dev/stderr | tail -n 1)
# Whatever happens from here on, nothing is left running.
trap '"$HERE/teardown.sh" "${DRY[@]}"' EXIT

if [ "${DRY_RUN:-0}" != "1" ]; then
  deadline=$(( $(date +%s) + MAX_RUN_HOURS * 3600 + 1800 ))
  echo "waiting for run $RUN_ID (status file in $BUCKET/runs/$RUN_ID/STATUS)"
  until gcp storage cat "$BUCKET/runs/$RUN_ID/STATUS" 2>/dev/null; do
    if [ "$(date +%s)" -gt "$deadline" ]; then echo "run did not report a status in time" >&2; break; fi
    if [ -z "$(gcp compute instances list --filter "labels.run=$RUN_ID" --format "value(name)")" ]; then
      echo "VM is gone without a status (preempted or deleted); check $BUCKET/runs/$RUN_ID/browsby-ft.log" >&2
      break
    fi
    sleep 120
  done
fi

"$HERE/fetch.sh" "${DRY[@]}" "$RUN_ID"
