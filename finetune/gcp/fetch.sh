#!/bin/bash
# Downloads a finished run (adapter, GGUF adapter, metrics, logs) from the bucket into
# finetune/gcp/out/RUN_ID and makes sure a GGUF adapter exists. The VM normally converts the
# adapter itself; when it did not, this converts it locally with llama.cpp's
# convert_lora_to_gguf.py, which reads the base model's config from Hugging Face (no weights).
#
# Usage: finetune/gcp/fetch.sh [--dry-run] RUN_ID
# Serve with: llama-server -m <base>.gguf --lora finetune/gcp/out/RUN_ID/adapter.gguf
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=finetune/gcp/config.sh
. "$HERE/config.sh"

RUN_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -*) echo "unknown option $1" >&2; exit 1 ;;
    *) RUN_ID=$1 ;;
  esac
  shift
done
[ -n "$RUN_ID" ] || { echo "usage: fetch.sh [--dry-run] RUN_ID" >&2; exit 1; }
model_profile "$BASE_MODEL"

LLAMA_CPP="${LLAMA_CPP:-$HOME/llama.cpp}"
PYTHON="${PYTHON:-python3}"
OUT="$HERE/out/$RUN_ID"
SRC="$BUCKET/runs/$RUN_ID"

run mkdir -p "$OUT"
run gcloud storage cp -r "$SRC/*" "$OUT/"
if [ "${DRY_RUN:-0}" != "1" ]; then
  status=$(cat "$OUT/STATUS" 2>/dev/null || echo missing)
  echo "run status: $status"
  [ -d "$OUT/adapter" ] || { echo "no adapter in $SRC; see $OUT/browsby-ft.log" >&2; exit 1; }
fi

if [ "${DRY_RUN:-0}" = "1" ] || [ ! -f "$OUT/adapter.gguf" ]; then
  run "$PYTHON" "$LLAMA_CPP/convert_lora_to_gguf.py" --base-model-id "$HF_MODEL" \
    --outtype f16 --outfile "$OUT/adapter.gguf" "$OUT/adapter"
fi
echo "adapter: $OUT/adapter.gguf"
